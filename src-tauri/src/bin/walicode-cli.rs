//! WaLiCode CLI — 终端 AI 对话模式入口
//!
//! 终端输入 `walicode` 即可进入此模式，类似 Claude Code / OpenCode 的终端体验。
//! 不启动 Tauri GUI，而是启动 ratatui TUI 界面，通过 HTTP SSE 对接 walicode-server。

use clap::Parser;

// 通过 #[path] 引用 src/cli/ 下的子模块
// 使用前缀 _cli_ 避免与 lib.rs 中的模块名冲突
#[path = "../cli/app.rs"]
mod _cli_app;
// CLI 与 GUI 共用同一进程生命周期和输出编码实现。
#[path = "../cli/sse_client.rs"]
mod _cli_sse;
#[path = "../cli/tui.rs"]
mod _cli_tui;
#[allow(dead_code)]
#[path = "../shell_exec.rs"]
mod shell_exec;

use _cli_app::CliArgs;
use _cli_tui::run_cli;

fn main() {
    let args = CliArgs::parse();

    // 设置 tokio runtime
    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
    rt.block_on(run_cli(args));
}
