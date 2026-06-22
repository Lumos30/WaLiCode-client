/**
 * PermissionConfirmModal — 权限确认弹窗
 *
 * P0-2: 当后端 PermissionGuard 命中 CONFIRM 级别时，
 * SSE 推送 permission_confirm 事件 → permissionStore 队列 → 本组件渲染
 *
 * 功能：
 * - 显示工具名称、参数、风险等级、风险原因
 * - 倒计时超时（如配置了 timeoutMs）
 * - 用户可「确认执行」「拒绝」「编辑参数后确认」
 * - 风险等级颜色区分：DENY=红 / CONFIRM=橙 / ALLOW=绿
 * - 键盘快捷键：Enter=确认 / Esc=拒绝
 */

import { useEffect, useState, useRef } from 'react'
import { usePermissionStore } from '../stores/permissionStore'
import { useThemeStore } from '../stores/themeStore'

const RISK_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  DENY: { bg: 'rgba(239, 68, 68, 0.12)', border: '#ef4444', text: '#fca5a5', label: '危险' },
  CONFIRM: { bg: 'rgba(249, 115, 22, 0.12)', border: '#f97316', text: '#fdba74', label: '需确认' },
  ALLOW: { bg: 'rgba(34, 197, 94, 0.12)', border: '#22c55e', text: '#86efac', label: '安全' },
}

export function PermissionConfirmModal() {
  const { colors } = useThemeStore()
  const { current, resolveConfirmation } = usePermissionStore()
  const [countdown, setCountdown] = useState<number | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editedArgs, setEditedArgs] = useState('')
  const countdownTimerRef = useRef<number | null>(null)

  // 倒计时
  useEffect(() => {
    if (!current) {
      setCountdown(null)
      setEditMode(false)
      return
    }

    setEditedArgs(current.toolArgs)

    if (current.timeoutMs > 0) {
      const seconds = Math.ceil(current.timeoutMs / 1000)
      setCountdown(seconds)

      countdownTimerRef.current = window.setInterval(() => {
        setCountdown((prev) => {
          if (prev === null) return null
          if (prev <= 1) {
            // 超时自动拒绝
            resolveConfirmation(current.confirmId, false)
            return null
          }
          return prev - 1
        })
      }, 1000)
    }

    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
    }
  }, [current, resolveConfirmation])

  // 键盘快捷键
  useEffect(() => {
    if (!current) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !editMode) {
        e.preventDefault()
        handleApprove()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleDeny()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [current, editMode, editedArgs])

  if (!current) return null

  const risk = RISK_COLORS[current.riskLevel] || RISK_COLORS.CONFIRM

  const handleApprove = () => {
    resolveConfirmation(current.confirmId, true, editMode ? editedArgs : undefined)
  }

  const handleDeny = () => {
    resolveConfirmation(current.confirmId, false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
    >
      <div
        className="w-full max-w-lg rounded-lg shadow-xl border"
        style={{
          backgroundColor: colors.bgSecondary || '#1e1e2e',
          borderColor: risk.border,
          color: colors.text,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-4 py-3 border-b"
          style={{ borderColor: colors.border || 'rgba(255,255,255,0.08)' }}
        >
          <span
            className="px-2 py-0.5 rounded text-xs font-medium"
            style={{ backgroundColor: risk.bg, color: risk.text, border: `1px solid ${risk.border}` }}
          >
            {risk.label}
          </span>
          <span className="text-sm font-medium" style={{ color: colors.text }}>
            权限确认
          </span>
          {countdown !== null && (
            <span className="ml-auto text-xs" style={{ color: colors.textSecondary || '#999' }}>
              {countdown}s 后自动拒绝
            </span>
          )}
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          {/* 工具信息 */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs" style={{ color: colors.textSecondary || '#999' }}>
              <span>工具</span>
              <code className="px-1.5 py-0.5 rounded" style={{ backgroundColor: colors.bgInput || 'rgba(255,255,255,0.05)' }}>
                {current.toolName}
              </code>
            </div>
          </div>

          {/* 风险原因 */}
          <div
            className="p-2.5 rounded text-xs"
            style={{ backgroundColor: risk.bg, color: risk.text }}
          >
            ⚠️ {current.reason}
          </div>

          {/* 参数 / 编辑区 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: colors.textSecondary || '#999' }}>执行参数</span>
              <button
                className="text-xs hover:underline"
                style={{ color: colors.accent }}
                onClick={() => setEditMode(!editMode)}
              >
                {editMode ? '取消编辑' : '编辑参数'}
              </button>
            </div>
            {editMode ? (
              <textarea
                className="w-full rounded p-2 text-xs font-mono resize-y"
                style={{
                  backgroundColor: colors.bgInput || 'rgba(255,255,255,0.05)',
                  color: colors.text,
                  border: `1px solid ${colors.border || 'rgba(255,255,255,0.1)'}`,
                  minHeight: '80px',
                }}
                value={editedArgs}
                onChange={(e) => setEditedArgs(e.target.value)}
                autoFocus
              />
            ) : (
              <pre
                className="p-2 rounded text-xs font-mono overflow-x-auto"
                style={{
                  backgroundColor: colors.bgInput || 'rgba(255,255,255,0.05)',
                  color: colors.text,
                  maxHeight: '160px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {current.toolArgs}
              </pre>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3 border-t"
          style={{ borderColor: colors.border || 'rgba(255,255,255,0.08)' }}
        >
          <button
            className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
            style={{
              backgroundColor: 'transparent',
              color: colors.textSecondary || '#999',
              border: `1px solid ${colors.border || 'rgba(255,255,255,0.15)'}`,
            }}
            onClick={handleDeny}
          >
            拒绝 (Esc)
          </button>
          <button
            className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
            style={{
              backgroundColor: risk.border,
              color: '#fff',
            }}
            onClick={handleApprove}
          >
            确认执行 (Enter)
          </button>
        </div>
      </div>
    </div>
  )
}
