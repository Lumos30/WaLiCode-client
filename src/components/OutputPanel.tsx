/**
 * OutputPanel — AI 命令执行输出面板
 *
 * 展示 AI 通过工具执行的命令及其输出结果。
 * 与终端不同，这里只展示 AI 执行的历史记录，不接受用户输入。
 *
 * 数据来源：
 * 1. Tauri Event "shell-stream" — 流式命令执行输出
 * 2. Tauri invoke "execute_shell_cmd" — 一次性命令执行结果
 * 3. 通过 outputStore 管理执行历史
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useOutputStore, type OutputEntry, type OutputStatus } from '../stores/outputStore'
import type { StreamEvent } from '../types/stream'

interface OutputPanelProps {
  /** 是否可见 */
  visible?: boolean
}

export function OutputPanel({ visible = true }: OutputPanelProps) {
  const { colors } = useThemeStore()
  const { entries, updateEntry, clearEntries } = useOutputStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const unlistenStreamRef = useRef<UnlistenFn | null>(null)

  /** 监听 shell-stream 事件 */
  useEffect(() => {
    listen<StreamEvent>('shell-stream', (event) => {
      const payload = event.payload
      const entry = entries.find((e) => e.sessionId === payload.session_id)

      if (payload.kind === 'stdout') {
        if (entry) {
          updateEntry(payload.session_id, {
            stdout: (entry.stdout || '') + payload.data,
            status: 'running',
          })
        }
      } else if (payload.kind === 'stderr') {
        if (entry) {
          updateEntry(payload.session_id, {
            stderr: (entry.stderr || '') + payload.data,
            status: 'running',
          })
        }
      } else if (payload.kind === 'done') {
        if (entry) {
          updateEntry(payload.session_id, {
            status: payload.exit_code === 0 ? 'success' : 'failed',
            exitCode: payload.exit_code ?? -1,
            durationMs: payload.duration_ms ?? 0,
          })
        }
      } else if (payload.kind === 'error') {
        if (entry) {
          updateEntry(payload.session_id, {
            status: 'failed',
            stderr: (entry.stderr || '') + payload.data,
          })
        }
      }
    }).then((unlisten) => {
      unlistenStreamRef.current = unlisten
    })

    return () => {
      unlistenStreamRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])

  /** 自动滚动到底部 */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])

  /** 切换展开/折叠 */
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  if (!visible) return null

  return (
    <div
      className="h-full flex flex-col min-w-0"
      style={{ backgroundColor: colors.bgPrimary }}
    >
      {/* 工具栏 */}
      <div
        className="h-9 flex items-center justify-between px-3 border-b flex-shrink-0"
        style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke={colors.accent}
            strokeWidth="2"
          >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span className="text-xs font-medium" style={{ color: colors.text }}>
            输出
          </span>
          <span className="text-[10px]" style={{ color: colors.textDim }}>
            ({entries.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          {entries.length > 0 && (
            <button
              onClick={clearEntries}
              className="p-1.5 rounded hover:bg-white/10 transition-colors"
              style={{ color: colors.textDim }}
              title="清空输出"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 输出列表 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="text-4xl mb-3 opacity-30">📋</div>
            <p className="text-xs" style={{ color: colors.textDim }}>
              AI 执行的命令将显示在这里
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {entries.map((entry) => (
              <OutputEntryItem
                key={entry.id}
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                onToggle={() => toggleExpand(entry.id)}
                colors={colors}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 单条输出条目 */
function OutputEntryItem({
  entry,
  expanded,
  onToggle,
  colors,
}: {
  entry: OutputEntry
  expanded: boolean
  onToggle: () => void
  colors: ReturnType<typeof useThemeStore.getState>['colors']
}) {
  const statusColor = getStatusColor(entry.status, colors)
  const statusIcon = getStatusIcon(entry.status)
  const hasOutput = (entry.stdout && entry.stdout.length > 0) || (entry.stderr && entry.stderr.length > 0)

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        backgroundColor: colors.bgSecondary,
        borderColor: entry.status === 'failed' ? colors.red + '40' : colors.border,
      }}
    >
      {/* 命令行头 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black/5 transition-colors"
      >
        <span className="text-[10px]" style={{ color: colors.textDim }}>
          {expanded ? '▼' : '▶'}
        </span>
        <span className="text-[10px]">{statusIcon}</span>
        <code
          className="text-[11px] font-mono flex-1 truncate"
          style={{ color: colors.accent }}
        >
          $ {entry.command}
        </code>
        <span className="text-[10px] flex-shrink-0" style={{ color: statusColor }}>
          {entry.status === 'running' && '执行中...'}
          {entry.status === 'success' && `✓ ${entry.durationMs}ms`}
          {entry.status === 'failed' && `✗ exit ${entry.exitCode}`}
          {entry.status === 'backgrounded' && '🔄 后台运行'}
        </span>
      </button>

      {/* 展开后的输出 */}
      {expanded && hasOutput && (
        <div className="border-t" style={{ borderColor: colors.border }}>
          {entry.stdout && (
            <pre
              className="px-3 py-2 text-[11px] font-mono whitespace-pre-wrap overflow-x-auto"
              style={{ color: colors.text, backgroundColor: colors.bgPrimary }}
            >
              {entry.stdout}
            </pre>
          )}
          {entry.stderr && (
            <pre
              className="px-3 py-2 text-[11px] font-mono whitespace-pre-wrap overflow-x-auto border-t"
              style={{ color: colors.red, backgroundColor: colors.bgPrimary, borderColor: colors.border }}
            >
              {entry.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function getStatusColor(status: OutputStatus, colors: ReturnType<typeof useThemeStore.getState>['colors']): string {
  switch (status) {
    case 'running':
      return colors.yellow
    case 'success':
      return colors.green
    case 'failed':
      return colors.red
    case 'backgrounded':
      return colors.accent
    default:
      return colors.textDim
  }
}

function getStatusIcon(status: OutputStatus): string {
  switch (status) {
    case 'running':
      return '⏳'
    case 'success':
      return '✅'
    case 'failed':
      return '❌'
    case 'backgrounded':
      return '🔄'
    default:
      return '📋'
  }
}
