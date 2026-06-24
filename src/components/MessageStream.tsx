/**
 * MessageStream — 多消息流架构（方案 B）
 *
 * 将单条含 steps 的 assistant 消息拆分为多条虚拟消息，
 * 工具调用以行内卡片形式穿插在对话中，模拟 Cursor/Windsurf 交互风格。
 *
 * 排序：thinking → tool_group → text → changeSummary
 */
import { memo, useState, useMemo } from 'react'
import { useThemeStore } from '../stores/themeStore'
import type { AgentMessage } from '../types'
import type { ReActStep, ChangeSummary } from '../api/agent'
import { CollapsibleContent } from './CollapsibleContent'
import { TypewriterRenderer } from './TypewriterRenderer'
import { MessageActionMenu } from './MessageActionMenu'
import {
  ThinkingBlock,
  ToolCallView,
  MarkdownContent,
  CopyButton,
  formatTime,
  splitThinkTags,
  groupToolSteps,
  getToolIconInfo,
  ToolGroup,
} from './MessageBubbleShared'

// ═══════════════════════════════════════════════════════════════
//  虚拟消息类型
// ═══════════════════════════════════════════════════════════════

type StreamItemType =
  | { type: 'thinking'; step: ReActStep; index: number }
  | { type: 'tool_group'; group: ToolGroup; index: number }
  | { type: 'text'; content: string; isStreaming: boolean }
  | { type: 'summary'; summary: ChangeSummary }
  | { type: 'loading' }

/**
 * 将 steps + content + changeSummary 拆分为有序的虚拟消息流
 *
 * 排序规则（模拟 ReAct 执行时序）：
 *   thinking 步骤 → tool_call 分组 → result 文本 → changeSummary
 * 流式输出时：text 在最后且 isStreaming=true；完成后 text 为最终内容
 */
function buildStreamItems(
  steps: ReActStep[],
  content: string,
  changeSummary?: ChangeSummary,
  isLoading?: boolean
): StreamItemType[] {
  const items: StreamItemType[] = []
  const processSteps = steps.filter(s => s.stepType !== 'result')
  const resultStep = steps.find(s => s.stepType === 'result' && s.content !== undefined)
  const displayContent = resultStep?.content || content
  const isStreaming = !resultStep && content === ''

  // 1. 思考步骤
  const thinkingSteps = processSteps.filter(s => s.stepType === 'thinking')
  thinkingSteps.forEach((step, i) => {
    items.push({ type: 'thinking', step, index: i })
  })

  // 2. 工具调用分组（每组一条卡片消息）
  const toolSteps = processSteps.filter(s => s.stepType === 'tool_call')
  if (toolSteps.length > 0) {
    const groups = groupToolSteps(toolSteps)
    groups.forEach((group, i) => {
      items.push({ type: 'tool_group', group, index: i })
    })
  }

  // 3. AI 文本回复
  const contentParts = displayContent ? splitThinkTags(displayContent) : []
  const hasVisibleText = contentParts.some(p => p.type !== 'think' && p.content?.trim())
  if (hasVisibleText || isStreaming || isLoading) {
    items.push({ type: 'text', content: displayContent || '', isStreaming: isStreaming || !!isLoading })
  }

  // 4. 文件变更汇总
  if (changeSummary) {
    items.push({ type: 'summary', summary: changeSummary })
  }

  // 5. 纯加载态
  if (items.length === 0 && (isStreaming || isLoading)) {
    items.push({ type: 'loading' })
  }

  return items
}

// ═══════════════════════════════════════════════════════════════
//  子组件
// ═══════════════════════════════════════════════════════════════

/** 流式思考项 */
const StreamThinkingItem = memo(function StreamThinkingItem({
  step,
}: {
  step: ReActStep
}) {
  return (
    <div className="flex justify-start overflow-hidden min-w-0 py-[2px]">
      <div className="max-w-[88%] min-w-0">
        <ThinkingBlock content={step.content || ''} isStreaming={step.status === 'in_progress'} />
      </div>
    </div>
  )
})

/** 流式工具卡片项 — 单行圆角卡片，可展开详情 */
const StreamToolGroupItem = memo(function StreamToolGroupItem({
  group, colors,
}: {
  group: ToolGroup
  colors: ReturnType<typeof useThemeStore.getState>['colors']
}) {
  const [expanded, setExpanded] = useState(false)
  const toolInfo = getToolIconInfo(group.toolName)
  const total = group.steps.length
  const anyInProgress = group.steps.some(s => s.status === 'in_progress')
  const hasFail = group.failCount > 0
  const allDone = group.steps.every(s => s.status !== 'in_progress')

  const subTitle = useMemo(() => {
    const step = group.steps[0]
    if (!step) return ''
    const params = step.toolParams || ''
    const toolName = step.toolName || ''
    if (params.trimStart().startsWith('{')) {
      try {
        const p = JSON.parse(params)
        const fp = p.file || p.path || p.filePath || p.filename || p.command || p.cmd
        if (fp) return String(fp)
      } catch {}
    }
    const pathMatch = params.match(/['"]?([\w./-]+\.[\w]+)["']?/)
    if (pathMatch) return pathMatch[1]
    if (toolName.toLowerCase().includes('ssh') || toolName.toLowerCase().includes('exec')) {
      return params.trim().split('\n')[0].substring(0, 80)
    }
    return ''
  }, [group.steps])

  const statusDot = anyInProgress
    ? (<span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: '#f59e0b' }} />)
    : hasFail
      ? (<span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#ef4444' }} />)
      : allDone
        ? (<svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="#22c55e"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>)
        : null

  return (
    <div className="flex justify-start overflow-hidden min-w-0 py-[2px]">
      <div className="max-w-[88%] min-w-0 w-full">
        {/* 工具组卡片行 */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg transition-all group min-w-0 text-left"
          style={{
            backgroundColor: `${colors.bgSecondary}80`,
            border: `1px solid ${hasFail ? 'rgba(239,68,68,0.2)' : `${colors.border}20`}`,
          }}
        >
          {/* 图标 */}
          <div className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 shadow-sm" style={{ backgroundColor: toolInfo.bgColor, color: toolInfo.color }}>
            {anyInProgress ? (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            ) : toolInfo.icon}
          </div>
          {/* 标题 + 副标题 */}
          <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[12px] font-medium truncate" style={{ color: colors.text }}>{toolInfo.label}</span>
              {total > 1 && (
                <span className="text-[10px] px-1 rounded flex-shrink-0" style={{ backgroundColor: toolInfo.bgColor, color: toolInfo.color }}>×{total}</span>
              )}
            </div>
            {subTitle && (
              <span className="text-[10px] font-mono truncate mt-0.5 opacity-60" style={{ color: colors.textSecondary }} title={subTitle}>{subTitle}</span>
            )}
          </div>
          {/* 状态 + 展开箭头 */}
          <div className="flex items-center gap-1.5 shrink-0">
            {statusDot}
            <svg className={`w-3 h-3 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </button>

        {/* 展开详情 */}
        {expanded && (
          <div className="relative ml-[13px] pl-4 py-1.5 mt-0.5 space-y-1">
            <div className="absolute top-0 left-[-1px] w-[2px] h-full rounded-full" style={{
              background: `linear-gradient(to bottom, ${toolInfo.color}40, transparent)`,
            }} />
            {group.steps.map((step, i) => (
              <ToolCallView key={i} step={step} colors={colors} compact />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

/** 流式文本消息项 */
const StreamTextItem = memo(function StreamTextItem({
  content, isStreaming, isLoading, colors,
}: {
  content: string
  isStreaming: boolean
  isLoading?: boolean
  colors: ReturnType<typeof useThemeStore.getState>['colors']
}) {
  const contentParts = content ? splitThinkTags(content) : []

  return (
    <div className="flex justify-start overflow-hidden min-w-0 py-[2px]">
      <div className="flex flex-col items-start max-w-[88%] min-w-0">
        <CollapsibleContent contentLength={content.length} forceExpanded={isStreaming || isLoading}>
          <div
            className="px-3.5 py-2.5 text-[13px] leading-relaxed overflow-hidden min-w-0"
            style={{
              backgroundColor: colors.bgTertiary,
              color: colors.text,
              borderRadius: '12px 12px 12px 2px',
              maxWidth: '100%',
            }}
          >
            {contentParts.length > 0 ? (
              contentParts.map((part, idx) => {
                if (part.type === 'think') {
                  return <ThinkingBlock key={idx} content={part.content} isStreaming={part.isStreaming || false} />
                }
                if (!part.content.trim()) return null
                if (isStreaming || (isLoading && part.isStreaming)) {
                  return (
                    <TypewriterRenderer
                      key={idx}
                      fullText={part.content}
                      isLoading={isLoading || isStreaming}
                      renderContent={(text) => <MarkdownContent content={text} colors={colors} />}
                    />
                  )
                }
                return <MarkdownContent key={idx} content={part.content} colors={colors} />
              })
            ) : null}
            {/* Loading indicator when streaming */}
            {isLoading && (
              <span className="inline-flex gap-1 ml-1 align-middle">
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: colors.accent, animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: colors.accent, animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: colors.accent, animationDelay: '300ms' }} />
              </span>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </div>
  )
})

/** 流式汇总项 */
const StreamSummaryItem = memo(function StreamSummaryItem({
  summary, colors,
}: {
  summary: ChangeSummary
  colors: ReturnType<typeof useThemeStore.getState>['colors']
}) {
  const created = summary.created?.length || 0
  const modified = summary.modified?.length || 0
  const deleted = summary.deleted?.length || 0
  const total = created + modified + deleted

  if (total === 0) return null

  return (
    <div className="flex justify-start overflow-hidden min-w-0 py-[2px]">
      <div
        className="px-3 py-2 rounded-lg text-[11px] flex items-center gap-3"
        style={{
          backgroundColor: `${colors.bgSecondary}80`,
          border: `1px solid ${colors.border}30`,
          color: colors.textSecondary,
        }}
      >
        <span className="font-medium" style={{ color: colors.text }}>变更汇总</span>
        {created > 0 && <span className="text-green-500">+{created} 新建</span>}
        {modified > 0 && <span className="text-amber-500">~{modified} 修改</span>}
        {deleted > 0 && <span className="text-red-500">-{deleted} 删除</span>}
      </div>
    </div>
  )
})

/** 流式加载态 */
const StreamLoadingItem = memo(function StreamLoadingItem({
  colors,
}: {
  colors: ReturnType<typeof useThemeStore.getState>['colors']
}) {
  return (
    <div className="flex justify-start overflow-hidden min-w-0 py-[2px]">
      <div className="px-3.5 py-2.5 flex items-center gap-2" style={{ backgroundColor: colors.bgTertiary, borderRadius: '12px 12px 12px 2px' }}>
        <div className="relative w-14 h-5 overflow-hidden" style={{ flexShrink: 0 }}>
          <span className="absolute top-0.5 text-[14px]" style={{ animation: 'cat-run 2s infinite ease-in-out', display: 'inline-block' }}>🐱</span>
          <span className="absolute bottom-0 text-[6px]" style={{ color: colors.textDim, animation: 'pawprints 2s infinite ease-in-out', opacity: 0.4 }}>🐾</span>
        </div>
        <span className="text-[11px]" style={{ color: colors.textSecondary }}>思考中...</span>
      </div>
    </div>
  )
})

// ═══════════════════════════════════════════════════════════════
//  MessageStream 主组件
// ═══════════════════════════════════════════════════════════════

export const MessageStream = memo(function MessageStream({
  message, isLoading,
}: {
  message: AgentMessage
  isLoading?: boolean
}) {
  const { colors } = useThemeStore()
  const [isBookmarked, setIsBookmarked] = useState(false)

  const resultStep = message.steps?.find(s => s.stepType === 'result' && s.content !== undefined)
  const copyText = resultStep?.content || message.content || ''
  const timeStr = formatTime(message.timestamp)

  // 判断是否已完成（用于未来优化）
  // const isDone = !isLoading || !!resultStep || (message.content.length > 0 && !isLoading)

  // 构建虚拟消息流
  const streamItems = useMemo(() => {
    // steps 为空时，根据 content 和 isLoading 决定显示
    if (!message.steps || message.steps.length === 0) {
      if (isLoading && !message.content) {
        // 初始加载状态
        return [{ type: 'loading' as const }]
      }
      if (message.content) {
        // 有内容但没有 steps → 纯文本消息
        return [{ type: 'text' as const, content: message.content, isStreaming: isLoading || false }]
      }
      return []
    }
    return buildStreamItems(message.steps, message.content, message.changeSummary, isLoading)
  }, [message.steps, message.content, message.changeSummary, isLoading])

  // 时间栏
  const timeBar = (
    <div className="flex items-center gap-1.5 mt-1 justify-start" style={{ fontSize: '10px', color: colors.textDim }}>
      {copyText && <CopyButton text={copyText} colors={colors} />}
      <span>{timeStr}</span>
    </div>
  )

  // 空状态：非加载且无内容时不渲染
  if (streamItems.length === 0 && !isLoading) return null

  return (
    <div className="group/msg relative px-4 py-1.5 flex justify-start overflow-hidden">
      <div className="flex flex-col items-start max-w-[88%] min-w-0 w-full">
        {/* 浮动操作菜单 */}
        <div className="absolute top-1 right-2 z-10">
          <MessageActionMenu
            isUser={false}
            isBookmarked={isBookmarked}
            onCopy={() => navigator.clipboard.writeText(copyText)}
            onQuote={() => {}}
            onRegenerate={() => {}}
            onToggleBookmark={() => setIsBookmarked(!isBookmarked)}
          />
        </div>

        {/* 虚拟消息流渲染 */}
        <div className="space-y-0.5 w-full">
          {streamItems.map((item, idx) => {
            switch (item.type) {
              case 'thinking':
                return <StreamThinkingItem key={`think-${idx}`} step={item.step} />
              case 'tool_group':
                return <StreamToolGroupItem key={`tool-${idx}`} group={item.group} colors={colors} />
              case 'text':
                return <StreamTextItem key={`text-${idx}`} content={item.content} isStreaming={item.isStreaming} isLoading={isLoading} colors={colors} />
              case 'summary':
                return <StreamSummaryItem key={`summary-${idx}`} summary={item.summary} colors={colors} />
              case 'loading':
                return <StreamLoadingItem key={`loading-${idx}`} colors={colors} />
              default:
                return null
            }
          })}
        </div>

        {timeBar}
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.steps === nextProps.message.steps &&
    prevProps.message.changeSummary === nextProps.message.changeSummary &&
    prevProps.isLoading === nextProps.isLoading
  )
})
