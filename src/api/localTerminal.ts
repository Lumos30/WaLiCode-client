/**
 * 本地 PTY 终端 API（Tauri invoke 封装）
 *
 * 对应 Rust 侧 local_pty.rs 的 Tauri Commands
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** PTY 输出事件 payload */
export interface LocalPtyOutputEvent {
  session_id: string
  data: string
}

/** PTY 退出事件 payload */
export interface LocalPtyExitEvent {
  session_id: string
  exit_code: number
}

/** 活跃 PTY 会话信息 */
export interface LocalPtySession {
  session_id: string
}

/** 创建本地 PTY 终端会话 */
export function spawnLocalPty(params: {
  sessionId: string
  cwd?: string
  cols?: number
  rows?: number
}): Promise<void> {
  return invoke('spawn_local_pty', {
    sessionId: params.sessionId,
    cwd: params.cwd,
    cols: params.cols,
    rows: params.rows,
  })
}

/** 写入数据到 PTY */
export function writeToPty(sessionId: string, data: string): Promise<void> {
  return invoke('write_to_pty', { sessionId, data })
}

/** 调整 PTY 终端大小 */
export function resizeLocalPty(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke('resize_local_pty', { sessionId, cols, rows })
}

/** 关闭 PTY 会话 */
export function killLocalPty(sessionId: string): Promise<void> {
  return invoke('kill_local_pty', { sessionId })
}

/** 列出所有活跃 PTY 会话 */
export function listLocalPtys(): Promise<LocalPtySession[]> {
  return invoke('list_local_ptys')
}

/** 监听 PTY 输出事件 */
export function onLocalPtyOutput(
  sessionId: string,
  callback: (data: string) => void,
): Promise<UnlistenFn> {
  return listen<LocalPtyOutputEvent>('local-pty-output', (event) => {
    if (event.payload.session_id === sessionId) {
      callback(event.payload.data)
    }
  })
}

/** 监听 PTY 退出事件 */
export function onLocalPtyExit(
  sessionId: string,
  callback: (exitCode: number) => void,
): Promise<UnlistenFn> {
  return listen<LocalPtyExitEvent>('local-pty-exit', (event) => {
    if (event.payload.session_id === sessionId) {
      callback(event.payload.exit_code)
    }
  })
}
