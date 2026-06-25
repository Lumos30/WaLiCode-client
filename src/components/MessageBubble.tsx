import React, { memo, useState, useRef, useMemo } from 'react'
import { useThemeStore } from '../stores/themeStore'
import type { AgentMessage } from '../types'
import type { ReActStep } from '../api/agent'
import { SessionSummaryCard } from './SessionSummaryCard'
import { TypewriterRenderer } from './TypewriterRenderer'
import { MessageActionMenu } from './MessageActionMenu'
import { CollapsibleContent } from './CollapsibleContent'
import { useAiPatchStore } from '../stores/aiPatchStore'
import {
  MarkdownContent, ThinkingBlock, splitThinkTags, formatTime as sharedFormatTime,
  CopyButton as SharedCopyButton, STEP_COLORS, groupToolSteps,
  getToolIconInfo, ToolGroup, formatDuration, classifyTool,
  ToolCallView
} from './MessageBubbleShared'

function ThinkingStepView({ step, colors, compact }: { step: ReActStep; colors: ReturnType<typeof useThemeStore.getState>['colors']; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded group/think hover:bg-black/5 transition-colors min-w-0">
        <svg className="w-3 h-3 flex-shrink-0" style={{ color: STEP_COLORS.thinking, opacity: 0.7 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><path d="M9 21h6"/>
        </svg>
        <span className="text-[10px] italic truncate flex-1 min-w-0" style={{ color: colors.textDim }}>{step.content || '思考中...'}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: `${STEP_COLORS.thinking}08`, border: `1px solid ${STEP_COLORS.thinking}20` }}>
      <svg className="w-3.5 h-3.5 flex-shrink-0 animate-pulse" style={{ color: STEP_COLORS.thinking }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><path d="M9 21h6"/>
      </svg>
      <span className="text-[11px]" style={{ color: colors.textSecondary }}>{step.content || '思考中...'}</span>
    </div>
  )
}

// ===== ProcessTimeline 辅助函数 =====

/** 获取工具对应的 emoji 图标 */
// getToolIcon 已废弃，统一使用 getToolIconInfo（从 MessageBubbleShared 导入）

/** 生成折叠状态的语义摘要文本 */
// buildCollapsedSummary 保留用于未来扩展（collapsed 模式详细摘要）
// function buildCollapsedSummary(groups: ToolGroup[]): string {
//   return groups.map(g => {
//     const icon = getToolIcon(g.toolName)
//     const count = g.steps.length
//     if (count > 1) {
//       return `${icon} ${g.label} ×${count}`
//     }
//     return `${icon} ${g.label}`
//   }).join(' · ')
// }

// ===== ToolGroupView 组件（expanded + compact 模式，在 CategoryGroupView 内部使用）=====
const ToolGroupView = memo(function ToolGroupView({ group, colors, compact }: {
  group: ToolGroup
  colors: ReturnType<typeof useThemeStore.getState>['colors']
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const toolInfo = getToolIconInfo(group.toolName)
  const total = group.steps.length
  const hasFail = group.failCount > 0
  const allDone = group.steps.every(s => s.status !== 'in_progress')
  const anyInProgress = group.steps.some(s => s.status === 'in_progress')

  // 从第一个 step 的 params 中提取副标题（路径/命令摘要）
  const subTitle = useMemo(() => {
    const step = group.steps[0]
    if (!step) return ''
    const params = step.toolParams || ''
    const toolName = step.toolName || ''
    
    // 尝试提取文件路径
    if (params.trimStart().startsWith('{')) {
      try {
        const p = JSON.parse(params)
        const fp = p.file || p.path || p.filePath || p.filename || p.command || p.cmd
        if (fp) return String(fp)
      } catch {}
    }
    // 正则提取路径
    const pathMatch = params.match(/['"]?([\w./-]+\.[\w]+)['"]?/)
    if (pathMatch) return pathMatch[1]
    // SSH 命令取第一行
    if (toolName.toLowerCase().includes('ssh') || toolName.toLowerCase().includes('exec')) {
      return params.trim().split('\n')[0].substring(0, 80)
    }
    return ''
  }, [group.steps])

  const statusText = anyInProgress
    ? `执行中…`
    : hasFail
      ? `${group.failCount} 失败`
      : allDone ? '完成' : '等待中'

  const statusDot = anyInProgress
    ? (<span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: '#f59e0b' }} />)
    : hasFail
      ? (<span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#ef4444' }} />)
      : allDone
        ? (<svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="#22c55e"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>)
        : null

  // 紧凑模式（expanded 内部使用）：单行无背景
  if (compact) {
    return (
      <div className="min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-black/5 transition-colors min-w-0"
        >
          <span className="flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0" style={{ backgroundColor: toolInfo.bgColor, color: toolInfo.color }}>{toolInfo.icon}</span>
          <span className="text-[11px] font-medium truncate flex-1 min-w-0" style={{ color: colors.text }}>
            {group.label}
          </span>
          {total > 1 && (
            <span className="text-[10px] flex-shrink-0 px-1 rounded" style={{ backgroundColor: `${toolInfo.bgColor}`, color: toolInfo.color }}>×{total}</span>
          )}
          <span className="text-[9px] flex-shrink-0" style={{ color: hasFail ? '#ef4444' : colors.textDim }}>{statusText}</span>
          <svg className={`w-3 h-3 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {expanded && (
          <div className="ml-3 mt-0.5 space-y-0.5">
            {group.steps.map((step, i) => (
              <ToolCallView key={i} step={step} colors={colors} compact />
            ))}
          </div>
        )}
      </div>
    )
  }
  // ===== 标准模式：Android 风格圆角卡片 =====
  return (
    <div className="mb-1 min-w-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all hover:shadow-sm group min-w-0 text-left"
        style={{
          backgroundColor: `${colors.bgSecondary}90`,
          border: `1px solid ${colors.border}30`,
        }}
      >
        {/* 图标 */}
        <div className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 transition-all group-hover:brightness-110 shadow-sm" style={{ backgroundColor: toolInfo.bgColor, color: toolInfo.color }}>
          {anyInProgress ? (
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          ) : toolInfo.icon}
        </div>

        {/* 主标题 + 副标题 */}
        <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-semibold truncate" style={{ color: colors.text }}>
              {toolInfo.label}{subTitle ? ` ${group.label}` : group.label}
            </span>
          </div>
          {subTitle && (
            <span className="text-[11px] font-mono truncate mt-0.5 opacity-70" style={{ color: colors.textSecondary }} title={subTitle}>
              {subTitle}
            </span>
          )}
        </div>

        {/* 状态 + 展开 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {statusDot}
          <span className="text-[10px] shrink-0" style={{ color: hasFail ? '#ef4444' : colors.textDim }}>
            {total > 1 ? `×${total}` : ''}
          </span>
          <svg className={`w-3.5 h-3.5 transition-transform shrink-0 opacity-0 group-hover:opacity-100 ${expanded ? '!opacity-100 rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* 展开内容：左侧渐变竖线 + 圆角内容区 */}
      {expanded && (
        <div className="relative ml-[15px] pl-5 py-2 mt-0.5">
          {/* 左侧竖线 */}
          <div className="absolute top-0 left-[-1px] w-[2px] h-full rounded-full" style={{
            background: `linear-gradient(to bottom, ${toolInfo.color}40, transparent)`,
          }} />
          {/* 内容区 */}
          <div className="space-y-1.5">
            {group.steps.map((step, i) => (
              <ToolCallView key={i} step={step} colors={colors} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

// ===== ToolCallCard — 多消息流专用，工具调用卡片 =====
function getToolIcon(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('read') || lower.includes('list') || lower.includes('file') || lower.includes('local')) return '📄'
  if (lower.includes('write') || lower.includes('edit') || lower.includes('create') || lower.includes('code')) return '✏️'
  if (lower.includes('exec') || lower.includes('command') || lower.includes('compile') || lower.includes('ssh')) return '💻'
  if (lower.includes('search') || lower.includes('glob') || lower.includes('grep') || lower.includes('find')) return '🔍'
  if (lower.includes('delete') || lower.includes('remove')) return '🗑️'
  return '🔧'
}

function getToolLabel(name: string): string {
  const labels: Record<string, string> = {
    listLocalFiles: '浏览文件', readLocalFile: '读取文件',
    writeLocalFile: '写入文件', createLocalFile: '创建文件', deleteLocalFile: '删除文件',
    editLocalFile: '编辑文件', executeLocalCommand: '执行命令',
    executeSshCommand: 'SSH命令', compileProject: '编译项目',
    compileTests: '编译测试', runUnitTests: '运行测试',
    CodeEditTool: '代码编辑', applyEdit: '应用编辑',
  }
  return labels[name] || name
}

const ToolCallCard = memo(function ToolCallCard({ message, colors }: {
  message: AgentMessage; colors: ReturnType<typeof useThemeStore.getState>['colors']
}) {
  const [expanded, setExpanded] = useState(false)
  const toolName = message.toolName || 'unknown'
  const icon = getToolIcon(toolName)
  const label = getToolLabel(toolName)
  const status = message.status || 'in_progress'

  // 提取简短参数摘要（文件路径等）
  const paramSummary = (() => {
    const p = message.toolParams || ''
    // 尝试提取文件路径
    const pathMatch = p.match(/([\w./-]+\.[\w]+)/)
    if (pathMatch) return pathMatch[1]
    if (p.length > 50) return p.substring(0, 50) + '...'
    return p
  })()

  const isSuccess = status === 'success'
  const isFailure = status === 'failure'

  return (
    <div
      className="rounded-lg transition-all cursor-pointer select-none"
      style={{
        backgroundColor: expanded ? colors.bgSecondary : 'transparent',
        border: expanded ? `1px solid ${isFailure ? colors.red + '40' : colors.border}60` : '1px solid transparent',
      }}
      onClick={() => setExpanded(v => !v)}
    >
      {/* 折叠态：极简单行 */}
      <div className="flex items-center gap-1.5 px-2 py-0.5">
        <span className="text-[10px] shrink-0 opacity-70">{icon}</span>
        <span className="text-[11px] shrink-0" style={{ color: colors.textDim }}>{label}</span>
        {paramSummary && (
          <span className="text-[10px] truncate max-w-[200px] font-mono" style={{ color: colors.textDim + '90' }}>{paramSummary}</span>
        )}
        {/* 状态：仅用颜色小圆点，无转圈 */}
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {isSuccess && (
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#4ade80' }} />
          )}
          {isFailure && (
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.red }} />
          )}
          {'in_progress' === status && (
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent + '60' }} />
          )}
          <svg className={`w-2.5 h-2.5 transition-transform ${expanded ? 'rotate-180' : ''}`} style={{ color: colors.textDim + '60' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>
      {/* 展开态：参数 + 结果 */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {message.toolParams && (
            <div>
              <div className="text-[10px] mb-0.5" style={{ color: colors.textDim }}>参数</div>
              <pre className="text-[11px] p-2 rounded overflow-x-auto max-h-32" style={{ backgroundColor: colors.bgPrimary, color: colors.text }}>{message.toolParams}</pre>
            </div>
          )}
          {message.toolResult && (
            <div>
              <div className="text-[10px] mb-0.5" style={{ color: colors.textDim }}>结果</div>
              <pre className="text-[11px] p-2 rounded overflow-x-auto max-h-40" style={{ backgroundColor: colors.bgPrimary, color: isFailure ? colors.red : colors.text }}>{message.toolResult.length > 2000 ? message.toolResult.substring(0, 2000) + '\n...(truncated)' : message.toolResult}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// ===== ProcessTimeline（从 RightSidebar 迁移）=====
// 三级展开模式
// 'collapsed' — 摘要单行
// 'compact' — 紧凑模式（单行无背景），失败项高亮
// 'expanded' — 完整展开
type ExpandMode = 'collapsed' | 'compact' | 'expanded'

function ProcessTimeline({ steps, colors, isStreaming, isLoading }: {
  steps: ReActStep[]
  colors: ReturnType<typeof useThemeStore.getState>['colors']
  isStreaming?: boolean
  isLoading?: boolean
}) {
  const processSteps = steps.filter(s => s.stepType !== 'result')
  const allDone = processSteps.every(s => s.status !== 'in_progress')
  // 三级展开模式：collapsed → compact → expanded
  const [expandMode, setExpandMode] = useState<ExpandMode>('collapsed')
  // 仅显示失败筛选
  const [showFailuresOnly, setShowFailuresOnly] = useState(false)
  // 追踪流式状态跳变
  const prevStreamingRef = useRef(isStreaming || isLoading)
  // 追踪用户是否手动操作过
  const userToggledRef = useRef(false)
  // 是否已经触发过自动折叠
  const autoCollapsedRef = useRef(false)

  // 流式/加载中 → compact（显示进度但不占太多空间）
  // ⚠️ 仅对本消息自身的流式状态响应，已完成的旧消息不受全局 isLoading 影响
  React.useEffect(() => {
    if (processSteps.length === 0) return
    const hasActiveSteps = processSteps.some(s => s.status === 'in_progress')
    if ((isStreaming || (isLoading && hasActiveSteps)) && expandMode === 'collapsed' && !userToggledRef.current) {
      setExpandMode('compact')
      autoCollapsedRef.current = false
    }
  }, [isStreaming, isLoading, processSteps])

  // 核心自动折叠：检测 isStreaming||isLoading 从 true→false 的跳变
  // 有文件变更时 → 折叠到 compact（保留变更可见性）+ 延迟 3s
  // 无文件变更时 → 抝叠到 collapsed + 延迟 1.5s
  // ⚠️ 仅对本消息自身的流式状态响应，忽略全局 isLoading 对已完成消息的影响
  React.useEffect(() => {
    if (processSteps.length === 0) return
    const hasActiveSteps = processSteps.some(s => s.status === 'in_progress')
    const wasStreaming = prevStreamingRef.current
    const nowStreaming = isStreaming || (isLoading && hasActiveSteps)
    prevStreamingRef.current = nowStreaming
    if (wasStreaming && !nowStreaming && allDone && !userToggledRef.current && !autoCollapsedRef.current) {
      // 以 aiPatchStore 中是否有预览数据来判断是否有文件变更，而非依赖工具名
      const storePreviews = useAiPatchStore.getState().previews
      const hasFileEdits = storePreviews.length > 0
      const targetMode: ExpandMode = hasFileEdits ? 'compact' : 'collapsed'
      const delay = hasFileEdits ? 3000 : 1500
      const timer = setTimeout(() => {
        setExpandMode(targetMode)
        autoCollapsedRef.current = true
      }, delay)
      return () => clearTimeout(timer)
    }
  }, [allDone, isStreaming, isLoading, processSteps])

  // ⚠️ Hook 规则：所有 Hook 必须在条件 return 之前调用
  // processSteps 为空时直接返回 null，但 Hook 数量必须与上一次渲染一致
  const toolSteps = processSteps.filter(s => s.stepType === 'tool_call')
  const thinkingSteps = processSteps.filter(s => s.stepType === 'thinking')
  const toolCount = toolSteps.length
  const thinkingCount = thinkingSteps.length
  const successCount = processSteps.filter(s => s.status === 'success').length
  const failCount = processSteps.filter(s => s.status === 'failure').length
  const progressPercent = processSteps.length > 0
    ? Math.round((successCount + failCount) / processSteps.length * 100)
    : 100
  const progressColor = allDone ? (failCount > 0 ? '#ef4444' : '#22c55e') : '#ef4444'

  // 工具分组
  const toolGroups = groupToolSteps(toolSteps)
  // 紧凑模式：完成态 >6 步骤
  const useCompactMode = expandMode === 'compact' || (!isStreaming && !isLoading && allDone && processSteps.length > 6 && expandMode === 'expanded')

  // 筛选后的步骤（仅显示失败时）
  const filteredToolGroups = showFailuresOnly
    ? toolGroups.map(g => ({ ...g, steps: g.steps.filter(s => s.status === 'failure') })).filter(g => g.steps.length > 0)
    : toolGroups
  const filteredThinkingSteps = showFailuresOnly ? [] : thinkingSteps

  // ⚠️ Hook 规则：useMemo 必须在条件 return 之前调用
  // ===== 工具分类汇总（用于 collapsed/compact 摘要头）=====
  const toolCategorySummary = useMemo(() => {
    if (processSteps.length === 0) return []
    const catMap = new Map<ReturnType<typeof classifyTool>, { label: string; color: string; count: number }>()
    for (const group of toolGroups) {
      const type = classifyTool(group.toolName)
      const info = getToolIconInfo(group.toolName)
      const existing = catMap.get(type)
      if (existing) {
        existing.count += group.steps.length
      } else {
        catMap.set(type, { label: info.label, color: info.color, count: group.steps.length })
      }
    }
    return Array.from(catMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([type, info]) => ({ type, ...info }))
  }, [toolGroups, processSteps])

  // ===== 按分类聚合工具组（expanded 模式使用）=====
  const categorizedToolGroups = useMemo(() => {
    if (processSteps.length === 0) return []
    const catMap = new Map<ReturnType<typeof classifyTool>, { label: string; color: string; bgColor: string; icon: React.ReactNode; groups: ToolGroup[]; totalSteps: number; successCount: number; failCount: number }>()
    for (const group of filteredToolGroups) {
      const type = classifyTool(group.toolName)
      const info = getToolIconInfo(group.toolName)
      const existing = catMap.get(type)
      if (existing) {
        existing.groups.push(group)
        existing.totalSteps += group.steps.length
        existing.successCount += group.successCount
        existing.failCount += group.failCount
      } else {
        catMap.set(type, {
          label: info.label,
          color: info.color,
          bgColor: info.bgColor,
          icon: info.icon,
          groups: [group],
          totalSteps: group.steps.length,
          successCount: group.successCount,
          failCount: group.failCount,
        })
      }
    }
    return Array.from(catMap.entries())
      .sort((a, b) => b[1].totalSteps - a[1].totalSteps)
      .map(([type, info]) => ({ type, ...info }))
  }, [filteredToolGroups, processSteps])

  // ⚠️ Hook 规则：所有 Hook 必须在条件 return 之前调用
  // processSteps 为空时直接返回 null，但 Hook 数量必须与上一次渲染一致
  if (processSteps.length === 0) return null

  // 循环切换展开模式：collapsed → compact → expanded → collapsed
  const cycleExpandMode = () => {
    userToggledRef.current = true
    setExpandMode(prev => prev === 'collapsed' ? 'compact' : prev === 'compact' ? 'expanded' : 'collapsed')
  }

  // ===== Cursor / Android 风格摘要行（collapsed + compact）=====
  const isCollapsedOrCompact = expandMode === 'collapsed' || expandMode === 'compact'

  return (
    <div className="mb-2 rounded-xl overflow-hidden min-w-0" style={{
      border: isCollapsedOrCompact ? 'none' : `1px solid ${colors.border}40`,
      backgroundColor: isCollapsedOrCompact ? 'transparent' : `${colors.bgSecondary}60`,
    }}>
      {isCollapsedOrCompact ? (
        /* ===== 分类汇总 + 可折叠卡片列表 ===== */
        <div className="space-y-1">
          {/* 摘要头：图标 + 统计 + 分类标签 + 思考 + 耗时 */}
          <div
            onClick={cycleExpandMode}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-black/[0.04] transition-colors min-w-0 group"
          >
            {/* 🔧 图标 */}
            <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>

            {/* 核心统计：工具数 · 消息总数 · 状态 */}
            <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: colors.text }}>
              {toolCount} 工具
            </span>

            {/* 总消息数（工具+思考+其他）*/}
            <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: colors.textSecondary }}>
              · {processSteps.length} 条消息
            </span>

            {/* 完成状态 */}
            {allDone && processSteps.length > 0 && (
              <span className="text-[10px] flex-shrink-0 font-medium" style={{ color: progressColor }}>
                ✓ {successCount}/{processSteps.length}
              </span>
            )}
            {!allDone && (
              <span className="text-[10px] flex-shrink-0 animate-pulse" style={{ color: '#f59e0b' }}>
                ● 处理中
              </span>
            )}

            {/* 分隔 + 分类汇总标签 */}
            <div className="w-px h-3 flex-shrink-0" style={{ backgroundColor: `${colors.border}40` }} />
            <div className="flex items-center gap-1 flex-wrap min-w-0">
              {toolCategorySummary.slice(0, expandMode === 'collapsed' ? 4 : 8).map((cat) => (
                <span key={cat.type} className="text-[10px] px-1.5 py-0 rounded-full flex-shrink-0 font-medium whitespace-nowrap" style={{
                  backgroundColor: `${cat.color}12`,
                  color: cat.color,
                  border: `1px solid ${cat.color}25`,
                }}>
                  {cat.label}×{cat.count}
                </span>
              ))}
              {toolCategorySummary.length > (expandMode === 'collapsed' ? 4 : 8) && (
                <span className="text-[9px] flex-shrink-0 whitespace-nowrap" style={{ color: colors.textDim }}>
                  +{toolCategorySummary.length - (expandMode === 'collapsed' ? 4 : 8)}
                </span>
              )}
            </div>

            {/* 思考次数 */}
            {thinkingCount > 0 && (
              <span className="text-[10px] px-1.5 py-0 rounded-full flex-shrink-0 font-medium whitespace-nowrap" style={{
                backgroundColor: `${STEP_COLORS.thinking}12`,
                color: STEP_COLORS.thinking,
                border: `1px solid ${STEP_COLORS.thinking}25`,
              }}>
                🧠 {thinkingCount}
              </span>
            )}

            {/* 失败标记 */}
            {failCount > 0 && (
              <span className="text-[10px] text-red-500 flex-shrink-0 font-medium">✗ {failCount}</span>
            )}

            <div className="flex-1" />

            {/* 耗时 */}
            {allDone && toolGroups.length > 0 && (
              <span className="text-[9px] tabular-nums flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: colors.textDim }}>
                {formatDuration(toolGroups)}
              </span>
            )}

            {/* 展开箭头 */}
            <svg className={`w-3 h-3 transition-transform flex-shrink-0 ${expandMode === 'compact' ? 'rotate-90' : ''}`} style={{ color: colors.textDim, opacity: 0.5 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {/* compact 模式：按分类聚合展示工具卡片 */}
          {expandMode === 'compact' && (
            <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-150">
              {categorizedToolGroups.map((cat) => (
                <CategoryGroupView key={cat.type} category={cat} colors={colors} compact />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ===== 展开模式（标题 + 分类汇总 + 内容区）===== */
        <div>
          {/* 标题栏 */}
          <button
            onClick={cycleExpandMode}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-t-xl transition-colors hover:bg-black/5 min-w-0"
            style={{ borderBottom: `1px solid ${colors.border}30` }}
          >
            <svg className="w-3 h-3 transition-transform flex-shrink-0 rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span className="text-[12px] font-semibold flex-shrink-0" style={{ color: colors.text }}>过程详情</span>
            <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: colors.textSecondary }}>
              {toolCount} 工具 · {processSteps.length} 条消息
            </span>
            {/* 完成状态 */}
            {allDone && processSteps.length > 0 && (
              <span className="text-[10px] flex-shrink-0 font-medium" style={{ color: progressColor }}>
                ✓ {successCount}/{processSteps.length}
              </span>
            )}
            {!allDone && (
              <span className="text-[10px] flex-shrink-0 animate-pulse" style={{ color: '#f59e0b' }}>● 处理中</span>
            )}
            {/* 思考次数 */}
            {thinkingCount > 0 && (
              <span className="text-[10px] px-1.5 py-0 rounded-full flex-shrink-0 font-medium whitespace-nowrap" style={{
                backgroundColor: `${STEP_COLORS.thinking}12`,
                color: STEP_COLORS.thinking,
                border: `1px solid ${STEP_COLORS.thinking}25`,
              }}>
                🧠 {thinkingCount}
              </span>
            )}
            {/* 失败标记 */}
            {failCount > 0 && (
              <span className="text-[10px] text-red-500 flex-shrink-0 font-medium">✗ {failCount}</span>
            )}
            <div className="flex-1" />
            {/* 耗时 */}
            {allDone && toolGroups.length > 0 && (
              <span className="text-[9px] tabular-nums flex-shrink-0" style={{ color: colors.textDim }}>{formatDuration(toolGroups)}</span>
            )}
          </button>

          {/* 分类汇总标签栏 */}
          {toolCategorySummary.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap px-3 py-1.5" style={{ borderBottom: `1px solid ${colors.border}20`, backgroundColor: `${colors.bgTertiary}50` }}>
              {toolCategorySummary.map((cat) => (
                <span key={cat.type} className="text-[10px] px-1.5 py-0 rounded-full flex-shrink-0 font-medium whitespace-nowrap" style={{
                  backgroundColor: `${cat.color}12`,
                  color: cat.color,
                  border: `1px solid ${cat.color}25`,
                }}>
                  {cat.label}×{cat.count}
                </span>
              ))}
            </div>
          )}

          {/* 进度条 */}
          <div className="h-0.5 w-full overflow-hidden" style={{ backgroundColor: `${colors.border}30` }}>
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{
                width: `${progressPercent}%`,
                backgroundColor: progressColor,
                animation: allDone ? 'none' : 'progress-pulse 1.5s ease-in-out infinite',
              }}
            />
          </div>

          {/* 内容区 */}
          <div className="px-3 pb-3 pt-2 space-y-2 animate-in slide-in-from-top-1 duration-200">
            {/* 工具栏：仅显示失败筛选 */}
            {failCount > 0 && (
              <div className="flex items-center gap-2 px-1 py-1" style={{ borderBottom: `1px solid ${colors.border}20` }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowFailuresOnly(!showFailuresOnly) }}
                  className="text-[10px] px-2 py-0.5 rounded-md transition-colors flex items-center gap-1"
                  style={{
                    backgroundColor: showFailuresOnly ? 'rgba(239,68,68,0.12)' : `${colors.bgTertiary}`,
                    color: showFailuresOnly ? '#ef4444' : colors.textDim,
                    border: `1px solid ${showFailuresOnly ? 'rgba(239,68,68,0.25)' : colors.border}40`,
                  }}
                >
                  {showFailuresOnly ? '◉' : '○'} 仅显示失败 ({failCount})
                </button>
              </div>
            )}
            {/* 思考步骤 */}
            {filteredThinkingSteps.map((step, i) => (
              <ThinkingStepView key={`think-${i}`} step={step} colors={colors} compact={useCompactMode} />
            ))}
            {/* 按分类聚合的工具列表 */}
            {categorizedToolGroups.map((cat) => (
              <CategoryGroupView key={cat.type} category={cat} colors={colors} compact={useCompactMode} />
            ))}
            {showFailuresOnly && filteredToolGroups.length === 0 && (
              <div className="px-3 py-2 text-[11px]" style={{ color: colors.textDim }}>🎉 无失败步骤</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ===== CategoryGroupView — expanded 模式按分类聚合的工具列表 =====
const CategoryGroupView = memo(function CategoryGroupView({ category, colors, compact }: {
  category: {
    type: string
    label: string
    color: string
    bgColor: string
    icon: React.ReactNode
    groups: ToolGroup[]
    totalSteps: number
    successCount: number
    failCount: number
  }
  colors: ReturnType<typeof useThemeStore.getState>['colors']
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const allDone = category.groups.every(g => g.steps.every(s => s.status !== 'in_progress'))
  const anyInProgress = category.groups.some(g => g.steps.some(s => s.status === 'in_progress'))

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${category.color}20` }}>
      {/* 分类头：图标 + 标签名 + 计数 + 状态 + 展开/收起 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-2 transition-colors hover:bg-black/[0.03] min-w-0"
        style={{ backgroundColor: `${category.bgColor}` }}
      >
        <span className="flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0" style={{ backgroundColor: `${category.color}18`, color: category.color }}>
          {category.icon}
        </span>
        <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: category.color }}>
          {category.label}
        </span>
        <span className="text-[10px] tabular-nums px-1.5 py-0 rounded-full font-medium flex-shrink-0" style={{
          backgroundColor: `${category.color}12`,
          color: category.color,
          border: `1px solid ${category.color}25`,
        }}>
          ×{category.totalSteps}
        </span>
        {/* 完成状态 */}
        {allDone && (
          <span className="text-[10px] flex-shrink-0 font-medium" style={{ color: category.successCount === category.totalSteps ? '#22c55e' : '#ef4444' }}>
            ✓ {category.successCount}/{category.totalSteps}
          </span>
        )}
        {anyInProgress && (
          <span className="text-[10px] flex-shrink-0 animate-pulse" style={{ color: '#f59e0b' }}>● 执行中</span>
        )}
        {category.failCount > 0 && (
          <span className="text-[10px] text-red-500 flex-shrink-0 font-medium">✗ {category.failCount}</span>
        )}
        <div className="flex-1" />
        <svg className={`w-3 h-3 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} style={{ color: category.color, opacity: 0.6 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* 展开的工具列表 */}
      {expanded && (
        <div className="px-2 pb-2 pt-1 space-y-0.5" style={{ borderTop: `1px solid ${category.color}15` }}>
          {category.groups.map((group, i) => (
            <ToolGroupView key={`group-${i}`} group={group} colors={colors} compact={compact} />
          ))}
        </div>
      )}
    </div>
  )
})

// ===== 复制按钮（用户消息需特殊样式，AI 消息复用 SharedCopyButton） =====
function CopyButton({ text, isUser, colors }: { text: string; isUser: boolean; colors: ReturnType<typeof useThemeStore.getState>['colors'] }) {
  const [copied, setCopied] = useState(false)
  if (!isUser) return <SharedCopyButton text={text} colors={colors} />
  const handleCopy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  return (
    <button onClick={handleCopy} title="复制消息" className="rounded cursor-pointer transition-all hover:opacity-80 flex items-center justify-center" style={{ padding: '2px 4px', backgroundColor: 'rgba(0,0,0,0.18)', color: colors.userBubbleText, border: '1px solid rgba(0,0,0,0.15)' }}>
      {copied ? <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg> : <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>}
    </button>
  )
}

// ===== MessageBubble 主组件 =====
export const MessageBubble = memo(function MessageBubble({ message, isLoading, onEditRetry, hideHeader }: {
  message: AgentMessage
  isLoading?: boolean
  onEditRetry?: (messageId: string) => void
  hideHeader?: boolean
}) {
  const { colors } = useThemeStore()
  const isUser = message.role === 'user'
  const [isBookmarked, setIsBookmarked] = useState(false)

  // 对于有 steps 的 assistant 消息，复制按钮应使用最终展示内容
  const copyText = isUser ? message.content : (message.steps && message.steps.length > 0
    ? (message.steps.find(s => s.stepType === 'result' && s.content)?.content || message.content || '')
    : message.content || '')

  const timeStr = sharedFormatTime(message.timestamp)
  const timeBar = (
    <div className={`flex items-center gap-1.5 mt-1 ${isUser ? 'justify-end' : 'justify-start'}`} style={{ fontSize: '10px', color: colors.textDim }}>
      {isUser && copyText && <CopyButton text={copyText} isUser={isUser} colors={colors} />}
      {isUser && onEditRetry && (
        <button
          onClick={() => onEditRetry(message.id)}
          className="flex items-center gap-0.5 px-1 py-0.5 rounded transition-colors hover:opacity-70"
          style={{ color: colors.textDim }}
          title="编辑重发"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span>编辑</span>
        </button>
      )}
      <span>{timeStr}</span>
      {!isUser && copyText && <CopyButton text={copyText} isUser={false} colors={colors} />}
    </div>
  )

  // ══════════════════════════════════════════════════
  //  多消息流：根据 messageType 分流渲染
  // ══════════════════════════════════════════════════

  // ── 兼容旧数据：有 steps 的 assistant 消息（旧模式）──
  if (message.steps && message.steps.length > 0 && !message.messageType) {
    const resultStep = message.steps.find(s => s.stepType === 'result' && s.content !== undefined)
    const hasProcessSteps = message.steps.some(s => s.stepType !== 'result')
    const displayContent = resultStep?.content || message.content
    const isStreaming = !resultStep && message.content === ''

    const contentParts = displayContent ? splitThinkTags(displayContent) : []

    return (
      <div className="group/msg relative px-4 py-1.5 flex justify-start overflow-hidden">
        <div className="flex flex-col items-start max-w-[88%] min-w-0">
          <div className="absolute top-1 right-2 z-10">
            <MessageActionMenu
              isUser={false}
              isBookmarked={isBookmarked}
              onCopy={() => navigator.clipboard.writeText(copyText)}
              onQuote={() => {/* TODO */}}
              onRegenerate={() => {/* TODO */}}
              onToggleBookmark={() => setIsBookmarked(!isBookmarked)}
            />
          </div>
          {contentParts.length > 0 ? (
            <CollapsibleContent contentLength={displayContent?.length || 0} forceExpanded={isStreaming || isLoading}>
            <div className="px-3.5 py-2.5 text-[13px] leading-relaxed overflow-hidden min-w-0" style={{ backgroundColor: colors.bgTertiary, color: colors.text, borderRadius: '12px 12px 12px 2px', maxWidth: '100%' }}>
              {contentParts.map((part, idx) => {
                if (part.type === 'think') return <ThinkingBlock key={idx} content={part.content} isStreaming={part.isStreaming || false} />
                if (!part.content.trim()) return null
                if (isStreaming || (isLoading && part.isStreaming)) {
                  return <TypewriterRenderer key={idx} fullText={part.content} isLoading={isLoading || isStreaming} renderContent={(text) => <MarkdownContent content={text} colors={colors} />} />
                }
                return <MarkdownContent key={idx} content={part.content} colors={colors} />
              })}
            </div>
            </CollapsibleContent>
          ) : !resultStep && !displayContent ? (
            <div className="px-3.5 py-2.5 flex items-center gap-2" style={{ backgroundColor: colors.bgTertiary, borderRadius: '12px 12px 12px 2px' }}>
              <div className="relative w-14 h-5 overflow-hidden" style={{ flexShrink: 0 }}>
                <span className="absolute top-0.5 text-[14px]" style={{ animation: 'cat-run 2s infinite ease-in-out', display: 'inline-block' }}>🐱</span>
                <span className="absolute bottom-0 text-[6px]" style={{ color: colors.textDim, animation: 'pawprints 2s infinite ease-in-out', opacity: 0.4 }}>🐾</span>
              </div>
            </div>
          ) : null}
          {hasProcessSteps && <ProcessTimeline steps={message.steps} colors={colors} isStreaming={isStreaming} isLoading={isLoading} />}
          {message.changeSummary && <SessionSummaryCard summary={message.changeSummary} />}
          {timeBar}
        </div>
      </div>
    )
  }

  // ── 多消息流：messageType 分流 ──

  // tool_call 消息：仅渲染卡片内容（头部由外层 ToolGroupBlock 统一提供）
  // 单独渲染时（非分组模式）仍提供完整头部
  if (message.messageType === 'tool_call') {
    return (
      <div className="group/msg relative px-4 py-0.5 flex justify-start overflow-hidden">
        <div className="flex gap-2 max-w-[88%] min-w-0 w-full">
          {/* AI 头像 — 占位对齐，但不显示（由 ToolGroupBlock 提供唯一头部） */}
          <div className="w-7 shrink-0" />
          <div className="flex flex-col min-w-0 flex-1">
            <ToolCallCard message={message} colors={colors} />
          </div>
        </div>
      </div>
    )
  }

  // thinking 消息：折叠的思考块（带头像+名称+时间戳）
  if (message.messageType === 'thinking') {
    const isPlaceholder = message.content === '思考中...'
    if (isPlaceholder) {
      // 占位思考消息：显示带动画的提示行
      return (
        <div className="px-4 py-1.5 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: colors.accent + '20', border: `1px solid ${colors.accent}30` }}>
            <span className="text-[12px]">🤖</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>WaLiCode</span>
            {/* 来回跑的小猫动画 */}
            <div className="relative w-14 h-5 overflow-hidden" style={{ flexShrink: 0 }}>
              <span
                className="absolute top-0.5 text-[14px]"
                style={{
                  animation: 'cat-run 2s infinite ease-in-out',
                  display: 'inline-block',
                }}
              >🐱</span>
              {/* 小脚印 */}
              <span
                className="absolute bottom-0 text-[6px]"
                style={{
                  color: colors.textDim,
                  animation: 'pawprints 2s infinite ease-in-out',
                  opacity: 0.4,
                }}
              >🐾</span>
            </div>
            <span className="text-[11px]" style={{ color: colors.textDim }}>思考中...</span>
            <span className="text-[10px] ml-1" style={{ color: colors.textDim }}>{timeStr}</span>
          </div>
        </div>
      )
    }
    // 真实 thinking 内容：带完整头部
    return (
      <div className="group/msg relative px-4 py-1 flex justify-start overflow-hidden">
        <div className="flex gap-2 max-w-[88%] min-w-0">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: colors.accent + '20', border: `1px solid ${colors.accent}30` }}>
            <span className="text-[12px]">🤖</span>
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>WaLiCode</span>
              <span className="text-[10px]" style={{ color: colors.textDim }}>{timeStr}</span>
            </div>
            <ThinkingBlock content={message.content} isStreaming={message.status === 'in_progress'} />
          </div>
        </div>
      </div>
    )
  }

  // summary 消息：文件变更摘要（带头像+名称+时间戳）
  if (message.messageType === 'summary') {
    return (
      <div className="group/msg relative px-4 py-1 flex justify-start overflow-hidden">
        <div className="flex gap-2 max-w-[88%] min-w-0">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: colors.accent + '20', border: `1px solid ${colors.accent}30` }}>
            <span className="text-[12px]">🤖</span>
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>WaLiCode</span>
              <span className="text-[10px]" style={{ color: colors.textDim }}>{timeStr}</span>
            </div>
            {message.changeSummary && <SessionSummaryCard summary={message.changeSummary} />}
          </div>
        </div>
      </div>
    )
  }

  // error 消息（带头像+名称+时间戳）
  if (message.messageType === 'error') {
    return (
      <div className="group/msg relative px-4 py-1 flex justify-start overflow-hidden">
        <div className="flex gap-2 max-w-[88%] min-w-0">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: colors.accent + '20', border: `1px solid ${colors.accent}30` }}>
            <span className="text-[12px]">🤖</span>
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>WaLiCode</span>
              <span className="text-[10px]" style={{ color: colors.textDim }}>{timeStr}</span>
            </div>
            <div className="px-3.5 py-2.5 text-[13px] leading-relaxed" style={{ backgroundColor: `${colors.red}15`, color: colors.red, borderRadius: '12px 12px 12px 2px', border: `1px solid ${colors.red}30` }}>
              {message.content}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // text 消息（AI 文本回复）
  if (message.messageType === 'text' && !isUser) {
    const contentParts = message.content ? splitThinkTags(message.content) : []
    const isStreaming = isLoading && !message.content

    // 在 AiTurnBlock 中，头部已由外层渲染，此处只渲染内容气泡
    const headerEl = hideHeader ? null : (
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: colors.accent + '20', border: `1px solid ${colors.accent}30` }}>
        <span className="text-[12px]">🤖</span>
      </div>
    )
    const nameTimeEl = hideHeader ? null : (
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>WaLiCode</span>
        <span className="text-[10px]" style={{ color: colors.textDim }}>{timeStr}</span>
      </div>
    )

    return (
      <div className="group/msg relative overflow-hidden" style={hideHeader ? {} : { padding: '6px 16px' }}>
        <div className="flex gap-2 min-w-0" style={hideHeader ? {} : { maxWidth: '88%' }}>
          {headerEl}
          <div className="flex flex-col items-start min-w-0 flex-1">
            {nameTimeEl}
            <div className="relative">
              <div className="absolute top-1 right-2 z-10">
                <MessageActionMenu
                  isUser={false}
                  isBookmarked={isBookmarked}
                  onCopy={() => navigator.clipboard.writeText(message.content)}
                  onQuote={() => {/* TODO */}}
                  onRegenerate={() => {/* TODO */}}
                  onToggleBookmark={() => setIsBookmarked(!isBookmarked)}
                />
              </div>
              {contentParts.length > 0 ? (
                <CollapsibleContent contentLength={message.content?.length || 0} forceExpanded={isStreaming || isLoading}>
                <div className="px-3.5 py-2.5 text-[13px] leading-relaxed overflow-hidden min-w-0" style={{ backgroundColor: colors.bgTertiary, color: colors.text, borderRadius: hideHeader ? '8px' : '12px 12px 12px 2px', maxWidth: '100%' }}>
                  {contentParts.map((part, idx) => {
                    if (part.type === 'think') return <ThinkingBlock key={idx} content={part.content} isStreaming={part.isStreaming || false} />
                    if (!part.content.trim()) return null
                    if (isLoading && part.isStreaming) {
                      return <TypewriterRenderer key={idx} fullText={part.content} isLoading={isLoading} renderContent={(text) => <MarkdownContent content={text} colors={colors} />} />
                    }
                    return <MarkdownContent key={idx} content={part.content} colors={colors} />
                  })}
                </div>
                </CollapsibleContent>
              ) : (
                /* 流式加载指示器 */
                <div className="px-3.5 py-2.5 flex items-center gap-2" style={{ backgroundColor: colors.bgTertiary, borderRadius: '12px 12px 12px 2px' }}>
                  <div className="relative w-14 h-5 overflow-hidden" style={{ flexShrink: 0 }}>
                    <span className="absolute top-0.5 text-[14px]" style={{ animation: 'cat-run 2s infinite ease-in-out', display: 'inline-block' }}>🐱</span>
                    <span className="absolute bottom-0 text-[6px]" style={{ color: colors.textDim, animation: 'pawprints 2s infinite ease-in-out', opacity: 0.4 }}>🐾</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── 普通消息（用户 / 无 messageType 的默认 / 防御性兜底）──
  // 防御性处理：如果 messageType==='text' 但 role==='assistant' 却流落到了这里（理论上不应发生），强制用 AI 样式
  const _isAiFallback = message.messageType === 'text' && !isUser
  const contentParts = message.content ? splitThinkTags(message.content) : []
  const effectiveIsUser = isUser && !_isAiFallback

  return (
    <div className={`group/msg relative px-4 py-1.5 ${effectiveIsUser ? 'flex justify-end' : 'flex justify-start'} overflow-hidden`}>
      {/* AI 兜底：带头像+名称 */}
      {_isAiFallback ? (
        <div className="flex gap-2 max-w-[88%] min-w-0">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: colors.accent + '20', border: `1px solid ${colors.accent}30` }}>
            <span className="text-[12px]">🤖</span>
          </div>
          <div className="flex flex-col items-start min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>WaLiCode</span>
              <span className="text-[10px]" style={{ color: colors.textDim }}>{timeStr}</span>
            </div>
            <div className="relative">
              <div className="absolute top-1 right-2 z-10">
                <MessageActionMenu
                  isUser={false}
                  isBookmarked={isBookmarked}
                  onCopy={() => navigator.clipboard.writeText(message.content)}
                  onQuote={() => {/* TODO */}}
                  onRegenerate={() => {/* TODO */}}
                  onToggleBookmark={() => setIsBookmarked(!isBookmarked)}
                />
              </div>
              <div
                className="px-3.5 py-2.5 text-[13px] leading-relaxed overflow-hidden min-w-0"
                style={{ backgroundColor: colors.bgTertiary, color: colors.text, borderRadius: '12px 12px 12px 2px', maxWidth: '100%' }}
              >
                {contentParts.map((part, idx) => {
                  if (part.type === 'think') return <ThinkingBlock key={idx} content={part.content} isStreaming={part.isStreaming || false} />
                  if (!part.content.trim()) return null
                  return <MarkdownContent key={idx} content={part.content} colors={colors} />
                })}
              </div>
            </div>
            {timeBar}
          </div>
        </div>
      ) : (
        <div className={`flex flex-col ${effectiveIsUser ? 'items-end' : 'items-start'} max-w-[88%] min-w-0`}>
          {!effectiveIsUser && (
          <div className={`absolute top-1 ${effectiveIsUser ? 'left-2' : 'right-2'} z-10`}>
            <MessageActionMenu
              isUser={effectiveIsUser}
              isBookmarked={isBookmarked}
              onCopy={() => navigator.clipboard.writeText(message.content)}
              onEdit={effectiveIsUser && onEditRetry ? () => onEditRetry(message.id) : undefined}
              onQuote={() => {/* TODO */}}
              onRegenerate={!effectiveIsUser ? () => {/* TODO */} : undefined}
              onToggleBookmark={() => setIsBookmarked(!isBookmarked)}
            />
          </div>
          )}
          <div
            className="w-full px-3.5 py-2.5 text-[13px] leading-relaxed overflow-hidden"
            style={{
              backgroundColor: effectiveIsUser ? colors.userBubble : colors.bgTertiary,
              color: effectiveIsUser ? colors.userBubbleText : colors.text,
              borderRadius: effectiveIsUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              maxWidth: '100%',
            }}
          >
            {contentParts.map((part, idx) => {
              if (part.type === 'think') return <ThinkingBlock key={idx} content={part.content} isStreaming={part.isStreaming || false} />
              if (!part.content.trim()) return null
              if (effectiveIsUser) return <MarkdownContent key={idx} content={part.content} colors={colors} isUser />
              return <MarkdownContent key={idx} content={part.content} colors={colors} />
            })}
          </div>
          {timeBar}
        </div>
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.steps === nextProps.message.steps &&
    prevProps.message.messageType === nextProps.message.messageType &&
    prevProps.message.status === nextProps.message.status &&
    prevProps.message.toolResult === nextProps.message.toolResult &&
    prevProps.message.changeSummary === nextProps.message.changeSummary &&
    prevProps.isLoading === nextProps.isLoading
  )
})
