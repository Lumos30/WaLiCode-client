/**
 * 权限确认 Store
 *
 * 管理后端发来的 permission_confirm 事件。
 * 当 PermissionGuard L2 规则命中 CONFIRM 级别时，后端发送 permission_confirm SSE 事件，
 * 前端弹出 PermissionConfirmModal，用户确认/拒绝后回写结果。
 *
 * 阻塞机制：
 * 1. 后端发送 permission_confirm 事件 → 前端收到后 push 到 pendingConfirmations
 * 2. PermissionConfirmModal 渲染最早一条确认请求
 * 3. 用户点击「确认执行」或「拒绝」→ 调用 resolveConfirmation
 * 4. 前端通过 fetch POST /api/v1/permission/resolve 回写结果给后端
 * 5. 后端收到结果 → 继续/中止工具执行
 */

import { create } from 'zustand'

export interface PermissionConfirmRequest {
  /** 确认请求唯一 ID */
  confirmId: string
  /** 工具名称 */
  toolName: string
  /** 工具参数（命令/路径等） */
  toolArgs: string
  /** 风险等级 */
  riskLevel: 'DENY' | 'CONFIRM' | 'ALLOW'
  /** 风险原因 */
  reason: string
  /** 超时时间（毫秒），0=不超时 */
  timeoutMs: number
  /** 请求到达时间戳 */
  arrivedAt: number
}

export interface PermissionState {
  /** 待确认队列（FIFO） */
  pending: PermissionConfirmRequest[]
  /** 当前展示的确认请求（队列首部） */
  current: PermissionConfirmRequest | null

  /** 添加一条确认请求 */
  pushConfirmation: (req: PermissionConfirmRequest) => void
  /** 解决当前确认（用户已操作） */
  resolveConfirmation: (confirmId: string, approved: boolean, modifiedArgs?: string) => void
  /** 清空队列 */
  clearAll: () => void
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pending: [],
  current: null,

  pushConfirmation: (req) => {
    const { pending } = get()
    const newPending = [...pending, req]
    set({
      pending: newPending,
      current: newPending[0] || null,
    })
  },

  resolveConfirmation: (confirmId, approved, modifiedArgs) => {
    const { pending } = get()
    const newPending = pending.filter((p) => p.confirmId !== confirmId)

    // 回写结果给后端
    fetch(`${getBaseUrl()}/api/v1/permission/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmId,
        approved,
        modifiedArgs: modifiedArgs || undefined,
      }),
    }).catch((err) => {
      console.error('[permissionStore] resolveConfirmation failed:', err)
    })

    set({
      pending: newPending,
      current: newPending[0] || null,
    })
  },

  clearAll: () => set({ pending: [], current: null }),
}))

function getBaseUrl(): string {
  return (window as any).__API_BASE__ || ''
}
