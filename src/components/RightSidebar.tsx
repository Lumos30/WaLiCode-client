import React, { useRef, useEffect, useState } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { useAgentStore } from '../stores/agentStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useSshAgentStore } from '../stores/sshAgentStore'
import { useFileExplorerStore, isDiffTab } from '../stores/fileExplorerStore'
import { useLocalFileStore, isLocalDiffTab, type LocalOpenTab } from '../stores/localFileStore'
import { useAiPatchStore } from '../stores/aiPatchStore'
import { useOutputStore } from '../stores/outputStore'
import { usePermissionStore } from '../stores/permissionStore'
import { useStreamStore, type StreamStatus } from '../stores/streamStore'
import * as agentApi from '../api/agent'
import type { ReActStep, TaskBreakdownDTO } from '../api/agent'
import { ConnectionStatus } from '../types'
import type { AgentMessage } from '../types'
import { MessageBubble } from './MessageBubble'
import { PermissionConfirmModal } from './PermissionConfirmModal'
import { StreamStatusBar } from './StreamStatusBar'
import { ErrorRecoveryCard, type ErrorRecovery } from './ErrorRecoveryCard'
import { TopicDivider, shouldInsertTopicDivider } from './TopicDivider'
import { SessionSummaryCard } from './SessionSummaryCard'
import { ArtifactSummaryPanel } from './ArtifactSummaryPanel'
import { CommandMenu, useCommandMenu, type MenuItem } from './CommandMenu'
import { ToolProgressBar, toolProgressStore } from './ToolProgressBar'
import { ShortcutHelp } from './ShortcutHelp'
import { MarkdownContent, ThinkingBlock, splitThinkTags, classifyTool, getToolIconInfo, STEP_COLORS } from './MessageBubbleShared'
import { TypewriterRenderer } from './TypewriterRenderer'
import { ChatExport } from './ChatExport'
import { EmptyState } from './EmptyState'

// ===== SidebarToolCategory — RightSidebar 中按分类聚合的工具卡片 =====
function SidebarToolCategory({ category, colors }: {
  category: { type: string; label: string; color: string; bgColor: string; icon: React.ReactNode; msgs: AgentMessage[] }
  colors: ReturnType<typeof useThemeStore.getState>['colors']
}) {
  const [expanded, setExpanded] = useState(false)
  const allDone = category.msgs.every(m => m.status !== 'in_progress')
  const anyInProgress = category.msgs.some(m => m.status === 'in_progress')
  const failCount = category.msgs.filter(m => m.status === 'failure').length

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${category.color}20` }}>
      {/* 分类头 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 transition-colors hover:bg-black/[0.03] min-w-0"
        style={{ backgroundColor: category.bgColor }}
      >
        <span className="flex items-center justify-center w-4 h-4 rounded flex-shrink-0" style={{ backgroundColor: `${category.color}18`, color: category.color, fontSize: '10px' }}>
          {category.icon}
        </span>
        <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: category.color }}>
          {category.label}
        </span>
        <span className="text-[9px] tabular-nums px-1 rounded-full font-medium flex-shrink-0" style={{
          backgroundColor: `${category.color}12`,
          color: category.color,
          border: `1px solid ${category.color}25`,
        }}>
          ×{category.msgs.length}
        </span>
        {allDone && (
          <span className="text-[9px] flex-shrink-0 font-medium" style={{ color: failCount > 0 ? '#ef4444' : '#22c55e' }}>
            ✓ {category.msgs.length - failCount}/{category.msgs.length}
          </span>
        )}
        {anyInProgress && (
          <span className="text-[9px] flex-shrink-0 animate-pulse" style={{ color: '#f59e0b' }}>● 执行中</span>
        )}
        <div className="flex-1" />
        <svg className={`w-2.5 h-2.5 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} style={{ color: colors.textDim, opacity: 0.5 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* 展开后: 工具列表 */}
      {expanded && (
        <div className="px-2 py-1.5 space-y-0.5" style={{ borderTop: `1px solid ${category.color}15` }}>
          {category.msgs.map(m => {
            const summary = extractToolSummaryGlobal(m.toolName || '', m.toolParams)
            const dotColor = m.status === 'success' ? '#4ade80' : m.status === 'failure' ? '#f87171' : colors.accent
            const toolInfo = getToolIconInfo(m.toolName || '')
            return (
              <div key={m.id} className="flex items-center gap-1.5 py-0.5 min-w-0">
                <span className="shrink-0 rounded-full" style={{ width: 4, height: 4, backgroundColor: dotColor }} />
                <span className="text-[10px] font-medium shrink-0 truncate" style={{ color: colors.text }}>{toolInfo.label}</span>
                {summary && (
                  <span className="text-[9px] font-mono truncate" style={{ color: colors.textDim }}>{summary}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 全局工具摘要提取（供 SidebarToolCategory 使用）
function extractToolSummaryGlobal(toolName: string, toolParams?: string): string {
  if (!toolParams) return ''
  const lower = toolName.toLowerCase()
  if (lower.includes('exec') || lower.includes('command') || lower.includes('ssh')) {
    const cmd = toolParams.trim().split('\n')[0]
    return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd
  }
  const pathMatch = toolParams.match(/(\/?[\w./-]+\.[\w]+)/)
  if (pathMatch) return pathMatch[1]
  return toolParams.length > 40 ? toolParams.substring(0, 40) + '...' : toolParams
}

// ===== AiTurnBlock — 同一 groupId 的 AI 回合统一渲染 =====
function AiTurnBlock({ msgs, colors, isLoading, streamStatus, onRetry }: {
  msgs: AgentMessage[]
  colors: ReturnType<typeof useThemeStore.getState>['colors']
  isLoading: boolean
  streamStatus: StreamStatus
  onRetry?: () => void
}) {
  const thinkingMsgs = msgs.filter(m => m.messageType === 'thinking')
  const toolCallMsgs = msgs.filter(m => m.messageType === 'tool_call')
  const textMsgs = msgs.filter(m => m.messageType === 'text')
  const errorMsgs = msgs.filter(m => m.messageType === 'error')
  const summaryMsgs = msgs.filter(m => m.messageType === 'summary')

  const toolCount = toolCallMsgs.length
  const doneCount = toolCallMsgs.filter(m => m.status !== 'in_progress').length
  const failCount = toolCallMsgs.filter(m => m.status === 'failure').length
  const allToolDone = doneCount === toolCount

  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [thinkingExpanded, setThinkingExpanded] = useState(false)

  const timestamp = msgs[0]?.timestamp || Date.now()
  const turnTime = (() => {
    const d = new Date(timestamp)
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })()

  // ── 是否处于思考占位状态 ──
  const isPlaceholderThinking = isLoading && thinkingMsgs.length > 0 && thinkingMsgs.every(m => m.content === '思考中...')
  const isReconnecting = isPlaceholderThinking && streamStatus === 'reconnecting'
  const isDisconnected = isPlaceholderThinking && (streamStatus === 'disconnected' || streamStatus === 'error')

  // ── 是否有实际思考内容（非占位） ──
  const hasRealThinking = thinkingMsgs.length > 0 && thinkingMsgs.some(m => m.content !== '思考中...')

  // ── 是否需要显示加载指示器（isLoading 但没有任何内容区块） ──
  const showLoadingBar = isLoading && !isPlaceholderThinking && !hasRealThinking && toolCount === 0 && textMsgs.length === 0 && errorMsgs.length === 0

  return (
    <div className="space-y-0">
      {/* 统一头部:头像 + 名称 + 时间 + 所有内容 */}
      <div className="px-4 py-1.5 flex gap-2.5">
        {/* 头像 - 只出现一次 */}
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
             style={{ backgroundColor: colors.accent + '20', border: `1px solid ${colors.accent}30` }}>
          <span className="text-[12px]">🤖</span>
        </div>
        <div className="flex flex-col min-w-0 flex-1 max-w-[calc(100%-36px)] gap-1">
          {/* 名称 + 时间 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>WaLiCode</span>
            <span className="text-[10px]" style={{ color: colors.textDim }}>{turnTime}</span>
          </div>

          {/* 思考占位 - 呼吸点 */}
          {isPlaceholderThinking && !isReconnecting && !isDisconnected && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md"
                 style={{ backgroundColor: colors.accent + '08', border: `1px solid ${colors.accent}12` }}>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '200ms' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '400ms' }} />
              </div>
              <span className="text-[11px]" style={{ color: colors.textDim }}>思考中...</span>
            </div>
          )}

          {/* 重连状态 */}
          {isPlaceholderThinking && isReconnecting && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md"
                 style={{ backgroundColor: colors.accent + '08', border: `1px solid ${colors.accent}12` }}>
              <span className="text-[13px]" style={{ animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>🔄</span>
              <span className="text-[11px]" style={{ color: '#fbbf24' }}>正在重连...</span>
            </div>
          )}

          {/* 断开状态 */}
          {isPlaceholderThinking && isDisconnected && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md"
                 style={{ backgroundColor: colors.accent + '08', border: `1px solid ${colors.accent}12` }}>
              <span className="text-[13px]">⚠️</span>
              <span className="text-[11px]" style={{ color: '#f87171' }}>连接已中断</span>
              {onRetry && (
                <button
                  className="px-2 py-0.5 rounded text-[10px] font-medium transition-all hover:opacity-80"
                  style={{ backgroundColor: colors.accent, color: '#fff' }}
                  onClick={onRetry}
                >继续</button>
              )}
            </div>
          )}

          {/* 实际思考内容 - 可折叠 */}
          {hasRealThinking && (
            <div className="rounded-md px-2.5 py-1.5 cursor-pointer select-none transition-colors"
                 style={{ backgroundColor: colors.bgSecondary + '50', border: `1px solid ${colors.border}20` }}
                 onClick={() => setThinkingExpanded(!thinkingExpanded)}>
              <div className="flex items-center gap-1.5">
                <svg className={`w-3 h-3 transition-transform ${thinkingExpanded ? 'rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                <span className="text-[11px]" style={{ color: colors.textSecondary }}>思考</span>
                {!thinkingExpanded && (
                  <span className="text-[10px] truncate max-w-[280px]" style={{ color: colors.textDim }}>
                    {thinkingMsgs.filter(m => m.content !== '思考中...').slice(-1)[0]?.content?.substring(0, 60)}
                  </span>
                )}
              </div>
              {thinkingExpanded && (
                <div className="mt-1.5 space-y-1">
                  {thinkingMsgs.filter(m => m.content !== '思考中...').map((m) => (
                    <div key={m.id} className="text-[11px] leading-relaxed" style={{ color: colors.textSecondary }}>
                      {m.content}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 通用加载条 - 呼吸点 */}
          {showLoadingBar && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md"
                 style={{ backgroundColor: colors.accent + '08', border: `1px solid ${colors.accent}12` }}>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '200ms' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '400ms' }} />
              </div>
              <span className="text-[11px]" style={{ color: colors.textDim }}>AI 正在分析...</span>
            </div>
          )}

          {/* 工具调用 - 分类聚合展示 */}
          {toolCount > 0 && (() => {
            // 分类聚合计算
            type ToolCategory = { type: ReturnType<typeof classifyTool>; label: string; color: string; bgColor: string; icon: React.ReactNode; msgs: AgentMessage[] }
            const categoryMap = new Map<ReturnType<typeof classifyTool>, ToolCategory>()
            for (const m of toolCallMsgs) {
              const cls = classifyTool(m.toolName || '')
              const info = getToolIconInfo(m.toolName || '')
              if (!categoryMap.has(cls)) {
                categoryMap.set(cls, { type: cls, label: info.label, color: info.color, bgColor: info.bgColor, icon: info.icon, msgs: [] })
              }
              categoryMap.get(cls)!.msgs.push(m)
            }
            const categories = Array.from(categoryMap.values()).sort((a, b) => b.msgs.length - a.msgs.length)
            const topCategories = categories.slice(0, 4)
            const thinkingCount = thinkingMsgs.filter(m => m.content !== '思考中...').length || (thinkingMsgs.length > 0 ? thinkingMsgs.length : 0)

            return (
              <div className="rounded-lg overflow-hidden" style={{ backgroundColor: allToolDone ? (failCount > 0 ? '#f8717108' : '#4ade8008') : colors.accent + '08', border: `1px solid ${allToolDone ? (failCount > 0 ? '#f8717120' : '#4ade8020') : colors.accent + '20'}` }}>
                {/* 摘要行 - 始终可见 */}
                <button className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-black/5 min-w-0"
                        onClick={() => setToolsExpanded(!toolsExpanded)}>
                  <span className="text-[11px]">🔧</span>
                  <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: colors.text }}>{toolCount} 工具</span>
                  <span className="text-[10px] flex-shrink-0" style={{ color: colors.textSecondary }}>· {msgs.length} 条消息</span>
                  {/* 完成状态 */}
                  {allToolDone && (
                    <span className="text-[10px] flex-shrink-0 font-medium" style={{ color: failCount > 0 ? '#ef4444' : '#22c55e' }}>
                      ✓ {doneCount}/{toolCount}
                    </span>
                  )}
                  {!allToolDone && (
                    <span className="text-[10px] flex-shrink-0 animate-pulse" style={{ color: '#f59e0b' }}>● 执行中</span>
                  )}
                  {/* 分类标签 - 只显示前3个 */}
                  {topCategories.slice(0, 3).map(cat => (
                    <span key={cat.type} className="text-[9px] px-1.5 py-0 rounded-full flex-shrink-0 font-medium whitespace-nowrap" style={{
                      backgroundColor: `${cat.color}12`,
                      color: cat.color,
                      border: `1px solid ${cat.color}25`,
                    }}>
                      {cat.label}×{cat.msgs.length}
                    </span>
                  ))}
                  {categories.length > 3 && (
                    <span className="text-[9px] px-1.5 py-0 rounded-full flex-shrink-0 font-medium whitespace-nowrap" style={{
                      backgroundColor: `${colors.textDim}12`,
                      color: colors.textSecondary,
                      border: `1px solid ${colors.textDim}25`,
                    }}>
                      +{categories.length - 3}
                    </span>
                  )}
                  {/* 思考次数 */}
                  {thinkingCount > 0 && (
                    <span className="text-[9px] px-1.5 py-0 rounded-full flex-shrink-0 font-medium whitespace-nowrap" style={{
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
                  <svg className={`w-3 h-3 transition-transform shrink-0 ${toolsExpanded ? 'rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>

                {/* 展开后: 按分类聚合的工具卡片列表 */}
                {toolsExpanded && (
                  <div className="px-2 pb-2 space-y-1.5" style={{ borderTop: `1px solid ${colors.border}15` }}>
                    {/* 按分类聚合的工具卡片 */}
                    {categories.map(cat => (
                      <SidebarToolCategory key={cat.type} category={cat} colors={colors} />
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* 错误消息 - 无重复头像 */}
          {errorMsgs.length > 0 && (
            <div className="space-y-1">
              {errorMsgs.map(m => (
                <div key={m.id} className="px-3 py-2 text-[12px] leading-relaxed rounded-lg"
                     style={{ backgroundColor: `${colors.red}10`, color: colors.red, border: `1px solid ${colors.red}25` }}>
                  {m.content}
                </div>
              ))}
            </div>
          )}

          {/* AI 文本回复 - 无重复头像,直接嵌入 */}
          {textMsgs.length > 0 && (
            <div className="text-[13px] leading-relaxed overflow-hidden min-w-0">
              {textMsgs.map(m => {
                const contentParts = m.content ? splitThinkTags(m.content) : []
                return (
                  <div key={m.id}>
                    {contentParts.length > 0 ? contentParts.map((part, idx) => {
                      if (part.type === 'think') return <ThinkingBlock key={idx} content={part.content} isStreaming={part.isStreaming || false} />
                      if (!part.content.trim()) return null
                      if (isLoading && part.isStreaming) {
                        return <TypewriterRenderer key={idx} fullText={part.content} isLoading={isLoading} renderContent={(text) => <MarkdownContent content={text} colors={colors} />} />
                      }
                      return <MarkdownContent key={idx} content={part.content} colors={colors} />
                    }) : (
                      <div className="flex items-center gap-1.5 py-0.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.accent, animation: 'pulse-dot 1.4s ease-in-out infinite' }} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* "AI 继续工作"指示器 - 简化为呼吸点 */}
          {isLoading && textMsgs.length > 0 && (() => {
            const hasInProgressTool = msgs.some(m => m.messageType === 'tool_call' && m.status === 'in_progress')
            const label = hasInProgressTool ? 'AI 正在调用工具...' : 'AI 正在分析...'
            return (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md"
                   style={{ backgroundColor: colors.accent + '06', border: `1px solid ${colors.accent}10` }}>
                <div className="flex items-center gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '200ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '400ms' }} />
                </div>
                <span className="text-[10px]" style={{ color: colors.textDim }}>{label}</span>
              </div>
            )
          })()}

          {/* 变更摘要 - 无重复头像 */}
          {summaryMsgs.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px]" style={{ color: colors.textSecondary }}>📋 变更摘要</span>
              </div>
              {summaryMsgs.map(m => m.changeSummary ? <SessionSummaryCard key={m.id} summary={m.changeSummary} /> : null)}
            </div>
          )}
        </div>
      </div>

      {/* 中断/错误状态提示 */}
      {!isLoading && errorMsgs.length > 0 && (
        <div className="px-4 py-1.5 flex gap-2.5">
          <div className="w-7 shrink-0" />
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
               style={{ backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <span className="text-[13px]">⚠️</span>
            <span className="text-[11px]" style={{ color: '#f87171' }}>
              {errorMsgs[errorMsgs.length - 1]?.content || '对话已中断'}
            </span>
            {onRetry && (
              <button className="px-2.5 py-0.5 rounded text-[10px] font-medium transition-all hover:opacity-80"
                      style={{ backgroundColor: colors.accent, color: '#fff' }}
                      onClick={onRetry}>
                ▶ 继续对话
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function parseToolResultPayload(raw?: string): Record<string, any> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const match = raw.match(/"path"\s*:\s*"([^"]+)"/)
    return match ? { path: match[1] } : null
  }
}

/**
 * 从原始错误信息中提取用户友好的摘要。
 * Java 异常堆栈、Caused by 等信息会被过滤，只保留核心错误描述。
 */
function extractErrorMessage(raw: string): string {
  if (!raw) return '未知错误'
  const s = raw.trim()

  // 1. 提取 Caused by 中的核心消息（如 "Server error: 500 Internal Server Error from POST ..."）
  const causedByMatch = s.match(/Caused by:\s*(.+?)(?:\s+at\s|\s*\.{3}\s+\d+)/s)
  if (causedByMatch) {
    let msg = causedByMatch[1].trim()
    // 截断过长的 URL
    msg = msg.replace(/(POST|GET|PUT|DELETE)\s+(https?:\/\/[^\s]+)(\s|$)/, '$1 <URL> ')
    if (msg.length > 200) msg = msg.substring(0, 200) + '...'
    return msg
  }

  // 2. 提取第一行有意义的内容（跳过纯堆栈行）
  const lines = s.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('at ') || trimmed.startsWith('...')) continue
    // 跳过纯异常类名行（如 "java.lang.RuntimeException: ..." 但保留冒号后的内容）
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0 && colonIdx < 60) {
      const afterColon = trimmed.substring(colonIdx + 1).trim()
      if (afterColon) {
        let msg = afterColon.replace(/(POST|GET|PUT|DELETE)\s+(https?:\/\/[^\s]+)/, '$1 <URL>')
        if (msg.length > 200) msg = msg.substring(0, 200) + '...'
        return msg
      }
    }
    // 非堆栈行，直接返回
    if (trimmed.length < 300) return trimmed
  }

  // 3. 兜底：截断到合理长度
  return s.length > 200 ? s.substring(0, 200) + '...' : s
}

interface RightSidebarProps {
  width?: number
  activeTerminalSessionId?: string | null
}

/**
 * 清理粘贴文本中的 Markdown 格式符号，转为纯文本
 */
function stripMarkdownForPaste(text: string): string {
  if (!text) return text
  return text
    // 标题: ## 标题 → 标题
    .replace(/^#{1,6}\s+/gm, '')
    // 加粗: **text** 或 __text__ → text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // 斜体: *text* 或 _text_ → text（避免误匹配列表标记）
    .replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '$1')
    // 行内代码: `text` → text
    .replace(/`([^`]+?)`/g, '$1')
    // 链接: [text](url) → text
    .replace(/\[([^\]]+?)\]\([^)]+?\)/g, '$1')
    // 图片: ![alt](url) → alt
    .replace(/!\[([^\]]*?)\]\([^)]+?\)/g, '$1')
    // 无序列表: - item / * item / + item → item
    .replace(/^\s*[-*+]\s+/gm, '')
    // 有序列表: 1. item → item
    .replace(/^\s*\d+\.\s+/gm, '')
    // 引用: > text → text
    .replace(/^>\s*/gm, '')
    // 分割线: --- 或 *** → 空行
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // 代码块标记: ``` → 移除
    .replace(/^```\w*$/gm, '')
}

export function RightSidebar({ width = 400, activeTerminalSessionId }: RightSidebarProps) {
  const { colors } = useThemeStore()
  const {
    sessions,
    currentSessionId,
    inputText,
    setInputText,
    addMessage,
    addToolCallMessage,
    updateToolMessageStatus,
    upsertTextMessage,
    addSummaryMessage,
    addThinkingMessage,
    replaceLastThinkingMessage,
    removeThinkingMessages,
    addErrorMessage,
    markGroupInProgressAsFailure,
    editAndRetry,
    clearMessages,
    isLoading,
    setLoading,
    newConversation,
    agents,
    currentAgentId,
    fetchAgents,
    setCurrentAgentId,
    createServerSession,
  } = useAgentStore()

  const { connections, currentConnectionId } = useConnectionStore()
  const streamStatus = useStreamStore(s => s.status)
  const {
    activeBinding,
    bindTerminal,
    inputTags,
    addInputTag,
    removeInputTag,
    getInputTagsContent,
    clearInputTags,
  } = useSshAgentStore()

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const currentSession = currentSessionId ? sessions.get(currentSessionId) : null
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLDivElement>(null)
  const inputHtmlRef = useRef<string>('')
  const lastRangeRef = useRef<Range | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [sendOnEnter, setSendOnEnter] = useState(() => {
    return localStorage.getItem('sendOnEnter') !== 'false'
  })
  const [showSendModeDropdown, setShowSendModeDropdown] = useState(false)
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false)
  const [inputKey, setInputKey] = useState(0)
  const abortRef = useRef<(() => void) | null>(null)
  const [errorRecovery, setErrorRecovery] = useState<ErrorRecovery | null>(null)

  // --- P2: 快捷键面板 & 导出面板 ---
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)
  const [showChatExport, setShowChatExport] = useState(false)
  // --- 历史记录面板 ---
  const { showHistoryPanel, toggleHistoryPanel } = useAgentStore()

  // --- CommandMenu 状态 ---
  const [cmdMenuTrigger, setCmdMenuTrigger] = useState<'/' | '@' | null>(null)
  const [cmdMenuIndex, setCmdMenuIndex] = useState(-1)
  const [cmdMenuQuery, setCmdMenuQuery] = useState('')

  // 可用的 @ 提及列表
  const mentionItems: MenuItem[] = [
    { id: 'current-file', label: '当前文件', description: '插入当前打开的文件', icon: '📄', insertText: '@当前文件' },
    { id: 'current-folder', label: '当前目录', description: '插入当前工作目录', icon: '📁', insertText: '@当前目录' },
    { id: 'terminal', label: '终端', description: '插入终端选中文本', icon: '💻', insertText: '@终端' },
    { id: 'connection', label: 'SSH 连接', description: '插入当前连接信息', icon: '🔗', insertText: '@SSH连接' },
  ]

  // --- SSE 心跳超时检测 ---
  useEffect(() => {
    const interval = setInterval(() => {
      const store = useStreamStore.getState()
      // 仅在 streaming/reconnecting 状态下检测心跳超时
      if ((store.status === 'streaming' || store.status === 'reconnecting') && store.isHeartbeatStale()) {
        console.warn('[SSE] heartbeat stale, stream may be dead')
        // 触发断开，agent.ts 的 catch 会自动重连
        if (abortRef.current) {
          // 不设置 isAborted，只中断当前 fetch 让 catch 处理重连
          // 但 abortRef 调用会设 isAborted=true...
          // 所以这里改为直接触发错误状态
        }
        // 如果已经在 reconnecting 且超过最大重试，显示错误
        if (store.status === 'reconnecting' && store.retryCount >= store.maxRetries) {
          store.setError('SSE 连接超时，心跳无响应')
          store.reset()
          setLoading(false)
          abortRef.current = null
        }
      }
    }, 10_000) // 每 10s 检查一次
    return () => clearInterval(interval)
  }, [])

  // --- 输入历史导航（支持文本 + 标签恢复） ---
  interface HistoryEntry {
    text: string
    tags: Array<{ label: string; fullContent: string; type: 'terminal-selection' | 'file' | 'custom' }>
  }
  const historyRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef<number>(-1) // -1 = 当前输入
  const savedInputRef = useRef<string>('') // 导航前的当前输入
  const savedInputTagsRef = useRef<Array<{ label: string; fullContent: string; type: 'terminal-selection' | 'file' | 'custom' }>>([]) // 导航前的当前标签

  // 从 localStorage 加载历史
  useEffect(() => {
    try {
      const stored = localStorage.getItem('chatInputHistory')
      if (stored) historyRef.current = JSON.parse(stored)
    } catch {}
  }, [])

  // 保存历史到 localStorage
  const saveHistory = (history: HistoryEntry[]) => {
    try {
      // 最多保留 200 条
      const trimmed = history.slice(-200)
      localStorage.setItem('chatInputHistory', JSON.stringify(trimmed))
      historyRef.current = trimmed
    } catch {}
  }

  // 添加一条历史记录（发送时调用）
  const pushHistory = (text: string, tags: Array<{ label: string; fullContent: string; type: 'terminal-selection' | 'file' | 'custom' }>) => {
    if (!text.trim() && tags.length === 0) return
    const history = [...historyRef.current]
    // 避免连续重复（比较文本+标签数量）
    const last = history[history.length - 1]
    if (last?.text !== text || last?.tags.length !== tags.length) {
      history.push({ text, tags })
      saveHistory(history)
    }
    historyIndexRef.current = -1
  }

  // 向上导航（更旧的历史）
  const navigateHistoryUp = () => {
    const history = historyRef.current
    if (history.length === 0) return
    if (historyIndexRef.current === -1) {
      // 从当前输入开始导航
      savedInputRef.current = inputRef.current?.innerText || ''
      savedInputTagsRef.current = inputTags.map(t => ({ label: t.label, fullContent: t.fullContent, type: t.type }))
      historyIndexRef.current = history.length - 1
    } else if (historyIndexRef.current > 0) {
      historyIndexRef.current--
    }
    const entry = history[historyIndexRef.current]
    if (inputRef.current) {
      inputRef.current.innerText = entry.text
      // 恢复标签
      clearInputTags()
      for (const tag of entry.tags) {
        addInputTag(tag)
      }
      // 光标移到最后
      const range = document.createRange()
      range.selectNodeContents(inputRef.current)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }

  // 向下导航（更新的历史）
  const navigateHistoryDown = () => {
    const history = historyRef.current
    if (historyIndexRef.current === -1) return // 已经在当前输入
    if (historyIndexRef.current < history.length - 1) {
      historyIndexRef.current++
      const entry = history[historyIndexRef.current]
      if (inputRef.current) inputRef.current.innerText = entry.text
      // 恢复标签
      clearInputTags()
      for (const tag of entry.tags) {
        addInputTag(tag)
      }
    } else {
      // 回到当前输入
      historyIndexRef.current = -1
      if (inputRef.current) inputRef.current.innerText = savedInputRef.current
      // 恢复之前保存的标签
      clearInputTags()
      for (const tag of savedInputTagsRef.current) {
        addInputTag(tag)
      }
    }
    // 光标移到最后
    if (inputRef.current) {
      const range = document.createRange()
      range.selectNodeContents(inputRef.current)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }

  const { openTabs, activeTabKey, activeConnectionId, currentPathByConnection } = useFileExplorerStore()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
  const currentKeyLabel = isMac ? 'Command + Enter' : 'Ctrl + Enter'

  const inputPlaceholder = () => {
    if (sendOnEnter) {
      return isMac
        ? '向 WaLiSSH 提问...（Enter 发送 · Command + Enter 换行）'
        : '向 WaLiSSH 提问...（Enter 发送 · Ctrl + Enter 换行）'
    }
    return `向 WaLiSSH 提问...（${currentKeyLabel} 发送 · Enter 换行）`
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentSession?.messages, isLoading])

  const syncInputTextFromDom = () => {
    if (!inputRef.current) return
    const text = inputRef.current.innerText.replace(/\u00a0/g, ' ')
    setInputText(text)
    inputHtmlRef.current = inputRef.current.innerHTML
  }

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0 && inputRef.current && inputRef.current.contains(selection.anchorNode)) {
        lastRangeRef.current = selection.getRangeAt(0).cloneRange()
      }
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  useEffect(() => {
    const handleInsertPhrase = (e: Event) => {
      const phrase = (e as CustomEvent<string>).detail
      if (!phrase || !inputRef.current) return
      const textNode = document.createTextNode(phrase)
      const selection = window.getSelection()
      const range = lastRangeRef.current && inputRef.current.contains(lastRangeRef.current.commonAncestorContainer)
        ? lastRangeRef.current
        : selection && selection.rangeCount > 0 && inputRef.current.contains(selection.anchorNode)
          ? selection.getRangeAt(0)
          : null

      if (range) {
        range.deleteContents()
        range.insertNode(textNode)
        range.setStartAfter(textNode)
        range.setEndAfter(textNode)
        selection?.removeAllRanges()
        selection?.addRange(range)
      } else {
        inputRef.current.appendChild(textNode)
      }
      inputRef.current.focus()
      syncInputTextFromDom()
    }

    window.addEventListener('walicode-insert-phrase', handleInsertPhrase as EventListener)
    return () => window.removeEventListener('walicode-insert-phrase', handleInsertPhrase as EventListener)
  }, [])

  useEffect(() => {
    const closeDropdown = () => setShowAttachmentMenu(false)
    if (showAttachmentMenu) {
      document.addEventListener('click', closeDropdown)
      return () => document.removeEventListener('click', closeDropdown)
    }
  }, [showAttachmentMenu])

  useEffect(() => {
    if (!inputRef.current) return
    if (inputHtmlRef.current === inputRef.current.innerHTML) return
    if (inputText) return
    inputRef.current.innerHTML = ''
    inputHtmlRef.current = ''
  }, [inputText])

  useEffect(() => {
    if (!inputRef.current) return
    const html = inputRef.current.innerHTML
    if (html.trim()) {
      inputHtmlRef.current = html
      return
    }
    setInputText('')
    inputHtmlRef.current = ''
  }, [inputKey])

  // --- 全局快捷键：? 打开帮助面板 ---
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 输入框内不触发，避免干扰正常输入
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.key === '?') {
        e.preventDefault()
        setShowShortcutHelp(prev => !prev)
      }
      if (e.key === 'Escape') {
        setShowShortcutHelp(false)
        setShowChatExport(false)
        if (useAgentStore.getState().showHistoryPanel) useAgentStore.getState().toggleHistoryPanel()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  useEffect(() => {
    const autoBindCurrentConnection = async () => {
      if (!activeTerminalSessionId) return
      if (activeBinding?.terminalSessionId === activeTerminalSessionId) return
      const connection = currentConnectionId
        ? connections.find((c) => c.id === currentConnectionId)
        : connections.find((c) => c.status === ConnectionStatus.CONNECTED)
      if (!connection || connection.status !== ConnectionStatus.CONNECTED) return
      if (!currentSessionId && currentAgentId) {
        await createServerSession(currentAgentId)
      }
      const sessionId = useAgentStore.getState().currentSessionId
      if (!sessionId) return
      const success = await bindTerminal(
        sessionId,
        activeTerminalSessionId,
        {
          connectionId: connection.id,
          connectionName: connection.name,
          host: connection.host,
          port: connection.port,
          username: connection.username,
        }
      )
      if (success) {
      }
    }

    autoBindCurrentConnection()
  }, [
    activeTerminalSessionId,
    activeBinding,
    currentConnectionId,
    connections,
    currentAgentId,
    bindTerminal,
    createServerSession,
  ])

  const insertTagAtCursor = (tag: { id: string; label: string; type: 'terminal-selection' | 'file' | 'custom'; fullContent: string }) => {
    if (!inputRef.current) return
    // 仅写入 Zustand store（store 渲染层负责显示标签，避免 DOM 插入导致重复）
    addInputTag(tag)
    inputRef.current.focus()
  }

  const handleAddCurrentFile = () => {
    // 先检查本地文件
    const localTab = useLocalFileStore.getState().openTabs.find(
      (t) => !isLocalDiffTab(t) && t.key === useLocalFileStore.getState().activeTabKey
    ) as LocalOpenTab | undefined
    if (localTab && localTab.content) {
      insertTagAtCursor({
        id: `file_${Date.now()}`,
        label: `文件: ${localTab.name}`,
        fullContent: `本地文件: ${localTab.path}\n\n\`\`\`\n${localTab.content}\n\`\`\``,
        type: 'file',
      })
      setShowAttachmentMenu(false)
      return
    }
    // 远程文件
    if (!activeTabKey) return
    const tab = openTabs.find(t => t.key === activeTabKey)
    if (!tab || isDiffTab(tab) || !tab.content) return
    insertTagAtCursor({
      id: `file_${Date.now()}`,
      label: `文件: ${tab.name}`,
      fullContent: `文件路径: ${tab.path}\n\n${tab.content}`,
      type: 'file',
    })
    setShowAttachmentMenu(false)
  }

  const handleAddCurrentFolder = () => {
    if (!activeConnectionId) return
    const cwd = currentPathByConnection[activeConnectionId] || '/'
    const children = useFileExplorerStore.getState().childrenByConnection[activeConnectionId]?.[cwd]
    let filesList = ''
    if (children && children.length > 0) {
      filesList = `\n目录内容预览:\n` + children.map(c => `  ${c.directory ? '📁' : '📄'} ${c.name}`).join('\n')
    }
    insertTagAtCursor({
      id: `folder_${Date.now()}`,
      label: `目录: ${cwd}`,
      fullContent: `当前操作目录: ${cwd}${filesList}`,
      type: 'custom',
    })
    setShowAttachmentMenu(false)
  }

  const handleAddSelectedText = () => {
    // @ts-ignore
    const editor = window.__activeMonacoEditor
    if (editor) {
      const selection = editor.getSelection()
      const text = editor.getModel()?.getValueInRange(selection)
      if (text) {
        // 检查是本地文件还是远程文件
        const localTab = useLocalFileStore.getState().openTabs.find(
          (t) => t.key === useLocalFileStore.getState().activeTabKey
        )
        const remoteTab = useFileExplorerStore.getState().openTabs.find(
          (t) => t.key === useFileExplorerStore.getState().activeTabKey
        )
        
        const filePath = localTab?.path || remoteTab?.path || 'unknown'
        const fileName = localTab?.name || remoteTab?.name || 'unknown'
        const prefix = localTab ? '本地文件' : '远程文件'
        
        const startLine = selection.startLineNumber
        const endLine = selection.endLineNumber
        const lineRange = startLine === endLine ? `第 ${startLine} 行` : `第 ${startLine}-${endLine} 行`
        
        insertTagAtCursor({
          id: `sel_${Date.now()}`,
          label: `选中: ${fileName} (${lineRange})`,
          fullContent: `${prefix}: ${filePath} (${lineRange})\n选中的代码/文本:\n\`\`\`\n${text}\n\`\`\``,
          type: 'terminal-selection',
        })
      }
    }
    setShowAttachmentMenu(false)
  }

  const handleSend = async () => {
    if (isLoading || !currentAgentId || !inputRef.current) return
    // 清除之前的错误恢复卡片
    setErrorRecovery(null)
    const plainText = inputRef.current.innerText.replace(/\u00a0/g, ' ').trim()
    if ((!plainText && inputTags.length === 0) || isLoading) return

    // 保存到输入历史（文本 + 标签）
    if (plainText || inputTags.length > 0) {
      pushHistory(plainText, inputTags.map(t => ({ label: t.label, fullContent: t.fullContent, type: t.type })))
    }

    if (!currentSessionId) {
      await createServerSession(currentAgentId)
    }
    const sessionId = useAgentStore.getState().currentSessionId
    if (!sessionId) return

    let messageContent = plainText
    // displayContent 始终用纯文本/Markdown 格式，不用 domHtml（原始 HTML 含 <span> 标签会导致渲染异常）
    let displayContent = plainText

    // 提取图片的 inlineDatas（传给后端 AI 模型的多模态数据）
    const inlineDatas: { data: string; mimeType: string }[] = []
    inputTags.forEach(tag => {
      const dataUrlMatch = tag.fullContent.match(/data:image\/([a-zA-Z]+);base64,([A-Za-z0-9+/=]+)/)
      if (dataUrlMatch) {
        inlineDatas.push({
          mimeType: `image/${dataUrlMatch[1]}`,
          data: dataUrlMatch[2],
        })
      }
    })

    const tagsContent = getInputTagsContent()
    if (tagsContent) {
      // messageContent 发给后端：图片标签保留描述文字（AI 可通过 inlineDatas 看到图片）
      const serverTagsContent = inputTags.map(tag => {
        const dataUrlMatch = tag.fullContent.match(/(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)/)
        if (dataUrlMatch) {
          return `[用户上传了图片: ${tag.label}]`
        }
        return tag.fullContent
      }).join('\n\n---\n\n')
      const formattedServerTags = serverTagsContent.split('\n').map(line => `> ${line}`).join('\n')
      messageContent = plainText
        ? `${plainText}\n\n**参考上下文：**\n${formattedServerTags}`
        : `**参考上下文：**\n${formattedServerTags}`

      // displayContent 仅前端渲染：图片用 Markdown 图片语法渲染预览
      const displayTags = inputTags.map(tag => {
        const dataUrlMatch = tag.fullContent.match(/(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)/)
        if (dataUrlMatch) {
          return `> 📎 **${tag.label}**\n> ![](${dataUrlMatch[1]})`
        }
        const contentLines = tag.fullContent.split('\n')
        const firstFewLines = contentLines.slice(0, 3).join(' ')
        const preview = firstFewLines.length > 80 ? firstFewLines.substring(0, 80) + '...' : firstFewLines
        return `> 📎 **${tag.label}**\n> ${preview}`
      }).join('\n>\n')
      displayContent = plainText ? `${plainText}\n\n${displayTags}` : displayTags
    }

    const selectedConn = activeBinding
      ? connections.find((c) => c.id === activeBinding.connectionId)
      : connections.find((c) => c.id === currentConnectionId && c.status === ConnectionStatus.CONNECTED)
    if (activeBinding || selectedConn) {
      const conn = activeBinding ? connections.find((c) => c.id === activeBinding.connectionId) : selectedConn!
      if (conn) {
        const serverContext = `当前服务器：${conn.name} (${conn.username}@${conn.host}:${conn.port})`
        messageContent = `${serverContext}\n\n${messageContent}`
      }
    }

    const groupId = `group_${Date.now()}`
    const userMessage: AgentMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: displayContent,
      timestamp: Date.now(),
      messageType: 'text',
      groupId,
    }
    addMessage(sessionId, userMessage)
    setInputText('')
    setLoading(true)

    // 清空输入框内容（包括文件标签）
    clearInputTags()
    if (inputRef.current) {
      inputRef.current.innerHTML = ''
      inputHtmlRef.current = ''
      setInputKey((k) => k + 1)
    }

    // 多消息流模式：不需要预创建 assistant 消息，各类型消息由回调动态创建
    // 但需要立即创建一个"思考中"占位消息，避免用户以为死机
    addThinkingMessage(sessionId, groupId, '思考中...')
    let textMsgId = '' // 同一 groupId 下只有一条 text 消息，onText 时 upsert
    const toolCallMsgMap = new Map<string, string>() // toolCallId → msgId 映射

    // 更新 SSE 流状态
    useStreamStore.getState().setStatus('connecting')
    useStreamStore.getState().touchActivity()

    abortRef.current = agentApi.reactChatStream(
      currentAgentId,
      'default',
      sessionId,
      messageContent,
      (step: ReActStep) => {
        // ── 多消息流：每个 step 生成独立消息 ──
        if (step.stepType === 'thinking') {
          // 替换占位"思考中..."消息（如果有）
          replaceLastThinkingMessage(sessionId, groupId, step.content || '思考中...')
        }

        else if (step.stepType === 'tool_call') {
          if (step.status === 'in_progress') {
            const msgId = addToolCallMessage(
              sessionId, groupId,
              step.toolCallId || `tc_${Date.now()}`,
              step.toolName || 'unknown',
              step.toolParams || ''
            )
            if (step.toolCallId) toolCallMsgMap.set(step.toolCallId, msgId)

            // 命令执行工具 → 写入输出面板
            const commandExecTools = ['executeLocalCommand', 'compileProject', 'compileTests', 'runUnitTests', 'executeSshCommand']
            if (step.toolName && commandExecTools.includes(step.toolName)) {
              useOutputStore.getState().addEntry({
                sessionId: `step-${step.stepIndex}`, command: step.toolParams || '',
                status: 'running', stdout: '', stderr: '', exitCode: null, durationMs: null,
              })
            }
          } else if (step.status === 'success' || step.status === 'failure') {
            // 更新工具消息状态：先按 toolCallId 匹配，找不到则按 toolName 匹配最后一条 in_progress 消息
            const tcId = step.toolCallId || ''
            let msgId = tcId ? toolCallMsgMap.get(tcId) : undefined
            if (!msgId && step.toolName) {
              const session = useAgentStore.getState().sessions.get(sessionId)
              if (session) {
                const match = [...session.messages]
                  .reverse()
                  .find(m => m.messageType === 'tool_call' && m.toolName === step.toolName && m.status === 'in_progress' && m.groupId === groupId)
                if (match) msgId = match.id
              }
            }
            if (msgId) updateToolMessageStatus(sessionId, msgId, step.status, step.toolResult)

            // 命令执行工具完成 → 更新输出面板
            const commandExecTools = ['executeLocalCommand', 'compileProject', 'compileTests', 'runUnitTests', 'executeSshCommand']
            if (step.toolName && commandExecTools.includes(step.toolName)) {
              const outputStore = useOutputStore.getState()
              const entrySessionId = `step-${step.stepIndex}`
              let stdout = '', stderr = '', exitCode = -1, durationMs = 0
              if (step.toolResult) {
                try { const r = JSON.parse(step.toolResult); stdout = r.output || r.stdout || ''; stderr = r.stderr || ''; exitCode = r.exitCode ?? -1; durationMs = r.timeoutMs || 0 }
                catch { stdout = step.toolResult }
              }
              if (outputStore.entries.find(e => e.sessionId === entrySessionId)) {
                outputStore.updateEntry(entrySessionId, { status: step.status === 'success' ? 'success' : 'failed', stdout, stderr, exitCode, durationMs })
              } else {
                outputStore.addEntry({ sessionId: entrySessionId, command: step.toolParams || '', status: step.status === 'success' ? 'success' : 'failed', stdout, stderr: '', exitCode, durationMs: 0 })
              }
            }

            // 文件操作工具完成 → 刷新文件树 + 重载编辑器
            if (step.toolName) {
              const fileWriteTools = ['writeLocalFile', 'createLocalFile', 'deleteLocalFile', 'writeFile', 'createFile', 'deleteFile', 'editLocalFile', 'editFile', 'editRemoteFile', 'writeRemoteFile', 'CodeEditTool', 'CodeEdit', 'applyEdit', 'applyEditTool']
              const isFileWriteTool = fileWriteTools.includes(step.toolName) || step.toolName.toLowerCase().includes('edit') || step.toolName.toLowerCase().includes('write')
              if (isFileWriteTool) {
                const payload = parseToolResultPayload(step.toolResult)
                let changedPath = (payload?.path as string | undefined)
                  || (step.toolParams && /^\//.test(step.toolParams.trim()) ? step.toolParams.trim() : step.toolParams?.match(/(\/\w[\w./-]+\.[\w]+)/)?.[1])
                  || step.toolResult?.match(/([\/][\w./-]+\.[\w]+)/)?.[1]

                const isLocalTool = step.toolName.includes('Local')
                const isDeleteOp = step.toolName === 'deleteLocalFile' || step.toolName === 'deleteFile'

                if (isLocalTool) {
                  const localStore = useLocalFileStore.getState()
                  if (changedPath && !isDeleteOp) {
                    const localTab = localStore.openTabs.find(t => !isLocalDiffTab(t) && t.path === changedPath) as LocalOpenTab | undefined
                    const before = localTab?.content ?? ''
                    if (localTab) {
                      // 文件已打开 → reload 更新 tab 内容 + 创建 preview
                      localStore.reloadFileByPath(changedPath).then(after => {
                        if (after != null && after !== before) useAiPatchStore.getState().upsertPreview({ target: 'local', path: changedPath!, toolName: step.toolName!, beforeContent: before, afterContent: after })
                      }).catch(() => {})
                    } else {
                      // 文件未打开 → 直接读取文件内容创建 preview（beforeContent 为空）
                      localStore.readFileContent(changedPath).then(after => {
                        if (after != null) useAiPatchStore.getState().upsertPreview({ target: 'local', path: changedPath!, toolName: step.toolName!, beforeContent: '', afterContent: after })
                      }).catch(() => {})
                    }
                  }
                  if (!changedPath) {
                    const activeTab = localStore.openTabs.find(t => t.key === localStore.activeTabKey)
                    if (activeTab && !isDeleteOp) localStore.reloadFileByPath(activeTab.path).catch(() => {})
                  }
                  const dir = changedPath ? changedPath.substring(0, changedPath.lastIndexOf('/')) : null
                  if (dir) localStore.refreshDirectory(dir).catch(() => {})
                  else if (localStore.rootPath) localStore.refreshDirectory(localStore.rootPath).catch(() => {})
                }

                if (!isLocalTool) {
                  const connId = activeBinding?.connectionId || currentConnectionId
                  if (connId) {
                    const fileStore = useFileExplorerStore.getState()
                    if (changedPath && !isDeleteOp) {
                      const remoteTab = fileStore.openTabs.find(t => !isDiffTab(t) && t.connectionId === connId && t.path === changedPath)
                      const before = remoteTab && !isDiffTab(remoteTab) ? remoteTab.content : ''
                      if (remoteTab && !isDiffTab(remoteTab)) {
                        // 远程文件已打开 → reload 更新 tab 内容 + 创建 preview
                        fileStore.reloadFileByPath(connId, changedPath).then(after => {
                          if (after != null && after !== before) useAiPatchStore.getState().upsertPreview({ target: 'remote', path: changedPath!, connectionId: connId, toolName: step.toolName!, beforeContent: before, afterContent: after })
                        }).catch(() => {})
                      } else {
                        // 远程文件未打开 → 通过 API 读取文件内容创建 preview（beforeContent 为空）
                        fileStore.readRemoteFileContent(connId, changedPath).then(after => {
                          if (after != null) useAiPatchStore.getState().upsertPreview({ target: 'remote', path: changedPath!, connectionId: connId, toolName: step.toolName!, beforeContent: '', afterContent: after })
                        }).catch(() => {})
                      }
                    }
                    if (!changedPath) {
                      const activeTab = fileStore.openTabs.find(t => t.connectionId === connId && t.key === fileStore.activeTabKey)
                      if (activeTab && !isDeleteOp) fileStore.reloadFileByPath(connId, activeTab.path).catch(() => {})
                    }
                    const dir = changedPath ? changedPath.substring(0, changedPath.lastIndexOf('/')) : null
                    if (dir) fileStore.refreshDirectory(connId, dir).catch(() => {})
                  }
                }
              }
            }
          }
        }
      },
      (fullText: string) => {
        // 流式文本 → 同一 groupId 下只有一条 text 消息
        // 收到文本时清除占位的 thinking 消息
        removeThinkingMessages(sessionId, groupId)
        textMsgId = upsertTextMessage(sessionId, groupId, fullText)
        useStreamStore.getState().setStatus('streaming')
        useStreamStore.getState().touchActivity()
      },
      (finalContent: string) => {
        // 完成时清除占位 thinking 消息
        removeThinkingMessages(sessionId, groupId)
        if (finalContent && textMsgId) {
          upsertTextMessage(sessionId, groupId, finalContent)
        } else if (finalContent && !textMsgId) {
          upsertTextMessage(sessionId, groupId, finalContent)
        }
        abortRef.current = null
        setLoading(false)
        // 仅在无错误时重置 streamStore（部分交付时 onError 已先触发）
        const streamState = useStreamStore.getState()
        if (streamState.status !== 'error') {
          streamState.reset()
        }
        const outputStore = useOutputStore.getState()
        outputStore.entries.forEach((entry) => {
          if (entry.status === 'running' && entry.sessionId.startsWith('tool-')) {
            outputStore.updateEntry(entry.sessionId, { status: 'success' })
          }
        })
      },
      (err: string) => {
        console.error('[reactChatStream] error:', err)
        abortRef.current = null
        setLoading(false)
        useStreamStore.getState().setError(err)

        // 错误时清除占位 thinking 消息
        removeThinkingMessages(sessionId, groupId)

        const userFriendlyMsg = extractErrorMessage(err)
        addErrorMessage(sessionId, groupId, `请求失败: ${userFriendlyMsg}`)

        let errorType: ErrorRecovery['type'] = 'unknown'
        let errorTitle = '对话已中断'
        if (err.includes('network') || err.includes('Failed to fetch') || err.includes('fetch') || err.includes('NetworkError') || err.includes('Failed')) {
          errorType = 'network'
          errorTitle = '网络连接异常'
        } else if (err.includes('413') || err.includes('too large') || err.includes('payload')) {
          errorType = 'context_limit'
          errorTitle = '请求体过大'
        } else if (err.includes('timeout') || err.includes('超时')) {
          errorType = 'network'
          errorTitle = '连接超时'
        } else if (err.includes('500') || err.includes('502') || err.includes('503') || err.includes('504')) {
          errorType = 'network'
          errorTitle = '服务暂时不可用'
        }
        setErrorRecovery({
          type: errorType, title: errorTitle, message: userFriendlyMsg,
          details: userFriendlyMsg !== err ? err : undefined,
        })
      },
      activeTerminalSessionId || undefined,
      // onTaskBreakdown
      (_breakdown: TaskBreakdownDTO) => {
        // TODO: 多消息流模式下需要新建 task_breakdown 类型消息
      },
      // onTaskProgress
      (_progress) => {
      },
      // onSubAgent
      (_subAgentInfo) => {
      },
      // onChangeSummary
      (changeSummary) => {
        addSummaryMessage(sessionId, groupId, changeSummary)

        const changedFiles = [...(changeSummary.modified || []), ...(changeSummary.created || [])]
        if (changedFiles.length === 0) return

        const localStore = useLocalFileStore.getState()
        const patchStore = useAiPatchStore.getState()
        const connId = activeBinding?.connectionId || currentConnectionId

        for (const file of changedFiles) {
          // ── 本地文件变更 → 创建 AiPatchPreview ──
          const localTab = localStore.openTabs.find(t => !isLocalDiffTab(t) && t.path === file.path) as LocalOpenTab | undefined
          if (localTab) {
            const before = localTab.content ?? ''
            localStore.reloadFileByPath(file.path).then((after) => {
              if (after != null && after !== before) {
                patchStore.upsertPreview({
                  target: 'local',
                  path: file.path,
                  toolName: file.kind === 'create' ? 'createLocalFile' : 'writeLocalFile',
                  beforeContent: before,
                  afterContent: after,
                })
              }
            }).catch(() => {})
          } else if (localStore.rootPath) {
            // 文件未在编辑器打开 → 读取当前内容作为 afterContent
            const fullPath = file.path.startsWith('/') ? file.path : `${localStore.rootPath}/${file.path}`
            localStore.readFileContent(fullPath).then((after) => {
              if (after != null) {
                patchStore.upsertPreview({
                  target: 'local',
                  path: fullPath,
                  toolName: file.kind === 'create' ? 'createLocalFile' : 'writeLocalFile',
                  beforeContent: '',  // 未打开的文件无 beforeContent
                  afterContent: after,
                })
              }
            }).catch(() => {})
          }

          // ── 远程文件变更 → 创建 AiPatchPreview ──
          if (connId) {
            const fileStore = useFileExplorerStore.getState()
            const remoteTab = fileStore.openTabs.find(t => !isDiffTab(t) && t.connectionId === connId && t.path === file.path)
            if (remoteTab && !isDiffTab(remoteTab)) {
              const before = remoteTab.content ?? ''
              fileStore.reloadFileByPath(connId, file.path).then((after) => {
                if (after != null && after !== before) {
                  patchStore.upsertPreview({
                    target: 'remote',
                    path: file.path,
                    connectionId: connId,
                    toolName: file.kind === 'create' ? 'createFile' : 'writeFile',
                    beforeContent: before,
                    afterContent: after,
                  })
                }
              }).catch(() => {})
            } else {
              // 远程文件未在编辑器打开 → 通过 API 读取 afterContent
              fileStore.readRemoteFileContent(connId, file.path).then((after) => {
                if (after != null) {
                  patchStore.upsertPreview({
                    target: 'remote',
                    path: file.path,
                    connectionId: connId,
                    toolName: file.kind === 'create' ? 'createFile' : 'writeFile',
                    beforeContent: '',
                    afterContent: after,
                  })
                }
              }).catch(() => {})
            }
          }
        }
      },
      // projectContext: 注入当前打开的工程信息（本地文件夹 + 远程 SSH）
      (() => {
        // 优先取本地文件树
        const localRoot = useLocalFileStore.getState().rootPath
        if (localRoot) {
          const name = localRoot.split('/').filter(Boolean).pop() || ''
          return name ? { name, rootPath: localRoot } : null
        }
        // 兜底：取远程 SSH 文件树的当前工作目录
        const remoteCwd = currentPathByConnection[activeConnectionId || '']
        if (remoteCwd) {
          const name = remoteCwd.split('/').filter(Boolean).pop() || ''
          return name ? { name, rootPath: remoteCwd } : null
        }
        return null
      })(),
      // ── 新增 SSE 事件回调 ──
      // onPermissionConfirm: 权限确认请求 → 推入 permissionStore
      (permissionData) => {
        usePermissionStore.getState().pushConfirmation({
          ...permissionData,
          arrivedAt: Date.now(),
        })
      },
      // onToolOutput: 工具实时输出片段 → 更新输出面板
      (toolCallId, outputChunk) => {
        const outputStore = useOutputStore.getState()
        const entrySessionId = `tool-${toolCallId}`
        const existing = outputStore.entries.find((e) => e.sessionId === entrySessionId)
        if (existing) {
          outputStore.updateEntry(entrySessionId, {
            stdout: (existing.stdout || '') + outputChunk,
          })
        } else {
          // 首次收到输出片段，创建条目
          outputStore.addEntry({
            sessionId: entrySessionId,
            command: '',
            status: 'running' as const,
            stdout: outputChunk,
            stderr: '',
            exitCode: null,
            durationMs: null,
          })
        }
      },
      // onStatus: 状态更新消息 → 更新 streamStore
      (statusMessage) => {
        useStreamStore.getState().setStatusMessage(statusMessage)
      },
      // onWarning: 警告消息
      (_warningMessage) => {
      },
      // onRoundStart: 新轮次开始
      (_roundIndex) => {
      },
      // onReconnect: 流中途断开重连
      (attempt, _maxAttempts) => {
        useStreamStore.getState().setStatus('reconnecting')
        useStreamStore.getState().setRetrying(attempt)
      },
      // onHeartbeat: 后端心跳保活
      () => {
        useStreamStore.getState().touchActivity()
      },
      // inlineDatas: 多模态图片数据
      inlineDatas.length > 0 ? inlineDatas : undefined,
    )
  }

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current()
      abortRef.current = null
      setLoading(false)
    }
    toolProgressStore.clear()

    // 将当前 groupId 下所有 in_progress 工具消息标记为 failure
    if (currentSessionId) {
      const session = sessions.get(currentSessionId)
      if (session) {
        const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
        if (lastUserMsg?.groupId) {
          markGroupInProgressAsFailure(currentSessionId, lastUserMsg.groupId)
        }
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return
    const isModifier = e.metaKey || e.ctrlKey

    // --- 快捷键体系 ---
    // Ctrl/Cmd+L: 清空输入框
    if (isModifier && e.key === 'l') {
      e.preventDefault()
      if (inputRef.current) {
        inputRef.current.innerHTML = ''
        inputRef.current.focus()
      }
      return
    }
    // Ctrl/Cmd+Shift+Backspace: 清空当前会话消息（保留会话）
    if (isModifier && e.shiftKey && e.key === 'Backspace') {
      e.preventDefault()
      if (currentSessionId) {
        clearMessages(currentSessionId)
      }
      return
    }

    // --- 输入历史导航 ---
    // ↑: 上一条历史（光标在行首或输入框为空时）
    if (e.key === 'ArrowUp' && !e.shiftKey && !isModifier) {
      const text = inputRef.current?.innerText || ''
      // 只在输入框为空或光标在第一行时触发
      const selection = window.getSelection()
      const isFirstLine = !selection || selection.anchorOffset === 0 || text.indexOf('\n') === -1
      if (isFirstLine && (text.length === 0 || historyIndexRef.current !== -1)) {
        e.preventDefault()
        navigateHistoryUp()
        return
      }
    }
    // ↓: 下一条历史
    if (e.key === 'ArrowDown' && !e.shiftKey && !isModifier) {
      if (historyIndexRef.current !== -1) {
        const selection = window.getSelection()
        const text = inputRef.current?.innerText || ''
        const isLastLine = !selection || selection.anchorOffset === text.length || text.indexOf('\n') === -1
        if (isLastLine) {
          e.preventDefault()
          navigateHistoryDown()
          return
        }
      }
    }

    // --- 发送快捷键 ---
    const shouldSend =
      (e.key === 'Enter' && !e.shiftKey && sendOnEnter && !isModifier) ||
      (e.key === 'Enter' && isModifier && !sendOnEnter)
    if (shouldSend) {
      e.preventDefault()
      handleSend()
      return
    }
    if (e.key === 'Enter' && e.shiftKey) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !isModifier) {
      e.preventDefault()
    }
  }

  const selectSendMode = (mode: 'enter' | 'cmd') => {
    const next = mode === 'enter'
    setSendOnEnter(next)
    localStorage.setItem('sendOnEnter', String(next))
    setShowSendModeDropdown(false)
  }

  const canSend = (inputRef.current?.innerText.trim() || inputTags.length > 0) && currentAgentId && !isLoading

  return (
    <div className="relative flex flex-col h-full flex-shrink-0 overflow-hidden" style={{ width, backgroundColor: colors.bgPrimary }}>
      <PermissionConfirmModal />
      <StreamStatusBar />
      {/* 工具进度条 */}
      <ToolProgressBar />
      {(() => {
        const conn = activeBinding
          ? connections.find((c) => c.id === activeBinding.connectionId)
          : connections.find((c) => c.id === currentConnectionId)
        if (!conn) return null
        const connected = conn.status === 1
        return (
          <div className="flex items-center gap-2 px-4 py-1.5 border-b" style={{ backgroundColor: connected ? `${colors.accent}08` : `${colors.textDim}06`, borderColor: colors.border }}>
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: connected ? '#22c55e' : colors.textDim }} />
            <span className="text-[11px] truncate" style={{ color: colors.textDim }}>
              {conn.name}（{conn.username}@{conn.host}）{connected ? '' : ' · 未连接'}
            </span>
          </div>
        )
      })()}

      <div className="flex-1 overflow-y-auto min-h-0">
        {!currentSession ? (
          <EmptyState onQuickAction={(text) => {
            if (inputRef.current) {
              inputRef.current.innerText = text
              inputHtmlRef.current = inputRef.current.innerHTML
              setInputText(text)
              inputRef.current.focus()
            }
          }} />
        ) : currentSession.messages.length === 0 ? (
          <EmptyState onQuickAction={(text) => {
            if (inputRef.current) {
              inputRef.current.innerText = text
              inputHtmlRef.current = inputRef.current.innerHTML
              setInputText(text)
              inputRef.current.focus()
            }
          }} />
        ) : (
          <div className="py-3 overflow-hidden min-w-0">
            {/* 消息分组渲染：同 groupId 的 assistant 消息聚合为一个 AI 回合块 */}
            {(() => {
              type AiTurnItem = {
                type: 'aiTurn'
                groupId: string
                msgs: AgentMessage[]
                startIdx: number
                timestamp: number
                showDivider: boolean
                dividerTitle?: string
              }
              type SingleItem = {
                type: 'single'
                msg: AgentMessage
                msgIdx: number
                showDivider: boolean
                dividerTitle?: string
              }
              type RenderItem = AiTurnItem | SingleItem

              const items: RenderItem[] = []
              let i = 0
              while (i < currentSession.messages.length) {
                const msg = currentSession.messages[i]
                const showDivider = i > 0 && (() => {
                  const prev = currentSession.messages[i - 1]
                  if (msg.groupId && prev.groupId && msg.groupId !== prev.groupId) return true
                  return shouldInsertTopicDivider(prev, msg).shouldInsert
                })()
                const dividerTitle = i > 0 ? (() => {
                  const prev = currentSession.messages[i - 1]
                  if (msg.groupId && prev.groupId && msg.groupId !== prev.groupId) return '新对话'
                  return shouldInsertTopicDivider(prev, msg).title
                })() : undefined

                // 用户消息 → single
                if (msg.role === 'user') {
                  items.push({ type: 'single', msg, msgIdx: i, showDivider, dividerTitle })
                  i++
                  continue
                }

                // assistant 消息有 groupId → 聚合同 groupId 的所有 assistant 消息为一个 AI 回合
                if (msg.groupId && msg.role === 'assistant') {
                  const groupMsgs: AgentMessage[] = [msg]
                  let j = i + 1
                  while (j < currentSession.messages.length && currentSession.messages[j].groupId === msg.groupId && currentSession.messages[j].role === 'assistant') {
                    groupMsgs.push(currentSession.messages[j])
                    j++
                  }
                  items.push({ type: 'aiTurn', groupId: msg.groupId, msgs: groupMsgs, startIdx: i, timestamp: msg.timestamp, showDivider, dividerTitle })
                  i = j
                  continue
                }

                // 兜底：无 groupId 的 assistant 消息 → single
                items.push({ type: 'single', msg, msgIdx: i, showDivider, dividerTitle })
                i++
              }

              const { colors } = useThemeStore.getState()

              return items.map((item, idx) => {
                const dividerEl = item.showDivider ? (
                  <TopicDivider
                    prevTimestamp={currentSession.messages[item.type === 'single' ? item.msgIdx : item.startIdx - 1]?.timestamp || 0}
                    currTimestamp={item.type === 'single' ? item.msg.timestamp : item.timestamp}
                    topicIndex={item.type === 'single' ? item.msgIdx : item.startIdx}
                    defaultTitle={item.dividerTitle}
                  />
                ) : null

                // 用户消息或兜底单条消息
                if (item.type === 'single') {
                  return (
                    <React.Fragment key={`single_${item.msg.id}_${idx}`}>
                      {dividerEl}
                      <MessageBubble message={item.msg} isLoading={isLoading} onEditRetry={(msgId) => {
                        if (currentSessionId) {
                          editAndRetry(currentSessionId, msgId)
                          setTimeout(() => inputRef.current?.focus(), 50)
                        }
                      }} />
                    </React.Fragment>
                  )
                }

                // AI 回合块
                return (
                  <React.Fragment key={`aiturn_${item.groupId}_${idx}`}>
                    {dividerEl}
                    <AiTurnBlock msgs={item.msgs} colors={colors} isLoading={isLoading} streamStatus={streamStatus} onRetry={() => {
                      setErrorRecovery(null)
                      if (currentSession && currentSession.messages.length >= 2) {
                        const lastUserMsg = [...currentSession.messages].reverse().find(m => m.role === 'user')
                        if (lastUserMsg) {
                          const inputEl = inputRef.current
                          if (inputEl) {
                            inputEl.innerText = lastUserMsg.content || ''
                          }
                          setTimeout(() => handleSend(), 100)
                        }
                      } else if (inputRef.current) {
                        setTimeout(() => handleSend(), 100)
                      }
                    }} />
                  </React.Fragment>
                )
              })
            })()}
            {/* 错误恢复卡片 */}
            {errorRecovery && (
              <div className="px-4 py-2">
                <ErrorRecoveryCard
                  error={errorRecovery}
                  canRetry={true}
                  onRetry={() => {
                    setErrorRecovery(null)
                    if (currentSession && currentSession.messages.length >= 2) {
                      const lastUserMsg = [...currentSession.messages].reverse().find(m => m.role === 'user')
                      if (lastUserMsg) {
                        const inputEl = inputRef.current
                        if (inputEl) {
                          inputEl.innerText = lastUserMsg.content || ''
                        }
                        setTimeout(() => handleSend(), 100)
                      }
                    } else if (inputRef.current) {
                        setTimeout(() => handleSend(), 100)
                    }
                  }}
                  onSkip={() => setErrorRecovery(null)}
                  onResetContext={() => {
                    setErrorRecovery(null)
                    if (currentSessionId) {
                      useAgentStore.getState().clearMessages(currentSessionId)
                    }
                  }}
                />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="w-full h-3 cursor-ns-resize select-none flex items-center justify-center transition-colors hover:bg-blue-500/20 flex-shrink-0" title="拖拽调整输入框高度" onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const startY = e.clientY
        const startHeight = inputRef.current?.offsetHeight || 120
        const onMouseMove = (moveEvent: MouseEvent) => {
          const deltaY = startY - moveEvent.clientY
          const newHeight = Math.max(80, Math.min(280, startHeight + deltaY))
          if (inputRef.current) {
            inputRef.current.style.height = newHeight + 'px'
          }
        }
        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove)
          document.removeEventListener('mouseup', onMouseUp)
        }
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
      }}>
        <div className="flex gap-1 opacity-30">
          <div className="w-1 h-1 rounded-full bg-gray-400" />
          <div className="w-1 h-1 rounded-full bg-gray-400" />
        </div>
      </div>

      {/* 产物汇总面板 — 参考 Android 端设计，放在输入框上方 */}
      <ArtifactSummaryPanel />

      {/* SSH 未连接提示 */}
      {currentAgentId === '100000' && !activeTerminalSessionId && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-[11px] flex-shrink-0" style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#f59e0b', borderBottom: `1px solid ${colors.border}` }}>
          <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>未连接 SSH 终端，executeCommand 工具不可用。请先在终端中建立 SSH 连接。</span>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2 border-t flex-shrink-0" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all" style={{ backgroundColor: colors.bgTertiary, color: colors.textSecondary, border: '1px solid transparent' }}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
            </svg>
            拆解
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => currentAgentId && newConversation(currentAgentId)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all" style={{ backgroundColor: colors.bgTertiary, color: colors.textSecondary, border: '1px solid transparent' }} title="新建会话">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button onClick={() => setShowChatExport(true)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:opacity-80" style={{ backgroundColor: colors.bgTertiary, color: colors.textSecondary, border: '1px solid transparent' }} title="导出对话">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button onClick={() => setShowShortcutHelp(true)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:opacity-80" style={{ backgroundColor: colors.bgTertiary, color: colors.textSecondary, border: '1px solid transparent' }} title="快捷键">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M8 14h8" />
            </svg>
          </button>
          <button onClick={toggleHistoryPanel} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:opacity-80" style={{ backgroundColor: showHistoryPanel ? `${colors.accent}20` : colors.bgTertiary, color: showHistoryPanel ? colors.accent : colors.textSecondary, border: `1px solid ${showHistoryPanel ? `${colors.accent}40` : 'transparent'}` }} title="历史记录">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-col relative px-4 pt-2 pb-3 flex-shrink-0" style={{ backgroundColor: colors.bgSecondary }}>
        <div className="relative w-full rounded-lg border transition-all flex flex-col" style={{ backgroundColor: colors.bgInput, borderColor: isFocused ? `${colors.accent}80` : colors.border, boxShadow: isFocused ? `0 0 0 1px ${colors.accent}30` : 'none' }}>
          {inputTags.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3 pb-1 max-h-[100px] overflow-y-auto">
              {inputTags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] max-w-[200px] transition-shadow"
                  style={{
                    backgroundColor: colors.bgTertiary,
                    border: `1px solid ${colors.border}`,
                    color: colors.textSecondary,
                    cursor: tag.type === 'file' || tag.type === 'terminal-selection' ? 'pointer' : 'default',
                  }}
                  onDoubleClick={() => {
                    if (tag.type === 'file') {
                      // 从 fullContent 解析文件路径
                      const localMatch = tag.fullContent.match(/^本地文件:\s*(.+)$/m)
                      const remoteMatch = tag.fullContent.match(/^文件路径:\s*(.+)$/m)
                      const filePath = (localMatch?.[1] || remoteMatch?.[1] || '').trim()
                      if (!filePath) return
                      // 先尝试本地文件
                      const localStore = useLocalFileStore.getState()
                      const localTab = localStore.openTabs.find(t => t.path === filePath)
                      if (localTab) {
                        localStore.setActiveTab(localTab.key)
                        return
                      }
                      // 远程文件
                      const remoteStore = useFileExplorerStore.getState()
                      const remoteTab = remoteStore.openTabs.find(t => t.path === filePath)
                      if (remoteTab) {
                        remoteStore.setActiveTab(remoteTab.key)
                      }
                    } else if (tag.type === 'terminal-selection') {
                      // 终端选中文本标签 - 提示已在终端上下文
                      const tSessionId = activeBinding?.terminalSessionId
                      if (tSessionId) {
                        // 触发终端聚焦（如果有全局事件）
                        window.dispatchEvent(new CustomEvent('focus-terminal', { detail: { sessionId: tSessionId } }))
                      }
                    }
                  }}
                  title={tag.type === 'file' ? '双击跳转到文件' : tag.type === 'terminal-selection' ? '双击跳转到终端' : undefined}
                >
                  <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span className="truncate">{tag.label}</span>
                  <button onClick={() => removeInputTag(tag.id)} className="p-0.5 rounded hover:bg-black/10 flex-shrink-0" style={{ color: colors.textDim }}>
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            key={inputKey}
            ref={inputRef}
            contentEditable={!isLoading}
            suppressContentEditableWarning
            onInput={(e) => {
              setInputText(e.currentTarget.innerText.replace(/\u00a0/g, ' '))
              inputHtmlRef.current = e.currentTarget.innerHTML
              // CommandMenu 检测
              const cursorPos = window.getSelection()?.anchorOffset || 0
              const text = e.currentTarget.innerText.replace(/\u00a0/g, ' ')
              const cmdMenu = useCommandMenu(text, Math.min(cursorPos, text.length), mentionItems)
              if (cmdMenu.trigger) {
                setCmdMenuTrigger(cmdMenu.trigger)
                setCmdMenuIndex(cmdMenu.triggerIndex)
                setCmdMenuQuery(cmdMenu.query)
              } else {
                setCmdMenuTrigger(null)
              }
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onMouseUp={() => {
              const selection = window.getSelection()
              if (selection && selection.rangeCount > 0 && inputRef.current?.contains(selection.anchorNode)) {
                lastRangeRef.current = selection.getRangeAt(0).cloneRange()
              }
            }}
            onPaste={(e) => {
              e.preventDefault()
              // 优先检查剪贴板中的图片数据
              const imageItems = Array.from(e.clipboardData.items).filter(
                (item) => item.type.startsWith('image/')
              )
              if (imageItems.length > 0) {
                const imageFile = imageItems[0].getAsFile()
                if (imageFile) {
                  const reader = new FileReader()
                  reader.onload = (ev) => {
                    const dataUrl = ev.target?.result as string
                    if (!dataUrl) return
                    insertTagAtCursor({
                      id: `img_${Date.now()}`,
                      label: `图片: ${imageFile.name || '粘贴图片'}`,
                      fullContent: `[图片: ${imageFile.name || '粘贴图片'}]\n${dataUrl}`,
                      type: 'custom',
                    })
                  }
                  reader.readAsDataURL(imageFile)
                  return
                }
              }
              // 无图片时，走纯文本粘贴流程
              const rawText = e.clipboardData.getData('text/plain')
              const cleanText = stripMarkdownForPaste(rawText)
              document.execCommand('insertText', false, cleanText)
              syncInputTextFromDom()
            }}
            className="w-full bg-transparent resize-none outline-none text-[13px] leading-relaxed flex-1 whitespace-pre-wrap break-words min-h-[120px] max-h-[280px] overflow-y-auto"
            style={{
              color: isLoading ? colors.textDim : colors.text,
              padding: inputTags.length > 0 ? '4px 16px 44px 16px' : '8px 16px 44px 16px',
            }}
          />

          {(!inputText || inputText.trim() === '') && inputTags.length === 0 && (
            <div className="absolute pointer-events-none text-sm" style={{ left: '16px', top: '8px', color: colors.textDim, opacity: 0.6 }}>
              {inputPlaceholder()}
            </div>
          )}

          <div className="absolute right-3 bottom-3 flex items-center gap-1.5">
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); setShowAttachmentMenu(!showAttachmentMenu) }} className="p-1.5 rounded-md transition-colors hover:bg-black/10" style={{ backgroundColor: colors.bgTertiary, color: colors.textSecondary }} title="添加上下文">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              {showAttachmentMenu && (
                <div className="absolute bottom-full right-0 mb-1 w-32 rounded-lg border shadow-lg py-1 z-50" style={{ backgroundColor: colors.bgPrimary, borderColor: colors.border }}>
                  <button onClick={handleAddCurrentFile} disabled={!activeTabKey} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" style={{ color: colors.text }}>
                    添加当前文件
                  </button>
                  <button onClick={handleAddCurrentFolder} disabled={!activeConnectionId} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" style={{ color: colors.text }}>
                    添加当前目录
                  </button>
                  <button onClick={handleAddSelectedText} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/5 transition-colors" style={{ color: colors.text }}>
                    添加选中文本
                  </button>
                </div>
              )}
            </div>
            <label className="p-1.5 rounded-md transition-colors hover:bg-black/10 cursor-pointer" style={{ backgroundColor: colors.bgTertiary, color: colors.textSecondary }} title="上传图片">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = (ev) => {
                    const dataUrl = ev.target?.result as string
                    if (!dataUrl) return
                    // 将图片作为上下文标签插入输入框
                    insertTagAtCursor({
                      id: `img_${Date.now()}`,
                      label: `图片: ${file.name}`,
                      fullContent: `[图片: ${file.name}]\n${dataUrl}`,
                      type: 'custom',
                    })
                  }
                  reader.readAsDataURL(file)
                  // 重置 input 以允许重复选择同一文件
                  e.target.value = ''
                }}
              />
            </label>
            {isLoading ? (
              <button onClick={handleStop} className="p-1.5 rounded-md transition-colors" style={{ backgroundColor: colors.red, color: '#fff' }} title="停止">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button onClick={handleSend} disabled={!canSend} className="p-1.5 rounded-md transition-colors" style={{ backgroundColor: canSend ? colors.accent : colors.bgTertiary, color: canSend ? '#fff' : colors.textSecondary, opacity: canSend ? 1 : 0.5, cursor: canSend ? 'pointer' : 'not-allowed' }} title="发送">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* CommandMenu 弹出 */}
        {cmdMenuTrigger && (
          <CommandMenu
            trigger={cmdMenuTrigger}
            query={cmdMenuQuery}
            mentions={mentionItems}
            onSelect={(item) => {
              if (cmdMenuTrigger === '/') {
                // 命令选择：替换输入框内容或执行操作
                if (item.insertText) {
                  if (inputRef.current) {
                    const text = inputRef.current.innerText
                    const before = text.slice(0, cmdMenuIndex)
                    const after = text.slice(cmdMenuIndex + cmdMenuQuery.length + 1)
                    inputRef.current.innerText = before + item.insertText + after
                    setInputText(inputRef.current.innerText)
                    // 光标移到末尾
                    const range = document.createRange()
                    range.selectNodeContents(inputRef.current)
                    range.collapse(false)
                    const sel = window.getSelection()
                    sel?.removeAllRanges()
                    sel?.addRange(range)
                  }
                } else if (item.id === 'connect') {
                  // 打开 SSH 连接配置弹窗，切换到服务器标签
                  window.dispatchEvent(new CustomEvent('open-ssh-modal'))
                } else if (item.id === 'disconnect') {
                  // 断开当前活跃连接
                  const conn = activeBinding
                    ? connections.find(c => c.id === activeBinding.connectionId)
                    : connections.find(c => c.id === currentConnectionId)
                  if (conn) {
                    useConnectionStore.getState().disconnect(conn.id)
                  }
                } else if (item.id === 'clear') {
                  if (currentSessionId) useAgentStore.getState().clearMessages(currentSessionId)
                } else if (item.id === 'reset') {
                  // TODO: 重置上下文 API 待后端提供
                } else if (item.id === 'export') {
                  // 导出对话
                  if (currentSession) {
                    const md = currentSession.messages.map(m => `### ${m.role === 'user' ? '🧑 用户' : '🤖 助手'}\n\n${m.content}`).join('\n---\n')
                    const blob = new Blob([md], { type: 'text/markdown' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `对话_${new Date().toISOString().slice(0, 10)}.md`
                    a.click()
                    URL.revokeObjectURL(url)
                  }
                } else if (item.id === 'debug') {
                  // 调试模式：发送提示让 AI 显示详细执行过程
                  if (inputRef.current) {
                    inputRef.current.innerText = '请开启调试模式，显示详细的 ReAct 执行过程'
                    setInputText(inputRef.current.innerText)
                  }
                } else if (item.id === 'help') {
                  // 帮助：发送提示让 AI 列出可用命令
                  if (inputRef.current) {
                    inputRef.current.innerText = '请列出可用的命令和快捷键'
                    setInputText(inputRef.current.innerText)
                  }
                }
              } else {
                // @ 提及选择：插入标签
                if (inputRef.current) {
                  const text = inputRef.current.innerText
                  const before = text.slice(0, cmdMenuIndex)
                  const after = text.slice(cmdMenuIndex + cmdMenuQuery.length + 1)
                  inputRef.current.innerText = before + item.insertText + ' ' + after
                  setInputText(inputRef.current.innerText)
                }
              }
              setCmdMenuTrigger(null)
            }}
            onClose={() => setCmdMenuTrigger(null)}
          />
        )}

        <div className="flex items-center mt-2 text-[11px]" style={{ color: colors.textDim }}>
          <div className="relative" style={{ zIndex: 10 }}>
            <select value={currentAgentId || ''} onChange={(e) => setCurrentAgentId(e.target.value)} className="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer transition-colors appearance-none pr-6" style={{ backgroundColor: colors.bgTertiary, color: colors.textSecondary, fontSize: '11px', border: 'none' }}>
              {agents.length === 0 && <option value="">加载中...</option>}
              {agents.map((agent) => (
                <option key={agent.agentId} value={agent.agentId}>
                  {agent.agentName}
                </option>
              ))}
            </select>
            <svg className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ width: 12, height: 12, color: colors.textSecondary, opacity: 0.6 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
          <div className="flex-1" />
          <div className="relative">
            <button onClick={() => setShowSendModeDropdown(!showSendModeDropdown)} className="flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer transition-colors hover:bg-black/10" style={{ backgroundColor: 'transparent', color: colors.textDim }} title="点击选择发送快捷键">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              {sendOnEnter ? (
                <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>Enter 发送</span>
              ) : (
                <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{currentKeyLabel} 发送</span>
              )}
            </button>
            {showSendModeDropdown && (
              <div className="absolute bottom-full right-0 mb-1 rounded-lg border shadow-lg py-1 min-w-[140px]" style={{ backgroundColor: colors.bgPrimary, borderColor: colors.border }}>
                <button onClick={() => selectSendMode('enter')} className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors" style={{ fontSize: '11px', color: sendOnEnter ? colors.accent : colors.textSecondary }}>
                  {sendOnEnter && (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  )}
                  <span>Enter 发送</span>
                </button>
                <button onClick={() => selectSendMode('cmd')} className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors" style={{ fontSize: '11px', color: !sendOnEnter ? colors.accent : colors.textSecondary }}>
                  {!sendOnEnter && (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  )}
                  <span>{currentKeyLabel} 发送</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* P2: 快捷键面板 */}
      <ShortcutHelp open={showShortcutHelp} onClose={() => setShowShortcutHelp(false)} />
      {/* P2: 导出面板 */}
      <ChatExport
        open={showChatExport}
        onClose={() => setShowChatExport(false)}
        messages={currentSession?.messages || []}
        sessionTitle={currentSession?.name}
      />
    </div>
  )
}
