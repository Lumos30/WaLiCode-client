/**
 * OutputPanel — IntelliJ IDEA "Run" 工具窗口风格的纯文本控制台
 *
 * 特性：
 * - 纯文本逐行渲染，不做结构化解析/折叠，信息不丢失
 * - ANSI 颜色支持
 * - 工具栏：清空、滚动锁定、自动滚动到底部
 * - 左侧 Gutter 显示行号
 * - 命令标题行（$ command）+ 输出区 + 退出码行
 *
 * 数据来源：
 * 1. RightSidebar onStep 回调 → outputStore（主要数据源，tool_result SSE 事件）
 * 2. Tauri Event "shell-stream" — 流式命令执行输出（备用）
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useOutputStore } from '../stores/outputStore'
import type { StreamEvent } from '../types/stream'

interface OutputPanelProps {
  /** 是否可见 */
  visible?: boolean
}

// ─── ANSI 解析 ─────────────────────────────────────────────

interface AnsiSegment {
  text: string
  bold: boolean
  color?: string
  bgColor?: string
}

/** 简易 ANSI 转义码解析器 */
function parseAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  const re = /\x1b\[(\d+(?:;\d+)*)m([^\x1b]*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  const current: AnsiSegment = { text: '', bold: false }

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ ...current, text: text.slice(lastIndex, match.index) })
    }
    const codes = match[1].split(';').map(Number)
    applySgr(codes, current)
    lastIndex = match.index + match[0].length + (match[2]?.length || 0)
    if (match[2]) {
      segments.push({ ...current, text: match[2] })
    }
  }
  if (lastIndex < text.length) {
    segments.push({ ...current, text: text.slice(lastIndex) })
  }

  return segments.filter((s) => s.text.length > 0)
}

function applySgr(codes: number[], target: AnsiSegment) {
  for (const code of codes) {
    switch (code) {
      case 0: target.bold = false; target.color = undefined; target.bgColor = undefined; break
      case 1: target.bold = true; break
      case 31: target.color = '#f87171'; break
      case 32: target.color = '#4ade80'; break
      case 33: target.color = '#facc15'; break
      case 34: target.color = '#60a5fa'; break
      case 35: target.color = '#c084fc'; break
      case 36: target.color = '#22d3ee'; break
      case 37: target.color = '#e5e7eb'; break
      case 90: target.color = '#6b7280'; break
      case 91: target.color = '#ef4444'; break
      case 92: target.color = '#22c55e'; break
      case 93: target.color = '#eab308'; break
      case 94: target.color = '#3b82f6'; break
      case 95: target.color = '#a855f7'; break
      case 96: target.color = '#06b6d4'; break
      case 97: target.color = '#f3f4f6'; break
    }
  }
}

// ─── 主组件 ──────────────────────────────────────────────────

export function OutputPanel({ visible = true }: OutputPanelProps) {
  const { colors } = useThemeStore()
  const { entries, updateEntry, clearEntries } = useOutputStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollLocked, setScrollLocked] = useState(false)
  const unlistenStreamRef = useRef<UnlistenFn | null>(null)

  /** 监听 shell-stream 事件（备用数据源） */
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

  /** 自动滚动到底部（除非锁定） */
  useEffect(() => {
    if (!scrollLocked && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries, scrollLocked])

  /** 检测用户手动滚动到顶部 → 自动锁定 */
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    // 距离底部超过 40px 视为锁定
    setScrollLocked(scrollHeight - scrollTop - clientHeight > 40)
  }, [])

  /** 合并所有条目的纯文本内容，生成连续控制台输出 */
  const consoleLines = useMemo(() => {
    const lines: { text: string; isCommand: boolean; isStatus: boolean; entryId: string }[] = []
    for (const entry of entries) {
      // 命令行
      lines.push({ text: `$ ${entry.command}`, isCommand: true, isStatus: false, entryId: entry.id })
      // stdout
      if (entry.stdout) {
        for (const line of entry.stdout.split('\n')) {
          lines.push({ text: line, isCommand: false, isStatus: false, entryId: entry.id })
        }
      }
      // stderr
      if (entry.stderr) {
        for (const line of entry.stderr.split('\n')) {
          lines.push({ text: line, isCommand: false, isStatus: false, entryId: entry.id })
        }
      }
      // 结束状态行
      if (entry.status === 'success' || entry.status === 'failed') {
        const exitInfo = entry.exitCode !== null ? ` (exit ${entry.exitCode})` : ''
        const duration = entry.durationMs !== null ? ` ${entry.durationMs}ms` : ''
        lines.push({
          text: entry.status === 'success'
            ? `✓ Process finished${exitInfo}${duration}`
            : `✕ Process finished${exitInfo}${duration}`,
          isCommand: false,
          isStatus: true,
          entryId: entry.id,
        })
        // 空行分隔不同命令
        lines.push({ text: '', isCommand: false, isStatus: false, entryId: entry.id })
      } else if (entry.status === 'running') {
        lines.push({
          text: '⏳ Running...',
          isCommand: false,
          isStatus: true,
          entryId: entry.id,
        })
      }
    }
    return lines
  }, [entries])

  if (!visible) return null

  return (
    <div
      className="h-full flex flex-col min-w-0"
      style={{ backgroundColor: colors.bgPrimary }}
    >
      {/* IntelliJ 风格工具栏 */}
      <div
        className="h-7 flex items-center justify-between px-2 border-b flex-shrink-0 select-none"
        style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}
      >
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke={colors.textDim} strokeWidth="1.5">
            <rect x="1" y="2" width="14" height="12" rx="1" />
            <polyline points="4 6 7 9 4 12" />
            <line x1="8" y1="12" x2="12" y2="12" />
          </svg>
          <span className="text-[11px] font-medium" style={{ color: colors.text }}>
            输出
          </span>
          {entries.length > 0 && (
            <span className="text-[10px] px-1 rounded" style={{ backgroundColor: colors.bgTertiary, color: colors.textDim }}>
              {entries.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {/* 滚动锁定按钮 */}
          <button
            onClick={() => setScrollLocked(!scrollLocked)}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: scrollLocked ? colors.accent : colors.textDim }}
            title={scrollLocked ? '解锁自动滚动' : '锁定自动滚动'}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              {scrollLocked ? (
                <>
                  <line x1="2" y1="2" x2="14" y2="14" />
                  <path d="M6 3h7v7" />
                </>
              ) : (
                <path d="M3 13h7V6M10 3H3v7" />
              )}
            </svg>
          </button>
          {/* 清空按钮 */}
          {entries.length > 0 && (
            <button
              onClick={clearEntries}
              className="p-1 rounded hover:bg-white/10 transition-colors"
              style={{ color: colors.textDim }}
              title="清空所有输出"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="6" />
                <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 控制台输出区 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-auto font-mono text-[12px] leading-[1.5]"
        style={{ backgroundColor: colors.bgPrimary }}
      >
        {consoleLines.length === 0 ? (
          <EmptyState colors={colors} />
        ) : (
          <div className="py-1">
            {consoleLines.map((line, idx) => (
              <ConsoleLine
                key={`${line.entryId}-${idx}`}
                line={line}
                lineNum={idx + 1}
                colors={colors}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 空状态 ──────────────────────────────────────────────────

function EmptyState({ colors }: { colors: ReturnType<typeof useThemeStore.getState>['colors'] }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 opacity-30">
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke={colors.textDim} strokeWidth="1.5">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
      <p className="text-[11px]" style={{ color: colors.textDim }}>
        AI 执行的命令输出将显示在这里
      </p>
    </div>
  )
}

// ─── 单行控制台输出 ──────────────────────────────────────────

function ConsoleLine({
  line,
  lineNum,
  colors,
}: {
  line: { text: string; isCommand: boolean; isStatus: boolean; entryId: string }
  lineNum: number
  colors: ReturnType<typeof useThemeStore.getState>['colors']
}) {
  if (line.text === '' && !line.isCommand && !line.isStatus) {
    return <div className="h-[18px]" />
  }

  // 命令行：蓝色高亮
  if (line.isCommand) {
    return (
      <div className="flex hover:bg-white/[0.03]">
        <span
          className="w-10 flex-shrink-0 text-right pr-2 select-none text-[10px] leading-[18px]"
          style={{ color: colors.textDim + '60' }}
        >
          {lineNum}
        </span>
        <span className="whitespace-pre" style={{ color: colors.accent, fontWeight: 500 }}>
          {line.text}
        </span>
      </div>
    )
  }

  // 状态行
  if (line.isStatus) {
    const isSuccess = line.text.startsWith('✓')
    return (
      <div className="flex hover:bg-white/[0.03]">
        <span
          className="w-10 flex-shrink-0 text-right pr-2 select-none text-[10px] leading-[18px]"
          style={{ color: colors.textDim + '60' }}
        >
          {lineNum}
        </span>
        <span
          className="whitespace-pre"
          style={{ color: isSuccess ? colors.green : colors.red, fontWeight: 500 }}
        >
          {line.text}
        </span>
      </div>
    )
  }

  // 普通输出行：ANSI 解析渲染
  return (
    <div className="flex hover:bg-white/[0.03]">
      <span
        className="w-10 flex-shrink-0 text-right pr-2 select-none text-[10px] leading-[18px]"
        style={{ color: colors.textDim + '60' }}
      >
        {lineNum}
      </span>
      <span className="whitespace-pre">
        <AnsiText text={line.text} colors={colors} />
      </span>
    </div>
  )
}

// ─── ANSI 文本渲染组件 ──────────────────────────────────────

function AnsiText({ text, colors }: { text: string; colors: ReturnType<typeof useThemeStore.getState>['colors'] }) {
  const segments = useMemo(() => parseAnsi(text), [text])

  if (segments.length === 0) {
    return <span style={{ color: colors.text }}>{text}</span>
  }

  return (
    <>
      {segments.map((seg, i) => (
        <span
          key={i}
          style={{
            fontWeight: seg.bold ? 700 : 400,
            color: seg.color || colors.text,
            backgroundColor: seg.bgColor,
          }}
        >
          {seg.text}
        </span>
      ))}
    </>
  )
}
