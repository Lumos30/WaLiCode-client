/**
 * 权限确认 Store
 *
 * 管理后端发来的 permission_confirm 事件。
 * 当 PermissionGuard L2 规则命中 CONFIRM 级别时，后端发送 permission_confirm SSE 事件，
 * 前端弹出 PermissionConfirmModal，用户确认/拒绝后回写结果。
 *
 * 阻塞机制：
 * 1. 后端发送 permission_confirm 事件 → 前端收到后 push 到 pendingConfirmations
 * 2. PermissionConfirmModal 渲染最早一条确认请求（唯一的用户确认入口）
 * 3. 用户点击「确认执行」或「拒绝」→ 调用 resolveConfirmation
 * 4. 前端通过 fetch POST /api/v1/permission/resolve 回写结果给后端
 * 5. 后端收到结果 → 继续/中止工具执行
 */

import { create } from 'zustand'
import { post } from '../api/request'

export interface PermissionConfirmRequest {
  /** 服务端生成的一次性票据 */
  ticket: string
  sessionId: string
  runId: string
  toolCallId: string
  /** 工具名称 */
  toolName: string
  /** 工具参数（命令/路径等） */
  toolArgs: string
  /** 原始参数摘要，回写时用于上下文完整性校验 */
  argsDigest: string
  /** 风险等级 */
  riskLevel: 'DENY' | 'CONFIRM' | 'ALLOW'
  /** 风险原因 */
  reason: string
  /** 超时时间（毫秒），0=不超时 */
  timeoutMs: number
  expiresAt: number
  /** 请求到达时间戳 */
  arrivedAt: number
}

export interface PermissionState {
  /** 待确认队列（FIFO） */
  pending: PermissionConfirmRequest[]
  /** 当前展示的确认请求（队列首部） */
  current: PermissionConfirmRequest | null
  resolving: boolean
  error: string | null

  /** 添加一条确认请求 */
  pushConfirmation: (req: PermissionConfirmRequest) => void
  /** 解决当前确认（用户已操作） */
  resolveConfirmation: (request: PermissionConfirmRequest, approved: boolean) => Promise<void>
  /** 丢弃已经失效、无法再次处理的本地弹窗 */
  dismissCurrent: () => void
  /** 清空队列 */
  clearAll: () => void
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pending: [],
  current: null,
  resolving: false,
  error: null,

  pushConfirmation: (req) => {
    const { pending } = get()
    if (pending.some((item) => item.ticket === req.ticket)) return
    const newPending = [...pending, req]
    set({
      pending: newPending,
      current: newPending[0] || null,
      error: null,
    })
  },

  resolveConfirmation: async (request, approved) => {
    set({ resolving: true, error: null })
    try {
      const response = await post<string>('/api/v1/permission/resolve', {
        ticket: request.ticket,
        sessionId: request.sessionId,
        runId: request.runId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        argsDigest: request.argsDigest,
        approved,
      })

      if (response.code !== '0000') {
        set({
          resolving: false,
          error: response.info || '权限确认失败，票据可能已过期',
        })
        return
      }

      const newPending = get().pending.filter((item) => item.ticket !== request.ticket)
      set({ pending: newPending, current: newPending[0] || null, resolving: false, error: null })
    } catch (error) {
      set({
        resolving: false,
        error: error instanceof Error ? error.message : '权限确认请求失败，请重试',
      })
    }
  },

  dismissCurrent: () => {
    const current = get().current
    if (!current) return
    const newPending = get().pending.filter((item) => item.ticket !== current.ticket)
    set({ pending: newPending, current: newPending[0] || null, resolving: false, error: null })
  },

  clearAll: () => set({ pending: [], current: null, resolving: false, error: null }),
}))
