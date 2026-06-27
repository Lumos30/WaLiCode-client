//! App 状态管理
//!
//! CLI 模式的核心状态：对话消息、会话信息、输入缓冲等。

use clap::Parser;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// CLI 命令行参数
#[derive(Parser, Debug)]
#[command(name = "walicode", version, about = "WaLiCode — AI 驱动的终端智能运维助手")]
pub struct CliArgs {
    /// 服务端地址（默认 http://localhost:8091）
    #[arg(long, default_value = "http://localhost:8091")]
    pub server: String,

    /// 智能体 ID（默认 200000 = unifiedAgent）
    #[arg(long, default_value = "200000")]
    pub agent_id: String,

    /// 用户 ID
    #[arg(long, default_value = "cli-user")]
    pub user_id: String,

    /// 一条一次性消息（执行完毕后退出，非交互模式）
    #[arg(short, long)]
    pub message: Option<String>,

    /// 工作目录（传递给 server 作为项目上下文）
    #[arg(short, long)]
    pub workdir: Option<String>,
}

// ── SSE 事件类型（对齐前端 ReActEvent） ──

/// 后端 SSE 事件（字段名 camelCase 匹配后端 ReActEventDTO）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReActEvent {
    pub event: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(rename = "toolCallId", default)]
    pub tool_call_id: Option<String>,
    #[serde(rename = "toolName", default)]
    pub tool_name: Option<String>,
    #[serde(rename = "fullText", default)]
    pub full_text: Option<String>,
    #[serde(default)]
    pub args: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(rename = "cmdId", default)]
    pub cmd_id: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(rename = "timeoutMs", default)]
    pub timeout_ms: Option<u64>,
    #[serde(rename = "stepInfo", default)]
    pub step_info: Option<StepInfo>,
    #[serde(rename = "changeSummary", default)]
    pub change_summary: Option<ChangeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepInfo {
    #[serde(rename = "currentStep")]
    pub current_step: u32,
    #[serde(rename = "maxSteps")]
    pub max_steps: u32,
    #[serde(rename = "shouldContinue")]
    pub should_continue: bool,
    #[serde(rename = "totalToolCalls")]
    pub total_tool_calls: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeSummary {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub created: Vec<ChangeFile>,
    #[serde(default)]
    pub modified: Vec<ChangeFile>,
    #[serde(default)]
    pub deleted: Vec<ChangeFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeFile {
    pub path: String,
    pub kind: String,
    #[serde(rename = "addedLines", default)]
    pub added_lines: i32,
    #[serde(rename = "removedLines", default)]
    pub removed_lines: i32,
}

// ── App 内部消息模型 ──

/// 对话消息
#[derive(Debug, Clone)]
pub enum Message {
    /// 用户输入
    User { text: String },
    /// AI 文本回复（流式累积）
    Assistant { text: String, done: bool },
    /// 工具调用
    ToolCall {
        tool_name: String,
        args: String,
        tool_call_id: String,
        status: ToolStatus,
    },
    /// 工具结果
    ToolResult {
        tool_name: String,
        tool_call_id: String,
        result: String,
        status: ToolStatus,
    },
    /// 错误
    Error { text: String },
    /// 系统消息（轮次信息等）
    System { text: String },
}

#[derive(Debug, Clone, PartialEq)]
pub enum ToolStatus {
    InProgress,
    Success,
    Failure,
}

/// App 事件
#[derive(Debug)]
pub enum AppEvent {
    /// SSE 事件到达
    SseEvent(ReActEvent),
    /// 用户发送消息
    UserInput(String),
    /// 请求完成
    Done,
    /// 错误
    Error(String),
}

/// App 状态
pub struct App {
    /// 服务端地址
    pub server_url: String,
    /// 智能体 ID
    pub agent_id: String,
    /// 用户 ID
    pub user_id: String,
    /// 当前会话 ID
    pub session_id: Option<String>,
    /// 对话消息列表
    pub messages: Vec<Message>,
    /// 当前输入缓冲
    pub input: String,
    /// 是否正在等待 AI 回复
    pub is_streaming: bool,
    /// 是否应该退出
    pub should_quit: bool,
    /// 当前流式文本累积
    pub streaming_text: String,
    /// 工具调用 → 步骤索引映射
    pub tool_step_map: HashMap<String, usize>,
    /// 步骤计数器
    pub step_counter: usize,
    /// 工作目录
    pub workdir: Option<String>,
    /// 用户手动滚动偏移（0 = 底部/最新，>0 = 向上偏移若干行）
    pub scroll_offset: u16,
    /// 是否处于手动滚动模式（流式输出时自动切回 auto-scroll）
    pub manual_scroll: bool,
}

impl App {
    pub fn new(args: &CliArgs) -> Self {
        // 推断工作目录
        let workdir = args.workdir.clone().or_else(|| {
            std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string())
        });

        Self {
            server_url: args.server.clone(),
            agent_id: args.agent_id.clone(),
            user_id: args.user_id.clone(),
            session_id: None,
            messages: Vec::new(),
            input: String::new(),
            is_streaming: false,
            should_quit: false,
            streaming_text: String::new(),
            tool_step_map: HashMap::new(),
            step_counter: 0,
            workdir,
            scroll_offset: 0,
            manual_scroll: false,
        }
    }

    /// 处理 SSE 事件
    pub fn handle_event(&mut self, event: ReActEvent) {
        match event.event.as_str() {
            "text" => {
                let full_text = event.full_text.or(event.content).unwrap_or_default();
                self.streaming_text = full_text.clone();

                // 新消息到达 → 取消手动滚动，自动跟随底部
                if self.manual_scroll {
                    self.manual_scroll = false;
                    self.scroll_offset = 0;
                }

                // 更新或创建 Assistant 消息
                if let Some(last) = self.messages.last_mut() {
                    if let Message::Assistant { text, done } = last {
                        if !*done {
                            *text = full_text;
                            return;
                        }
                    }
                }
                // 新建 Assistant 消息
                self.messages.push(Message::Assistant {
                    text: full_text,
                    done: false,
                });
            }

            "tool_call" => {
                self.step_counter += 1;
                let tool_name = event.tool_name.unwrap_or_default();
                let tool_call_id = event.tool_call_id.unwrap_or_default();
                let args = event.args.unwrap_or_default();

                if !tool_call_id.is_empty() {
                    self.tool_step_map
                        .insert(tool_call_id.clone(), self.step_counter);
                }

                self.messages.push(Message::ToolCall {
                    tool_name,
                    args,
                    tool_call_id,
                    status: ToolStatus::InProgress,
                });
            }

            "tool_result" => {
                let tool_call_id = event.tool_call_id.unwrap_or_default();
                let result = event.content.unwrap_or_default();
                let status = if event.status.as_deref() == Some("error") {
                    ToolStatus::Failure
                } else {
                    ToolStatus::Success
                };

                // 找到对应的 ToolCall 并更新
                let tool_name = self.find_tool_name(&tool_call_id);
                self.messages.push(Message::ToolResult {
                    tool_name,
                    tool_call_id,
                    result,
                    status,
                });
            }

            "tool_progress" => {
                // 工具执行进度，暂不处理（可以在后续版本添加进度条）
            }

            "round_end" => {
                if let Some(info) = event.step_info {
                    self.messages.push(Message::System {
                        text: format!(
                            "🔄 ReAct 步骤 {}/{} · 工具调用 {} 次",
                            info.current_step, info.max_steps, info.total_tool_calls
                        ),
                    });
                }
            }

            "done" => {
                // 标记 Assistant 消息完成
                if let Some(last) = self.messages.last_mut() {
                    if let Message::Assistant { text, done } = last {
                        *done = true;
                    }
                }
                self.is_streaming = false;
                self.streaming_text.clear();

                // 如果有 changeSummary，显示变更摘要
                if let Some(cs) = event.change_summary {
                    if !cs.modified.is_empty() || !cs.created.is_empty() || !cs.deleted.is_empty() {
                        let mut summary = String::from("📝 文件变更:\n");
                        for f in &cs.created {
                            summary.push_str(&format!("  ✨ 创建: {}\n", f.path));
                        }
                        for f in &cs.modified {
                            summary.push_str(&format!("  ✏️ 修改: {}\n", f.path));
                        }
                        for f in &cs.deleted {
                            summary.push_str(&format!("  🗑 删除: {}\n", f.path));
                        }
                        self.messages.push(Message::System { text: summary });
                    }
                }
            }

            "error" => {
                let error_msg = event.content.unwrap_or_default();
                self.messages.push(Message::Error { text: error_msg });
                self.is_streaming = false;
                self.streaming_text.clear();
            }

            "warning" => {
                if let Some(w) = event.content {
                    self.messages.push(Message::System { text: format!("⚠️ {}", w) });
                }
            }

            "execute_local_command" => {
                // CLI 模式下本地命令直接执行（不依赖 Tauri invoke）
                let cmd_id = event.cmd_id.unwrap_or_default();
                let command = event.command.unwrap_or_default();
                let cwd = event.cwd.clone();

                if !cmd_id.is_empty() && !command.is_empty() {
                    self.messages.push(Message::System {
                        text: format!("⚡ 执行本地命令: {}", command),
                    });
                    // 实际执行在 sse_client 中处理
                }
            }

            "heartbeat" | "status" | "round_start" => {
                // 心跳/状态/轮次开始 — 不显示到 UI
            }

            _ => {
                // 未知事件类型，忽略
            }
        }
    }

    /// 通过 tool_call_id 查找对应的工具名
    fn find_tool_name(&self, tool_call_id: &str) -> String {
        // 从 messages 中反向查找
        for msg in self.messages.iter().rev() {
            if let Message::ToolCall { tool_name, tool_call_id: id, .. } = msg {
                if id == tool_call_id {
                    return tool_name.clone();
                }
            }
        }
        String::new()
    }

    /// 用户发送消息
    pub fn send_message(&mut self, text: String) {
        self.messages.push(Message::User { text: text.clone() });
        self.is_streaming = true;
        self.streaming_text.clear();
        self.input.clear();
    }

    /// 斜杠命令处理
    pub fn handle_slash_command(&mut self, cmd: &str) -> bool {
        let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
        let command = parts[0];

        match command {
            "/quit" | "/exit" | "/q" => {
                self.should_quit = true;
                true
            }
            "/clear" => {
                self.messages.clear();
                self.streaming_text.clear();
                true
            }
            "/help" => {
                self.messages.push(Message::System {
                    text: "WaLiCode CLI 命令:\n\
                           /help    — 显示帮助\n\
                           /quit    — 退出\n\
                           /clear   — 清空对话\n\
                           /session — 显示当前会话信息\n\
                           /model   — 切换智能体\n\
                           /status  — 显示连接状态"
                        .to_string(),
                });
                true
            }
            "/session" => {
                let info = match &self.session_id {
                    Some(id) => format!("会话 ID: {}\n智能体: {}", id, self.agent_id),
                    None => "尚未创建会话".to_string(),
                };
                self.messages.push(Message::System { text: info });
                true
            }
            "/status" => {
                self.messages.push(Message::System {
                    text: format!(
                        "服务端: {}\n智能体: {}\n用户: {}\n工作目录: {}\n流式: {}\n消息数: {}",
                        self.server_url,
                        self.agent_id,
                        self.user_id,
                        self.workdir.as_deref().unwrap_or("未设置"),
                        self.is_streaming,
                        self.messages.len()
                    ),
                });
                true
            }
            "/model" => {
                if let Some(new_id) = parts.get(1) {
                    self.agent_id = new_id.to_string();
                    self.session_id = None; // 切换智能体需要新会话
                    self.messages.push(Message::System {
                        text: format!("切换智能体为: {}", new_id),
                    });
                } else {
                    self.messages.push(Message::System {
                        text: format!("当前智能体: {}", self.agent_id),
                    });
                }
                true
            }
            _ => false, // 不是斜杠命令，当作普通消息发送
        }
    }
}
