/**
 * ErrorRecoveryCard — 对话中断恢复卡片
 *
 * 当 SSE 连接断开、网络异常、服务报错时，在对话区域展示醒目的中断提示。
 * 默认展开，核心操作（重试/继续）直接可见。
 */

import { useState } from 'react'
import { useThemeStore } from '../stores/themeStore'

export type ErrorType = 'network' | 'tool_execution' | 'permission_denied' | 'context_limit' | 'unknown'

export interface ErrorRecovery {
  type: ErrorType
  title: string
  message: string
  details?: string
  toolName?: string
  toolCallId?: string
  suggestions?: string[]
}

interface ErrorRecoveryCardProps {
  error: ErrorRecovery
  onRetry?: () => void
  onSkip?: () => void
  onResetContext?: () => void
  onFeedback?: (feedback: string) => void
  canRetry?: boolean
}

const ERROR_ICONS: Record<ErrorType, string> = {
  network: '🔌',
  tool_execution: '⚙️',
  permission_denied: '⛔',
  context_limit: '📦',
  unknown: '❌',
}

const ERROR_TITLES: Record<ErrorType, string> = {
  network: '网络连接异常',
  tool_execution: '工具执行失败',
  permission_denied: '权限不足',
  context_limit: '上下文长度超限',
  unknown: '发生错误',
}

/** 根据错误类型生成用户友好的中断原因描述 */
function getInterruptReason(error: ErrorRecovery): string {
  switch (error.type) {
    case 'network':
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        return '网络连接已断开，无法与服务器通信'
      }
      if (error.message.includes('timeout') || error.message.includes('超时')) {
        return '请求超时，服务器响应过慢或无响应'
      }
      return `网络问题：${error.message}`
    case 'tool_execution':
      return `工具执行出错：${error.toolName || error.message}`
    case 'context_limit':
      return '当前对话上下文已超出限制'
    default:
      return error.message || '发生了未知错误'
  }
}

export function ErrorRecoveryCard({
  error,
  onRetry,
  onSkip,
  onResetContext,
  onFeedback,
  canRetry = true,
}: ErrorRecoveryCardProps) {
  const { colors } = useThemeStore()
  const [showDetails, setShowDetails] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')

  const title = error.title || ERROR_TITLES[error.type] || '对话已中断'
  const reason = getInterruptReason(error)

  const handleFeedback = () => {
    if (feedbackText.trim()) {
      onFeedback?.(feedbackText.trim())
      setFeedbackText('')
      setShowFeedback(false)
    }
  }

  return (
    <div
      className="rounded-xl border overflow-hidden my-2"
      style={{
        background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(251,146,60,0.06))',
        borderColor: 'rgba(239, 68, 68, 0.25)',
        boxShadow: '0 2px 12px rgba(239,68,68,0.1)',
      }}
    >
      {/* 主提示区 — 始终可见 */}
      <div className="px-4 py-3">
        {/* 标题行 */}
        <div className="flex items-center gap-2.5 mb-2">
          <span className="text-lg">{ERROR_ICONS[error.type]}</span>
          <span className="text-sm font-semibold" style={{ color: colors.text }}>
            {title}
          </span>
          {error.toolName && (
            <code
              className="px-1.5 py-0.5 rounded text-xs font-mono"
              style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: colors.textSecondary }}
            >
              {error.toolName}
            </code>
          )}
        </div>

        {/* 中断原因 */}
        <p className="text-xs leading-relaxed mb-3" style={{ color: colors.textSecondary || '#999' }}>
          {reason}
        </p>

        {/* 操作按钮行 — 核心操作直接暴露 */}
        <div className="flex items-center gap-2">
          {canRetry && onRetry && (
            <button
              className="px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                backgroundColor: colors.accent || '#3b82f6',
                color: '#fff',
                boxShadow: `0 2px 8px ${(colors.accent || '#3b82f6')}33`,
              }}
              onClick={onRetry}
            >
              <span>▶</span> 继续对话
            </button>
          )}
          {onSkip && (
            <button
              className="px-3 py-1.5 rounded-lg text-xs transition-all hover:opacity-80"
              style={{
                color: colors.textSecondary || '#999',
                border: `1px solid ${colors.border || 'rgba(255,255,255,0.12)'}`,
              }}
              onClick={onSkip}
            >
              忽略
            </button>
          )}
          {onResetContext && (
            <button
              className="px-3 py-1.5 rounded-lg text-xs transition-all hover:opacity-80"
              style={{
                color: colors.textSecondary || '#999',
                border: `1px solid ${colors.border || 'rgba(255,255,255,0.12)'}`,
              }}
              onClick={onResetContext}
            >
              重置上下文
            </button>
          )}
          {/* 展开/收起详情 */}
          {(error.details || onFeedback) && (
            <button
              className="ml-auto px-2 py-1 rounded text-xs transition-all hover:opacity-70"
              style={{ color: colors.textSecondary || '#888' }}
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? '收起详情 ▲' : '查看详情 ▼'}
            </button>
          )}
        </div>
      </div>

      {/* 展开的详细信息区 */}
      {showDetails && (
        <div
          className="px-4 pb-3 border-t"
          style={{ borderColor: 'rgba(239, 68, 68, 0.15)' }}
        >
          {/* 技术细节 */}
          {error.details && (
            <pre
              className="mt-2 p-2.5 rounded-lg text-xs font-mono overflow-x-auto max-h-32 leading-relaxed"
              style={{
                backgroundColor: 'rgba(0,0,0,0.25)',
                color: colors.textSecondary || '#aaa',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {error.details}
            </pre>
          )}

          {/* 反馈区 */}
          {onFeedback && (
            <div className="mt-2">
              {!showFeedback ? (
                <button
                  className="text-xs px-2 py-1 rounded transition-all hover:opacity-80"
                  style={{ color: colors.textSecondary || '#888' }}
                  onClick={() => setShowFeedback(true)}
                >
                  📝 反馈此问题
                </button>
              ) : (
                <div className="space-y-1.5">
                  <textarea
                    className="w-full rounded-lg p-2.5 text-xs resize-none leading-relaxed"
                    style={{
                      backgroundColor: colors.bgInput || 'rgba(255,255,255,0.05)',
                      color: colors.text,
                      border: `1px solid ${colors.border || 'rgba(255,255,255,0.1)'}`,
                      minHeight: '64px',
                    }}
                    placeholder="描述你遇到的问题..."
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      className="px-2.5 py-1 rounded text-xs"
                      style={{ color: colors.textSecondary || '#999' }}
                      onClick={() => setShowFeedback(false)}
                    >
                      取消
                    </button>
                    <button
                      className="px-2.5 py-1 rounded text-xs font-medium"
                      style={{ backgroundColor: colors.accent, color: '#fff' }}
                      onClick={handleFeedback}
                    >
                      提交反馈
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
