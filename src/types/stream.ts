/** Shell 流式执行事件（Rust 侧 StreamEvent 对应） */
export interface StreamEvent {
  session_id: string
  kind: 'stdout' | 'stderr' | 'done' | 'error'
  data: string
  exit_code: number | null
  duration_ms: number | null
}
