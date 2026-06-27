//! 命令行工具注册模块
//!
//! 在系统 PATH 中创建 symlink `/usr/local/bin/walicode-cli → app_path`，
//! 注册后终端输入 `walicode-cli` 即可启动应用。
//! 参考 VS Code 的 `Shell Command: Install 'code' command in PATH`。

use std::fs;
use std::os::unix::fs::symlink;
use std::path::PathBuf;
use std::process::Command;

/// macOS 上 symlink 的目标路径
const SYMLINK_PATH: &str = "/usr/local/bin/walicode-cli";

/// 安装 CLI 命令到 PATH
///
/// 1. 找到同目录下的 walicode-cli 二进制（独立 CLI TUI 入口）
/// 2. 尝试直接创建 symlink（/usr/local/bin 可写时）
/// 3. 如果权限不足，通过 osascript 弹出系统授权框
#[tauri::command]
pub fn install_cli_command() -> Result<String, String> {
    // current_exe 是 Tauri GUI 二进制 (walissh-client)，
    // CLI 二进制 (walicode-cli) 在同目录下
    let gui_path = std::env::current_exe().map_err(|e| format!("获取应用路径失败: {}", e))?;
    let cli_path = gui_path.parent()
        .ok_or_else(|| "无法获取父目录".to_string())?
        .join("walicode-cli");

    // 验证 CLI 二进制存在
    if !cli_path.exists() {
        return Err(format!("CLI 二进制不存在: {}", cli_path.display()));
    }

    let app_path = cli_path;

    // 如果 symlink 已存在且指向同一个文件，直接返回成功
    if let Ok(existing_target) = fs::read_link(SYMLINK_PATH) {
        if existing_target == app_path {
            return Ok("walicode-cli 命令已注册".to_string());
        }
        // 指向不同文件，需要先删除旧 symlink
        fs::remove_file(SYMLINK_PATH).map_err(|e| format!("删除旧 symlink 失败: {}", e))?;
    }

    // 尝试直接写入（/usr/local/bin 在某些 macOS 上是可写的）
    if try_direct_install(&app_path) {
        return Ok("walicode-cli 命令已注册到 PATH".to_string());
    }

    // 直接写入失败，通过 osascript 获取管理员权限
    install_with_elevation(&app_path)
}

/// 移除 PATH 中的 CLI 命令
#[tauri::command]
pub fn uninstall_cli_command() -> Result<String, String> {
    let symlink_path = PathBuf::from(SYMLINK_PATH);

    if !symlink_path.exists() && !symlink_path.is_symlink() {
        return Ok("walicode-cli 命令未注册，无需移除".to_string());
    }

    // 尝试直接删除
    if try_direct_uninstall() {
        return Ok("walicode-cli 命令已从 PATH 移除".to_string());
    }

    // 直接删除失败，通过 osascript 获取管理员权限
    uninstall_with_elevation()
}

/// 检查 CLI 命令是否已注册
#[tauri::command]
pub fn check_cli_installed() -> bool {
    let symlink_path = PathBuf::from(SYMLINK_PATH);
    symlink_path.is_symlink() || symlink_path.exists()
}

// ── 内部实现 ──

/// 尝试直接创建 symlink（无 sudo）
fn try_direct_install(app_path: &PathBuf) -> bool {
    // 先删除已存在的文件/symlink（可能指向旧版本）
    if PathBuf::from(SYMLINK_PATH).exists() || PathBuf::from(SYMLINK_PATH).is_symlink() {
        if fs::remove_file(SYMLINK_PATH).is_err() {
            return false; // 无法删除，说明没有写权限
        }
    }

    symlink(app_path, SYMLINK_PATH).is_ok()
}

/// 通过 osascript 弹出 macOS 系统授权框来创建 symlink
fn install_with_elevation(app_path: &PathBuf) -> Result<String, String> {
    // 使用 ln -sf 强制创建/替换 symlink
    let script = format!(
        "do shell script \"ln -sf '{}' {}\" with administrator privileges",
        app_path.display(),
        SYMLINK_PATH
    );

    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("执行 osascript 失败: {}", e))?;

    if output.status.success() {
        Ok("walicode-cli 命令已注册到 PATH".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("注册失败（需要管理员权限）: {}", stderr.trim()))
    }
}

/// 尝试直接删除 symlink（无 sudo）
fn try_direct_uninstall() -> bool {
    fs::remove_file(SYMLINK_PATH).is_ok()
}

/// 通过 osascript 弹出 macOS 系统授权框来删除 symlink
fn uninstall_with_elevation() -> Result<String, String> {
    let script = format!(
        "do shell script \"rm -f {}\" with administrator privileges",
        SYMLINK_PATH
    );

    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("执行 osascript 失败: {}", e))?;

    if output.status.success() {
        Ok("walicode-cli 命令已从 PATH 移除".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("移除失败（需要管理员权限）: {}", stderr.trim()))
    }
}
