// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod cli_register;
mod local_pty;
mod project_index;
mod shell_exec;
mod workspace_file;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(workspace_file::WorkspaceRegistry::default())
        .manage(project_index::ProjectIndexRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
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
            // 由原生目录选择授权并绑定工作区 ID 的 Agent 文件操作
            workspace_file::select_local_workspace,
            workspace_file::revoke_local_workspace,
            workspace_file::execute_workspace_file_operation,
            workspace_file::cancel_workspace_file_operation,
            // 当前原生授权项目的有界增量检索
            project_index::retrieve_local_project_context,
            // 命令行工具注册
            cli_register::install_cli_command,
            cli_register::uninstall_cli_command,
            cli_register::check_cli_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
