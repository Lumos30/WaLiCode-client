//! SSE 客户端
//!
//! 对接 walicode-server 的 `/api/v1/chat_stream` 端点，
//! 解析 JSON 事件流（非标准 SSE 格式，每行是一个 JSON 对象）。

use crate::_cli_app::{AppEvent, PermissionInfo, ReActEvent};
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
    api_token: Option<String>,
}

#[derive(Debug, Serialize)]
struct PermissionResolveRequest {
    ticket: String,
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "runId")]
    run_id: String,
    #[serde(rename = "toolCallId")]
    tool_call_id: String,
    #[serde(rename = "toolName")]
    tool_name: String,
    #[serde(rename = "argsDigest")]
    args_digest: String,
    approved: bool,
}

impl SseClient {
    pub fn new(server_url: String, event_tx: mpsc::UnboundedSender<AppEvent>) -> Self {
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            server_url,
            event_tx,
            api_token: load_api_token(),
        }
    }

    fn authorize(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.api_token {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }

    /// 创建会话
    pub async fn create_session(&self, agent_id: &str, user_id: &str) -> Result<String, String> {
        let url = format!("{}/api/v1/create_session", self.server_url);
        let req = CreateSessionRequest {
            agent_id: agent_id.to_string(),
            user_id: user_id.to_string(),
        };

        let resp = self
            .authorize(self.client.post(&url))
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("连接服务端失败: {}", e))?;

        let body: ApiResponse<CreateSessionData> = resp
            .json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;

        match body {
            ApiResponse {
                code,
                data: Some(data),
                ..
            } if code == "0000" => Ok(data.session_id),
            body => Err(format!("创建会话失败: {}", body.info)),
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
            .authorize(self.client.post(&url))
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

                        if event.event == "permission_confirm" {
                            self.handle_permission_confirmation(&event);
                            continue;
                        }

                        // 发送事件到 UI
                        let _ = self.event_tx.send(AppEvent::SseEvent(Box::new(event)));
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
                    if event.event == "execute_local_command" {
                        self.handle_local_command(&event, session_id);
                    } else if event.event == "permission_confirm" {
                        self.handle_permission_confirmation(&event);
                    } else {
                        let _ = self.event_tx.send(AppEvent::SseEvent(Box::new(event)));
                    }
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
        let timeout_ms = event.timeout_ms.unwrap_or(60_000);

        if cmd_id.is_empty() || command.is_empty() {
            return;
        }

        // 通知 UI
        let _ = self
            .event_tx
            .send(AppEvent::SseEvent(Box::new(event.clone())));

        // 在后台线程执行本地命令
        let client = self.client.clone();
        let server_url = self.server_url.clone();
        let api_token = self.api_token.clone();
        let sid = session_id.to_string();

        tokio::spawn(async move {
            let approval_command = command.clone();
            let approval_cwd = cwd.clone();
            let approved = tokio::task::spawn_blocking(move || {
                confirm_local_command(&approval_command, approval_cwd.as_deref())
            })
            .await
            .unwrap_or(false);

            let start = std::time::Instant::now();

            if !approved {
                let url = format!("{}/api/v1/tool_result", server_url);
                let cmd_result = CommandResult {
                    cmd_id: cmd_id.clone(),
                    session_id: sid.clone(),
                    status_str: "ERROR".to_string(),
                    output: None,
                    error: Some("本地用户拒绝执行该命令".to_string()),
                    exit_code: None,
                    duration_ms: Some(0),
                    success: false,
                };
                let request = client.post(&url).json(&cmd_result);
                let request = match api_token.clone() {
                    Some(token) => request.bearer_auth(token),
                    None => request,
                };
                let _ = request.send().await;
                return;
            }

            // 执行命令（直接使用 std::process::Command，不依赖 Tauri）
            let result = tokio::task::spawn_blocking(move || {
                execute_local_command_internal(&command, cwd.as_deref(), timeout_ms)
            })
            .await;

            let duration_ms = start.elapsed().as_millis() as u64;

            let cmd_result = match result {
                Ok(Ok(shell_result)) => CommandResult {
                    cmd_id: cmd_id.clone(),
                    session_id: sid.clone(),
                    status_str: if shell_result.timed_out {
                        "TIMEOUT".to_string()
                    } else if shell_result.success {
                        "SUCCESS".to_string()
                    } else {
                        "ERROR".to_string()
                    },
                    output: Some(format!(
                        "{}{}",
                        shell_result.stdout,
                        if shell_result.stderr.is_empty() {
                            String::new()
                        } else {
                            format!("\n{}", shell_result.stderr)
                        }
                    )),
                    error: shell_result
                        .timed_out
                        .then(|| "命令执行超时，已终止进程树".to_string()),
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
            let request = client.post(&url).json(&cmd_result);
            let request = match api_token {
                Some(token) => request.bearer_auth(token),
                None => request,
            };
            let _ = request.send().await;
        });
    }

    fn handle_permission_confirmation(&self, event: &ReActEvent) {
        let Some(permission) = event.permission.clone() else {
            return;
        };

        let _ = self
            .event_tx
            .send(AppEvent::SseEvent(Box::new(event.clone())));
        let client = self.client.clone();
        let server_url = self.server_url.clone();
        let api_token = self.api_token.clone();

        tokio::spawn(async move {
            let prompt = permission.clone();
            let approved = tokio::task::spawn_blocking(move || confirm_permission_request(&prompt))
                .await
                .unwrap_or(false);

            let request_body = PermissionResolveRequest {
                ticket: permission.ticket,
                session_id: permission.session_id,
                run_id: permission.run_id,
                tool_call_id: permission.tool_call_id,
                tool_name: permission.tool_name,
                args_digest: permission.args_digest,
                approved,
            };
            let url = format!("{}/api/v1/permission/resolve", server_url);
            let request = client.post(&url).json(&request_body);
            let request = match api_token {
                Some(token) => request.bearer_auth(token),
                None => request,
            };
            match request.send().await {
                Ok(response) => match response.json::<ApiResponse<String>>().await {
                    Ok(body) if body.code == "0000" => {}
                    Ok(body) => eprintln!("权限确认失败: {}", body.info),
                    Err(error) => eprintln!("权限确认响应解析失败: {}", error),
                },
                Err(error) => eprintln!("权限确认回写失败: {}", error),
            }
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

/// CLI 本地命令执行复用 GUI/Tauri 的同一执行内核。
///
/// 这样超时、完整进程树终止、输出解码和危险命令校验不会随入口变化。
fn execute_local_command_internal(
    command: &str,
    cwd: Option<&str>,
    timeout_ms: u64,
) -> Result<LocalCommandResult, String> {
    let result = crate::shell_exec::execute_shell_internal(command, cwd, timeout_ms, false)?;
    Ok(LocalCommandResult {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
        success: result.success,
        timed_out: result.timed_out,
        _duration_ms: result.duration_ms,
    })
}

fn confirm_local_command(command: &str, cwd: Option<&str>) -> bool {
    use std::io::{self, Write};
    let mut stdout = io::stdout();
    let _ = writeln!(
        stdout,
        "\nServer requested local command execution:\n  {}\nWorking directory: {}\nExecute? [y/N]",
        command,
        cwd.unwrap_or("current directory")
    );
    let _ = stdout.flush();
    let mut answer = String::new();
    io::stdin().read_line(&mut answer).is_ok()
        && matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes")
}

fn confirm_permission_request(permission: &PermissionInfo) -> bool {
    use std::io::{self, Write};
    let mut stdout = io::stdout();
    let _ = writeln!(
        stdout,
        "\nPermission required\n  Tool: {}\n  Session: {}\n  Reason: {}\n  Arguments: {}\nApprove these exact arguments? [y/N]",
        permission.tool_name,
        permission.session_id,
        permission.reason,
        permission.tool_args
    );
    let _ = stdout.flush();
    let mut answer = String::new();
    io::stdin().read_line(&mut answer).is_ok()
        && matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes")
}

fn load_api_token() -> Option<String> {
    if let Ok(token) = std::env::var("WALICODE_API_TOKEN") {
        let token = token.trim().to_string();
        if !token.is_empty() {
            return Some(token);
        }
    }

    let path = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .map(|base| base.join("WaLiCode").join("config").join("api-token"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join(".config"))
            })
            .map(|base| base.join("walicode").join("api-token"))
    }?;

    std::fs::read_to_string(path)
        .ok()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

/// 本地命令执行结果
struct LocalCommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    success: bool,
    timed_out: bool,
    _duration_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::{execute_local_command_internal, PermissionResolveRequest};

    #[test]
    fn executes_in_directory_with_spaces_and_unicode() {
        let dir = std::env::temp_dir().join("walicode cli 空格 test");
        std::fs::create_dir_all(&dir).expect("create test directory");
        #[cfg(windows)]
        let command = "echo cli-cwd";
        #[cfg(not(windows))]
        let command = "printf cli-cwd";

        let result = execute_local_command_internal(command, dir.to_str(), 5_000)
            .expect("command should run");
        assert!(result.success, "stderr: {}", result.stderr);
        assert!(result.stdout.contains("cli-cwd"));
        std::fs::remove_dir_all(dir).expect("remove test directory");
    }

    #[test]
    fn reports_timeout() {
        #[cfg(windows)]
        let command = "ping 127.0.0.1 -n 6 > nul";
        #[cfg(not(windows))]
        let command = "sleep 5";

        let result = execute_local_command_internal(command, None, 100)
            .expect("timeout should return a result");
        assert!(result.timed_out);
        assert!(!result.success);
    }

    #[test]
    fn serializes_bound_permission_resolution_context() {
        let request = PermissionResolveRequest {
            ticket: "opaque-ticket".to_string(),
            session_id: "session-a".to_string(),
            run_id: "run-a".to_string(),
            tool_call_id: "call-a".to_string(),
            tool_name: "executeCommand".to_string(),
            args_digest: "digest-a".to_string(),
            approved: true,
        };

        let value = serde_json::to_value(request).expect("permission resolution should serialize");
        assert_eq!(value["ticket"], "opaque-ticket");
        assert_eq!(value["sessionId"], "session-a");
        assert_eq!(value["runId"], "run-a");
        assert_eq!(value["toolCallId"], "call-a");
        assert_eq!(value["toolName"], "executeCommand");
        assert_eq!(value["argsDigest"], "digest-a");
        assert_eq!(value["approved"], true);
        assert!(value.get("modifiedArgs").is_none());
    }
}
