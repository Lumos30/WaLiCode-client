/**
 * ErrorRecoveryCard — 错误恢复卡片
 *
 * P0-4: 当 SSE error 事件或工具执行失败时展示
 *
 * 功能：
 * - 显示错误类型、错误消息、上下文
 * - 提供重试/跳过/重置上下文/反馈 四个操作
 * - 错误分类：network / tool_execution / permission_denied / context_limit / unknown
 * - 自动匹配恢复建议
 * - 可折叠/展开错误详情
 */

import { useState } from 'react'
import { useThemeStore } from '../stores/themeStore'

export type ErrorType = 'network' | 'tool_execution' | 'permission_denied' | 'context_limit' | 'unknown'

export interface ErrorRecovery {
  type: ErrorType
  title: string
  message: string
  details?: string
  /** 关联的工具名 */
  toolName?: string
  /** 关联的工具调用 ID */
  toolCallId?: string
  /** 建议的操作 */
  suggestions?: string[]
}

interface ErrorRecoveryCardProps {
  error: ErrorRecovery
  onRetry?: () => void
  onSkip?: () => void
  onResetContext?: () => void
  onFeedback?: (feedback: string) => void
  /** 是否可重试 */
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

const ERROR_SUGGESTIONS: Record<ErrorType, string[]> = {
  network: [
    '检查网络连接是否正常',
    '确认后端服务是否在运行',
    '等待几秒后重试',
  ],
  tool_execution: [
    '检查命令拼写和参数',
    '确认 SSH 连接是否正常',
    '查看工具输出日志获取详细错误',
  ],
  permission_denied: [
    '该操作被安全规则拦截',
    '检查命令是否在危险命令列表中',
    '联系管理员调整权限规则',
  ],
  context_limit: [
    '开启新对话以清除历史上下文',
    '简化请求，减少上下文引用',
    '等待自动上下文压缩触发',
  ],
  unknown: [
    '尝试重新发送请求',
    '如果持续出现，请反馈给开发者',
  ],
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
  const [expanded, setExpanded] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')

  const suggestions = error.suggestions || ERROR_SUGGESTIONS[error.type] || []
  const title = error.title || ERROR_TITLES[error.type] || '错误'

  const handleFeedback = () => {
    if (feedbackText.trim()) {
      onFeedback?.(feedbackText.trim())
      setFeedbackText('')
      setShowFeedback(false)
    }
  }

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        backgroundColor: 'rgba(239, 68, 68, 0.06)',
        borderColor: 'rgba(239, 68, 68, 0.3)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-base">{ERROR_ICONS[error.type]}</span>
        <span className="text-sm font-medium" style={{ color: colors.text }}>
          {title}
        </span>
        {error.toolName && (
          <code
            className="px-1.5 py-0.5 rounded text-xs"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
          >
            {error.toolName}
          </code>
        )}
        <span className="ml-auto text-xs" style={{ color: colors.textSecondary || '#999' }}>
          {expanded ? '▼' : '▶'}
        </span>
      </div>

      {/* 错误消息（始终展示） */}
      <div className="px-3 pb-2">
        <p className="text-xs" style={{ color: colors.textSecondary || '#aaa' }}>
          {error.message}
        </p>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <>
          {/* 详细信息 */}
          {error.details && (
            <div className="px-3 pb-2">
              <pre
                className="p-2 rounded text-xs font-mono overflow-x-auto max-h-32"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  color: colors.textSecondary || '#aaa',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {error.details}
              </pre>
            </div>
          )}

          {/* 恢复建议 */}
          {suggestions.length > 0 && (
            <div className="px-3 pb-2">
              <div className="text-xs font-medium mb-1" style={{ color: colors.textSecondary || '#999' }}>
                💡 建议
              </div>
              <ul className="space-y-0.5">
                {suggestions.map((s, i) => (
                  <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: colors.textSecondary || '#aaa' }}>
                    <span style={{ color: colors.accent }}>•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 反馈区 */}
          {showFeedback && (
            <div className="px-3 pb-2">
              <textarea
                className="w-full rounded p-2 text-xs resize-none"
                style={{
                  backgroundColor: colors.bgInput || 'rgba(255,255,255,0.05)',
                  color: colors.text,
                  border: `1px solid ${colors.border || 'rgba(255,255,255,0.1)'}`,
                  minHeight: '60px',
                }}
                placeholder="描述你遇到的问题..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-1">
                <button
                  className="px-2 py-1 rounded text-xs"
                  style={{ color: colors.textSecondary || '#999' }}
                  onClick={() => setShowFeedback(false)}
                >
                  取消
                </button>
                <button
                  className="px-2 py-1 rounded text-xs"
                  style={{ backgroundColor: colors.accent, color: '#fff' }}
                  onClick={handleFeedback}
                >
                  提交
                </button>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 px-3 py-2 border-t" style={{ borderColor: 'rgba(239, 68, 68, 0.15)' }}>
            {canRetry && onRetry && (
              <button
                className="px-3 py-1.5 rounded text-xs font-medium"
                style={{ backgroundColor: colors.accent, color: '#fff' }}
                onClick={onRetry}
              >
                🔄 重试
              </button>
            )}
            {onSkip && (
              <button
                className="px-3 py-1.5 rounded text-xs"
                style={{
                  backgroundColor: 'transparent',
                  color: colors.textSecondary || '#999',
                  border: `1px solid ${colors.border || 'rgba(255,255,255,0.15)'}`,
                }}
                onClick={onSkip}
              >
                跳过
              </button>
            )}
            {onResetContext && (
              <button
                className="px-3 py-1.5 rounded text-xs"
                style={{
                  backgroundColor: 'transparent',
                  color: colors.textSecondary || '#999',
                  border: `1px solid ${colors.border || 'rgba(255,255,255,0.15)'}`,
                }}
                onClick={onResetContext}
              >
                重置上下文
              </button>
            )}
            {onFeedback && !showFeedback && (
              <button
                className="ml-auto px-3 py-1.5 rounded text-xs"
                style={{ color: colors.textSecondary || '#999' }}
                onClick={() => setShowFeedback(true)}
              >
                反馈
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
