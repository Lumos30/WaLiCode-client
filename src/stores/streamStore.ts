/**
 * SSE 流连接状态 Store
 *
 * 管理 SSE 连接的健康状态、断线重连、心跳超时检测。
 * 对应 UI: StreamStatusBar 组件（显示连接状态横幅）
 */

import { create } from 'zustand'
import { chatConfig } from '../config/chat'

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'disconnected' | 'error'

export interface StreamState {
  /** 当前连接状态 */
  status: StreamStatus
  /** 重试次数 */
  retryCount: number
  /** 最大重试次数 */
  maxRetries: number
  /** 最后一次错误消息 */
  lastError: string | null
  /** 最后一次收到心跳/数据的时间戳 */
  lastActivityAt: number | null
  /** 心跳超时阈值（毫秒），默认 60s */
  heartbeatTimeoutMs: number
  /** 状态更新消息（来自后端 status 事件） */
  statusMessage: string | null

  // Actions
  setStatus: (status: StreamStatus) => void
  setRetrying: (count: number) => void
  setError: (err: string | null) => void
  touchActivity: () => void
  setStatusMessage: (msg: string | null) => void
  reset: () => void

  /** 检查心跳是否超时 */
  isHeartbeatStale: () => boolean
}

export const useStreamStore = create<StreamState>((set, get) => ({
  status: 'idle',
  retryCount: 0,
  maxRetries: chatConfig.maxRetries,
  lastError: null,
  lastActivityAt: null,
  heartbeatTimeoutMs: chatConfig.heartbeatTimeout,
  statusMessage: null,

  setStatus: (status) => set({ status }),
  setRetrying: (count) => set({ retryCount: count, status: count > 0 ? 'reconnecting' : 'streaming' }),
  setError: (err) => set({ lastError: err, status: err ? 'error' : 'idle' }),
  touchActivity: () => set({ lastActivityAt: Date.now() }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  reset: () => set({
    status: 'idle',
    retryCount: 0,
    lastError: null,
    lastActivityAt: null,
    statusMessage: null,
  }),

  isHeartbeatStale: () => {
    const { lastActivityAt, heartbeatTimeoutMs } = get()
    if (!lastActivityAt) return false
    return Date.now() - lastActivityAt > heartbeatTimeoutMs
  },
}))
