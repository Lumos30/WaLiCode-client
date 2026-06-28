//! SSE 客户端
//!
//! 对接 walicode-server 的 `/api/v1/chat_stream` 端点，
//! 解析 JSON 事件流（非标准 SSE 格式，每行是一个 JSON 对象）。

use crate::_cli_app::{AppEvent, ReActEvent};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::mpsc;

/// SSE 客户端配置
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// 创建会话请求（字段名 camelCase 匹配后端 CreateSessionRequestDTO）
#[derive(Debug, Serialize)]
struct CreateSessionRequest {
    #[serde(rename = "agentId")]
    agent_id: String,
    #[serde(rename = "userId")]
    user_id: String,
}

/// 创建会话响应
#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    code: String,
    #[serde(default)]
    info: String,
    #[serde(default)]
    data: Option<T>,
}

#[derive(Debug, Default, Deserialize)]
struct CreateSessionData {
    #[serde(rename = "sessionId")]
    session_id: String,
}

/// 对话请求（字段名 camelCase 匹配后端 ChatRequestDTO）
#[derive(Debug, Serialize)]
struct ChatStreamRequest {
    #[serde(rename = "agentId")]
    agent_id: String,
    #[serde(rename = "userId")]
    user_id: String,
    #[serde(rename = "sessionId")]
    session_id: String,
    message: String,
    #[serde(rename = "terminalSessionId", skip_serializing_if = "Option::is_none")]
    terminal_session_id: Option<String>,
    #[serde(rename = "projectContext", skip_serializing_if = "Option::is_none")]
    project_context: Option<ProjectContext>,
}

#[derive(Debug, Serialize)]
pub struct ProjectContext {
    #[serde(rename = "name")]
    name: String,
    #[serde(rename = "rootPath")]
    root_path: String,
}

/// 本地命令结果回传（字段名 camelCase 匹配后端 CommandResult）
///
/// 注意：后端 status 字段是枚举（SUCCESS/ERROR/TIMEOUT/CANCELLED/DISCONNECTED），
/// Jackson 可以反序列化 String → Enum。
#[derive(Debug, Serialize)]
struct CommandResult {
    #[serde(rename = "cmdId")]
    cmd_id: String,
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "status")]
    status_str: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(rename = "exitCode", skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u64>,
    success: bool,
}

pub struct SseClient {
    client: Client,
    server_url: String,
    event_tx: mpsc::UnboundedSender<AppEvent>,
}

impl SseClient {
    pub fn new(server_url: String, event_tx: mpsc::UnboundedSender<AppEvent>) -> Self {
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .expect("Failed to create HTTP client");

        Self { client, server_url, event_tx }
    }

    /// 创建会话
    pub async fn create_session(&self, agent_id: &str, user_id: &str) -> Result<String, String> {
        let url = format!("{}/api/v1/create_session", self.server_url);
        let req = CreateSessionRequest {
            agent_id: agent_id.to_string(),
            user_id: user_id.to_string(),
        };

        let resp = self
            .client
            .post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("连接服务端失败: {}", e))?;

        let body: ApiResponse<CreateSessionData> = resp
            .json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;

        if body.code == "0000" && body.data.is_some() {
            Ok(body.data.unwrap().session_id)
        } else {
            Err(format!("创建会话失败: {}", body.info))
        }
    }

    /// 发送消息并接收 SSE 流
    pub async fn chat_stream(
        &self,
        agent_id: &str,
        user_id: &str,
        session_id: &str,
        message: &str,
        project_context: Option<ProjectContext>,
    ) -> Result<(), String> {
        let url = format!("{}/api/v1/chat_stream", self.server_url);
        let req = ChatStreamRequest {
            agent_id: agent_id.to_string(),
            user_id: user_id.to_string(),
            session_id: session_id.to_string(),
            message: message.to_string(),
            terminal_session_id: None,
            project_context,
        };

        let resp = self
            .client
            .post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }

        // 读取流式响应
        let mut stream = resp.bytes_stream();

        use futures::StreamExt;
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("读取流失败: {}", e))?;
            buffer += &String::from_utf8_lossy(&chunk);

            // 按换行分割，解析 JSON 事件
            let lines: Vec<String> = buffer.split('\n').map(|s| s.to_string()).collect();
            // 最后一段可能不完整，保留
            buffer = lines.last().cloned().unwrap_or_default();

            for line in &lines[..lines.len().saturating_sub(1)] {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                match serde_json::from_str::<ReActEvent>(trimmed) {
                    Ok(event) => {
                        // 心跳事件忽略
                        if event.event == "heartbeat" {
                            continue;
                        }

                        // execute_local_command → CLI 模式直接执行本地命令
                        if event.event == "execute_local_command" {
                            self.handle_local_command(&event, session_id);
                            continue;
                        }

                        // 发送事件到 UI
                        let _ = self.event_tx.send(AppEvent::SseEvent(event));
                    }
                    Err(_) => {
                        // 非 JSON 行，忽略（HTTP chunk 边界）
                    }
                }
            }
        }

        // 处理最后可能剩余的数据
        if !buffer.trim().is_empty() {
            if let Ok(event) = serde_json::from_str::<ReActEvent>(buffer.trim()) {
                if event.event != "heartbeat" {
                    let _ = self.event_tx.send(AppEvent::SseEvent(event));
                }
            }
        }

        let _ = self.event_tx.send(AppEvent::Done);
        Ok(())
    }

    /// 处理本地命令执行（CLI 模式）
    fn handle_local_command(&self, event: &ReActEvent, session_id: &str) {
        let cmd_id = event.cmd_id.clone().unwrap_or_default();
        let command = event.command.clone().unwrap_or_default();
        let cwd = event.cwd.clone();

        if cmd_id.is_empty() || command.is_empty() {
            return;
        }

        // 通知 UI
        let _ = self.event_tx.send(AppEvent::SseEvent(event.clone()));

        // 在后台线程执行本地命令
        let client = self.client.clone();
        let server_url = self.server_url.clone();
        let sid = session_id.to_string();

        tokio::spawn(async move {
            let start = std::time::Instant::now();

            // 执行命令（直接使用 std::process::Command，不依赖 Tauri）
            let result = tokio::task::spawn_blocking(move || {
                execute_local_command_internal(
                    &command,
                    cwd.as_deref(),
                    60000,
                )
            })
            .await;

            let duration_ms = start.elapsed().as_millis() as u64;

            let cmd_result = match result {
                Ok(Ok(shell_result)) => CommandResult {
                    cmd_id: cmd_id.clone(),
                    session_id: sid.clone(),
                    status_str: if shell_result.success { "SUCCESS".to_string() } else { "ERROR".to_string() },
                    output: Some(format!("{}{}", shell_result.stdout,
                        if shell_result.stderr.is_empty() { String::new() } else { format!("\n{}", shell_result.stderr) })),
                    error: None,
                    exit_code: Some(shell_result.exit_code),
                    duration_ms: Some(duration_ms),
                    success: shell_result.success,
                },
                Ok(Err(e)) => CommandResult {
                    cmd_id: cmd_id.clone(),
                    session_id: sid.clone(),
                    status_str: "ERROR".to_string(),
                    output: None,
                    error: Some(e),
                    exit_code: None,
                    duration_ms: Some(duration_ms),
                    success: false,
                },
                Err(e) => CommandResult {
                    cmd_id: cmd_id.clone(),
                    session_id: sid.clone(),
                    status_str: "ERROR".to_string(),
                    output: None,
                    error: Some(format!("Task error: {}", e)),
                    exit_code: None,
                    duration_ms: Some(duration_ms),
                    success: false,
                },
            };

            // 回传结果给 Server
            let url = format!("{}/api/v1/tool_result", server_url);
            let _ = client.post(&url).json(&cmd_result).send().await;
        });
    }
}

/// 构建项目上下文
pub fn build_project_context(workdir: &Option<String>) -> Option<ProjectContext> {
    workdir.as_ref().and_then(|dir| {
        let path = std::path::PathBuf::from(dir);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.is_empty() {
            None
        } else {
            Some(ProjectContext {
                name,
                root_path: dir.clone(),
            })
        }
    })
}

/// 本地命令执行（纯 Rust，不依赖 Tauri）
/// 
/// 用于 CLI 模式下执行 server 发来的 execute_local_command。
/// 使用标准库 std::process::Command，与 shell_exec 的核心逻辑一致。
fn execute_local_command_internal(
    command: &str,
    cwd: Option<&str>,
    _timeout_ms: u64,
) -> Result<LocalCommandResult, String> {
    use std::process::{Command, Stdio};
    use std::time::Instant;

    let start = Instant::now();

    // 获取 shell
    let shell = std::env::var("SHELL")
        .unwrap_or_else(|_| if cfg!(target_os = "macos") { "/bin/zsh".to_string() } else { "/bin/bash".to_string() });

    let mut cmd = Command::new(&shell);
    cmd.arg("-lic")
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(dir) = cwd {
        let path = std::path::Path::new(dir);
        if path.exists() && path.is_dir() {
            cmd.current_dir(path);
        }
    }

    let output = cmd.output()
        .map_err(|e| format!("Failed to execute: {}", e))?;

    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(LocalCommandResult {
        stdout,
        stderr,
        exit_code,
        success: exit_code == 0,
        _duration_ms: start.elapsed().as_millis() as u64,
    })
}

/// 本地命令执行结果
struct LocalCommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    success: bool,
    _duration_ms: u64,
}

/// 去除 ANSI 转义序列（颜色码等）
fn strip_ansi_codes(s: &str) -> String {
    // 匹配 ESC[...m 格式的 ANSI 序列
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            // 遇到 ESC，检查是否是 CSI 序列 ESC[...m
            if chars.peek() == Some(&'[') {
                chars.next(); // 跳过 '['
                // 跳过所有参数直到 'm'
                while let Some(&c) = chars.peek() {
                    chars.next();
                    if c == 'm' {
                        break;
                    }
                }
                continue;
            }
        }
        result.push(ch);
    }
    
    result
}
