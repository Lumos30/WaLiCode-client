//! CLI 模块入口
//!
//! WaLiCode 终端 AI 对话模式的核心模块。

mod app;
mod sse_client;
mod tui;

pub use app::{App, AppEvent, CliArgs, ReActEvent};
pub use sse_client::build_project_context;
pub use tui::run_cli;
