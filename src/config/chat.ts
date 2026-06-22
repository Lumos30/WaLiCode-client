/**
 * SSE 流式对话配置
 *
 * 所有时间单位：毫秒
 * 修改此文件后无需重新编译，热更新生效
 */
export const chatConfig = {
  /** HTTP 请求超时时间（单次 fetch） */
  requestTimeout: 60_000,

  /** HTTP 5xx / 网络错误 — 最大重试次数 */
  maxRetries: 3,

  /** HTTP 5xx / 网络错误 — 重试基础间隔（第 n 次 = baseDelay × n） */
  retryBaseDelay: 1_000,

  /** SSE 流中途断开 — 最大重连次数 */
  maxStreamReconnects: 3,

  /** SSE 流中途断开 — 重连基础间隔（第 n 次 = baseDelay × n） */
  streamReconnectBaseDelay: 2_000,

  /** 心跳超时时间（超过此时间未收到 heartbeat → 标记断开） */
  heartbeatTimeout: 30_000,
} as const
