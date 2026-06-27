//! TUI 终端界面
//!
//! 基于 ratatui + crossterm 的终端 UI 渲染。
//! 设计风格：类似 Claude Code / OpenCode 的简洁终端对话界面。
//!
//! 布局：
//! ┌─────────────────────────────────────────┐
//! │ Header: WaLiCode v0.1 | Agent: unified  │
//! ├─────────────────────────────────────────┤
//! │                                         │
//! │  [消息区域 - 自动滚动]                  │
//! │                                         │
//! │  🧑 你: 帮我看看这个项目                │
//! │                                         │
//! │  🤖 AI: 让我分析一下项目架构...         │
//! │                                         │
//! │  🔧 tool_call: FileRead(path=...)       │
//! │  ✅ tool_result: 文件内容...            │
//! │                                         │
//! ├─────────────────────────────────────────┤
//! │ Status: Streaming... | Step 3/10        │
//! ├─────────────────────────────────────────┤
//! │ > 输入你的消息...                       │
//! └─────────────────────────────────────────┘

use crate::_cli_app::{App, AppEvent, CliArgs, Message, ToolStatus, ReActEvent};
use crate::_cli_sse::{SseClient, build_project_context};

use crossterm::{
    event::{Event as CEvent, KeyCode, KeyEvent, KeyModifiers, MouseEvent},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Layout, Margin, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame, Terminal,
};
use std::io;
use tokio::sync::mpsc;

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
    // 初始化终端
    enable_raw_mode().expect("Failed to enable raw mode");
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
        let welcome = Paragraph::new(Line::from(vec![
            Span::styled(" 🚀 ", Style::default().fg(Color::Cyan)),
            Span::styled("WaLiCode", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::raw(" — AI 驱动的终端智能运维助手"),
        ]))
        .wrap(Wrap { trim: false });

        let connecting = Paragraph::new(Line::from(vec![
            Span::styled(" ⏳ ", Style::default().fg(Color::Yellow)),
            Span::raw("正在连接服务端..."),
        ]));

        let chunks = Layout::vertical([
            Constraint::Length(3),
            Constraint::Min(1),
        ]).split(size);

        f.render_widget(welcome, chunks[0]);
        f.render_widget(connecting, chunks[1]);
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

    // 整体布局：Header + Messages + Status + Input
    let chunks = Layout::vertical([
        Constraint::Length(2),  // Header
        Constraint::Min(5),     // Messages（弹性）
        Constraint::Length(1),  // Status
        Constraint::Length(3),  // Input
    ]).split(size);

    render_header(f, chunks[0], app);
    render_messages(f, chunks[1], app);
    render_status(f, chunks[2], app);
    render_input(f, chunks[3], app);
}

/// 渲染 Header
fn render_header(f: &mut Frame, area: Rect, app: &App) {
    let title = Line::from(vec![
        Span::styled(" 🚀 WaLiCode ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::raw("│"),
        Span::styled(format!(" Agent: {} ", app.agent_id), Style::default().fg(Color::Green)),
        Span::raw("│"),
        Span::styled(
            format!(" Session: {} ", app.session_id.as_deref().unwrap_or("未创建")),
            Style::default().fg(Color::DarkGray),
        ),
    ]);

    let header = Paragraph::new(title)
        .style(Style::default().bg(Color::Rgb(0, 0, 100)))
        .wrap(Wrap { trim: false });

    f.render_widget(header, area);
}

/// 渲染消息区域
fn render_messages(f: &mut Frame, area: Rect, app: &App) {
    let mut lines: Vec<Line> = Vec::new();

    for msg in &app.messages {
        match msg {
            Message::User { text } => {
                lines.push(Line::from(vec![
                    Span::styled(" 🧑 ", Style::default().fg(Color::Blue)),
                    Span::styled("你:", Style::default().fg(Color::Blue).add_modifier(Modifier::BOLD)),
                ]));
                for line in text.lines() {
                    lines.push(Line::from(Span::styled(format!("   {}", line), Style::default().fg(Color::White))));
                }
                lines.push(Line::raw("")); // 空行分隔
            }

            Message::Assistant { text, done } => {
                let indicator = if *done { " ✅ " } else { " 🤖 " };
                let color = if *done { Color::Green } else { Color::Cyan };
                lines.push(Line::from(vec![
                    Span::styled(indicator, Style::default().fg(color)),
                    Span::styled("AI:", Style::default().fg(color).add_modifier(Modifier::BOLD)),
                ]));
                for line in text.lines() {
                    lines.push(Line::from(Span::raw(format!("   {}", line))));
                }
                lines.push(Line::raw(""));
            }

            Message::ToolCall { tool_name, args, status, .. } => {
                let (icon, color) = match status {
                    ToolStatus::InProgress => ("⏳", Color::Yellow),
                    ToolStatus::Success => ("✅", Color::Green),
                    ToolStatus::Failure => ("❌", Color::Red),
                };
                let args_display = if args.len() > 80 {
                    format!("{}...", &args[..80])
                } else {
                    args.clone()
                };
                lines.push(Line::from(vec![
                    Span::styled(format!(" {} ", icon), Style::default().fg(color)),
                    Span::styled(
                        format!("🔧 {}: ", tool_name),
                        Style::default().fg(Color::Magenta),
                    ),
                    Span::styled(args_display, Style::default().fg(Color::DarkGray)),
                ]));
            }

            Message::ToolResult { tool_name, result, status, .. } => {
                let (icon, color) = match status {
                    ToolStatus::Success => ("✅", Color::Green),
                    ToolStatus::Failure => ("❌", Color::Red),
                    ToolStatus::InProgress => ("⏳", Color::Yellow),
                };
                // 结果可能很长，截断显示
                let display = if result.len() > 200 {
                    format!("{}...\n   (结果共 {} 字符)", &result[..200], result.len())
                } else {
                    result.clone()
                };
                lines.push(Line::from(vec![
                    Span::styled(format!(" {} ", icon), Style::default().fg(color)),
                    Span::styled(
                        format!("📋 {}: ", tool_name),
                        Style::default().fg(Color::Magenta),
                    ),
                ]));
                for line in display.lines().take(8) {
                    lines.push(Line::from(Span::styled(
                        format!("   {}", line),
                        Style::default().fg(Color::DarkGray),
                    )));
                }
                if result.lines().count() > 8 {
                    lines.push(Line::from(Span::styled(
                        format!("   ... (共 {} 行)", result.lines().count()),
                        Style::default().fg(Color::DarkGray),
                    )));
                }
            }

            Message::Error { text } => {
                lines.push(Line::from(vec![
                    Span::styled(" ❌ ", Style::default().fg(Color::Red)),
                    Span::styled("错误: ", Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)),
                    Span::styled(text.clone(), Style::default().fg(Color::Red)),
                ]));
                lines.push(Line::raw(""));
            }

            Message::System { text } => {
                lines.push(Line::from(vec![
                    Span::styled(" 💬 ", Style::default().fg(Color::Yellow)),
                    Span::styled(text.clone(), Style::default().fg(Color::Yellow)),
                ]));
                lines.push(Line::raw(""));
            }
        }
    }

    // 如果正在流式接收，显示思考动画
    if app.is_streaming && app.streaming_text.is_empty() {
        lines.push(Line::from(vec![
            Span::styled(" 🤖 ", Style::default().fg(Color::Cyan)),
            Span::styled("AI: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::styled("思考中...", Style::default().fg(Color::Cyan).add_modifier(Modifier::ITALIC)),
        ]));
    }

    // 自动滚动到底部
    let scroll = calculate_scroll(area, &app.messages, app.is_streaming);

    let messages_widget = Paragraph::new(lines)
        .wrap(Wrap { trim: false })
        .block(Block::default().borders(Borders::NONE))
        .scroll((scroll as u16, 0));

    f.render_widget(messages_widget, area.inner(Margin::new(0, 0)));
}

/// 计算滚动偏移（确保最新消息可见）
fn calculate_scroll(area: Rect, messages: &Vec<Message>, is_streaming: bool) -> u16 {
    // 估算消息总行数
    let total_lines = estimate_total_lines(messages, is_streaming);
    let visible_lines = area.height.saturating_sub(2) as u16;

    if total_lines > visible_lines {
        total_lines.saturating_sub(visible_lines)
    } else {
        0
    }
}

/// 估算消息总行数
fn estimate_total_lines(messages: &Vec<Message>, is_streaming: bool) -> u16 {
    let mut total: u16 = 0;

    for msg in messages {
        match msg {
            Message::User { text } => {
                total += 2; // header + empty line
                total += text.lines().count() as u16;
            }
            Message::Assistant { text, .. } => {
                total += 2;
                total += text.lines().count().max(1) as u16;
            }
            Message::ToolCall { args, .. } => {
                total += 1;
                total += args.lines().count() as u16;
            }
            Message::ToolResult { result, .. } => {
                total += 2;
                total += (result.lines().count().min(9)) as u16;
            }
            Message::Error { .. } => total += 2,
            Message::System { .. } => total += 2,
        }
    }

    if is_streaming {
        total += 1;
    }

    total
}

/// 渲染状态栏
fn render_status(f: &mut Frame, area: Rect, app: &App) {
    let status_text = if app.is_streaming {
        "⏳ AI 正在回复..."
    } else {
        "✅ 就绪"
    };

    let status = Line::from(vec![
        Span::styled(status_text, Style::default().fg(
            if app.is_streaming { Color::Cyan } else { Color::Green }
        )),
        Span::raw("  "),
        Span::styled(
            format!("消息: {}", app.messages.len()),
            Style::default().fg(Color::DarkGray),
        ),
    ]);

    f.render_widget(Paragraph::new(status), area);
}

/// 渲染输入框
fn render_input(f: &mut Frame, area: Rect, app: &App) {
    let input_text = if app.is_streaming {
        Line::from(vec![
            Span::styled(" ⏳ ", Style::default().fg(Color::Yellow)),
            Span::styled("等待 AI 回复 (按 Esc 取消)...", Style::default().fg(Color::DarkGray)),
        ])
    } else {
        Line::from(vec![
            Span::styled(" > ", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
            Span::styled(app.input.clone(), Style::default().fg(Color::White)),
            Span::styled("▎", Style::default().fg(Color::Green)), // 光标指示
        ])
    };

    let input_block = Block::default()
        .borders(Borders::TOP)
        .border_style(Style::default().fg(Color::DarkGray));

    let input = Paragraph::new(input_text)
        .block(input_block)
        .wrap(Wrap { trim: false });

    f.render_widget(input, area);
}
