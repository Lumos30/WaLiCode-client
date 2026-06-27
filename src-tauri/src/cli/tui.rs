//! TUI 终端界面
//!
//! 基于 ratatui + crossterm 的终端 UI 渲染。
//! 设计风格：类似 Claude Code / OpenCode 的简洁终端对话界面。
//!
//! 布局：
//! ┌──────────────────────────────────────────────────────────────┐
//! │ Header: WaLiCode v0.1.0 | Agent: unified | Session: xxx      │
//! ├──────────────────────────────────────────────────────────────┤
//! │                                                              │
//! │  [消息区域 - 自动滚动]                                        │
//! │                                                              │
//! │  ┌────────────────────────────────────────────────────┐     │
//! │  │ 🧑 你                                              │     │
//! │  │ 帮我看看这个项目                                    │     │
//! │  └────────────────────────────────────────────────────┘     │
//! │                                                              │
//! │  ┌────────────────────────────────────────────────────┐     │
//! │  │ 🤖 AI · 2.3s                                       │     │
//! │  │ 让我分析一下项目架构...                             │     │
//! │  │                                                    │     │
//! │  │ ▼ Thinking                                         │     │
//! │  │   1. 首先查看项目结构                               │     │
//! │  │   2. 分析主要代码文件                               │     │
//! │  └────────────────────────────────────────────────────┘     │
//! │                                                              │
//! │  🔧 FileRead: src/main.rs                                    │
//! │  ✅ FileRead: 完成 (234 lines)                               │
//! │                                                              │
//! ├──────────────────────────────────────────────────────────────┤
//! │ 💡 提示: 按 Ctrl+C 退出, /help 查看命令                      │
//! ├──────────────────────────────────────────────────────────────┤
//! │ > 输入你的消息...                                            │
//! └──────────────────────────────────────────────────────────────┘

use crate::_cli_app::{App, AppEvent, CliArgs, Message, ToolStatus, ReActEvent, StepInfo};
use crate::_cli_sse::{SseClient, build_project_context};

use crossterm::{
    event::{Event as CEvent, KeyCode, KeyEvent, KeyModifiers, MouseEvent},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Margin, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
    Frame, Terminal,
};
use std::io::{self, Read};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// 检查 stdin 是否为 TTY（终端）
fn is_tty() -> bool {
    use std::io::IsTerminal;
    std::io::stdin().is_terminal()
}

/// 主题颜色配置（OpenCode 风格）
mod theme {
    use ratatui::style::Color;

    pub const BG: Color = Color::Rgb(245, 245, 245);           // 浅灰背景
    pub const FG: Color = Color::Rgb(60, 60, 60);              // 主文字色
    pub const FG_DIM: Color = Color::Rgb(120, 120, 120);       // 次要文字
    pub const FG_MUTED: Color = Color::Rgb(160, 160, 160);     // 更淡的文字
    pub const BORDER: Color = Color::Rgb(220, 220, 220);       // 边框色
    pub const USER_BG: Color = Color::Rgb(235, 245, 255);      // 用户消息背景
    pub const USER_BORDER: Color = Color::Rgb(100, 150, 200);  // 用户消息边框
    pub const AI_BG: Color = Color::Rgb(255, 255, 255);        // AI 消息背景
    pub const AI_BORDER: Color = Color::Rgb(200, 200, 200);    // AI 消息边框
    pub const THINKING_BG: Color = Color::Rgb(250, 250, 250);  // Thinking 背景
    pub const ACCENT: Color = Color::Rgb(80, 160, 80);         // 强调色（绿色）
    pub const ACCENT_BLUE: Color = Color::Rgb(60, 120, 180);   // 蓝色强调
    pub const ERROR: Color = Color::Rgb(200, 80, 80);          // 错误红
    pub const WARNING: Color = Color::Rgb(200, 160, 60);       // 警告黄
    pub const SUCCESS: Color = Color::Rgb(60, 160, 60);        // 成功绿
}

/// 运行 CLI 模式
pub async fn run_cli(args: CliArgs) {
    // 非交互模式：一条消息直接执行
    if let Some(message) = args.message.clone() {
        run_one_shot(args, message).await;
        return;
    }

    // 交互模式：启动 TUI
    run_tui(args).await;
}

/// 一次性消息模式（非交互）
async fn run_one_shot(args: CliArgs, message: String) {
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<AppEvent>();
    let sse = SseClient::new(args.server.clone(), event_tx);

    // 创建会话
    let session_id = match sse.create_session(&args.agent_id, &args.user_id).await {
        Ok(id) => id,
        Err(e) => {
            eprintln!("❌ {}", e);
            return;
        }
    };

    let project_context = build_project_context(&args.workdir);

    // 发送消息
    let result = sse
        .chat_stream(
            &args.agent_id,
            &args.user_id,
            &session_id,
            &message,
            project_context,
        )
        .await;

    // 输出结果
    let mut full_text = String::new();
    while let Some(event) = event_rx.recv().await {
        match event {
            AppEvent::SseEvent(e) => {
                match e.event.as_str() {
                    "text" => {
                        full_text = e.full_text.or(e.content).unwrap_or_default();
                    }
                    "done" => {
                        if !full_text.is_empty() {
                            println!("{}", full_text);
                        }
                        return;
                    }
                    "error" => {
                        eprintln!("❌ {}", e.content.unwrap_or_default());
                        return;
                    }
                    _ => {}
                }
            }
            AppEvent::Done => {
                if !full_text.is_empty() {
                    println!("{}", full_text);
                }
                return;
            }
            AppEvent::Error(e) => {
                eprintln!("❌ {}", e);
                return;
            }
            _ => {}
        }
    }

    if let Err(e) = result {
        eprintln!("❌ {}", e);
    }
}

/// 交互式 TUI 模式
async fn run_tui(args: CliArgs) {
    // 检查是否为 TTY，如果不是则切换到非交互模式
    if !is_tty() {
        eprintln!("⚠️  检测到非交互环境，切换到非交互模式");
        // 尝试从 stdin 读取消息
        let mut message = String::new();
        if std::io::stdin().read_to_string(&mut message).is_ok() && !message.trim().is_empty() {
            run_one_shot(args, message.trim().to_string()).await;
        } else {
            eprintln!("❌ 非交互模式需要提供消息: walicode-cli -m '消息' 或通过管道传入");
        }
        return;
    }
    
    // 初始化终端
    if let Err(e) = enable_raw_mode() {
        eprintln!("⚠️  无法启用终端 raw 模式 ({}), 切换到非交互模式", e);
        let mut message = String::new();
        if std::io::stdin().read_to_string(&mut message).is_ok() && !message.trim().is_empty() {
            run_one_shot(args, message.trim().to_string()).await;
        } else {
            eprintln!("❌ 非交互模式需要提供消息: walicode-cli -m '消息' 或通过管道传入");
        }
        return;
    }
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen).expect("Failed to enter alternate screen");
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).expect("Failed to create terminal");
    terminal.clear().expect("Failed to clear terminal");

    // 创建 App 和事件 channel
    let mut app = App::new(&args);
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<AppEvent>();
    let sse = SseClient::new(args.server.clone(), event_tx.clone());

    // 先创建会话
    print_welcome(&mut terminal, &app);

    let session_id = match sse.create_session(&args.agent_id, &args.user_id).await {
        Ok(id) => id,
        Err(e) => {
            // 恢复终端并报错
            restore_terminal(&mut terminal);
            eprintln!("❌ 无法连接到 WaLiCode 服务端: {}", e);
            eprintln!("   请确认服务端已启动: {}", args.server);
            return;
        }
    };

    app.session_id = Some(session_id);

    // 主循环
    loop {
        // 渲染 UI
        terminal.draw(|f| render(f, &app)).expect("Failed to draw");

        // 处理事件（键盘输入 + SSE 事件）
        if crossterm::event::poll(std::time::Duration::from_millis(50)).expect("Event poll failed") {
            if let Ok(c_event) = crossterm::event::read() {
                match c_event {
                    CEvent::Key(key) => handle_key_event(&mut app, key, &sse, &event_tx),
                    CEvent::Mouse(mouse) => handle_mouse_event(&mut app, mouse),
                    CEvent::Resize(_, _) => {} // 自动处理
                    _ => {}
                }
            }
        }

        // 处理 SSE 事件
        while let Ok(event) = event_rx.try_recv() {
            match event {
                AppEvent::SseEvent(e) => {
                    // 内部事件：会话创建
                    if e.event == "_session_created" {
                        if let Some(sid) = e.content {
                            app.session_id = Some(sid);
                        }
                        continue;
                    }
                    app.handle_event(e);
                }
                AppEvent::Done => {
                    app.is_streaming = false;
                }
                AppEvent::Error(e) => {
                    app.messages.push(Message::Error { text: e });
                    app.is_streaming = false;
                }
                _ => {}
            }
        }

        if app.should_quit {
            break;
        }
    }

    // 恢复终端
    restore_terminal(&mut terminal);
}

fn restore_terminal(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) {
    disable_raw_mode().expect("Failed to disable raw mode");
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen
    ).expect("Failed to leave alternate screen");
    terminal.show_cursor().expect("Failed to show cursor");
}

/// 打印欢迎信息（在创建会话期间）
fn print_welcome(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, _app: &App) {
    terminal.draw(|f| {
        let size = f.area();
        
        let welcome = Paragraph::new(Text::from(vec![
            Line::from(vec![
                Span::styled(" 🚀 ", Style::default().fg(theme::ACCENT)),
                Span::styled("WaLiCode", Style::default().fg(theme::ACCENT).add_modifier(Modifier::BOLD)),
                Span::styled(" — AI 驱动的终端智能运维助手", Style::default().fg(theme::FG_DIM)),
            ]),
            Line::from(""),
            Line::from(vec![
                Span::styled(" ⏳ ", Style::default().fg(theme::WARNING)),
                Span::styled("正在连接服务端...", Style::default().fg(theme::FG_DIM)),
            ]),
        ]))
        .alignment(Alignment::Center);

        let area = centered_rect(60, 20, size);
        f.render_widget(welcome, area);
    }).expect("Failed to draw welcome");
}

/// 处理键盘事件
fn handle_key_event(app: &mut App, key: KeyEvent, _sse: &SseClient, event_tx: &mpsc::UnboundedSender<AppEvent>) {
    // Ctrl+C / Esc 退出
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        app.should_quit = true;
        return;
    }

    // 正在流式接收时，按 Esc 取消流式请求
    if app.is_streaming && key.code == KeyCode::Esc {
        app.is_streaming = false;
        app.messages.push(Message::System { text: "⏹ 已取消当前请求".to_string() });
        return;
    }

    // Enter 发送消息
    if key.code == KeyCode::Enter {
        let text = app.input.trim().to_string();
        if text.is_empty() {
            return;
        }

        // 检查是否是斜杠命令
        if text.starts_with('/') {
            if app.handle_slash_command(&text) {
                return;
            }
        }

        // 发送消息
        app.send_message(text.clone());

        // 异步发送 SSE 请求
        let session_id = app.session_id.clone().unwrap_or_default();
        let agent_id = app.agent_id.clone();
        let user_id = app.user_id.clone();
        let project_context = build_project_context(&app.workdir);
        let server_url = app.server_url.clone();
        let tx = event_tx.clone();

        tokio::spawn(async move {
            let sse = SseClient::new(server_url, tx.clone());

            let sid = if session_id.is_empty() {
                match sse.create_session(&agent_id, &user_id).await {
                    Ok(id) => {
                        // 通知主循环更新 session_id
                        let session_id_str: String = id;
                        let _ = tx.send(AppEvent::SseEvent(ReActEvent {
                            event: "_session_created".to_string(),
                            content: Some(session_id_str.clone()),
                            tool_call_id: None,
                            tool_name: None,
                            full_text: None,
                            args: None,
                            summary: None,
                            status: None,
                            cmd_id: None,
                            command: None,
                            cwd: None,
                            timeout_ms: None,
                            step_info: None,
                            change_summary: None,
                        }));
                        session_id_str
                    }
                    Err(e) => {
                        let _ = tx.send(AppEvent::Error(e));
                        return;
                    }
                }
            } else {
                session_id
            };

            let _ = sse.chat_stream(&agent_id, &user_id, &sid, &text, project_context).await;
        });

        return;
    }

    // 退格删除
    if key.code == KeyCode::Backspace {
        app.input.pop();
        return;
    }

    // Ctrl+U 清空输入
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('u') {
        app.input.clear();
        return;
    }

    // 字符输入
    if let KeyCode::Char(c) = key.code {
        app.input.push(c);
    }
}

/// 处理鼠标事件
fn handle_mouse_event(_app: &mut App, _mouse: MouseEvent) {
    // 可以用于滚动消息区域等，暂不实现
}

/// 渲染 TUI
fn render(f: &mut Frame, app: &App) {
    let size = f.area();

    // 整体布局：Header + Messages + Hint + Input
    let chunks = Layout::vertical([
        Constraint::Length(1),  // Header（单行）
        Constraint::Min(5),     // Messages（弹性）
        Constraint::Length(1),  // Hint
        Constraint::Length(3),  // Input
    ]).split(size);

    render_header(f, chunks[0], app);
    render_messages(f, chunks[1], app);
    render_hint(f, chunks[2], app);
    render_input(f, chunks[3], app);
}

/// 渲染 Header（单行简洁风格）
fn render_header(f: &mut Frame, area: Rect, app: &App) {
    let session_short = app.session_id.as_ref()
        .map(|s| if s.len() > 8 { format!("{}...", &s[..8]) } else { s.clone() })
        .unwrap_or_else(|| "未连接".to_string());

    let header_text = Line::from(vec![
        Span::styled(" WaLiCode ", Style::default().fg(theme::ACCENT).add_modifier(Modifier::BOLD)),
        Span::styled("v0.1.0", Style::default().fg(theme::FG_MUTED)),
        Span::raw(" │ "),
        Span::styled("Agent: ", Style::default().fg(theme::FG_DIM)),
        Span::styled(&app.agent_id, Style::default().fg(theme::ACCENT_BLUE)),
        Span::raw(" │ "),
        Span::styled("Session: ", Style::default().fg(theme::FG_DIM)),
        Span::styled(session_short, Style::default().fg(theme::FG_DIM)),
    ]);

    let header = Paragraph::new(header_text)
        .style(Style::default().bg(theme::BG));

    f.render_widget(header, area);
}

/// 渲染消息区域（气泡卡片风格）
fn render_messages(f: &mut Frame, area: Rect, app: &App) {
    let mut lines: Vec<Line> = Vec::new();

    for msg in &app.messages {
        match msg {
            Message::User { text } => {
                // 用户消息：蓝色气泡风格
                lines.push(Line::from(""));
                lines.push(Line::from(vec![
                    Span::styled(" ┌─ ", Style::default().fg(theme::USER_BORDER)),
                    Span::styled("🧑 你", Style::default().fg(theme::USER_BORDER).add_modifier(Modifier::BOLD)),
                ]));
                for line in text.lines() {
                    lines.push(Line::from(vec![
                        Span::styled(" │ ", Style::default().fg(theme::USER_BORDER)),
                        Span::styled(line.to_string(), Style::default().fg(theme::FG)),
                    ]));
                }
                lines.push(Line::from(vec![
                    Span::styled(" └", Style::default().fg(theme::USER_BORDER)),
                ]));
                lines.push(Line::from(""));
            }

            Message::Assistant { text, done } => {
                // AI 消息：灰色边框卡片风格
                let indicator = if *done { "✓" } else { "◐" };
                let color = if *done { theme::SUCCESS } else { theme::ACCENT };
                
                lines.push(Line::from(""));
                lines.push(Line::from(vec![
                    Span::styled(" ┌─ ", Style::default().fg(theme::AI_BORDER)),
                    Span::styled(format!("🤖 AI · {}", indicator), Style::default().fg(color).add_modifier(Modifier::BOLD)),
                ]));
                
                // 解析并渲染内容（支持 thinking 块）
                let content_lines = parse_content_with_thinking(text);
                for line in content_lines {
                    lines.push(line);
                }
                
                lines.push(Line::from(vec![
                    Span::styled(" └", Style::default().fg(theme::AI_BORDER)),
                ]));
                lines.push(Line::from(""));
            }

            Message::ToolCall { tool_name, args, status, .. } => {
                let (icon, color) = match status {
                    ToolStatus::InProgress => ("◐", theme::WARNING),
                    ToolStatus::Success => ("✓", theme::SUCCESS),
                    ToolStatus::Failure => ("✗", theme::ERROR),
                };
                let args_display = if args.len() > 60 {
                    format!("{}...", &args[..60])
                } else {
                    args.clone()
                };
                lines.push(Line::from(vec![
                    Span::styled(format!("  {} ", icon), Style::default().fg(color)),
                    Span::styled(
                        format!("{}", tool_name),
                        Style::default().fg(theme::ACCENT_BLUE),
                    ),
                    Span::styled(format!(": {}", args_display), Style::default().fg(theme::FG_DIM)),
                ]));
            }

            Message::ToolResult { tool_name, result, status, .. } => {
                let (icon, color) = match status {
                    ToolStatus::Success => ("✓", theme::SUCCESS),
                    ToolStatus::Failure => ("✗", theme::ERROR),
                    ToolStatus::InProgress => ("◐", theme::WARNING),
                };
                // 结果截断显示
                let display = if result.len() > 150 {
                    format!("{}... ({} chars)", &result[..150], result.len())
                } else {
                    result.clone()
                };
                lines.push(Line::from(vec![
                    Span::styled(format!("  {} ", icon), Style::default().fg(color)),
                    Span::styled(
                        format!("{}", tool_name),
                        Style::default().fg(theme::ACCENT_BLUE),
                    ),
                    Span::styled(format!(": {}", display), Style::default().fg(theme::FG_DIM)),
                ]));
                lines.push(Line::from(""));
            }

            Message::Error { text } => {
                lines.push(Line::from(""));
                lines.push(Line::from(vec![
                    Span::styled(" ✗ 错误: ", Style::default().fg(theme::ERROR).add_modifier(Modifier::BOLD)),
                    Span::styled(text.clone(), Style::default().fg(theme::ERROR)),
                ]));
                lines.push(Line::from(""));
            }

            Message::System { text } => {
                lines.push(Line::from(vec![
                    Span::styled(" 💡 ", Style::default().fg(theme::WARNING)),
                    Span::styled(text.clone(), Style::default().fg(theme::FG_DIM)),
                ]));
            }
        }
    }

    // 如果正在流式接收，显示思考动画
    if app.is_streaming && app.streaming_text.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled(" ┌─ ", Style::default().fg(theme::AI_BORDER)),
            Span::styled("🤖 AI", Style::default().fg(theme::ACCENT).add_modifier(Modifier::BOLD)),
        ]));
        lines.push(Line::from(vec![
            Span::styled(" │ ", Style::default().fg(theme::AI_BORDER)),
            Span::styled("思考中", Style::default().fg(theme::FG_DIM).add_modifier(Modifier::ITALIC)),
            Span::styled("...", Style::default().fg(theme::ACCENT)),
        ]));
        lines.push(Line::from(vec![
            Span::styled(" └", Style::default().fg(theme::AI_BORDER)),
        ]));
    }

    // 自动滚动到底部
    let scroll = calculate_scroll(area, &lines);

    let messages_widget = Paragraph::new(lines)
        .wrap(Wrap { trim: false })
        .scroll((scroll, 0));

    f.render_widget(messages_widget, area);
}

/// 解析内容，提取 thinking 块并格式化
fn parse_content_with_thinking(content: &str) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut in_thinking = false;
    let mut thinking_content = String::new();
    let mut normal_content = String::new();
    
    // 简单的 thinking 标签解析
    let mut remaining = content;
    while let Some(start) = remaining.find("<think>") {
        normal_content.push_str(&remaining[..start]);
        remaining = &remaining[start + 7..];
        
        if let Some(end) = remaining.find("</think>") {
            thinking_content = remaining[..end].trim().to_string();
            remaining = &remaining[end + 8..];
            
            // 输出正常内容
            for line in normal_content.lines() {
                if !line.trim().is_empty() {
                    lines.push(Line::from(vec![
                        Span::styled(" │ ", Style::default().fg(theme::AI_BORDER)),
                        Span::styled(line.to_string(), Style::default().fg(theme::FG)),
                    ]));
                }
            }
            normal_content.clear();
            
            // 输出 thinking 块（折叠样式）
            lines.push(Line::from(vec![
                Span::styled(" │ ", Style::default().fg(theme::AI_BORDER)),
                Span::styled("▼ Thinking", Style::default().fg(theme::FG_DIM).add_modifier(Modifier::ITALIC)),
            ]));
            for line in thinking_content.lines() {
                lines.push(Line::from(vec![
                    Span::styled(" │   ", Style::default().fg(theme::AI_BORDER)),
                    Span::styled(line.to_string(), Style::default().fg(theme::FG_MUTED)),
                ]));
            }
        } else {
            // 未闭合的 thinking 标签
            normal_content.push_str(&remaining);
            break;
        }
    }
    
    normal_content.push_str(remaining);
    
    // 输出剩余的正常内容
    for line in normal_content.lines() {
        if !line.trim().is_empty() {
            lines.push(Line::from(vec![
                Span::styled(" │ ", Style::default().fg(theme::AI_BORDER)),
                Span::styled(line.to_string(), Style::default().fg(theme::FG)),
            ]));
        }
    }
    
    lines
}

/// 计算滚动偏移（确保最新消息可见）
fn calculate_scroll(area: Rect, lines: &[Line]) -> u16 {
    let total_lines = lines.len() as u16;
    let visible_lines = area.height.saturating_sub(1);

    if total_lines > visible_lines {
        total_lines.saturating_sub(visible_lines)
    } else {
        0
    }
}

/// 渲染提示栏
fn render_hint(f: &mut Frame, area: Rect, app: &App) {
    let hint_text = if app.is_streaming {
        Line::from(vec![
            Span::styled(" ⏳ ", Style::default().fg(theme::WARNING)),
            Span::styled("AI 正在回复... 按 Esc 取消", Style::default().fg(theme::FG_DIM)),
        ])
    } else {
        Line::from(vec![
            Span::styled(" 💡 ", Style::default().fg(theme::ACCENT)),
            Span::styled("提示: ", Style::default().fg(theme::FG_DIM)),
            Span::styled("Ctrl+C", Style::default().fg(theme::FG)),
            Span::styled(" 退出, ", Style::default().fg(theme::FG_DIM)),
            Span::styled("/help", Style::default().fg(theme::FG)),
            Span::styled(" 查看命令", Style::default().fg(theme::FG_DIM)),
        ])
    };

    let hint = Paragraph::new(hint_text)
        .style(Style::default().bg(theme::BG));

    f.render_widget(hint, area);
}

/// 渲染输入框
fn render_input(f: &mut Frame, area: Rect, app: &App) {
    let input_block = Block::default()
        .borders(Borders::TOP)
        .border_style(Style::default().fg(theme::BORDER));

    let input_text = if app.is_streaming {
        Line::from(vec![
            Span::styled(" ⏳ ", Style::default().fg(theme::WARNING)),
            Span::styled("等待 AI 回复...", Style::default().fg(theme::FG_DIM).add_modifier(Modifier::ITALIC)),
        ])
    } else {
        Line::from(vec![
            Span::styled(" > ", Style::default().fg(theme::ACCENT).add_modifier(Modifier::BOLD)),
            Span::styled(app.input.clone(), Style::default().fg(theme::FG)),
            Span::styled("▎", Style::default().fg(theme::ACCENT)),
        ])
    };

    let input = Paragraph::new(input_text)
        .block(input_block)
        .wrap(Wrap { trim: false });

    f.render_widget(input, area);
}

/// 创建居中矩形
fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}
