//! Shell Execution Module for WaLiCode
//! Provides safe shell command execution with platform-specific handling

#[cfg(windows)]
use encoding_rs::GBK;
#[cfg(windows)]
use encoding_rs_io::DecodeReaderBytesBuilder;
use serde::{Deserialize, Serialize};
use std::io::Read;

/// Decode bytes to String with platform-aware encoding.
/// On Windows, preserves valid UTF-8 first, then falls back to legacy GBK output.
/// On other platforms, uses UTF-8 lossy directly.
#[cfg(windows)]
fn decode_output_bytes(buf: &[u8]) -> String {
    if let Ok(utf8) = String::from_utf8(buf.to_vec()) {
        return utf8;
    }

    let mut decoder = DecodeReaderBytesBuilder::new()
        .encoding(Some(GBK))
        .build(buf);
    let mut decoded = String::new();
    if decoder.read_to_string(&mut decoded).is_ok() {
        decoded
    } else {
        String::from_utf8_lossy(buf).to_string()
    }
}

#[cfg(not(windows))]
fn decode_output_bytes(buf: &[u8]) -> String {
    String::from_utf8_lossy(buf).to_string()
}

/// 获取用户登录 shell 路径（从 $SHELL 环境变量，fallback 到平台默认）
fn get_user_shell() -> String {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        // Android: /system/bin/sh is always available
        // iOS: App Sandbox 内无用户 shell，使用 /bin/sh
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        #[cfg(not(windows))]
        {
            std::env::var("SHELL").unwrap_or_else(|_| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".to_string()
                } else {
                    "/bin/bash".to_string()
                }
            })
        }
        #[cfg(windows)]
        {
            "cmd.exe".to_string()
        }
    }
}
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::Emitter;

/// Get the shell argument flag for the current platform.
/// - Windows: `/C`
/// - Android: `-c` (\system/bin/sh only supports -c)
/// - macOS/Linux: `-lic` (login + interactive + command)
fn get_shell_arg() -> &'static str {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        "-c"
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if cfg!(target_os = "windows") {
            "/C"
        } else {
            "-lic"
        }
    }
}

// ─── Streaming Process Registry ──────────────────────────────────────────
// Global registry of running streaming processes, keyed by session ID.
// Used for Ctrl+C support: kill a running process by session ID.
lazy_static::lazy_static! {
    pub static ref STREAMING_PROCESSES: Mutex<HashMap<String, u32>> = Mutex::new(HashMap::new());
    // Non-streaming commands retain their Child handle as a restricted-host
    // fallback when Windows denies `taskkill` for a process we started.
    static ref TRACKED_CHILDREN: Mutex<HashMap<String, std::sync::Arc<Mutex<std::process::Child>>>> = Mutex::new(HashMap::new());
    // A direct-child fallback cannot guarantee that descendants closed their
    // inherited stdout/stderr handles, so do not block cancellation on readers.
    static ref FALLBACK_TERMINATED_SESSIONS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
}
#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    /// Session ID for correlating events
    pub session_id: String,
    /// Event kind: "stdout" | "stderr" | "done" | "error"
    pub kind: String,
    /// Text content (for stdout/stderr) or message (for error)
    pub data: String,
    /// Exit code (only for "done" events)
    pub exit_code: Option<i32>,
    /// Duration in ms (only for "done" events)
    pub duration_ms: Option<u64>,
}

/// Result of shell execution
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShellResult {
    /// Standard output
    pub stdout: String,
    /// Standard error
    pub stderr: String,
    /// Exit code
    pub exit_code: i32,
    /// Whether execution was successful (exit_code == 0)
    pub success: bool,
    /// Execution duration in milliseconds
    pub duration_ms: u64,
    /// Whether the command was auto-backgrounded (persistent server detected)
    pub backgrounded: bool,
    /// The final command that was executed (may differ from input if backgrounded)
    pub executed_command: String,
    /// Whether the command exceeded its requested timeout and was terminated.
    pub timed_out: bool,
}

/// Detect if a command is a "persistent server" that will never exit on its own.
/// These commands need to be run in the background automatically.
fn is_persistent_server(command: &str) -> bool {
    let cmd_lower = command.to_lowercase();
    let cmd_trimmed = cmd_lower.trim();

    // Explicit background operator already present — treat as persistent, don't add another &
    if cmd_trimmed.ends_with('&') {
        return true;
    }

    // ─── Exact prefix patterns (most reliable) ───────────────────
    // We require a space or end-of-string after the keyword to avoid
    // matching quick-exit commands like "python --version".
    let patterns = [
        // Python HTTP servers
        ("python3 -m http.server", "python3 -m http.server"),
        ("python -m http.server", "python -m http.server"),
        ("python3 -m SimpleHTTPServer", "python3 -m SimpleHTTPServer"),
        ("python -m SimpleHTTPServer", "python -m SimpleHTTPServer"),
        // Python dev servers
        ("python3 manage.py runserver", "python3 manage.py runserver"),
        ("python manage.py runserver", "python manage.py runserver"),
        ("flask run", "flask run"),
        ("fastapi dev", "fastapi dev"),
        ("uvicorn ", "uvicorn "),
        ("django-admin runserver", "django-admin runserver"),
        // Node HTTP servers
        ("npx serve", "npx serve"),
        ("npx http-server", "npx http-server"),
        ("npx http2", "npx http2"),
        ("http-server", "http-server"),
        ("serve -s", "serve -s"),
        // Node dev servers
        ("vite", "vite"),
        ("next dev", "next dev"),
        ("next start", "next start"),
        ("next build", "next build"),
        ("nuxt dev", "nuxt dev"),
        ("nuxt start", "nuxt start"),
        ("nuxt build", "nuxt build"),
        ("webpack serve", "webpack serve"),
        ("webpack-dev-server", "webpack-dev-server"),
        ("rollup -c -w", "rollup -c -w"),
        ("esbuild --serve", "esbuild --serve"),
        // Bun dev
        ("bun --bun dev", "bun --bun dev"),
        ("bun dev", "bun dev"),
        ("bun run dev", "bun run dev"),
        // Go dev servers
        ("air", "air"),
        ("fresh", "fresh"),
        ("realize start", "realize start"),
        // Rust dev servers
        ("cargo run --watch", "cargo run --watch"),
        // Docker
        ("docker run", "docker run"),
        ("docker-compose up", "docker-compose up"),
        ("docker compose up", "docker compose up"),
        // Misc servers
        ("redis-server", "redis-server"),
        ("mongod", "mongod"),
        ("postgres -D", "postgres -D"),
        ("nginx", "nginx"),
        // Watch/maintainer loops
        ("nodemon", "nodemon"),
        ("node-dev", "node-dev"),
        ("ts-node-dev", "ts-node-dev"),
        ("concurrently", "concurrently"),
        ("live-server", "live-server"),
        ("browser-sync start", "browser-sync start"),
        ("parcel watch", "parcel watch"),
        ("snowpack dev", "snowpack dev"),
        // Interactive commands that would block forever
        ("top", "top"),
        ("htop", "htop"),
        ("vmstat", "vmstat"),
        ("iostat", "iostat"),
        ("watch ", "watch "),
        ("tail -f", "tail -f"),
        ("tail --follow", "tail --follow"),
        // Shell REPLs
        ("python3", "python3"),
        ("python", "python"),
        ("node -i", "node -i"),
        ("node --interactive", "node --interactive"),
        ("ruby -i", "ruby -i"),
        ("lua", "lua"),
        ("perl -de", "perl -de"),
        ("php -a", "php -a"),
        ("bash -i", "bash -i"),
        ("zsh -i", "zsh -i"),
        // Interactive network tools
        ("telnet", "telnet"),
        ("ftp", "ftp"),
        ("nc -l", "nc -l"),
        ("nc -lvnp", "nc -lvnp"),
        ("socat -", "socat -"),
    ];

    for (prefix, _display) in &patterns {
        if cmd_trimmed.starts_with(prefix) {
            return true;
        }
    }

    // ─── Heuristics: watch / serve / dev flags ───────────────────
    // Only for package managers that run dev servers
    let dev_prefixes = [
        "npm run dev",
        "npm run serve",
        "npm run start",
        "pnpm run dev",
        "pnpm run serve",
        "pnpm run start",
        "yarn dev",
        "yarn serve",
        "yarn start",
        "bun run dev",
        "bun run serve",
        "deno task dev",
        "deno task serve",
    ];
    for prefix in &dev_prefixes {
        if cmd_trimmed.starts_with(prefix) {
            return true;
        }
    }

    // Flag-based heuristics (must NOT match quick-exit commands)
    if cmd_trimmed.contains(" --watch") || cmd_trimmed.ends_with(" -w") {
        return true;
    }
    if cmd_trimmed.contains(" --serve") && !cmd_trimmed.contains(" --server") {
        return true;
    }

    false
}

#[allow(dead_code)]
/// Wrap a command for background execution.
/// Uses `setsid` so the process is fully detached and survives shell exit.
fn wrap_background_command(command: &str) -> String {
    format!(
        "setsid {} >/dev/null 2>&1 &",
        command.trim_end_matches('&').trim()
    )
}

/// Execute a shell command with one shared lifecycle for GUI and CLI callers.
///
/// A session ID makes the process cancellable through `kill_stream_shell`; every
/// non-background command is also terminated when its timeout expires.
pub fn execute_shell_with_lifecycle(
    command: &str,
    cwd: Option<&str>,
    timeout_ms: u64,
    auto_background: bool,
    session_id: Option<&str>,
) -> Result<ShellResult, String> {
    let start = Instant::now();
    validate_command(command)?;

    // Check if this is a persistent server that needs backgrounding
    let is_persistent = auto_background && is_persistent_server(command);

    if is_persistent {
        // Strip any trailing & the user already added to avoid "nohup cmd & &"
        let clean_cmd = command.trim_end().trim_end_matches('&').trim().to_string();

        // Use nohup to detach the process from the terminal, then run via bash.
        // nohup ignores SIGHUP so the process survives even after bash exits.
        // bash itself finishes immediately after spawning the nohup subprocess.
        let nohup_cmd = if cfg!(target_os = "windows") {
            format!("start /B {}", clean_cmd)
        } else if cfg!(any(target_os = "android", target_os = "ios")) {
            // Android (Toybox) / iOS: simple background, no nohup
            format!("{} >/dev/null 2>&1 &", clean_cmd)
        } else {
            format!("nohup {} >/dev/null 2>&1 &", clean_cmd)
        };

        let shell_path = get_user_shell();
        let shell_arg = get_shell_arg();

        let mut cmd = Command::new(&shell_path);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.arg(shell_arg)
            .arg(&nohup_cmd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if let Some(dir) = cwd {
            let path = std::path::Path::new(dir);
            if path.exists() && path.is_dir() {
                cmd.current_dir(path);
            }
        }

        // spawn() and immediately drop the handle - we don't wait for the child.
        // nohup ensures the process survives after bash exits.
        match cmd.spawn() {
            Ok(_child) => {
                return Ok(ShellResult {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                    success: true,
                    duration_ms: start.elapsed().as_millis() as u64,
                    backgrounded: true,
                    executed_command: clean_cmd,
                    timed_out: false,
                });
            }
            Err(e) => {
                return Err(format!("Failed to spawn command: {}", e));
            }
        }
    }

    let shell_path = get_user_shell();
    let shell_arg = get_shell_arg();
    let mut cmd = Command::new(&shell_path);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd.arg(shell_arg)
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    if let Some(dir) = cwd {
        let path = std::path::Path::new(dir);
        if path.exists() && path.is_dir() {
            cmd.current_dir(path);
        }
    }

    let child = std::sync::Arc::new(Mutex::new(
        cmd.spawn()
            .map_err(|e| format!("Failed to spawn command: {}", e))?,
    ));
    let pid = child
        .lock()
        .map_err(|_| "Command process lock poisoned".to_string())?
        .id();
    if let Some(sid) = session_id {
        STREAMING_PROCESSES
            .lock()
            .map_err(|_| "Process registry lock poisoned".to_string())?
            .insert(sid.to_string(), pid);
        TRACKED_CHILDREN
            .lock()
            .map_err(|_| "Process registry lock poisoned".to_string())?
            .insert(sid.to_string(), child.clone());
    }

    let stdout = child
        .lock()
        .map_err(|_| "Command process lock poisoned".to_string())?
        .stdout
        .take()
        .ok_or_else(|| "Failed to read command stdout".to_string())?;
    let stderr = child
        .lock()
        .map_err(|_| "Command process lock poisoned".to_string())?
        .stderr
        .take()
        .ok_or_else(|| "Failed to read command stderr".to_string())?;
    let stdout_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut reader = stdout;
        let _ = reader.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut reader = stderr;
        let _ = reader.read_to_end(&mut bytes);
        bytes
    });

    let timeout = std::time::Duration::from_millis(timeout_ms.max(1));
    let mut timed_out = false;
    let mut output_pipes_may_remain_open = false;
    let status = loop {
        // Keep the mutex guard out of the match arms: a timeout arm must be
        // able to lock the child again to kill/wait it without self-deadlocking.
        let current_status = {
            let mut child_guard = child
                .lock()
                .map_err(|_| "Command process lock poisoned".to_string())?;
            child_guard
                .try_wait()
                .map_err(|e| format!("Failed to wait for command: {}", e))?
        };
        match current_status {
            Some(status) => break status,
            None if start.elapsed() >= timeout => {
                timed_out = true;
                // `taskkill /T` is the normal Windows path and removes the whole
                // command tree.  Some restricted test hosts deny taskkill even for
                // a child we own, so retain a direct-child fallback instead of
                // reporting a timeout while leaving the shell running.
                if let Err(tree_error) = kill_process_by_pid(pid) {
                    {
                        let mut child_guard = child
                            .lock()
                            .map_err(|_| "Command process lock poisoned".to_string())?;
                        match child_guard.kill() {
                            Ok(()) => {}
                            Err(kill_error) => match child_guard.try_wait() {
                                Ok(Some(_)) => {}
                                Ok(None) => return Err(format!(
                                    "Failed to terminate timed out command: {}; fallback failed: {}",
                                    tree_error, kill_error
                                )),
                                Err(wait_error) => return Err(format!(
                                    "Failed to terminate timed out command: {}; fallback failed: {}; status check failed: {}",
                                    tree_error, kill_error, wait_error
                                )),
                            },
                        }
                    }
                    output_pipes_may_remain_open = true;
                }
                break child
                    .lock()
                    .map_err(|_| "Command process lock poisoned".to_string())?
                    .wait()
                    .map_err(|e| format!("Failed to wait for terminated command: {}", e))?;
            }
            None => std::thread::sleep(std::time::Duration::from_millis(10)),
        }
    };

    if let Some(sid) = session_id {
        let mut processes = STREAMING_PROCESSES
            .lock()
            .map_err(|_| "Process registry lock poisoned".to_string())?;
        if processes.get(sid).copied() == Some(pid) {
            processes.remove(sid);
        }
        TRACKED_CHILDREN
            .lock()
            .map_err(|_| "Process registry lock poisoned".to_string())?
            .remove(sid);
        output_pipes_may_remain_open |= FALLBACK_TERMINATED_SESSIONS
            .lock()
            .map_err(|_| "Process registry lock poisoned".to_string())?
            .remove(sid);
    }

    let stdout = if output_pipes_may_remain_open {
        String::new()
    } else {
        decode_output_bytes(&stdout_reader.join().unwrap_or_default())
    };
    let stderr = if output_pipes_may_remain_open {
        String::new()
    } else {
        filter_shell_noise(&decode_output_bytes(
            &stderr_reader.join().unwrap_or_default(),
        ))
    };
    let exit_code = status.code().unwrap_or(-1);

    Ok(ShellResult {
        stdout,
        stderr,
        exit_code,
        success: !timed_out && exit_code == 0,
        duration_ms: start.elapsed().as_millis() as u64,
        backgrounded: false,
        executed_command: command.to_string(),
        timed_out,
    })
}

/// Backward-compatible name for internal local callers without a cancellation key.
pub fn execute_shell_internal(
    command: &str,
    cwd: Option<&str>,
    timeout_ms: u64,
    auto_background: bool,
) -> Result<ShellResult, String> {
    execute_shell_with_lifecycle(command, cwd, timeout_ms, auto_background, None)
}

/// Filter shell initialization noise from stderr.
/// When using `-lic` (login+interactive shell), shell rc files may produce
/// warnings that are not from the user's actual command.
/// - zsh: "command not found: compdef/compinit" (completion scripts load before compinit)
/// - bash: "bash: compgen: command not found" or similar
/// - Windows cmd.exe: no such noise (uses /C, not -lic)
fn filter_shell_noise(stderr: &str) -> String {
    stderr
        .lines()
        .filter(|line| {
            let l = line.trim();
            // Skip empty lines from noise filtering
            if l.is_empty() {
                return true; // keep empty lines (they may be intentional)
            }
            // zsh completion system noise
            if l.contains("command not found: compdef")
                || l.contains("command not found: compinit")
                || l.contains("command not found: _") && l.contains("compdef")
            {
                return false;
            }
            // bash completion noise
            if l.contains("bash: compgen: command not found")
                || l.contains("bash: complete: command not found")
            {
                return false;
            }
            // Generic: shell rc file errors that are clearly init noise
            // Pattern: <shell>:<line_number>: <something> not found (from sourcing rc files)
            // But be careful not to filter real command errors from user commands
            true
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Basic command validation for safety
fn validate_command(command: &str) -> Result<(), String> {
    let dangerous_patterns = [
        // Dangerous file operations
        "rm -rf /",
        "rm -rf /*",
        "rm -rf ..",
        // Fork bombs
        ":(){ :|:& };:",
        // Network attacks (basic)
        // Note: We allow wget/curl for development convenience
    ];

    let cmd_lower = command.to_lowercase();
    for pattern in dangerous_patterns {
        if cmd_lower.contains(&pattern.to_lowercase()) {
            return Err(format!("Command contains dangerous pattern: {}", pattern));
        }
    }

    // Check for null bytes (injection attempt)
    if command.contains('\0') {
        return Err("Command contains null byte (possible injection)".to_string());
    }

    Ok(())
}

#[allow(dead_code)]
/// Execute command with streaming support (returns spawn handle for real-time output)
#[cfg(not(target_os = "windows"))]
pub fn spawn_shell(command: &str, cwd: Option<&str>) -> Result<std::process::Child, String> {
    validate_command(command)?;

    let shell = get_user_shell();
    let mut cmd = Command::new(&shell);
    // Android / iOS: /bin/sh only supports -c, not -lic
    #[cfg(any(target_os = "android", target_os = "ios"))]
    cmd.arg("-c");
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    cmd.arg("-lic");
    cmd.arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(dir) = cwd {
        let path = std::path::Path::new(dir);
        if path.exists() && path.is_dir() {
            cmd.current_dir(path);
        }
    }

    cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
pub fn spawn_shell(command: &str, cwd: Option<&str>) -> Result<std::process::Child, String> {
    validate_command(command)?;

    let mut cmd = Command::new("cmd.exe");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd.arg("/C")
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(dir) = cwd {
        let path = std::path::Path::new(dir);
        if path.exists() && path.is_dir() {
            cmd.current_dir(path);
        }
    }

    cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))
}

/// Platform-specific shell information
pub fn get_shell_info() -> serde_json::Value {
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| {
            std::process::Command::new("hostname")
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        })
        .unwrap_or_else(|_| "localhost".to_string());

    #[cfg(target_os = "android")]
    {
        serde_json::json!({
            "platform": "android",
            "shell": get_user_shell(),
            "home": std::env::var("HOME").ok(),
            "hostname": hostname,
            "cwd": std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string()),
        })
    }
    #[cfg(target_os = "ios")]
    {
        serde_json::json!({
            "platform": "ios",
            "shell": get_user_shell(),
            "home": std::env::var("HOME").ok(),
            "hostname": hostname,
            "cwd": std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string()),
        })
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        #[cfg(target_os = "windows")]
        {
            serde_json::json!({
                "platform": "windows",
                "shell": "cmd.exe",
                "home": std::env::var("USERPROFILE").ok(),
                "hostname": hostname,
                "cwd": std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string()),
            })
        }
        #[cfg(target_os = "macos")]
        {
            serde_json::json!({
                "platform": "macos",
                "shell": get_user_shell(),
                "home": std::env::var("HOME").ok(),
                "hostname": hostname,
                "cwd": std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string()),
            })
        }
        #[cfg(target_os = "linux")]
        {
            serde_json::json!({
                "platform": "linux",
                "shell": get_user_shell(),
                "home": std::env::var("HOME").ok(),
                "hostname": hostname,
                "cwd": std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string()),
            })
        }
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────────

/// Execute a shell command (Tauri command)
/// # Arguments
/// * `command` - The shell command to execute
/// * `cwd` - Working directory (optional, defaults to project root)
/// * `timeout_ms` - Timeout in milliseconds (default 30000)
/// * `auto_background` - If true, auto-background persistent servers (http/dev servers)
/// * `session_id` - Optional session ID for abort-aware process tracking (registered in STREAMING_PROCESSES)
///
/// Uses `spawn_blocking` to run the blocking shell execution off the main thread,
/// preventing UI freezes (spinning cursor) during long-running commands.
#[tauri::command]
pub async fn execute_shell_cmd(
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    auto_background: Option<bool>,
    session_id: Option<String>,
) -> Result<ShellResult, String> {
    // If session_id is provided, use abort-aware execution with PID tracking
    if let Some(sid) = session_id {
        return execute_shell_with_tracking(
            &command,
            cwd.as_deref(),
            timeout_ms.unwrap_or(30000),
            auto_background.unwrap_or(false),
            sid,
        )
        .await;
    }

    tokio::task::spawn_blocking(move || {
        execute_shell_internal(
            &command,
            cwd.as_deref(),
            timeout_ms.unwrap_or(30000),
            auto_background.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Execute a shell command with PID tracking, so it can be killed via `kill_stream_shell`.
/// This delegates to the same lifecycle core used by every non-streaming caller.
pub async fn execute_shell_with_tracking(
    command: &str,
    cwd: Option<&str>,
    timeout_ms: u64,
    auto_background: bool,
    session_id: String,
) -> Result<ShellResult, String> {
    let command = command.to_string();
    let cwd = cwd.map(str::to_string);
    tokio::task::spawn_blocking(move || {
        execute_shell_with_lifecycle(
            &command,
            cwd.as_deref(),
            timeout_ms,
            auto_background,
            Some(&session_id),
        )
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Kill a process by PID (used for timeout cleanup)
fn kill_process_by_pid(pid: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::process::Command as StdCommand;
        let _ = StdCommand::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .output();
        // Give it 2 seconds, then force kill
        let pid_str = pid.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let _ = StdCommand::new("kill").arg("-KILL").arg(&pid_str).output();
        });
    }
    #[cfg(windows)]
    {
        use std::process::Command as StdCommand;
        let mut taskkill = StdCommand::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start taskkill for PID {}: {}", pid, e))?;
        let started = Instant::now();
        loop {
            match taskkill.try_wait() {
                Ok(Some(status)) if status.success() => break,
                Ok(Some(status)) => {
                    return Err(format!(
                        "taskkill failed for PID {} with exit code {}",
                        pid,
                        status.code().unwrap_or(-1)
                    ))
                }
                Ok(None) if started.elapsed() >= std::time::Duration::from_secs(2) => {
                    let _ = taskkill.kill();
                    let _ = taskkill.wait();
                    return Err(format!("taskkill did not finish promptly for PID {}", pid));
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(10)),
                Err(error) => {
                    return Err(format!(
                        "Failed to wait for taskkill on PID {}: {}",
                        pid, error
                    ))
                }
            }
        }
    }
    Ok(())
}

/// Check if a command would be auto-backgrounded (for UI hints)
#[tauri::command]
pub fn check_backgroundable(command: String) -> bool {
    is_persistent_server(&command)
}

/// Get shell/platform information (Tauri command)
#[tauri::command]
pub fn get_shell_info_cmd() -> serde_json::Value {
    get_shell_info()
}

// ─── Streaming Shell Execution ────────────────────────────────────────────

pub type StreamEventSink = Arc<dyn Fn(StreamEvent) + Send + Sync + 'static>;

fn is_shell_initialization_noise(text: &str) -> bool {
    text.contains("command not found: compdef")
        || text.contains("command not found: compinit")
        || text.contains("bash: compgen: command not found")
        || text.contains("bash: complete: command not found")
}

fn forward_stream_output<R: Read + Send + 'static>(
    reader: R,
    session_id: String,
    kind: &'static str,
    filter_shell_noise: bool,
    sink: StreamEventSink,
) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut bytes = Vec::with_capacity(4096);

        loop {
            bytes.clear();
            match reader.read_until(b'\n', &mut bytes) {
                Ok(0) => break,
                Ok(_) => {
                    let data = decode_output_bytes(&bytes);
                    if filter_shell_noise && is_shell_initialization_noise(&data) {
                        continue;
                    }
                    sink(StreamEvent {
                        session_id: session_id.clone(),
                        kind: kind.into(),
                        data,
                        exit_code: None,
                        duration_ms: None,
                    });
                }
                Err(_) => break,
            }
        }
    });
}

/// Spawn a shell command and forward output as soon as it is available.
///
/// The sink keeps the Tauri-event command on the same process registration and
/// cancellation lifecycle used by the desktop execution channel.
pub fn spawn_stream_shell_with_sink(
    session_id: String,
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    sink: StreamEventSink,
) -> Result<(), String> {
    validate_command(&command)?;

    let shell_path = get_user_shell();
    let shell_arg = get_shell_arg();

    let mut cmd = Command::new(&shell_path);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd.arg(shell_arg)
        .arg(&command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    if let Some(ref dir) = cwd {
        let path = std::path::Path::new(dir);
        if path.exists() && path.is_dir() {
            cmd.current_dir(path);
        }
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;

    // Register PID for Ctrl+C support
    let pid = child.id();
    {
        let mut procs = STREAMING_PROCESSES.lock().unwrap();
        procs.insert(session_id.clone(), pid);
    }

    let sid = session_id.clone();
    let start = Instant::now();

    // Forward both descriptors independently, preserving their original order
    // within each stream.  Unlike the old HTTP bridge, this does not wait for
    // the process to finish before returning stdout/stderr to its caller.
    if let Some(stdout) = child.stdout.take() {
        forward_stream_output(stdout, sid.clone(), "stdout", false, sink.clone());
    }

    if let Some(stderr) = child.stderr.take() {
        forward_stream_output(stderr, sid.clone(), "stderr", true, sink.clone());
    }

    if let Some(timeout_ms) = timeout_ms.filter(|timeout| *timeout > 0) {
        let watchdog_sid = sid.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(timeout_ms));
            let is_current = STREAMING_PROCESSES
                .lock()
                .map(|processes| processes.get(&watchdog_sid).copied() == Some(pid))
                .unwrap_or(false);
            if is_current {
                let _ = kill_process_by_pid(pid);
            }
        });
    }

    // Wait for process completion in a separate thread, then emit a terminal event.
    let done_sink = sink.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let elapsed = start.elapsed().as_millis() as u64;

        // Remove from registry
        {
            let mut procs = STREAMING_PROCESSES.lock().unwrap();
            if procs.get(&sid).copied() == Some(pid) {
                procs.remove(&sid);
            }
        }

        let (exit_code, success) = match status {
            Ok(s) => (s.code().unwrap_or(-1), s.success()),
            Err(_e) => (-1, false),
        };

        let event = StreamEvent {
            session_id: sid.clone(),
            kind: "done".into(),
            data: if success {
                String::new()
            } else {
                format!("Command exited with code {}", exit_code)
            },
            exit_code: Some(exit_code),
            duration_ms: Some(elapsed),
        };
        done_sink(event);
    });

    Ok(())
}

/// Spawn a shell command with streaming output via Tauri events.
/// Lines from stdout/stderr are emitted in real-time as `shell-stream` events.
/// When the process exits, a `done` event is emitted with exit code and duration.
#[tauri::command]
pub fn spawn_stream_shell(
    app_handle: tauri::AppHandle,
    session_id: String,
    command: String,
    cwd: Option<String>,
) -> Result<(), String> {
    let sink: StreamEventSink = Arc::new(move |event| {
        let _ = app_handle.emit("shell-stream", &event);
    });
    spawn_stream_shell_with_sink(session_id, command, cwd, None, sink)
}

/// Kill a running streaming process by session ID.
#[tauri::command]
pub fn kill_stream_shell(session_id: String) -> Result<(), String> {
    let pid = STREAMING_PROCESSES
        .lock()
        .map_err(|_| "Process registry lock poisoned".to_string())?
        .get(&session_id)
        .copied()
        .ok_or_else(|| format!("No running process for session: {}", session_id))?;

    if let Err(tree_error) = kill_process_by_pid(pid) {
        let child = TRACKED_CHILDREN
            .lock()
            .map_err(|_| "Process registry lock poisoned".to_string())?
            .get(&session_id)
            .cloned();
        match child {
            Some(child) => {
                let mut child = child
                    .lock()
                    .map_err(|_| "Command process lock poisoned".to_string())?;
                if let Err(kill_error) = child.kill() {
                    if child.try_wait().ok().flatten().is_none() {
                        return Err(format!(
                            "{}; direct child fallback failed: {}",
                            tree_error, kill_error
                        ));
                    }
                }
                FALLBACK_TERMINATED_SESSIONS
                    .lock()
                    .map_err(|_| "Process registry lock poisoned".to_string())?
                    .insert(session_id.clone());
            }
            None => return Err(tree_error),
        }
    }

    let mut procs = STREAMING_PROCESSES
        .lock()
        .map_err(|_| "Process registry lock poisoned".to_string())?;
    if procs.get(&session_id).copied() == Some(pid) {
        procs.remove(&session_id);
    }
    TRACKED_CHILDREN
        .lock()
        .map_err(|_| "Process registry lock poisoned".to_string())?
        .remove(&session_id);
    Ok(())
}

/// List all currently running streaming processes.
#[tauri::command]
pub fn list_stream_shells() -> Vec<serde_json::Value> {
    let procs = STREAMING_PROCESSES.lock().unwrap();
    procs
        .iter()
        .map(|(sid, pid)| {
            serde_json::json!({
                "session_id": sid,
                "pid": pid,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_command() {
        let result = execute_shell_internal("echo hello", None, 5000, false).unwrap();
        assert!(result.success);
        assert!(result.stdout.contains("hello"));
    }

    #[test]
    fn test_pwd() {
        #[cfg(windows)]
        let command = "cd";
        #[cfg(not(windows))]
        let command = "pwd";

        let result = execute_shell_internal(command, None, 5000, false).unwrap();
        assert!(result.success);
        assert!(!result.stdout.is_empty());
    }

    #[test]
    fn test_dangerous_command_rejected() {
        let result = execute_shell_internal("rm -rf /", None, 5000, false);
        assert!(result.is_err());
    }

    #[test]
    fn timed_out_command_is_terminated_and_reported() {
        #[cfg(windows)]
        let command = "ping 127.0.0.1 -n 20 > nul";
        #[cfg(not(windows))]
        let command = "sleep 5";

        let result = execute_shell_internal(command, None, 100, false)
            .expect("timeout should produce a result after terminating the command");
        assert!(result.timed_out);
        assert!(!result.success);
    }

    #[test]
    fn streaming_output_is_emitted_before_command_completion() {
        let session_id = format!(
            "stream-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        );
        #[cfg(windows)]
        let command = "echo first & ping 127.0.0.1 -n 3 > nul & echo second";
        #[cfg(not(windows))]
        let command = "printf 'first\\n'; sleep 2; printf 'second\\n'";

        let (sender, receiver) = std::sync::mpsc::channel();
        let sink: StreamEventSink = Arc::new(move |event| {
            let _ = sender.send(event);
        });
        spawn_stream_shell_with_sink(session_id, command.into(), None, Some(5_000), sink)
            .expect("stream command should start");

        let first = receiver
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("first output should arrive before the command completes");
        assert_eq!(first.kind, "stdout");
        assert!(first.data.contains("first"));

        let mut received_done = false;
        for _ in 0..4 {
            let event = receiver
                .recv_timeout(std::time::Duration::from_secs(4))
                .expect("stream should finish");
            if event.kind == "done" {
                received_done = true;
                break;
            }
        }
        assert!(received_done, "stream should publish a done event");
    }

    #[test]
    fn utf8_output_is_not_mojibake_on_windows() {
        #[cfg(windows)]
        let command = "powershell -NoProfile -Command \"[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Write-Output '中文UTF8'\"";
        #[cfg(not(windows))]
        let command = "printf '中文UTF8'";

        let result =
            execute_shell_internal(command, None, 5_000, false).expect("UTF-8 command should run");
        assert!(result.success, "stderr: {}", result.stderr);
        assert!(
            result.stdout.contains("中文UTF8"),
            "stdout: {}",
            result.stdout
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn tracked_command_can_be_cancelled() {
        let session_id = format!(
            "cancel-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        );
        #[cfg(windows)]
        let command = "ping 127.0.0.1 -n 20 > nul";
        #[cfg(not(windows))]
        let command = "sleep 20";

        let run_session_id = session_id.clone();
        let task = tokio::spawn(async move {
            execute_shell_with_tracking(command, None, 30_000, false, run_session_id).await
        });

        let mut registered = false;
        for _ in 0..20 {
            if STREAMING_PROCESSES
                .lock()
                .expect("registry lock")
                .contains_key(&session_id)
            {
                registered = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        assert!(registered, "tracked command should register its PID");

        kill_stream_shell(session_id).expect("tracked command should be cancellable");
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), task)
            .await
            .expect("cancelled command should finish promptly")
            .expect("task join");

        if let Ok(shell_result) = result {
            assert!(!shell_result.success);
        }
    }
}
