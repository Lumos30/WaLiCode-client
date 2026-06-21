//! Local PTY Terminal Module for WaLiCode
//!
//! 提供真实 PTY 终端会话（类似 IDEA/WebStorm 内置终端）。
//! 基于 portable-pty 创建 login + interactive shell，加载用户完整环境（PATH、nvm、pyenv 等）。
//!
//! Tauri Commands:
//! - spawn_local_pty: 创建 PTY 会话
//! - write_to_pty: 写入数据（按键/命令）
//! - resize_local_pty: 调整终端大小
//! - kill_local_pty: 关闭 PTY 会话
//! - list_local_ptys: 列出活跃会话
//!
//! Events（→ 前端）:
//! - "local-pty-output": { session_id, data } — PTY 输出
//! - "local-pty-exit": { session_id, exit_code } — PTY 退出

use std::collections::HashMap;
use std::io::{Read, Write};
use tauri::Emitter;

use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty, Child};

#[cfg(windows)]
use encoding_rs::GBK;
#[cfg(windows)]
use encoding_rs_io::DecodeReaderBytesBuilder;

lazy_static::lazy_static! {
    /// 活跃 PTY 会话注册表
    pub static ref PTY_SESSIONS: tokio::sync::Mutex<HashMap<String, PtySession>> =
        tokio::sync::Mutex::new(HashMap::new());
}

/// PTY 会话：持有 master PTY 句柄、slave 句柄（保持 shell 存活）、写入器和子进程
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    #[allow(dead_code)]
    slave: Box<dyn portable_pty::SlavePty + Send>,
    writer: Box<dyn std::io::Write + Send>,
    child: Box<dyn Child + Send>,
}

/// 获取用户登录 shell 路径
#[allow(dead_code)]
fn get_user_shell() -> String {
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

/// 获取用户 home 目录
fn get_home_dir() -> String {
    #[cfg(not(windows))]
    {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    }
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string())
    }
}

/// 创建本地 PTY 终端会话
///
/// 使用 login + interactive shell 加载完整用户环境：
/// - .zprofile / .bash_profile（PATH 设置）
/// - .zshrc / .bashrc（nvm、rbenv、pyenv 等）
#[tauri::command]
pub async fn spawn_local_pty(
    app_handle: tauri::AppHandle,
    session_id: String,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let cols_val = cols.unwrap_or(80);
    let rows_val = rows.unwrap_or(24);

    let pty_pair = pty_system
        .openpty(PtySize {
            rows: rows_val,
            cols: cols_val,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to create PTY: {}", e))?;

    #[cfg(not(windows))]
    let shell = get_user_shell();
    let home = get_home_dir();
    let working_dir = cwd.unwrap_or_else(|| home.clone());

    #[cfg(not(windows))]
    {
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l"); // login shell — 加载 .zprofile/.bash_profile
        cmd.arg("-i"); // interactive shell — 加载 .zshrc/.bashrc
        cmd.cwd(&working_dir);

        cmd.env("HOME", &home);
        cmd.env("TERM", "xterm-256color");
        cmd.env("SHELL", &shell);

        let child = pty_pair.slave.spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // ⚠️ 必须持有 slave 引用，否则 drop 后 shell 收到 SIGHUP 立即退出
        let slave = pty_pair.slave;

        let master = pty_pair.master;
        let reader = master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
        let writer = master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

        let session = PtySession { master, slave, writer, child };

        {
            let mut sessions = PTY_SESSIONS.lock().await;
            sessions.insert(session_id.clone(), session);
        }

        // 后台线程读取 PTY 输出，通过 Tauri Event 推送前端
        let sid = session_id.clone();
        let app = app_handle.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // reader EOF — 可能是暂时的，需要确认子进程是否真的退出
                        // 短暂等待后检查 child 状态
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        let child_exited = {
                            let mut sessions = PTY_SESSIONS.blocking_lock();
                            if let Some(session) = sessions.get_mut(&sid) {
                                session.child.try_wait().ok().flatten().is_some()
                            } else {
                                true // session 已不存在，视为已退出
                            }
                        };
                        if child_exited {
                            let exit_code = {
                                let mut sessions = PTY_SESSIONS.blocking_lock();
                                sessions.get_mut(&sid)
                                    .and_then(|s| s.child.try_wait().ok().flatten())
                                    .map(|status| status.exit_code())
                                    .unwrap_or(0)
                            };
                            let _ = app.emit("local-pty-exit", serde_json::json!({
                                "session_id": sid,
                                "exit_code": exit_code,
                            }));
                            break;
                        }
                        // 子进程仍存活，继续读取（reader 可能恢复）
                        continue;
                    }
                    Ok(n) => {
                        #[cfg(windows)]
                        let data = {
                            let mut decoder = DecodeReaderBytesBuilder::new()
                                .encoding(Some(GBK))
                                .build(&buf[..n]);
                            let mut decoded = String::new();
                            if decoder.read_to_string(&mut decoded).is_ok() {
                                decoded
                            } else {
                                String::from_utf8_lossy(&buf[..n]).to_string()
                            }
                        };
                        #[cfg(not(windows))]
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();

                        let _ = app.emit("local-pty-output", serde_json::json!({
                            "session_id": sid,
                            "data": data,
                        }));
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::Interrupted {
                            // 检查子进程是否真的退出
                            let child_exited = {
                                let mut sessions = PTY_SESSIONS.blocking_lock();
                                if let Some(session) = sessions.get_mut(&sid) {
                                    session.child.try_wait().ok().flatten().is_some()
                                } else {
                                    true
                                }
                            };
                            if child_exited {
                                let _ = app.emit("local-pty-exit", serde_json::json!({
                                    "session_id": sid,
                                    "exit_code": -1,
                                }));
                                break;
                            }
                            // 子进程仍存活，继续读取
                            continue;
                        }
                    }
                }
            }

            // 清理会话注册
            {
                let mut sessions = PTY_SESSIONS.blocking_lock();
                sessions.remove(&sid);
            }
        });
    }

    #[cfg(windows)]
    {
        // Windows: 优先 pwsh → powershell → cmd
        let shell_path = which::which("pwsh.exe")
            .or_else(|_| which::which("powershell.exe"))
            .unwrap_or_else(|_| std::path::PathBuf::from("cmd.exe"));

        let mut cmd = CommandBuilder::new(&shell_path);
        cmd.cwd(&working_dir);
        cmd.env("HOME", &home);
        cmd.env("USERPROFILE", &home);
        cmd.env("TERM", "xterm-256color");

        if shell_path.file_name().and_then(|s| s.to_str())
            .map(|s| s.contains("powershell") || s.contains("pwsh"))
            .unwrap_or(false)
        {
            cmd.env("PSExecutionPolicyPreference", "RemoteSigned");
            cmd.env("PYTHONIOENCODING", "utf-8");
        }

        let child = pty_pair.slave.spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell ({}): {}", shell_path.display(), e))?;

        // ⚠️ 必须持有 slave 引用，否则 drop 后 shell 退出
        let slave = pty_pair.slave;

        let master = pty_pair.master;
        let reader = master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
        let writer = master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

        // Windows: 设置控制台编码为 UTF-8
        {
            let _ = writer.write_all(b"chcp 65001 >nul\r\n");
            let _ = writer.flush();
            let _ = writer.write_all(b"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8\r\n");
            let _ = writer.flush();
        }

        let session = PtySession { master, slave, writer, child };

        {
            let mut sessions = PTY_SESSIONS.lock().await;
            sessions.insert(session_id.clone(), session);
        }

        let sid = session_id.clone();
        let app = app_handle.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // reader EOF — 确认子进程是否真的退出
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        let child_exited = {
                            let mut sessions = PTY_SESSIONS.blocking_lock();
                            if let Some(session) = sessions.get_mut(&sid) {
                                session.child.try_wait().ok().flatten().is_some()
                            } else {
                                true
                            }
                        };
                        if child_exited {
                            let exit_code = {
                                let mut sessions = PTY_SESSIONS.blocking_lock();
                                sessions.get_mut(&sid)
                                    .and_then(|s| s.child.try_wait().ok().flatten())
                                    .map(|status| status.exit_code())
                                    .unwrap_or(0)
                            };
                            let _ = app.emit("local-pty-exit", serde_json::json!({
                                "session_id": sid,
                                "exit_code": exit_code,
                            }));
                            break;
                        }
                        continue;
                    }
                    Ok(n) => {
                        let data = {
                            let mut decoder = DecodeReaderBytesBuilder::new()
                                .encoding(Some(GBK))
                                .build(&buf[..n]);
                            let mut decoded = String::new();
                            if decoder.read_to_string(&mut decoded).is_ok() {
                                decoded
                            } else {
                                String::from_utf8_lossy(&buf[..n]).to_string()
                            }
                        };

                        let _ = app.emit("local-pty-output", serde_json::json!({
                            "session_id": sid,
                            "data": data,
                        }));
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::Interrupted {
                            let child_exited = {
                                let mut sessions = PTY_SESSIONS.blocking_lock();
                                if let Some(session) = sessions.get_mut(&sid) {
                                    session.child.try_wait().ok().flatten().is_some()
                                } else {
                                    true
                                }
                            };
                            if child_exited {
                                let _ = app.emit("local-pty-exit", serde_json::json!({
                                    "session_id": sid,
                                    "exit_code": -1,
                                }));
                                break;
                            }
                            continue;
                        }
                    }
                }
            }
            {
                let mut sessions = PTY_SESSIONS.blocking_lock();
                sessions.remove(&sid);
            }
        });
    }

    Ok(())
}

/// 写入数据到 PTY（用户按键、AI 命令等）
#[tauri::command]
pub async fn write_to_pty(session_id: String, data: String) -> Result<(), String> {
    let mut sessions = PTY_SESSIONS.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("No PTY session found: {}", session_id))?;

    session.writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to PTY: {}", e))?;
    session.writer.flush().ok();

    Ok(())
}

/// 调整 PTY 终端大小
#[tauri::command]
pub async fn resize_local_pty(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let mut sessions = PTY_SESSIONS.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("No PTY session found: {}", session_id))?;

    session.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {}", e))?;

    Ok(())
}

/// 关闭 PTY 会话
#[tauri::command]
pub async fn kill_local_pty(session_id: String) -> Result<(), String> {
    let mut sessions = PTY_SESSIONS.lock().await;
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child.kill();
        drop(session);
    }
    Ok(())
}

/// 列出所有活跃 PTY 会话
#[tauri::command]
pub async fn list_local_ptys() -> Vec<serde_json::Value> {
    let sessions = PTY_SESSIONS.lock().await;
    sessions
        .keys()
        .map(|sid| {
            serde_json::json!({
                "session_id": sid,
            })
        })
        .collect()
}
