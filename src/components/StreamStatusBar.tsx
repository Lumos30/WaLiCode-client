/**
 * StreamStatusBar — SSE 连接状态横幅
 *
 * P0-5: 展示 SSE 连接健康状态，断线时显示重连进度
 *
 * 状态映射：
 * - idle: 不显示
 * - connecting: "正在连接..." (蓝色)
 * - streaming: 不显示（正常状态不打扰用户）
 * - reconnecting: "正在重连... (第 n 次)" (橙色，带动画)
 * - disconnected: "连接已断开" (红色)
 * - stopped: "已由用户停止" (灰色)
 * - error: "连接错误: xxx" (红色)
 *
 * 心跳超时检测：
 * - streamStore.isHeartbeatStale() → 自动触发重连提示
 */

import { useEffect } from 'react'
import { useStreamStore, StreamStatus } from '../stores/streamStore'
import { chatConfig } from '../config/chat'

const STATUS_CONFIG: Record<StreamStatus, { color: string; bg: string; icon: string; text: (n: number, err: string | null) => string } | null> = {
  idle: null,
  connecting: null, // 连接中属于正常状态，不显示横幅打扰用户
  streaming: null, // 正常流式输出时不显示
  reconnecting: {
    color: '#fbbf24',
    bg: 'rgba(251, 191, 36, 0.1)',
    icon: '🔄',
    text: (n, _) => `正在重连... (第 ${n} 次)`,
  },
  disconnected: {
    color: '#f87171',
    bg: 'rgba(239, 68, 68, 0.1)',
    icon: '❌',
    text: () => '连接已断开',
  },
  stopped: {
    color: '#94a3b8',
    bg: 'rgba(148, 163, 184, 0.1)',
    icon: '■',
    text: () => 'Agent 运行已由用户停止',
  },
  error: {
    color: '#f87171',
    bg: 'rgba(239, 68, 68, 0.1)',
    icon: '⚠️',
    text: (_, err) => `连接错误: ${err || '未知错误'}`,
  },
}

export function StreamStatusBar() {
  const { status, retryCount, lastError, statusMessage, touchActivity, isHeartbeatStale, setStatus } = useStreamStore()

  // 心跳超时检测 — 每 5 秒检查一次
  useEffect(() => {
    if (status !== 'streaming') return

    const timer = setInterval(() => {
      if (isHeartbeatStale()) {
        console.warn('[StreamStatusBar] 心跳超时，标记为断开')
        setStatus('disconnected')
      }
    }, chatConfig.heartbeatTimeout / 6)

    return () => clearInterval(timer)
  }, [status, isHeartbeatStale, setStatus])

  const config = STATUS_CONFIG[status]
  // A normal stream has no connection banner, but retrieval and other
  // controlled status events are useful provenance rather than errors.
  if (!config && !statusMessage) return null
  const activeConfig = config || {
    color: '#60a5fa',
    bg: 'rgba(96, 165, 250, 0.08)',
    icon: 'ℹ',
    text: () => statusMessage || '',
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-xs"
      style={{
        backgroundColor: activeConfig.bg,
        color: activeConfig.color,
        borderBottom: `1px solid ${activeConfig.color}33`,
      }}
    >
      <span className={status === 'reconnecting' ? 'animate-spin inline-block' : ''}>
        {activeConfig.icon}
      </span>
      <span>{config ? config.text(retryCount, lastError) : activeConfig.text(retryCount, lastError)}</span>
      {status === 'reconnecting' && (
        <span className="flex gap-0.5 ml-1">
          <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: activeConfig.color, animationDelay: '0ms' }} />
          <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: activeConfig.color, animationDelay: '150ms' }} />
          <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: activeConfig.color, animationDelay: '300ms' }} />
        </span>
      )}
      {status === 'disconnected' && (
        <button
          className="ml-auto px-2 py-0.5 rounded text-xs hover:opacity-80"
          style={{
            backgroundColor: activeConfig.color + '22',
            color: activeConfig.color,
            border: `1px solid ${activeConfig.color}44`,
          }}
          onClick={() => {
            touchActivity()
            setStatus('connecting')
          }}
        >
          手动重连
        </button>
      )}
    </div>
  )
}
