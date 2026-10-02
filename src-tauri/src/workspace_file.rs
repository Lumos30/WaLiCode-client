//! Desktop workspace file operations requested through the Agent SSE channel.
//!
//! The workspace root is selected and registered by the native process. The
//! renderer and server only receive an opaque workspace ID plus relative paths.

use crate::project_index::ProjectIndexRegistry;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
use uuid::Uuid;

const MAX_FILE_BYTES: u64 = 2_000_000;
const READ_CHUNK_BYTES: usize = 64 * 1024;
const ATOMIC_TEMP_FILE_PREFIX: &str = ".walicode-write-";
const MAX_DIRECTORY_ENTRIES: usize = 200;
const MAX_SEARCH_MATCHES: usize = 100;
const MAX_OPERATION_TIMEOUT_MS: u64 = 60_000;
const SKIPPED_DIRECTORIES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "out",
];

#[derive(Clone)]
struct AuthorizedWorkspace {
    id: String,
    root: PathBuf,
}

#[derive(Default)]
pub(crate) struct WorkspaceRegistry {
    current: Mutex<Option<AuthorizedWorkspace>>,
    active_operations: Mutex<HashMap<String, Arc<OperationControl>>>,
    cancelled_operation_ids: Mutex<HashSet<String>>,
}

struct OperationControl {
    cancelled: AtomicBool,
    deadline: Option<Instant>,
    mutation_gate: Mutex<()>,
}

impl OperationControl {
    #[cfg(test)]
    fn unbounded() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            deadline: None,
            mutation_gate: Mutex::new(()),
        }
    }

    fn with_deadline(deadline_ms: u64) -> Result<Self, String> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "系统时间不可用".to_string())?
            .as_millis() as u64;
        if deadline_ms <= now_ms {
            return Err("本地文件操作已超过执行截止时间".to_string());
        }
        if deadline_ms - now_ms > MAX_OPERATION_TIMEOUT_MS {
            return Err("本地文件操作截止时间超过允许上限".to_string());
        }
        Ok(Self {
            cancelled: AtomicBool::new(false),
            deadline: Some(Instant::now() + Duration::from_millis(deadline_ms - now_ms)),
            mutation_gate: Mutex::new(()),
        })
    }

    fn checkpoint(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::SeqCst) {
            return Err("本地文件操作已取消".to_string());
        }
        if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            return Err("本地文件操作已超时".to_string());
        }
        Ok(())
    }

    fn mutate<T>(&self, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let _gate = self
            .mutation_gate
            .lock()
            .map_err(|_| "本地文件操作状态不可用".to_string())?;
        self.checkpoint()?;
        action()
    }
}

struct OperationLease<'a> {
    registry: &'a WorkspaceRegistry,
    id: String,
    control: Arc<OperationControl>,
}

impl Drop for OperationLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut operations) = self.registry.active_operations.lock() {
            operations.remove(&self.id);
        }
    }
}

impl WorkspaceRegistry {
    fn register(&self, root: PathBuf) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let mut current = self
            .current
            .lock()
            .map_err(|_| "本地工作区授权状态不可用".to_string())?;
        *current = Some(AuthorizedWorkspace {
            id: id.clone(),
            root,
        });
        self.cancel_all_operations();
        Ok(id)
    }

    pub(crate) fn resolve(&self, workspace_id: &str) -> Result<PathBuf, String> {
        let current = self
            .current
            .lock()
            .map_err(|_| "本地工作区授权状态不可用".to_string())?;
        current
            .as_ref()
            .filter(|workspace| workspace.id == workspace_id)
            .map(|workspace| workspace.root.clone())
            .ok_or_else(|| "本地工作区授权已失效，请重新选择项目目录".to_string())
    }

    fn revoke(&self, workspace_id: &str) -> Result<bool, String> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "本地工作区授权状态不可用".to_string())?;
        if current
            .as_ref()
            .is_some_and(|workspace| workspace.id == workspace_id)
        {
            *current = None;
            self.cancel_all_operations();
            return Ok(true);
        }
        Ok(false)
    }

    fn begin_operation(
        &self,
        operation_id: &str,
        deadline_ms: u64,
    ) -> Result<OperationLease<'_>, String> {
        if operation_id.trim().is_empty() {
            return Err("本地文件操作缺少 operationId".to_string());
        }
        let mut cancelled = self
            .cancelled_operation_ids
            .lock()
            .map_err(|_| "本地文件操作状态不可用".to_string())?;
        if cancelled.remove(operation_id) {
            return Err("本地文件操作已取消".to_string());
        }
        let control = Arc::new(OperationControl::with_deadline(deadline_ms)?);
        let mut operations = self
            .active_operations
            .lock()
            .map_err(|_| "本地文件操作状态不可用".to_string())?;
        if operations
            .insert(operation_id.to_string(), control.clone())
            .is_some()
        {
            return Err("本地文件操作 ID 已存在".to_string());
        }
        Ok(OperationLease {
            registry: self,
            id: operation_id.to_string(),
            control,
        })
    }

    fn cancel_operation(&self, operation_id: &str) -> Result<bool, String> {
        let mut cancelled = self
            .cancelled_operation_ids
            .lock()
            .map_err(|_| "本地文件操作状态不可用".to_string())?;
        let operations = self
            .active_operations
            .lock()
            .map_err(|_| "本地文件操作状态不可用".to_string())?;
        if let Some(control) = operations.get(operation_id) {
            control.cancelled.store(true, Ordering::SeqCst);
        } else {
            // The renderer can cancel between receiving an SSE event and this
            // command reaching Tauri. Retain a one-shot tombstone so a later
            // start with the same opaque ID fails closed.
            cancelled.insert(operation_id.to_string());
        }
        Ok(true)
    }

    fn cancel_all_operations(&self) {
        if let Ok(operations) = self.active_operations.lock() {
            for control in operations.values() {
                control.cancelled.store(true, Ordering::SeqCst);
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSelection {
    workspace_id: String,
    root_path: String,
}

/// Opens the native directory picker and registers exactly the directory the
/// user selected. A renderer-provided path can therefore never create an Agent
/// file authorization by itself.
#[tauri::command]
pub async fn select_local_workspace(
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    indexes: State<'_, ProjectIndexRegistry>,
) -> Result<Option<WorkspaceSelection>, String> {
    let Some(selected) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let selected_path = selected
        .into_path()
        .map_err(|_| "所选项目不是可访问的本地目录".to_string())?;
    let root = canonical_root(&selected_path.to_string_lossy())?;

    // The editor/file tree still use the scoped plugin APIs. Command ACLs are
    // fixed in default.json; this dynamic scope limits them to user-picked paths.
    app.fs_scope()
        .allow_directory(&selected_path, true)
        .map_err(|_| "无法授权所选项目目录".to_string())?;
    app.state::<tauri::scope::Scopes>()
        .allow_directory(&selected_path, true)
        .map_err(|_| "无法授权所选项目目录".to_string())?;

    indexes.clear()?;
    let workspace_id = registry.register(root)?;
    Ok(Some(WorkspaceSelection {
        workspace_id,
        root_path: selected_path.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
pub fn revoke_local_workspace(
    workspace_id: String,
    registry: State<'_, WorkspaceRegistry>,
    indexes: State<'_, ProjectIndexRegistry>,
) -> Result<bool, String> {
    let revoked = registry.revoke(&workspace_id)?;
    if revoked {
        indexes.clear()?;
    }
    Ok(revoked)
}

#[tauri::command]
pub fn execute_workspace_file_operation(
    operation: String,
    workspace_id: String,
    args: Value,
    operation_id: String,
    deadline_ms: u64,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<Value, String> {
    let root = registry.resolve(&workspace_id)?;
    let lease = registry.begin_operation(&operation_id, deadline_ms)?;
    execute_workspace_file_operation_with_control(&root, &operation, &args, &lease.control)
}

#[tauri::command]
pub fn cancel_workspace_file_operation(
    operation_id: String,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<bool, String> {
    registry.cancel_operation(&operation_id)
}

#[cfg(test)]
fn execute_workspace_file_operation_at_root(
    root: &Path,
    operation: &str,
    args: &Value,
) -> Result<Value, String> {
    execute_workspace_file_operation_with_control(
        root,
        operation,
        args,
        &OperationControl::unbounded(),
    )
}

fn execute_workspace_file_operation_with_control(
    root: &Path,
    operation: &str,
    args: &Value,
    control: &OperationControl,
) -> Result<Value, String> {
    control.checkpoint()?;
    match operation {
        "read" => read_file(root, required_string(args, "filePath")?, control),
        "write" => write_file(
            root,
            required_string(args, "filePath")?,
            required_value_string(args, "content")?,
            optional_string(args, "expectedHash"),
            control,
        ),
        "list" => list_files(
            root,
            optional_string(args, "dirPath").unwrap_or(""),
            control,
        ),
        "search" => search_files(
            root,
            optional_string(args, "directory").unwrap_or(""),
            required_string(args, "keyword")?,
            control,
        ),
        "create" => create_file(root, required_string(args, "filePath")?, control),
        "delete" => delete_file(root, required_string(args, "filePath")?, control),
        _ => Err("不支持的桌面工作区文件操作".to_string()),
    }
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "无法生成工作区相对路径".to_string())?;
    if relative.as_os_str().is_empty() {
        return Ok(".".to_string());
    }
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn canonical_root(root_path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root_path).map_err(|_| "已授权项目根目录不可访问".to_string())?;
    if !root.is_dir() {
        return Err("已授权项目根目录不是目录".to_string());
    }
    Ok(root)
}

fn required_string<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    optional_string(args, name)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("缺少文件操作参数：{}", name))
}

/// Content may intentionally be empty (for example, clearing a file), unlike
/// a path or a search keyword.
fn required_value_string<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    optional_string(args, name).ok_or_else(|| format!("缺少文件操作参数：{}", name))
}

fn optional_string<'a>(args: &'a Value, name: &str) -> Option<&'a str> {
    args.get(name).and_then(Value::as_str)
}

fn requested_path(root: &Path, raw: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(raw);
    let candidate = if requested.is_absolute() {
        requested
    } else {
        root.join(requested)
    };
    if candidate.as_os_str().is_empty() {
        return Err("文件路径不能为空".to_string());
    }
    Ok(candidate)
}

fn existing_path(root: &Path, raw: &str) -> Result<PathBuf, String> {
    let requested = requested_path(root, raw)?;
    if fs::symlink_metadata(&requested)
        .map_err(|_| "文件或目录不存在".to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("不允许通过符号链接访问工作区文件".to_string());
    }
    let path = fs::canonicalize(&requested).map_err(|_| "文件或目录不存在".to_string())?;
    ensure_inside(root, &path)?;
    Ok(path)
}

fn writable_path(root: &Path, raw: &str, must_not_exist: bool) -> Result<PathBuf, String> {
    let requested = requested_path(root, raw)?;
    let parent = requested
        .parent()
        .ok_or_else(|| "文件路径缺少父目录".to_string())?;
    let canonical_parent =
        fs::canonicalize(parent).map_err(|_| "目标父目录不存在或不可访问".to_string())?;
    ensure_inside(root, &canonical_parent)?;
    if !canonical_parent.is_dir() {
        return Err("目标父路径不是目录".to_string());
    }
    let file_name = requested
        .file_name()
        .ok_or_else(|| "文件路径无效".to_string())?;
    let path = canonical_parent.join(file_name);
    if path.exists() {
        if must_not_exist {
            return Err("目标文件已存在".to_string());
        }
        if fs::symlink_metadata(&path)
            .map_err(|_| "无法读取目标文件".to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("不允许写入符号链接".to_string());
        }
        let canonical = fs::canonicalize(&path).map_err(|_| "无法读取目标文件".to_string())?;
        ensure_inside(root, &canonical)?;
        if !canonical.is_file() {
            return Err("目标不是常规文件".to_string());
        }
    }
    Ok(path)
}

fn ensure_inside(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("路径越出当前会话授权的项目根目录".to_string())
    }
}

fn read_text(path: &Path, control: &OperationControl) -> Result<(String, bool), String> {
    control.checkpoint()?;
    let declared_size = fs::metadata(path)
        .map_err(|_| "无法读取文件元数据".to_string())?
        .len();
    let max_with_sentinel = MAX_FILE_BYTES + 1;
    let mut reader =
        fs::File::open(path).map_err(|_| "文件不是 UTF-8 文本或无法读取".to_string())?;
    let mut bytes = Vec::with_capacity(declared_size.min(max_with_sentinel) as usize);
    let mut chunk = [0_u8; READ_CHUNK_BYTES];

    while bytes.len() < max_with_sentinel as usize {
        control.checkpoint()?;
        let remaining = max_with_sentinel as usize - bytes.len();
        let chunk_len = remaining.min(chunk.len());
        let read = reader
            .read(&mut chunk[..chunk_len])
            .map_err(|_| "文件不是 UTF-8 文本或无法读取".to_string())?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
    control.checkpoint()?;

    let truncated = declared_size > MAX_FILE_BYTES || bytes.len() > MAX_FILE_BYTES as usize;
    if bytes.len() > MAX_FILE_BYTES as usize {
        bytes.truncate(MAX_FILE_BYTES as usize);
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok((content, truncated)),
        Err(error) if truncated && error.utf8_error().error_len().is_none() => {
            let valid_end = error.utf8_error().valid_up_to();
            let bytes = error.into_bytes();
            let content = String::from_utf8(bytes[..valid_end].to_vec())
                .map_err(|_| "文件不是 UTF-8 文本或无法读取".to_string())?;
            Ok((content, true))
        }
        Err(_) => Err("文件不是 UTF-8 文本或无法读取".to_string()),
    }
}

fn sha256_file(path: &Path, control: &OperationControl) -> Result<String, String> {
    let mut reader = fs::File::open(path).map_err(|_| "无法读取文件哈希".to_string())?;
    let mut digest = Sha256::new();
    let mut chunk = [0_u8; READ_CHUNK_BYTES];
    loop {
        control.checkpoint()?;
        let read = reader
            .read(&mut chunk)
            .map_err(|_| "无法读取文件哈希".to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&chunk[..read]);
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

enum RevertSnapshot {
    Captured(String),
    TooLarge { bytes: u64 },
}

impl RevertSnapshot {
    fn before_content(&self) -> Option<&str> {
        match self {
            Self::Captured(content) => Some(content),
            Self::TooLarge { .. } => None,
        }
    }

    fn state(&self) -> &'static str {
        match self {
            Self::Captured(_) => "CAPTURED",
            Self::TooLarge { .. } => "TOO_LARGE",
        }
    }

    fn bytes(&self) -> Option<u64> {
        match self {
            Self::Captured(_) => None,
            Self::TooLarge { bytes } => Some(*bytes),
        }
    }
}

fn capture_revert_snapshot(
    path: &Path,
    control: &OperationControl,
) -> Result<RevertSnapshot, String> {
    let size = fs::metadata(path)
        .map_err(|_| "无法读取文件元数据".to_string())?
        .len();
    if size > MAX_FILE_BYTES {
        return Ok(RevertSnapshot::TooLarge { bytes: size });
    }
    let (content, truncated) = read_text(path, control)?;
    if truncated {
        return Ok(RevertSnapshot::TooLarge {
            bytes: size.max(MAX_FILE_BYTES + 1),
        });
    }
    Ok(RevertSnapshot::Captured(content))
}

fn temporary_write_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标文件缺少父目录".to_string())?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "目标文件名不可用".to_string())?;
    Ok(parent.join(format!(
        "{ATOMIC_TEMP_FILE_PREFIX}{name}-{}",
        Uuid::new_v4()
    )))
}

#[cfg(windows)]
fn replace_temp_file(temp: &Path, target: &Path) -> std::io::Result<()> {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    if !target.exists() {
        return fs::rename(temp, target);
    }
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(once(0)).collect();
    let temp_wide: Vec<u16> = temp.as_os_str().encode_wide().chain(once(0)).collect();
    let replaced = unsafe {
        windows_sys::Win32::Storage::FileSystem::ReplaceFileW(
            target_wide.as_ptr(),
            temp_wide.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_temp_file(temp: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(temp, target)
}

fn atomic_write_with_replacer(
    path: &Path,
    content: &str,
    control: &OperationControl,
    replacer: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    let temp = temporary_write_path(path)?;
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "无法创建安全临时文件".to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|_| "写入临时文件失败".to_string())?;
        file.sync_all()
            .map_err(|_| "无法同步临时文件".to_string())?;
        // Windows cannot atomically replace a file while this process still
        // owns a handle to the replacement file.
        drop(file);
        control.checkpoint()?;
        replacer(&temp, path).map_err(|_| "原子替换文件失败".to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn atomic_write(path: &Path, content: &str, control: &OperationControl) -> Result<(), String> {
    atomic_write_with_replacer(path, content, control, replace_temp_file)
}

fn read_file(root: &Path, file_path: &str, control: &OperationControl) -> Result<Value, String> {
    control.checkpoint()?;
    let path = existing_path(root, file_path)?;
    if !path.is_file() {
        return Err("目标不是常规文件".to_string());
    }
    let size = fs::metadata(&path)
        .map_err(|_| "无法读取文件元数据".to_string())?
        .len();
    let (content, truncated) = read_text(&path, control)?;
    let content_sha256 = sha256_file(&path, control)?;
    control.checkpoint()?;
    let relative = relative_path(root, &path)?;
    Ok(
        json!({"success": true, "path": relative, "name": path.file_name(), "size": size, "truncated": truncated, "content": content, "contentSha256": content_sha256}),
    )
}

fn write_file(
    root: &Path,
    file_path: &str,
    content: &str,
    expected_hash: Option<&str>,
    control: &OperationControl,
) -> Result<Value, String> {
    if content.len() > MAX_FILE_BYTES as usize {
        return Err("写入内容超过 2 MB 字节限制".to_string());
    }
    let path = writable_path(root, file_path, false)?;
    let existed = path.exists();
    let current_hash = if existed {
        Some(sha256_file(&path, control)?)
    } else {
        None
    };
    if existed {
        let expected = expected_hash
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "覆盖已有文件必须提供 expectedHash；请先重新读取文件".to_string())?;
        if current_hash.as_deref() != Some(expected.trim()) {
            return Err("文件在读取后已发生变化，拒绝覆盖；请重新读取并生成 diff".to_string());
        }
    }
    let before = if existed {
        Some(capture_revert_snapshot(&path, control)?)
    } else {
        None
    };
    control.mutate(|| {
        // Re-check while holding the mutation gate. The first check above
        // provides a fast failure; this second check closes the small window
        // where another process edits the file between hashing and replace.
        if existed {
            let expected = expected_hash
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "覆盖已有文件必须提供 expectedHash；请先重新读取文件".to_string())?;
            let latest_hash = sha256_file(&path, control)?;
            if latest_hash != expected.trim() {
                return Err("文件在读取后已发生变化，拒绝覆盖；请重新读取并生成 diff".to_string());
            }
        }
        atomic_write(&path, content, control)
    })?;
    // A newly created file cannot be safely reverted by merely writing an empty
    // string; the existing UI revert action has no delete semantic.
    let before_captured = existed
        && before
            .as_ref()
            .and_then(RevertSnapshot::before_content)
            .is_some();
    let relative = relative_path(root, &path)?;
    Ok(
        json!({"success": true, "path": relative, "bytesWritten": content.len(), "existed": existed,
        "contentSha256": format!("sha256:{:x}", Sha256::digest(content.as_bytes())),
        "hasBeforeContent": before_captured,
        "beforeContentState": before.as_ref().map(RevertSnapshot::state),
        "beforeContentBytes": before.as_ref().and_then(RevertSnapshot::bytes),
        "beforeContent": before.and_then(|snapshot| snapshot.before_content().map(str::to_owned))}),
    )
}

fn create_file(root: &Path, file_path: &str, control: &OperationControl) -> Result<Value, String> {
    let path = writable_path(root, file_path, true)?;
    control.mutate(|| {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map(|_| ())
            .map_err(|_| "创建文件失败".to_string())
    })?;
    // Creation is deliberately view-only until the UI has an explicit safe
    // delete-revert operation.  Do not represent "file did not exist" as an
    // empty-content snapshot.
    let relative = relative_path(root, &path)?;
    Ok(json!({"success": true, "path": relative, "created": true, "hasBeforeContent": false}))
}

fn delete_file(root: &Path, file_path: &str, control: &OperationControl) -> Result<Value, String> {
    let path = existing_path(root, file_path)?;
    if !path.is_file() {
        return Err("只允许删除常规文件，不允许删除目录".to_string());
    }
    let before = capture_revert_snapshot(&path, control).ok();
    control.mutate(|| fs::remove_file(&path).map_err(|_| "删除文件失败".to_string()))?;
    let captured = before
        .as_ref()
        .and_then(RevertSnapshot::before_content)
        .is_some();
    let relative = relative_path(root, &path)?;
    Ok(json!({"success": true, "path": relative, "deleted": true,
        "hasBeforeContent": captured,
        "beforeContentState": before.as_ref().map(RevertSnapshot::state),
        "beforeContentBytes": before.as_ref().and_then(RevertSnapshot::bytes),
        "beforeContent": before.and_then(|snapshot| snapshot.before_content().map(str::to_owned))}))
}

fn list_files(root: &Path, dir_path: &str, control: &OperationControl) -> Result<Value, String> {
    control.checkpoint()?;
    let path = if dir_path.is_empty() || dir_path == "." {
        root.to_path_buf()
    } else {
        existing_path(root, dir_path)?
    };
    if !path.is_dir() {
        return Err("目标不是目录".to_string());
    }
    let mut entries: Vec<_> = fs::read_dir(&path)
        .map_err(|_| "无法列出目录".to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            fs::symlink_metadata(entry.path())
                .map(|metadata| !metadata.file_type().is_symlink())
                .unwrap_or(false)
        })
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    let truncated = entries.len() > MAX_DIRECTORY_ENTRIES;
    let items: Vec<Value> = entries
        .into_iter()
        .take(MAX_DIRECTORY_ENTRIES)
        .map(|entry| -> Result<Value, String> {
            control.checkpoint()?;
            let item_path = entry.path();
            let metadata = entry.metadata().ok();
            Ok(json!({"name": entry.file_name().to_string_lossy(), "path": relative_path(root, &item_path)?, "directory": metadata.as_ref().is_some_and(|m| m.is_dir()), "size": metadata.map(|m| m.len()).unwrap_or(0)}))
        })
        .collect::<Result<_, _>>()?;
    let relative = relative_path(root, &path)?;
    Ok(
        json!({"success": true, "path": relative, "items": items, "total": items.len(), "truncated": truncated}),
    )
}

fn search_files(
    root: &Path,
    directory: &str,
    keyword: &str,
    control: &OperationControl,
) -> Result<Value, String> {
    if keyword.is_empty() {
        return Err("搜索关键词不能为空".to_string());
    }
    let start = if directory.is_empty() || directory == "." {
        root.to_path_buf()
    } else {
        existing_path(root, directory)?
    };
    if !start.is_dir() {
        return Err("搜索起点不是目录".to_string());
    }
    let mut matches = Vec::new();
    search_directory(root, &start, keyword, &mut matches, control)?;
    let truncated = matches.len() >= MAX_SEARCH_MATCHES;
    let relative = relative_path(root, &start)?;
    Ok(
        json!({"success": true, "directory": relative, "keyword": keyword, "matches": matches, "total": matches.len(), "truncated": truncated}),
    )
}

fn search_directory(
    root: &Path,
    dir: &Path,
    keyword: &str,
    matches: &mut Vec<Value>,
    control: &OperationControl,
) -> Result<(), String> {
    let mut pending = vec![dir.to_path_buf()];
    while let Some(directory) = pending.pop() {
        control.checkpoint()?;
        for entry in fs::read_dir(&directory)
            .map_err(|_| "无法读取搜索目录".to_string())?
            .filter_map(Result::ok)
        {
            control.checkpoint()?;
            if matches.len() >= MAX_SEARCH_MATCHES {
                return Ok(());
            }
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                if !SKIPPED_DIRECTORIES
                    .iter()
                    .any(|name| entry.file_name().eq_ignore_ascii_case(name))
                {
                    pending.push(path);
                }
                continue;
            }
            if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
                continue;
            }
            let (content, truncated) = match read_text(&path, control) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if truncated {
                continue;
            }
            for (index, line) in content.lines().enumerate() {
                control.checkpoint()?;
                if line.contains(keyword) {
                    matches.push(json!({"file": relative_path(root, &path)?, "line": index + 1, "content": line.trim()}));
                    if matches.len() >= MAX_SEARCH_MATCHES {
                        break;
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root() -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "walicode-workspace-{}-{}",
            std::process::id(),
            nonce
        ))
    }

    #[test]
    fn rejects_paths_outside_the_authorized_root() {
        let root = test_root();
        let outside = root.with_extension("outside.txt");
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, "outside").unwrap();
        let result = existing_path(
            &canonical_root(root.to_str().unwrap()).unwrap(),
            outside.to_str().unwrap(),
        );
        assert_eq!(result.unwrap_err(), "路径越出当前会话授权的项目根目录");
        fs::remove_dir(&root).unwrap();
        fs::remove_file(&outside).unwrap();
    }

    #[test]
    fn write_returns_a_revert_snapshot_for_small_existing_text_files() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("sample.txt"), "before").unwrap();
        let canonical = canonical_root(&root.to_string_lossy()).unwrap();
        let result = execute_workspace_file_operation_at_root(
            &canonical,
            "write",
            &json!({"filePath": "sample.txt", "content": "after", "expectedHash": format!("sha256:{:x}", Sha256::digest(b"before"))}),
        )
        .unwrap();
        assert_eq!(result["beforeContent"], "before");
        assert_eq!(result["path"], "sample.txt");
        assert_eq!(
            fs::read_to_string(root.join("sample.txt")).unwrap(),
            "after"
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn large_text_is_read_with_a_bounded_utf8_preview() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        // 2,000,001 bytes: the bounded read ends in the middle of a three-byte
        // UTF-8 character and must still return valid text without full-file IO.
        fs::write(
            root.join("large.txt"),
            "界".repeat(MAX_FILE_BYTES as usize / 3 + 1),
        )
        .unwrap();
        let canonical = canonical_root(&root.to_string_lossy()).unwrap();

        let result = read_file(&canonical, "large.txt", &OperationControl::unbounded()).unwrap();
        let content = result["content"].as_str().unwrap();

        assert_eq!(result["truncated"], true);
        assert!(result["size"].as_u64().unwrap() > MAX_FILE_BYTES);
        assert!(content.len() <= MAX_FILE_BYTES as usize);
        assert!(std::str::from_utf8(content.as_bytes()).is_ok());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn direct_file_read_honors_a_preexisting_cancellation() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("sample.txt"), "contents").unwrap();
        let control = OperationControl::unbounded();
        control.cancelled.store(true, Ordering::SeqCst);

        let error = read_text(&root.join("sample.txt"), &control).unwrap_err();

        assert_eq!(error, "本地文件操作已取消");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn direct_file_read_honors_an_expired_deadline() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("sample.txt"), "contents").unwrap();
        let control = OperationControl {
            cancelled: AtomicBool::new(false),
            deadline: Some(Instant::now() - Duration::from_millis(1)),
            mutation_gate: Mutex::new(()),
        };

        let error = read_text(&root.join("sample.txt"), &control).unwrap_err();

        assert_eq!(error, "本地文件操作已超时");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn invalid_utf8_is_rejected_without_lossy_conversion() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("invalid.bin"), [0xff, 0xfe]).unwrap();

        let error =
            read_text(&root.join("invalid.bin"), &OperationControl::unbounded()).unwrap_err();

        assert_eq!(error, "文件不是 UTF-8 文本或无法读取");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn oversized_revert_snapshot_is_explicitly_nonrecoverable() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("large.txt"),
            "x".repeat(MAX_FILE_BYTES as usize + 1),
        )
        .unwrap();
        let canonical = canonical_root(&root.to_string_lossy()).unwrap();

        let result = execute_workspace_file_operation_at_root(
            &canonical,
            "write",
            &json!({"filePath": "large.txt", "content": "replacement", "expectedHash": sha256_file(&root.join("large.txt"), &OperationControl::unbounded()).unwrap()}),
        )
        .unwrap();

        assert_eq!(result["hasBeforeContent"], false);
        assert_eq!(result["beforeContentState"], "TOO_LARGE");
        assert_eq!(result["beforeContentBytes"], MAX_FILE_BYTES + 1);
        assert!(result["beforeContent"].is_null());
        assert_eq!(
            fs::read_to_string(root.join("large.txt")).unwrap(),
            "replacement"
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn failed_atomic_replacement_preserves_original_and_cleans_temp_file() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let path = root.join("sample.txt");
        fs::write(&path, "before").unwrap();

        let error =
            atomic_write_with_replacer(&path, "after", &OperationControl::unbounded(), |_, _| {
                Err(std::io::Error::other("injected replacement failure"))
            })
            .unwrap_err();

        assert_eq!(error, "原子替换文件失败");
        assert_eq!(fs::read_to_string(&path).unwrap(), "before");
        assert!(fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .all(|entry| !entry
                .file_name()
                .to_string_lossy()
                .starts_with(ATOMIC_TEMP_FILE_PREFIX)));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn permits_an_intentionally_empty_file_write() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("sample.txt"), "before").unwrap();
        let canonical = canonical_root(&root.to_string_lossy()).unwrap();
        let result = execute_workspace_file_operation_at_root(
            &canonical,
            "write",
            &json!({"filePath": "sample.txt", "content": "", "expectedHash": format!("sha256:{:x}", Sha256::digest(b"before"))}),
        )
        .unwrap();
        assert_eq!(result["success"], true);
        assert_eq!(fs::read_to_string(root.join("sample.txt")).unwrap(), "");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rejects_overwrite_when_file_changed_after_read() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let path = root.join("sample.txt");
        fs::write(&path, "before").unwrap();
        let canonical = canonical_root(&root.to_string_lossy()).unwrap();
        let expected_hash = sha256_file(&path, &OperationControl::unbounded()).unwrap();
        fs::write(&path, "user-change").unwrap();

        let result = execute_workspace_file_operation_at_root(
            &canonical,
            "write",
            &json!({"filePath": "sample.txt", "content": "agent-change", "expectedHash": expected_hash}),
        );

        assert_eq!(
            result.unwrap_err(),
            "文件在读取后已发生变化，拒绝覆盖；请重新读取并生成 diff"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "user-change");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn cancelled_operation_cannot_write_a_file() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("sample.txt"), "before").unwrap();
        let canonical = canonical_root(&root.to_string_lossy()).unwrap();
        let control = OperationControl::unbounded();
        control.cancelled.store(true, Ordering::SeqCst);

        let result = execute_workspace_file_operation_with_control(
            &canonical,
            "write",
            &json!({"filePath": "sample.txt", "content": "after"}),
            &control,
        );

        assert_eq!(result.unwrap_err(), "本地文件操作已取消");
        assert_eq!(
            fs::read_to_string(root.join("sample.txt")).unwrap(),
            "before"
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn expired_operation_stops_search_before_reading_files() {
        let root = test_root();
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("nested/sample.txt"), "needle").unwrap();
        let canonical = canonical_root(&root.to_string_lossy()).unwrap();
        let control = OperationControl {
            cancelled: AtomicBool::new(false),
            deadline: Some(Instant::now() - Duration::from_millis(1)),
            mutation_gate: Mutex::new(()),
        };

        let result = search_files(&canonical, "", "needle", &control);

        assert_eq!(result.unwrap_err(), "本地文件操作已超时");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn cancellation_that_arrives_before_operation_registration_fails_closed() {
        let registry = WorkspaceRegistry::default();
        let operation_id = "late-registration";
        let deadline_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            + 5_000;

        assert!(registry.cancel_operation(operation_id).unwrap());
        let error = registry
            .begin_operation(operation_id, deadline_ms)
            .err()
            .unwrap();
        assert_eq!(error, "本地文件操作已取消");
    }

    #[test]
    fn lists_nested_directory_entries_with_workspace_relative_paths() {
        let root = test_root();
        fs::create_dir_all(root.join("nested").join("deeper")).unwrap();
        fs::write(root.join("nested").join("sample.txt"), "contents").unwrap();
        let canonical = canonical_root(&root.to_string_lossy()).unwrap();

        let result = list_files(&canonical, "nested", &OperationControl::unbounded()).unwrap();
        let items = result["items"].as_array().unwrap();

        assert_eq!(result["success"], true);
        assert_eq!(result["path"], "nested");
        assert!(
            items
                .iter()
                .any(|item| item["name"] == "deeper" && item["directory"] == true),
            "{result}"
        );
        assert!(
            items
                .iter()
                .any(|item| item["name"] == "sample.txt" && item["directory"] == false),
            "{result}"
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn registry_invalidates_the_previous_workspace_id() {
        let first = test_root();
        let second = test_root();
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let registry = WorkspaceRegistry::default();
        let first_id = registry
            .register(canonical_root(&first.to_string_lossy()).unwrap())
            .unwrap();
        let second_id = registry
            .register(canonical_root(&second.to_string_lossy()).unwrap())
            .unwrap();

        assert_eq!(
            registry.resolve(&first_id).unwrap_err(),
            "本地工作区授权已失效，请重新选择项目目录"
        );
        assert!(registry.resolve(&second_id).is_ok());
        fs::remove_dir_all(&first).unwrap();
        fs::remove_dir_all(&second).unwrap();
    }
}
