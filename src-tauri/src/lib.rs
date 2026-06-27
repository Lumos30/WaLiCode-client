// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod cli_register;
mod local_pty;
mod shell_exec;
mod local_http_server;

use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 启动本地 HTTP Server（供 Spring Boot LocalExecuteAdkTool 调用）
            local_http_server::start_local_server(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            // 本地 PTY 终端
            local_pty::spawn_local_pty,
            local_pty::write_to_pty,
            local_pty::resize_local_pty,
            local_pty::kill_local_pty,
            local_pty::list_local_ptys,
            // 命令执行
            shell_exec::execute_shell_cmd,
            shell_exec::check_backgroundable,
            shell_exec::get_shell_info_cmd,
            shell_exec::spawn_stream_shell,
            shell_exec::kill_stream_shell,
            shell_exec::list_stream_shells,
            // 本地 Server 信息
            local_http_server::get_local_server_port,
            // 命令行工具注册
            cli_register::install_cli_command,
            cli_register::uninstall_cli_command,
            cli_register::check_cli_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
