//! TUI 终端界面
//!
//! 基于 ratatui + crossterm 的终端 UI 渲染。
//! 设计风格：参考 OpenCode 的简洁终端对话界面。
//!
//! 两种模式：
//! 1. 欢迎界面（首次进入）：居中 Logo + 输入框 + 快捷提示
//! 2. 命令窗口（输入后）：分栏布局（消息区 + Context 面板）

use crate::_cli_app::{App, AppEvent, CliArgs, Message, ToolStatus, ReActEvent};
use crate::_cli_sse::{SseClient, build_project_context};

use crossterm::{
    event::{Event as CEvent, KeyCode, KeyEvent, KeyModifiers, MouseEvent, MouseEventKind, EnableMouseCapture, DisableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
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

/// 主题颜色配置（OpenCode 风格 - 高对比度）
mod theme {
    use ratatui::style::Color;

    // 背景色
    pub const BG: Color = Color::Rgb(245, 245, 245);           // 浅灰背景
    pub const BG_DARK: Color = Color::Rgb(230, 230, 230);      // 稍深背景
    pub const BG_INPUT: Color = Color::Rgb(255, 255, 255);     // 输入框背景
    
    // 文字色 - 加深对比度
    pub const FG: Color = Color::Rgb(30, 30, 30);              // 主文字色（加深）
    pub const FG_DIM: Color = Color::Rgb(80, 80, 80);          // 次要文字（加深）
    pub const FG_MUTED: Color = Color::Rgb(120, 120, 120);     // 更淡的文字（加深）
    pub const FG_PLACEHOLDER: Color = Color::Rgb(160, 160, 160); // placeholder
    
    // 边框色
    pub const BORDER: Color = Color::Rgb(200, 200, 200);       // 边框色
    pub const BORDER_FOCUS: Color = Color::Rgb(60, 120, 180);  // 聚焦边框
    
    // 消息气泡
    pub const USER_BG: Color = Color::Rgb(235, 245, 255);      // 用户消息背景
    pub const USER_BORDER: Color = Color::Rgb(60, 120, 180);   // 用户消息边框
    pub const AI_BG: Color = Color::Rgb(255, 255, 255);        // AI 消息背景
    pub const AI_BORDER: Color = Color::Rgb(180, 180, 180);    // AI 消息边框
    
    // 强调色 - OpenCode 风格彩色
    pub const ACCENT: Color = Color::Rgb(60, 140, 60);         // 强调色（绿色）
    pub const ACCENT_BLUE: Color = Color::Rgb(40, 100, 160);   // 蓝色强调
    pub const ACCENT_PURPLE: Color = Color::Rgb(100, 60, 140); // 紫色强调
    pub const ERROR: Color = Color::Rgb(180, 60, 60);          // 错误红
    pub const WARNING: Color = Color::Rgb(180, 140, 40);       // 警告黄
    pub const SUCCESS: Color = Color::Rgb(40, 140, 40);        // 成功绿
    pub const TIP: Color = Color::Rgb(180, 120, 40);           // Tips 橙色
    
    // OpenCode 风格列表颜色
    pub const LIST_ORANGE: Color = Color::Rgb(200, 120, 40);   // + Thought 橙色
    pub const LIST_BLUE: Color = Color::Rgb(60, 120, 200);     // - 列表项蓝色
    pub const LIST_GREEN: Color = Color::Rgb(60, 160, 80);     // 绿色列表项
    pub const LIST_PURPLE: Color = Color::Rgb(140, 80, 180);   // 紫色列表项
}

/// WaLiCode Logo - 像素风格 ASCII Art（WALI 加粗黑色，CODE 彩色）
const LOGO: &str = r#"
██╗    ██╗ █████╗ ██╗     ██╗ ██████╗ ██████╗ ██████╗ 
██║    ██║██╔══██╗██║     ██║██╔════╝██╔═══██╗██╔══██╗
██║ █╗ ██║███████║██║     ██║██║     ██║   ██║██║  ██║
██║███╗██║██╔══██║██║     ██║██║     ██║   ██║██║  ██║
╚███╔███╔╝██║  ██║███████╗██║╚██████╗╚██████╔╝██████╔╝
 ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ 
"#;

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
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture).expect("Failed to enter alternate screen");
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).expect("Failed to create terminal");
    terminal.clear().expect("Failed to clear terminal");

    // 创建 App 和事件 channel
    let mut app = App::new(&args);
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<AppEvent>();
    let sse = SseClient::new(args.server.clone(), event_tx.clone());

    // 先显示欢迎界面并创建会话
    let mut show_welcome = true;
    let session_result = sse.create_session(&args.agent_id, &args.user_id).await;
    
    if let Ok(session_id) = session_result {
        app.session_id = Some(session_id);
    } else {
        // 连接失败，显示错误
        show_welcome = false;
        app.messages.push(Message::Error { 
            text: format!("无法连接到 WaLiCode 服务端: {}", session_result.unwrap_err())
        });
    }

    // 主循环
    loop {
        // 渲染 UI
        terminal.draw(|f| {
            if show_welcome {
                render_welcome(f, &app);
            } else {
                render_chat(f, &app);
            }
        }).expect("Failed to draw");

        // 处理事件（键盘输入 + SSE 事件）
        if crossterm::event::poll(std::time::Duration::from_millis(50)).expect("Event poll failed") {
            if let Ok(c_event) = crossterm::event::read() {
                match c_event {
                    CEvent::Key(key) => {
                        if show_welcome {
                            if handle_welcome_key(&mut app, key, &sse, &event_tx) {
                                show_welcome = false;
                            }
                        } else {
                            handle_chat_key(&mut app, key, &sse, &event_tx);
                        }
                    }
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
        LeaveAlternateScreen,
        DisableMouseCapture
    ).expect("Failed to leave alternate screen");
    terminal.show_cursor().expect("Failed to show cursor");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  欢迎界面渲染
// ═══════════════════════════════════════════════════════════════════════════════

/// 渲染欢迎界面（OpenCode 风格）
fn render_welcome(f: &mut Frame, app: &App) {
    let size = f.area();

    // 垂直居中布局 - 参考 OpenCode 的简洁居中设计
    let v_chunks = Layout::vertical([
        Constraint::Percentage(20),  // 顶部留白
        Constraint::Length(7),       // Logo（彩色像素风格）
        Constraint::Length(5),       // 输入框区域
        Constraint::Length(2),       // 快捷提示
        Constraint::Length(2),       // Tips
        Constraint::Min(0),          // 底部留白
    ]).split(size);

    // 1. Logo（居中，彩色像素风格 - WALI 黑色加粗，CODE 彩色）
    let logo_lines = vec![
        // W A L I (黑色加粗)  C (紫色)  O (蓝色)  D (绿色)  E (橙色)
        Line::from(vec![
            Span::styled("██╗    ██╗ ", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("█████╗ ", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("██╗     ██╗ ", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled(" ██████╗", Style::default().fg(theme::ACCENT_PURPLE).add_modifier(Modifier::BOLD)),
            Span::styled(" ██████╗", Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD)),
            Span::styled(" ██████╗", Style::default().fg(theme::SUCCESS).add_modifier(Modifier::BOLD)),
            Span::styled(" ███████╗", Style::default().fg(theme::TIP).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled("██║    ██║", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("██╔══██╗", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("██║     ██║", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("██╔════╝", Style::default().fg(theme::ACCENT_PURPLE).add_modifier(Modifier::BOLD)),
            Span::styled("██╔═══██╗", Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD)),
            Span::styled(" ██╔══██╗", Style::default().fg(theme::SUCCESS).add_modifier(Modifier::BOLD)),
            Span::styled("██╔════╝", Style::default().fg(theme::TIP).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled("██║ █╗ ██║", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("███████║", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("██║     ██║", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("██║     ", Style::default().fg(theme::ACCENT_PURPLE).add_modifier(Modifier::BOLD)),
            Span::styled("██║   ██║", Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD)),
            Span::styled(" ██║  ██║", Style::default().fg(theme::SUCCESS).add_modifier(Modifier::BOLD)),
            Span::styled("█████╗  ", Style::default().fg(theme::TIP).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled("██║███╗██║", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("██╔══██║", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("██║     ██║", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("██║     ", Style::default().fg(theme::ACCENT_PURPLE).add_modifier(Modifier::BOLD)),
            Span::styled("██║   ██║", Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD)),
            Span::styled(" ██║  ██║", Style::default().fg(theme::SUCCESS).add_modifier(Modifier::BOLD)),
            Span::styled("██╔══╝  ", Style::default().fg(theme::TIP).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled("╚███╔███╔╝", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("██║  ██║", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("███████╗██║", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("╚██████╗", Style::default().fg(theme::ACCENT_PURPLE).add_modifier(Modifier::BOLD)),
            Span::styled("╚██████╔╝", Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD)),
            Span::styled("╚██████╔╝", Style::default().fg(theme::SUCCESS).add_modifier(Modifier::BOLD)),
            Span::styled("███████╗", Style::default().fg(theme::TIP).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled(" ╚══╝╚══╝ ", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("╚═╝  ╚═╝", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled("╚══════╝╚═╝", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled(" ╚═════╝", Style::default().fg(theme::ACCENT_PURPLE).add_modifier(Modifier::BOLD)),
            Span::styled(" ╚═════╝ ", Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD)),
            Span::styled(" ╚═════╝", Style::default().fg(theme::SUCCESS).add_modifier(Modifier::BOLD)),
            Span::styled("╚══════╝", Style::default().fg(theme::TIP).add_modifier(Modifier::BOLD)),
        ]),
    ];
    let logo = Paragraph::new(logo_lines)
        .alignment(Alignment::Center);
    f.render_widget(logo, v_chunks[1]);

    // 2. 输入框区域（OpenCode 风格 - 左侧紫色竖线 + 白色背景卡片）
    // 使用固定宽度居中，高度占满 v_chunks[2]
    let input_width = (size.width as f32 * 0.75) as u16;
    let input_x = (size.width.saturating_sub(input_width)) / 2;
    let input_area = Rect {
        x: input_x,
        y: v_chunks[2].y,
        width: input_width,
        height: v_chunks[2].height,
    };
    
    // 白色背景卡片
    let input_card = Block::default()
        .style(Style::default().bg(theme::BG_INPUT));
    f.render_widget(input_card, input_area);
    
    // 左侧紫色竖线
    let left_bar_area = Rect {
        x: input_area.x,
        y: input_area.y,
        width: 1,
        height: input_area.height,
    };
    let left_bar = Paragraph::new(" ")
        .style(Style::default().bg(theme::ACCENT_PURPLE));
    f.render_widget(left_bar, left_bar_area);
    
    // 输入框内容区域
    let input_content_area = Rect {
        x: input_area.x + 2,
        y: input_area.y + 1,
        width: input_area.width.saturating_sub(4),
        height: input_area.height.saturating_sub(2),
    };
    
    // 输入框内容（可输入，带光标）
    let input_lines = if app.input.is_empty() {
        // Placeholder 模式 - 添加操作提示
        vec![
            Line::from(vec![
                Span::styled("💬 ", Style::default()),
                Span::styled("输入问题进行提问，按 Enter 发送", 
                    Style::default().fg(theme::FG_PLACEHOLDER).add_modifier(Modifier::ITALIC)),
            ]),
            Line::from(vec![
                Span::styled("   例如：\"帮我看看项目结构\" 或 \"如何部署这个服务？\"", 
                    Style::default().fg(theme::FG_MUTED).add_modifier(Modifier::ITALIC)),
            ]),
        ]
    } else {
        // 输入中模式（显示用户输入 + 闪烁光标）
        vec![
            Line::from(vec![
                Span::styled("💬 ", Style::default()),
                Span::styled(app.input.clone(), Style::default().fg(theme::FG)),
                Span::styled("▎", Style::default().fg(theme::ACCENT_PURPLE)),
            ]),
            Line::from(vec![
                Span::styled("   按 Enter 发送，Esc 取消", 
                    Style::default().fg(theme::FG_MUTED).add_modifier(Modifier::ITALIC)),
            ]),
        ]
    };
    
    let input_widget = Paragraph::new(input_lines)
        .wrap(Wrap { trim: false });
    f.render_widget(input_widget, input_content_area);

    // 3. 快捷提示（底部居中，彩色装饰）
    let hint_text = Line::from(vec![
        Span::styled("tab ", Style::default().fg(theme::FG_DIM)),
        Span::styled("agents", Style::default().fg(theme::ACCENT_PURPLE)),
        Span::styled("    ", Style::default()),
        Span::styled("ctrl+p", Style::default().fg(theme::ACCENT_BLUE)),
        Span::styled(" commands", Style::default().fg(theme::FG_DIM)),
    ]);
    let hint = Paragraph::new(hint_text)
        .alignment(Alignment::Center);
    f.render_widget(hint, v_chunks[3]);

    // 4. Tips 提示条（橙色圆点 + 彩色命令）
    let tip_text = Line::from(vec![
        Span::styled("● Tip ", Style::default().fg(theme::TIP).add_modifier(Modifier::BOLD)),
        Span::styled("输入 ", Style::default().fg(theme::FG_DIM)),
        Span::styled("/help", Style::default().fg(theme::ACCENT_PURPLE).add_modifier(Modifier::BOLD)),
        Span::styled(" 查看所有命令，", Style::default().fg(theme::FG_DIM)),
        Span::styled("/connect", Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD)),
        Span::styled(" 配置 AI 模型", Style::default().fg(theme::FG_DIM)),
    ]);
    let tip = Paragraph::new(tip_text)
        .alignment(Alignment::Center);
    f.render_widget(tip, v_chunks[4]);
}

/// 处理欢迎界面的键盘事件
/// 返回 true 表示应该切换到聊天界面
fn handle_welcome_key(app: &mut App, key: KeyEvent, sse: &SseClient, event_tx: &mpsc::UnboundedSender<AppEvent>) -> bool {
    // Ctrl+C 退出
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        app.should_quit = true;
        return false;
    }

    // Enter 发送消息并进入聊天界面
    if key.code == KeyCode::Enter {
        let text = app.input.trim().to_string();
        if text.is_empty() {
            return false;
        }

        // 检查是否是斜杠命令
        if text.starts_with('/') {
            if app.handle_slash_command(&text) {
                app.input.clear();
                return false;
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

        return true; // 切换到聊天界面
    }

    // 退格删除
    if key.code == KeyCode::Backspace {
        app.input.pop();
        return false;
    }

    // Ctrl+U 清空输入
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('u') {
        app.input.clear();
        return false;
    }

    // Tab 切换 agent（示例功能）
    if key.code == KeyCode::Tab {
        // 可以在这里实现 agent 切换逻辑
        return false;
    }

    // Ctrl+P 打开命令面板（示例功能）
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('p') {
        // 可以在这里实现命令面板
        return false;
    }

    // 字符输入
    if let KeyCode::Char(c) = key.code {
        app.input.push(c);
    }

    false
}

// ═══════════════════════════════════════════════════════════════════════════════
//  命令窗口渲染（聊天界面）
// ═══════════════════════════════════════════════════════════════════════════════

/// 渲染聊天界面（OpenCode 风格分栏布局）
fn render_chat(f: &mut Frame, app: &App) {
    let size = f.area();

    // 整体布局：Header + Main（Messages | Context）+ Hint + Input
    let main_chunks = Layout::vertical([
        Constraint::Length(1),  // Header
        Constraint::Min(5),     // Main content
        Constraint::Length(1),  // Hint
        Constraint::Length(3),  // Input
    ]).split(size);

    render_header(f, main_chunks[0], app);
    render_main_content(f, main_chunks[1], app);
    render_hint(f, main_chunks[2], app);
    render_input(f, main_chunks[3], app);
}

/// 渲染主内容区（左侧消息 + 右侧 Context）
fn render_main_content(f: &mut Frame, area: Rect, app: &App) {
    let chunks = Layout::horizontal([
        Constraint::Percentage(70),  // 消息区域
        Constraint::Percentage(30),  // Context 面板
    ]).split(area);

    render_messages(f, chunks[0], app);
    render_context_panel(f, chunks[1], app);
}

/// 渲染 Context 面板（右侧 - 简化版）
fn render_context_panel(f: &mut Frame, area: Rect, app: &App) {
    let block = Block::default()
        .title(" Context ")
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(theme::BORDER))
        .style(Style::default().bg(theme::BG));

    let inner = block.inner(area);
    f.render_widget(block, area);

    let mut lines: Vec<Line> = vec![];
    
    // Session 信息（简化）
    lines.push(Line::from(vec![
        Span::styled("New session", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
    ]));
    let session_display = app.session_id.as_ref()
        .map(|s| if s.len() > 20 { format!("{}...", &s[..20]) } else { s.clone() })
        .unwrap_or_else(|| "unknown".to_string());
    lines.push(Line::from(vec![
        Span::styled(session_display, Style::default().fg(theme::FG_MUTED)),
    ]));
    lines.push(Line::from(""));
    
    // 快捷命令（实际有用的内容）
    lines.push(Line::from(vec![
        Span::styled("◆ 快捷命令", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("/help", Style::default().fg(theme::ACCENT_BLUE)),
        Span::styled(" 查看帮助", Style::default().fg(theme::FG_DIM)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("/clear", Style::default().fg(theme::ACCENT_BLUE)),
        Span::styled(" 清空会话", Style::default().fg(theme::FG_DIM)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("/agent", Style::default().fg(theme::ACCENT_BLUE)),
        Span::styled(" 切换 Agent", Style::default().fg(theme::FG_DIM)),
    ]));
    lines.push(Line::from(""));
    
    // Agent 信息
    lines.push(Line::from(vec![
        Span::styled("◆ Agent", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
    ]));
    lines.push(Line::from(vec![
        Span::styled(&app.agent_id, Style::default().fg(theme::ACCENT)),
    ]));
    lines.push(Line::from(""));
    
    // 状态
    lines.push(Line::from(vec![
        Span::styled("◆ 状态", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
    ]));
    let status = if app.is_streaming {
        Span::styled("● 思考中", Style::default().fg(theme::WARNING))
    } else {
        Span::styled("● 就绪", Style::default().fg(theme::SUCCESS))
    };
    lines.push(Line::from(vec![status]));

    let context = Paragraph::new(lines)
        .wrap(Wrap { trim: false });
    f.render_widget(context, inner);
}

/// 渲染 Header（单行简洁风格）
fn render_header(f: &mut Frame, area: Rect, app: &App) {
    let session_short = app.session_id.as_ref()
        .map(|s| if s.len() > 8 { format!("{}...", &s[..8]) } else { s.clone() })
        .unwrap_or_else(|| "未连接".to_string());

    let header_text = Line::from(vec![
        Span::styled(" WaLiCode ", Style::default().fg(theme::SUCCESS).add_modifier(Modifier::BOLD)),
        Span::styled("v0.1.0", Style::default().fg(theme::FG_MUTED)),
        Span::raw(" │ "),
        Span::styled("Agent: ", Style::default().fg(theme::FG_DIM)),
        Span::styled(&app.agent_id, Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD)),
        Span::raw(" │ "),
        Span::styled("Session: ", Style::default().fg(theme::FG_DIM)),
        Span::styled(session_short, Style::default().fg(theme::FG_DIM)),
    ]);

    let header = Paragraph::new(header_text)
        .style(Style::default().bg(theme::BG));

    f.render_widget(header, area);
}

/// 渲染消息区域（气泡卡片风格 + Markdown 支持）
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
                // 用户消息也使用 Markdown 渲染
                let md_lines = parse_markdown_owned(text);
                for md_line in md_lines {
                    let mut styled_spans = vec![Span::styled(" │ ", Style::default().fg(theme::USER_BORDER))];
                    styled_spans.extend(md_line.spans);
                    lines.push(Line::from(styled_spans));
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
                
                // 解析并渲染内容（支持 thinking 块 + Markdown）
                let content_lines = parse_content_with_thinking_markdown(text);
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
                        Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD),
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
                        Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD),
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
    let scroll = calculate_scroll(area, &lines, app);

    let messages_widget = Paragraph::new(lines)
        .wrap(Wrap { trim: false })
        .scroll((scroll, 0));

    f.render_widget(messages_widget, area);
}

/// Markdown 解析 - 将文本解析为带样式的 Line<'static> 列表（所有 Span 拥有自己的 String）
/// 支持：ATX 标题(#)、Setext 标题(===/---)、粗体、斜体、代码、列表、表格
fn parse_markdown_owned(text: &str) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let mut in_table = false;
    let mut table_lines: Vec<&str> = Vec::new();
    let mut pending_setext_header: Option<String> = None; // 缓存可能的 Setext 标题行
    
    for line in text.lines() {
        let trimmed = line.trim();
        
        // 空行
        if trimmed.is_empty() {
            if in_table {
                lines.extend(render_table(&table_lines));
                table_lines.clear();
                in_table = false;
            }
            // Setext 下划线不会紧跟空行
            pending_setext_header = None;
            lines.push(Line::from(""));
            continue;
        }
        
        // 表格检测（放宽：以 | 开头，内容含至少 2 个 | 分隔的列）
        if is_table_line(trimmed) {
            in_table = true;
            table_lines.push(trimmed);
            pending_setext_header = None;
            continue;
        } else if in_table {
            lines.extend(render_table(&table_lines));
            table_lines.clear();
            in_table = false;
        }
        
        // Setext 标题检测（=== 一级标题，--- 二级标题）
        // 逻辑：如果当前行全是 === 或 --- 且长度 >= 3，且上一行不是空行也不是表格行
        if is_setext_underline(trimmed) && pending_setext_header.is_some() {
            let header_text = pending_setext_header.take().unwrap();
            let level = if trimmed.starts_with('=') { 1 } else { 2 };
            let spans = parse_inline_markdown_owned(&header_text);
            let mut header_spans = vec![
                Span::styled("#".repeat(level) + " ",
                    Style::default().fg(theme::ACCENT_PURPLE).add_modifier(Modifier::BOLD)),
            ];
            header_spans.extend(spans);
            lines.push(Line::from(header_spans));
            continue;
        }
        
        // ATX 标题检测 ##
        if let Some(header_level) = detect_header(trimmed) {
            let header_text = &trimmed[header_level..].trim();
            let spans = parse_inline_markdown_owned(header_text);
            let mut header_spans = vec![
                Span::styled("#".repeat(header_level) + " ", 
                    Style::default().fg(theme::ACCENT_PURPLE).add_modifier(Modifier::BOLD)),
            ];
            header_spans.extend(spans);
            lines.push(Line::from(header_spans));
            pending_setext_header = None;
            continue;
        }
        
        // 普通文本行 — 缓存为潜在的 Setext 标题行
        pending_setext_header = Some(trimmed.to_string());
        let spans = parse_inline_markdown_owned(line);
        lines.push(Line::from(spans));
    }
    
    // 处理末尾未闭合的表格
    if in_table && !table_lines.is_empty() {
        lines.extend(render_table(&table_lines));
    }
    
    lines
}

/// 判断是否是表格行（放宽检测：以 | 开头，含至少 2 个列）
fn is_table_line(trimmed: &str) -> bool {
    if !trimmed.starts_with('|') {
        return false;
    }
    // 标准格式：| col1 | col2 | （以 | 结尾）
    if trimmed.ends_with('|') {
        return true;
    }
    // 放宽格式：| col1 | col2 （不以 | 结尾但含 >= 2 个列）
    let cols = trimmed.split('|').filter(|s| !s.is_empty()).count();
    cols >= 2
}

/// 判断是否是 Setext 标题下划线（全由 = 或 - 组成，长度 >= 3）
fn is_setext_underline(trimmed: &str) -> bool {
    if trimmed.len() < 3 {
        return false;
    }
    let first = trimmed.chars().next().unwrap();
    if first != '=' && first != '-' {
        return false;
    }
    // 所有字符必须相同
    trimmed.chars().all(|c| c == first)
}

/// 检测标题级别，返回 # 的数量
fn detect_header(line: &str) -> Option<usize> {
    let mut count = 0;
    for ch in line.chars() {
        if ch == '#' {
            count += 1;
        } else if ch.is_whitespace() {
            if count > 0 && count <= 6 {
                return Some(count);
            }
            return None;
        } else {
            return None;
        }
    }
    None
}

/// 渲染 Markdown 表格
/// 解析一行表格数据，兼容以/不以 `|` 结尾的行
/// 解析一行表格数据，兼容以/不以 `|` 结尾的行
fn parse_table_row(line: &str) -> Vec<String> {
    let trimmed = line.trim();
    let inner = if trimmed.starts_with('|') && trimmed.ends_with('|') {
        &trimmed[1..trimmed.len()-1]
    } else if trimmed.starts_with('|') {
        &trimmed[1..]
    } else if trimmed.ends_with('|') {
        &trimmed[..trimmed.len()-1]
    } else {
        trimmed
    };
    inner.split('|')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 渲染 Markdown 表格（自适应列宽，避免框线被 wrap 打断）
fn render_table(lines: &[&str]) -> Vec<Line<'static>> {
    let mut result = Vec::new();
    if lines.len() < 2 {
        // 不是有效表格，按普通文本返回
        for line in lines {
            result.push(Line::from(line.to_string()));
        }
        return result;
    }
    
    // 解析表头
    let headers = parse_table_row(lines[0]);
    let num_cols = headers.len();
    if num_cols == 0 {
        for line in lines {
            result.push(Line::from(line.to_string()));
        }
        return result;
    }
    
    // 跳过分隔行（包含 --- 的行）
    let data_start = if lines.len() > 1 && lines[1].contains("---") { 2 } else { 1 };
    
    // 解析所有数据行
    let data_rows: Vec<Vec<String>> = lines[data_start..].iter()
        .map(|l| parse_table_row(l))
        .collect();
    
    // 计算每列最大宽度（基于实际内容）
    let mut col_widths: Vec<usize> = headers.iter().map(|h| h.len()).collect();
    for row in &data_rows {
        for (i, cell) in row.iter().enumerate() {
            if i < col_widths.len() {
                col_widths[i] = col_widths[i].max(cell.len());
            }
        }
    }
    // 限制每列最大宽度为 30，防止表格超宽被 Paragraph::wrap 打断框线
    for w in col_widths.iter_mut() {
        *w = (*w).min(30);
    }
    
    // 渲染表头
    let mut header_spans = vec![Span::styled("│ ", Style::default().fg(theme::BORDER))];
    for (i, header) in headers.iter().enumerate() {
        if i > 0 {
            header_spans.push(Span::styled(" │ ", Style::default().fg(theme::BORDER)));
        }
        // 按列宽 pad 内容，确保框线对齐
        let padded = format!("{:<width$}", header, width = col_widths[i]);
        header_spans.push(Span::styled(
            padded, 
            Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)
        ));
    }
    header_spans.push(Span::styled(" │", Style::default().fg(theme::BORDER)));
    result.push(Line::from(header_spans));
    
    // 分隔线
    let mut sep_spans = vec![Span::styled("├─", Style::default().fg(theme::BORDER))];
    for i in 0..num_cols {
        if i > 0 {
            sep_spans.push(Span::styled("─┼─", Style::default().fg(theme::BORDER)));
        }
        sep_spans.push(Span::styled("─".repeat(col_widths[i]), Style::default().fg(theme::BORDER)));
    }
    sep_spans.push(Span::styled("─┤", Style::default().fg(theme::BORDER)));
    result.push(Line::from(sep_spans));
    
    // 渲染数据行
    for row in &data_rows {
        let mut row_spans = vec![Span::styled("│ ", Style::default().fg(theme::BORDER))];
        for (i, cell) in row.iter().enumerate() {
            if i > 0 {
                row_spans.push(Span::styled(" │ ", Style::default().fg(theme::BORDER)));
            }
            let padded = if i < col_widths.len() {
                format!("{:<width$}", cell, width = col_widths[i])
            } else {
                cell.clone()
            };
            row_spans.push(Span::styled(padded, Style::default().fg(theme::FG)));
        }
        row_spans.push(Span::styled(" │", Style::default().fg(theme::BORDER)));
        result.push(Line::from(row_spans));
    }
    
    result
}
/// 解析行内 Markdown（粗体、斜体、代码等），返回拥有 String 的 Span
fn parse_inline_markdown_owned(text: &str) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    let mut remaining = text;
    
    while !remaining.is_empty() {
        // 优先检查代码 `code`
        if let Some(start) = remaining.find('`') {
            if start > 0 {
                let before = &remaining[..start];
                spans.extend(parse_inline_formatting(before));
            }
            remaining = &remaining[start + 1..];
            
            if let Some(end) = remaining.find('`') {
                let code_text = &remaining[..end];
                spans.push(Span::styled(
                    code_text.to_string(),
                    Style::default().fg(theme::ACCENT_BLUE).add_modifier(Modifier::BOLD)
                ));
                remaining = &remaining[end + 1..];
            } else {
                spans.push(Span::styled(format!("`{}", remaining), Style::default().fg(theme::FG)));
                break;
            }
            continue;
        }
        
        // 没有更多标记
        spans.extend(parse_inline_formatting(remaining));
        break;
    }
    
    if spans.is_empty() {
        spans.push(Span::styled(text.to_string(), Style::default().fg(theme::FG)));
    }
    
    spans
}

/// 解析行内格式（粗体、斜体）
fn parse_inline_formatting(text: &str) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    let mut remaining = text;
    
    while !remaining.is_empty() {
        // 检查粗体 **text**
        if let Some(start) = remaining.find("**") {
            if start > 0 {
                spans.push(Span::styled(remaining[..start].to_string(), Style::default().fg(theme::FG)));
            }
            remaining = &remaining[start + 2..];
            
            if let Some(end) = remaining.find("**") {
                let bold_text = &remaining[..end];
                spans.push(Span::styled(
                    bold_text.to_string(),
                    Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)
                ));
                remaining = &remaining[end + 2..];
            } else {
                spans.push(Span::styled(format!("**{}", remaining), Style::default().fg(theme::FG)));
                break;
            }
        } else {
            // 没有更多标记
            spans.push(Span::styled(remaining.to_string(), Style::default().fg(theme::FG)));
            break;
        }
    }
    
    spans
}

/// 解析内容，提取 thinking 块并格式化（带 Markdown 支持）
fn parse_content_with_thinking_markdown(content: &str) -> Vec<Line<'static>> {
    let mut lines: Vec<Line<'static>> = Vec::new();
    let mut normal_content = String::new();
    
    // 简单的 thinking 标签解析
    let mut remaining = content;
    while let Some(start) = remaining.find("<think>") {
        normal_content.push_str(&remaining[..start]);
        remaining = &remaining[start + 7..];
        
        if let Some(end) = remaining.find("</think>") {
            let thinking_content = remaining[..end].trim().to_string();
            remaining = &remaining[end + 8..];
            
            // 输出正常内容（带 Markdown + 彩色列表）
            for md_line in parse_markdown_owned(&normal_content) {
                let colored = apply_list_colors(md_line.spans);
                let mut styled_spans = vec![Span::styled(" │ ", Style::default().fg(theme::AI_BORDER))];
                styled_spans.extend(colored);
                lines.push(Line::from(styled_spans));
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
            normal_content.push_str(remaining);
            break;
        }
    }
    
    normal_content.push_str(remaining);
    
    // 输出剩余的正常内容（带 Markdown 解析和彩色列表）
    for md_line in parse_markdown_owned(&normal_content) {
        let colored = apply_list_colors(md_line.spans);
        let mut final_spans = vec![Span::styled(" │ ", Style::default().fg(theme::AI_BORDER))];
        final_spans.extend(colored);
        lines.push(Line::from(final_spans));
    }
    
    lines
}

/// 从 parse_markdown_owned 的 spans 中检测列表前缀，添加 OpenCode 风格颜色
fn apply_list_colors(spans: Vec<Span<'static>>) -> Vec<Span<'static>> {
    if spans.is_empty() {
        return spans;
    }
    let first_text = spans[0].content.to_string();
    let trimmed = first_text.trim();
    
    // + Thought 橙色
    if trimmed.starts_with("+ ") {
        let mut result = vec![
            Span::styled("+ ", Style::default().fg(theme::LIST_ORANGE).add_modifier(Modifier::BOLD)),
        ];
        let rest_text = if first_text.len() > 2 { first_text[2..].to_string() } else { "".to_string() };
        if !rest_text.is_empty() {
            result.push(Span::styled(rest_text, Style::default().fg(theme::FG)));
        }
        result.extend(spans.into_iter().skip(1));
        return result;
    }
    
    // - 列表项蓝色
    if trimmed.starts_with("- ") {
        let mut result = vec![
            Span::styled("- ", Style::default().fg(theme::LIST_BLUE)),
        ];
        let rest_text = if first_text.len() > 2 { first_text[2..].to_string() } else { "".to_string() };
        if !rest_text.is_empty() {
            result.push(Span::styled(rest_text, Style::default().fg(theme::FG)));
        }
        result.extend(spans.into_iter().skip(1));
        return result;
    }
    
    // 数字列表 紫色
    if !trimmed.is_empty() && trimmed.as_bytes()[0].is_ascii_digit() {
        if let Some(dot_pos) = trimmed.find('.') {
            if dot_pos <= 2 {
                let num_part = &trimmed[..dot_pos + 1];
                let rest_start = dot_pos + 1;
                let rest_text = trimmed[rest_start..].trim_start().to_string();
                let mut result = vec![
                    Span::styled(format!("{} ", num_part), Style::default().fg(theme::LIST_PURPLE)),
                ];
                if !rest_text.is_empty() {
                    result.push(Span::styled(rest_text, Style::default().fg(theme::FG)));
                }
                result.extend(spans.into_iter().skip(1));
                return result;
            }
        }
    }
    
    // * 列表项绿色
    if trimmed.starts_with("* ") {
        let mut result = vec![
            Span::styled("* ", Style::default().fg(theme::LIST_GREEN)),
        ];
        let rest_text = if first_text.len() > 2 { first_text[2..].to_string() } else { "".to_string() };
        if !rest_text.is_empty() {
            result.push(Span::styled(rest_text, Style::default().fg(theme::FG)));
        }
        result.extend(spans.into_iter().skip(1));
        return result;
    }
    
    spans
}

/// 计算滚动偏移：如果用户手动滚动了，用 scroll_offset；否则自动跟底部
fn calculate_scroll(area: Rect, lines: &[Line], app: &App) -> u16 {
    let total_lines = lines.len() as u16;
    let visible_lines = area.height.saturating_sub(2); // 预留 2 行给边界

    if app.manual_scroll {
        // 用户手动滚动：底部位置 - scroll_offset
        let bottom_scroll = if total_lines > visible_lines {
            total_lines.saturating_sub(visible_lines)
        } else {
            0
        };
        bottom_scroll.saturating_sub(app.scroll_offset)
    } else {
        // 自动跟随底部
        if total_lines > visible_lines {
            total_lines.saturating_sub(visible_lines)
        } else {
            0
        }
    }
}

/// 渲染提示栏
fn render_hint(f: &mut Frame, area: Rect, app: &App) {
    let hint_text = if app.manual_scroll {
        // 手动滚动模式提示
        Line::from(vec![
            Span::styled(" 📜 ", Style::default().fg(theme::ACCENT)),
            Span::styled("手动滚动模式", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled(" — ", Style::default().fg(theme::FG_DIM)),
            Span::styled("Esc", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled(" 回到底部", Style::default().fg(theme::FG_DIM)),
        ])
    } else if app.is_streaming {
        Line::from(vec![
            Span::styled(" ⏳ ", Style::default().fg(theme::WARNING)),
            Span::styled("AI 正在回复... 按 Esc 取消", Style::default().fg(theme::FG_DIM)),
        ])
    } else {
        Line::from(vec![
            Span::styled(" 💡 ", Style::default().fg(theme::ACCENT)),
            Span::styled("提示: ", Style::default().fg(theme::FG_DIM)),
            Span::styled("Ctrl+C", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
            Span::styled(" 退出, ", Style::default().fg(theme::FG_DIM)),
            Span::styled("/help", Style::default().fg(theme::FG).add_modifier(Modifier::BOLD)),
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

// ═══════════════════════════════════════════════════════════════════════════════
//  键盘事件处理
// ═══════════════════════════════════════════════════════════════════════════════

/// 处理聊天界面的键盘事件
fn handle_chat_key(app: &mut App, key: KeyEvent, _sse: &SseClient, event_tx: &mpsc::UnboundedSender<AppEvent>) {
    // Ctrl+C 退出
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        app.should_quit = true;
        return;
    }

    // Esc：流式时取消请求，非流式时回到底部（取消手动滚动）
    if key.code == KeyCode::Esc {
        if app.is_streaming {
            app.is_streaming = false;
            app.messages.push(Message::System { text: "⏹ 已取消当前请求".to_string() });
        } else {
            app.manual_scroll = false;
            app.scroll_offset = 0;
        }
        return;
    }

    // 滚动操作（流式时也允许滚动，不阻塞输入）
    match key.code {
        KeyCode::PageUp => {
            app.manual_scroll = true;
            app.scroll_offset = app.scroll_offset.saturating_add(10);
            return;
        }
        KeyCode::PageDown => {
            app.scroll_offset = app.scroll_offset.saturating_sub(10);
            if app.scroll_offset == 0 {
                app.manual_scroll = false;
            }
            return;
        }
        KeyCode::Up if key.modifiers.contains(KeyModifiers::SHIFT) => {
            app.manual_scroll = true;
            app.scroll_offset = app.scroll_offset.saturating_add(3);
            return;
        }
        KeyCode::Down if key.modifiers.contains(KeyModifiers::SHIFT) => {
            app.scroll_offset = app.scroll_offset.saturating_sub(3);
            if app.scroll_offset == 0 {
                app.manual_scroll = false;
            }
            return;
        }
        _ => {}
    }

    // 流式时只允许滚动和 Esc
    if app.is_streaming {
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

/// 处理鼠标事件（滚轮滚动）
fn handle_mouse_event(app: &mut App, mouse: MouseEvent) {
    match mouse.kind {
        MouseEventKind::ScrollUp => {
            // 向上滚动 3 行
            app.manual_scroll = true;
            app.scroll_offset = app.scroll_offset.saturating_add(3);
        }
        MouseEventKind::ScrollDown => {
            // 向下滚动 3 行，如果到底了就取消手动模式
            app.scroll_offset = app.scroll_offset.saturating_sub(3);
            if app.scroll_offset == 0 {
                app.manual_scroll = false;
            }
        }
        _ => {}
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════════════════════════════════════════

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
