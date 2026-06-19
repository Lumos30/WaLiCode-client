import { useRef, useEffect, useState } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { useAgentStore } from '../stores/agentStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useSshAgentStore } from '../stores/sshAgentStore'
import { useFileExplorerStore } from '../stores/fileExplorerStore'
import { useLocalFileStore } from '../stores/localFileStore'
import * as agentApi from '../api/agent'
import type { AgentMessage } from '../types'
import type { ReActStep, TaskBreakdownDTO } from '../api/agent'
import { ConnectionStatus } from '../types'
import { TaskBreakdownCard } from './TaskBreakdownCard'

// ===== ReAct 步骤渲染 =====
const STEP_COLORS: Record<string, string> = {
  thinking: '#f59e0b',
  tool_call: '#8b5cf6',
  result: '#22c55e',
}

function ToolCallView({ step, colors }: { step: ReActStep; colors: ReturnType<typeof useThemeStore.getState>['colors'] }) {
  const [expanded, setExpanded] = useState(false)
  const isSuccess = step.status === 'success'
  const isFailure = step.status === 'failure'
  const isInProgress = step.status === 'in_progress'
  // 检测是否为子代理调用
  const isSubAgent = step.toolName?.startsWith('🤖')
  // Cursor 风格图标：沙漏(执行中) / 绿勾(成功) / 红叉(失败) / 🤖(子代理)
  const statusIcon = isSubAgent
    ? (<span className="text-sm flex-shrink-0">🤖</span>)
    : isFailure
    ? (<svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="#ef4444"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>)
    : isSuccess
      ? (<svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="#22c55e"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>)
      : (<svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="2s" repeatCount="indefinite"/></svg>)
  const resultText = step.toolResult || ''
  const hasResult = resultText.length > 0
  return (
    <div className={`rounded-lg overflow-hidden transition-opacity ${isInProgress ? 'opacity-80' : ''}`} style={{
      border: `1px solid ${isFailure ? '#ef444440' : isInProgress ? `${colors.accent}30` : `${colors.border}`}`,
      backgroundColor: colors.bgSecondary,
    }}>
      {/* 头部：工具名 + 状态 — Cursor 风格紧凑布局 */}
      <button
        onClick={() => hasResult && setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/5"
        style={{ cursor: hasResult ? 'pointer' : 'default' }}
      >
        {statusIcon}
        <span className="text-[12px] font-mono font-semibold flex-shrink-0" style={{ color: isSubAgent ? '#8b5cf6' : colors.accent }}>
          {step.toolName || '工具'}
        </span>
        {step.toolParams && (
          <span className="text-[11px] font-mono truncate flex-1 min-w-0" style={{ color: colors.textDim }}>
            {step.toolParams.length > 60 ? step.toolParams.substring(0, 60) + '...' : step.toolParams}
          </span>
        )}
        {!step.toolParams && <div className="flex-1" />}
        {isInProgress && (
          <span className="text-[10px] flex-shrink-0 px-1.5 py-0.5 rounded-full animate-pulse" style={{
            backgroundColor: isSubAgent ? '#8b5cf615' : `${STEP_COLORS.tool_call}15`,
            color: isSubAgent ? '#8b5cf6' : STEP_COLORS.tool_call,
          }}>{isSubAgent ? '子代理运行中' : '执行中'}</span>
        )}
        {hasResult && !isInProgress && (
          <span className="text-[10px] flex-shrink-0" style={{ color: colors.textDim }}>
            {expanded ? '收起' : `${resultText.length} 字节`}
          </span>
        )}
        {hasResult && (
          <svg className={`w-3.5 h-3.5 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>
      {/* 展开内容：工具结果 */}
      {hasResult && expanded && (
        <div className="px-3 pb-2.5 border-t" style={{ borderColor: colors.border }}>
          <pre className="text-[11px] mt-2 px-2.5 py-2 rounded-md overflow-x-auto leading-relaxed" style={{
            backgroundColor: colors.bgPrimary,
            color: colors.text,
            fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '320px',
            overflowY: 'auto',
            lineHeight: '1.5',
          }}>
            {resultText}
          </pre>
        </div>
      )}
      {/* 错误信息 */}
      {step.error && (
        <div className="px-3 pb-2 text-[11px] flex items-start gap-1.5" style={{ color: '#ef4444' }}>
          <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {step.error}
        </div>
      )}
    </div>
  )
}

function ThinkingStepView({ step, colors }: { step: ReActStep; colors: ReturnType<typeof useThemeStore.getState>['colors'] }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{
      backgroundColor: `${STEP_COLORS.thinking}08`,
      border: `1px solid ${STEP_COLORS.thinking}20`,
    }}>
      <svg className="w-3.5 h-3.5 flex-shrink-0 animate-pulse" style={{ color: STEP_COLORS.thinking }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/>
        <path d="M9 21h6"/>
      </svg>
      <span className="text-[11px]" style={{ color: colors.textSecondary }}>
        {step.content || '思考中...'}
      </span>
    </div>
  )
}

/**
 * ProcessTimeline — Cursor 风格工具调用折叠面板
 *
 * 核心特性：
 * 1. 进度条动画（执行中显示红色进度条，完成后变绿）
 * 2. 对话结束后自动折叠（所有步骤都完成时默认折叠）
 * 3. 折叠头显示统计（N 次工具）+ 状态圆点预览
 * 4. 展开后每个工具调用独立卡片，带状态图标
 */
function ProcessTimeline({ steps, colors, isStreaming, isLoading }: { 
  steps: ReActStep[]; 
  colors: ReturnType<typeof useThemeStore.getState>['colors']; 
  isStreaming?: boolean;
  isLoading?: boolean;
}) {
  // 过滤掉 result 类型（最终结果单独展示为对话气泡）
  const processSteps = steps.filter(s => s.stepType !== 'result')
  if (processSteps.length === 0) return null

  // 判断是否全部完成（无 in_progress 状态的步骤）
  const allDone = processSteps.every(s => s.status !== 'in_progress')
  // 默认行为：流式输出时展开，全部完成后自动折叠
  const [collapsed, setCollapsed] = useState(() => !isStreaming)
  
  // 当流式结束或加载状态变为 false 时自动折叠
  useEffect(() => {
    const shouldAutoCollapse = allDone && !isStreaming && !isLoading && !collapsed
    if (shouldAutoCollapse) {
      // 延迟 1.5s 自动折叠，让用户看到完成状态
      const timer = setTimeout(() => setCollapsed(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [allDone, isStreaming, isLoading, collapsed])
  
  // 流式开始时自动展开
  useEffect(() => {
    if ((isStreaming || isLoading) && collapsed) {
      setCollapsed(false)
    }
  }, [isStreaming, isLoading])

  const toolCount = processSteps.filter(s => s.stepType === 'tool_call').length
  const thinkingCount = processSteps.filter(s => s.stepType === 'thinking').length
  const successCount = processSteps.filter(s => s.status === 'success').length
  const failCount = processSteps.filter(s => s.status === 'failure').length
  const progressPercent = processSteps.length > 0 
    ? Math.round((successCount + failCount) / processSteps.length * 100) 
    : 100
  // 进度条颜色：执行中红/橙，完成绿
  const progressColor = allDone 
    ? (failCount > 0 ? '#ef4444' : '#22c55e')
    : '#ef4444'

  return (
    <div className="mb-2 rounded-lg overflow-hidden" style={{
      border: `1px solid ${colors.border}40`,
      backgroundColor: `${colors.bgSecondary}60`,
    }}>
      {/* ===== 折叠头（始终可见）===== */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 transition-colors hover:bg-black/5"
        style={{ color: colors.textDim }}
      >
        {/* 展开/收起箭头 */}
        <svg className={`w-3.5 h-3.5 transition-transform duration-200 flex-shrink-0 ${collapsed ? 'rotate-0' : '-rotate-90'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        
        {/* 文字标签 */}
        <span className="text-[11px] font-medium select-none">
          {collapsed ? '展开过程' : '收起过程'}
        </span>
        
        {/* 统计数字 */}
        <span className="text-[11px] font-medium tabular-nums" style={{ color: colors.textSecondary }}>
          {toolCount > 0 && `${toolCount} 次工具`}
          {thinkingCount > 0 && toolCount > 0 && ' · '}
          {thinkingCount > 0 && `${thinkingCount} 轮思考`}
        </span>
        
        <div className="flex-1" />
        
        {/* 状态圆点预览（最多显示 6 个） */}
        <div className="flex gap-1 items-center">
          {processSteps.slice(0, 6).map((s, i) => (
            <div key={i} className="w-1.5 h-1.5 rounded-full transition-colors" style={{
              backgroundColor: s.status === 'failure' ? '#ef4444'
                : s.status === 'success' ? '#22c55e'
                : STEP_COLORS[s.stepType] || colors.accent,
            }} />
          ))}
          {processSteps.length > 6 && (
            <span className="text-[9px] ml-0.5" style={{ color: colors.textDim }}>+{processSteps.length - 6}</span>
          )}
        </div>
      </button>

      {/* ===== 进度条（折叠头下方，类似截图中的红色横条）===== */}
      <div className="h-0.5 w-full overflow-hidden" style={{ backgroundColor: `${colors.border}30` }}>
        <div 
          className="h-full transition-all duration-500 ease-out"
          style={{ 
            width: `${progressPercent}%`, 
            backgroundColor: progressColor,
            // 执行中时带脉冲动画
            animation: allDone ? 'none' : 'progress-pulse 1.5s ease-in-out infinite',
          }} 
        />
      </div>

      {/* ===== 展开内容：工具调用列表 ===== */}
      {!collapsed && (
        <div className="px-2 pb-2 space-y-1.5 animate-in slide-in-from-top-1 duration-200">
          {processSteps.map((step, i) => {
            if (step.stepType === 'tool_call') {
              return <ToolCallView key={i} step={step} colors={colors} />
            }
            if (step.stepType === 'thinking') {
              return <ThinkingStepView key={i} step={step} colors={colors} />
            }
            return null
          })}
        </div>
      )}
    </div>
  )
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const mo = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const h = d.getHours()
  const ap = h < 12 ? '上午' : '下午'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${mo}-${day} ${ap}${h12}:${m}`
}

function CopyButton({ text, isUser, colors }: { text: string; isUser: boolean; colors: ReturnType<typeof useThemeStore.getState>['colors'] }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <button
      onClick={handleCopy}
      title="复制消息"
      className="rounded cursor-pointer transition-all hover:opacity-80 flex items-center justify-center"
      style={{
        padding: '2px 4px',
        backgroundColor: isUser ? 'rgba(0,0,0,0.15)' : colors.bgSecondary,
        color: isUser ? 'rgba(255,255,255,0.95)' : colors.textSecondary,
        border: isUser ? '1px solid rgba(0,0,0,0.1)' : `1px solid ${colors.border}`,
      }}
    >
      {copied ? (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      ) : (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      )}
    </button>
  )
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const { colors } = useThemeStore()
  const { isLoading } = useAgentStore()
  const isUser = message.role === 'user'

  const formatMarkdown = (text: string): string => {
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    // 1. 分割线 --- / *** / ___
    html = html.replace(/^(?:---|\*{3}|_{3})\s*$/gm,
      `<hr style="border:none;border-top:1px solid ${colors.border}40;margin:8px 0;" />`)

    // 2. 标题 ## / ### / #### （必须在其他规则之前）
    html = html.replace(/^#### (.+)$/gm, '<h4 style="font-size:12px;font-weight:600;color:${colors.text};margin:10px 0 4px;">$1</h4>')
    html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:13px;font-weight:600;color:${colors.text};margin:12px 0 5px;">$1</h3>')
    html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:14px;font-weight:600;color:${colors.text};margin:14px 0 6px;">$1</h2>')
    html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:16px;font-weight:700;color:${colors.text};margin:16px 0 6px;">$1</h1>')

    // 3. 代码块（必须在行内代码之前，避免被误匹配）
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
      return `<pre style="margin:6px 0;padding:10px;border-radius:6px;overflow-x:auto;font-size:11px;font-family:'JetBrains Mono',monospace;background:${colors.bgSecondary};color:${colors.text};border:1px solid ${colors.border}"><code>${code.trim()}</code></pre>`
    })

    // 4. 引用块 >
    html = html.replace(/^>\s?(.*)(?:\n>\s?(.*))*/gm, (match) => {
      const content = match.replace(/^>\s?/gm, '')
      return `<blockquote style="border-left: 3px solid ${colors.accent}; margin: 4px 0; padding-left: 8px; color: ${colors.textDim}; background: ${colors.bgSecondary}80; padding-top: 4px; padding-bottom: 4px; border-radius: 0 4px 4px 0;">${content}</blockquote>`
    })

    // 5. 无序列表 - item / * item
    html = html.replace(/^[ 	]*[-*+] (.+)$/gm, '<li style="margin-left:16px;list-style-type:disc;color:${colors.text};line-height:1.6;">$1</li>')

    // 6. 有序列表 1. item
    html = html.replace(/^[ \t]*\d+\. (.+)$/gm, '<li style="margin-left:16px;list-style-type:decimal;color:${colors.text};line-height:1.6;">$1</li>')

    // 7. 行内代码
    html = html.replace(/`([^`]+)`/g, `<code style="padding:1px 5px;border-radius:3px;font-size:11px;font-family:monospace;background:${colors.bgHover};color:${colors.accent};border:1px solid ${colors.border}">$1</code>`)

    // 8. 粗体
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

    // 9. 斜体
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')

    // 10. 换行（最后执行）
    html = html.replace(/\n/g, '<br/>')

    return html
  }

  // 对于有 steps 的 assistant 消息，复制按钮应使用最终展示内容
  const copyText = isUser ? message.content : (message.steps && message.steps.length > 0
    ? (message.steps.find(s => s.stepType === 'result' && s.content)?.content || message.content || '')
    : message.content || '')
  const timeStr = formatTime(message.timestamp)
  const timeBar = (
    <div className={`flex items-center gap-1.5 mt-1 ${isUser ? 'justify-end' : 'justify-start'}`} style={{ fontSize: '10px', color: colors.textDim }}>
      {isUser && copyText && <CopyButton text={copyText} isUser={isUser} colors={colors} />}
      <span>{timeStr}</span>
      {!isUser && copyText && <CopyButton text={copyText} isUser={false} colors={colors} />}
    </div>
  )

  if (message.steps && message.steps.length > 0) {
    // 分离 result 步骤和过程步骤
    const resultStep = message.steps.find(s => s.stepType === 'result' && s.content)
    const hasProcessSteps = message.steps.some(s => s.stepType !== 'result')
    // 最终展示内容：优先取 result 步骤的 content，其次取 message.content（流式过程中）
    const displayContent = resultStep?.content || message.content

    return (
      <div className="px-4 py-1.5 flex justify-start">
        <div className="flex flex-col items-start max-w-[88%]">
          {/* 任务拆解卡片 */}
          {message.taskBreakdown && message.taskBreakdown.subTasks && message.taskBreakdown.subTasks.length > 0 && (
            <TaskBreakdownCard breakdown={message.taskBreakdown} />
          )}
          {/* 过程时间线（Cursor 风格可折叠面板） */}
          {hasProcessSteps && (
            <ProcessTimeline 
              steps={message.steps} 
              colors={colors} 
              isStreaming={!resultStep && message.content === ''}
              isLoading={isLoading} 
            />
          )}
          {/* AI 回复内容（独立对话气泡） */}
          {displayContent && (
            <div
              className="px-3.5 py-2.5 text-[13px] leading-relaxed"
              style={{
                backgroundColor: colors.bgTertiary,
                color: colors.text,
                borderRadius: '12px 12px 12px 2px',
              }}
              dangerouslySetInnerHTML={{ __html: formatMarkdown(displayContent) }}
            />
          )}
          {/* 流式加载指示器 */}
          {!displayContent && !resultStep && (
            <div className="px-3.5 py-2.5 flex items-center gap-2" style={{ backgroundColor: colors.bgTertiary, borderRadius: '12px 12px 12px 2px' }}>
              <div className="flex gap-1">
                {[0, 150, 300].map((delay) => (
                  <span key={delay} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: `pulse-dot 1.4s ${delay}ms infinite ease-in-out both` }} />
                ))}
              </div>
            </div>
          )}
          {timeBar}
        </div>
      </div>
    )
  }

  return (
    <div className={`px-4 py-1.5 ${isUser ? 'flex justify-end' : 'flex justify-start'}`}>
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className="max-w-[88%] px-3.5 py-2.5 text-[13px] leading-relaxed"
          style={{
            backgroundColor: isUser ? colors.accent : colors.bgTertiary,
            color: isUser ? '#fff' : colors.text,
            borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          }}
          dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }}
        />
        {timeBar}
      </div>
    </div>
  )
}

interface RightSidebarProps {
  width?: number
  activeTerminalSessionId?: string | null
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildContextSpanHtml(tag: { id: string; label: string; type: string; fullContent: string }) {
  const icon = tag.type === 'file' ? '📄' : tag.type === 'terminal-selection' ? '🖥️' : '📎'
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 mx-1 rounded-md border text-[12px] align-middle select-none" data-context="${escapeHtml(encodeURIComponent(JSON.stringify(tag)))}" contenteditable="false" style="background:rgba(59,130,246,0.12);border-color:rgba(59,130,246,0.35);color:inherit;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;">
    <span>${icon}</span>
    <span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(tag.label)}</span>
    <span contenteditable="false" data-remove-context="true" class="ml-0.5 opacity-70 hover:opacity-100">✕</span>
  </span>&nbsp;`
}

export function RightSidebar({ width = 400, activeTerminalSessionId }: RightSidebarProps) {
  const { colors } = useThemeStore()
  const {
    sessions,
    currentSessionId,
    inputText,
    setInputText,
    addMessage,
    updateMessage,
    updateMessageSteps,
    updateMessageTaskBreakdown,
    updateSubTaskStatus,
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
  const {
    activeBinding,
    bindTerminal,
    inputTags,
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
        console.log('[RightSidebar] Auto-bound to:', connection.name)
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

  const insertTagAtCursor = (tag: { id: string; label: string; type: string; fullContent: string }) => {
    if (!inputRef.current) return
    const span = document.createElement('span')
    span.innerHTML = buildContextSpanHtml(tag)
    const selection = window.getSelection()
    const range = lastRangeRef.current && inputRef.current.contains(lastRangeRef.current.commonAncestorContainer)
      ? lastRangeRef.current
      : selection && selection.rangeCount > 0 && inputRef.current.contains(selection.anchorNode)
        ? selection.getRangeAt(0)
        : null

    const wrapper = document.createElement('span')
    wrapper.innerHTML = buildContextSpanHtml(tag)
    const node = wrapper.firstChild as Node

    if (range) {
      range.deleteContents()
      range.insertNode(node)
      const space = document.createTextNode('\u00A0')
      node.parentNode?.insertBefore(space, node.nextSibling)
      range.setStartAfter(space)
      range.setEndAfter(space)
      selection?.removeAllRanges()
      selection?.addRange(range)
      lastRangeRef.current = range.cloneRange()
    } else {
      inputRef.current.appendChild(node)
      inputRef.current.appendChild(document.createTextNode('\u00A0'))
    }
    inputRef.current.focus()
    syncInputTextFromDom()
  }

  const handleAddCurrentFile = () => {
    // 先检查本地文件
    const localTab = useLocalFileStore.getState().openTabs.find(
      (t) => t.key === useLocalFileStore.getState().activeTabKey
    )
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
    if (!tab || !tab.content) return
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
        
        insertTagAtCursor({
          id: `sel_${Date.now()}`,
          label: `选中: ${fileName}`,
          fullContent: `${prefix}: ${filePath}\n选中的代码/文本:\n\`\`\`\n${text}\n\`\`\``,
          type: 'terminal-selection',
        })
      }
    }
    setShowAttachmentMenu(false)
  }

  const handleSend = async () => {
    if (isLoading || !currentAgentId || !inputRef.current) return
    const domHtml = inputRef.current.innerHTML
    const plainText = inputRef.current.innerText.replace(/\u00a0/g, ' ').trim()
    if ((!plainText && inputTags.length === 0) || isLoading) return

    if (!currentSessionId) {
      await createServerSession(currentAgentId)
    }
    const sessionId = useAgentStore.getState().currentSessionId
    if (!sessionId) return

    let messageContent = plainText
    let displayContent = domHtml

    const tagsContent = getInputTagsContent()
    if (tagsContent) {
      const formattedTagsContent = tagsContent.split('\n').map(line => `> ${line}`).join('\n')
      messageContent = plainText
        ? `${plainText}\n\n**参考上下文：**\n${formattedTagsContent}`
        : `**参考上下文：**\n${formattedTagsContent}`
      const displayTags = inputTags.map(tag => {
        const contentLines = tag.fullContent.split('\n')
        const firstFewLines = contentLines.slice(0, 3).join(' ')
        const preview = firstFewLines.length > 80 ? firstFewLines.substring(0, 80) + '...' : firstFewLines
        return `> 📎 **${tag.label}**\n> ${preview}`
      }).join('\n>\n')
      displayContent = plainText ? `${plainText}\n\n${displayTags}` : displayTags
      // 发送后清空文件标签，避免残留
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

    const userMessage: AgentMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: displayContent,
      timestamp: Date.now(),
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

    let assistantId = `msg_${Date.now() + 1}`
    const assistantMessage: AgentMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      steps: [],
    }
    addMessage(sessionId, assistantMessage)

    let fullContent = ''
    const steps: ReActStep[] = []

    abortRef.current = agentApi.reactChatStream(
      currentAgentId,
      'default',
      sessionId,
      messageContent,
      (step: ReActStep) => {
        console.log('[onStep]', step.stepType, step.content?.substring(0, 80))
        steps.push(step)
        updateMessageSteps(sessionId, assistantId, steps)

        // 检测文件操作工具完成 → 刷新文件树 + 重载编辑器
        if (step.stepType === 'tool_call' && step.status === 'success' && step.toolName) {
          const fileWriteTools = ['writeLocalFile', 'createLocalFile', 'deleteLocalFile', 'writeFile']
          if (fileWriteTools.includes(step.toolName)) {
            console.log('[onStep] 文件操作工具完成，刷新文件树和编辑器:', step.toolName)
            // 刷新本地文件树
            const { rootPath, refreshDirectory } = useLocalFileStore.getState()
            if (rootPath) {
              refreshDirectory(rootPath).catch(() => {})
            }
            // 重载当前活动文件内容
            useLocalFileStore.getState().reloadActiveFile().catch(() => {})
          }
        }
      },
      (fullText: string) => {
        console.log('[onText]', fullText.substring(0, 80))
        fullContent = fullText
        updateMessage(sessionId, assistantId, fullContent)
      },
      (finalContent: string) => {
        console.log('[onDone] finalContent=', finalContent?.substring(0, 80))
        if (finalContent) {
          fullContent = finalContent
          updateMessage(sessionId, assistantId, fullContent)
        }
        abortRef.current = null
        setLoading(false)
      },
      (err: string) => {
        console.error('[reactChatStream] error:', err)
        updateMessage(sessionId, assistantId, `请求失败: ${err}`)
        abortRef.current = null
        setLoading(false)
      },
      activeTerminalSessionId || undefined,
      // onTaskBreakdown: 展示任务拆解卡片
      (breakdown: TaskBreakdownDTO) => {
        console.log('[onTaskBreakdown]', breakdown.summary, breakdown.subTasks?.length)
        updateMessageTaskBreakdown(sessionId, assistantId, breakdown)
      },
      // onTaskProgress: 更新子任务状态
      (progress) => {
        console.log('[onTaskProgress]', progress.subTaskIndex, progress.status)
        updateSubTaskStatus(sessionId, assistantId, progress.subTaskIndex, progress.status)
      },
      // onSubAgent: 子代理调用/结果（日志记录，UI 在 steps 中展示）
      (subAgentInfo) => {
        console.log('[onSubAgent]', subAgentInfo.agentName, subAgentInfo.status, subAgentInfo.task || subAgentInfo.result || '')
      },
    )
  }

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current()
      abortRef.current = null
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return
    const isModifier = e.metaKey || e.ctrlKey
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
    <div className="flex flex-col h-full flex-shrink-0 overflow-hidden" style={{ width, backgroundColor: colors.bgPrimary }}>
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
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
            <img src="/logo.png" alt="WaLiSSH" className="w-14 h-14 mb-2 opacity-60 rounded" />
            <h3 className="text-base font-medium" style={{ color: colors.text }}>开始对话</h3>
            <p className="text-xs text-center max-w-xs leading-relaxed" style={{ color: colors.textSecondary }}>
              连接 SSH 后，可以向我询问服务器状态、执行命令、排查问题、管理文件。
            </p>
          </div>
        ) : currentSession.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
            <img src="/logo.png" alt="WaLiSSH" className="w-10 h-10 opacity-50 rounded" />
            <div className="text-center">
              <p className="text-sm font-medium mb-1" style={{ color: colors.text }}>WaLiSSH AI</p>
              <p className="text-xs" style={{ color: colors.textDim }}>执行命令 · 排查问题 · 管理服务器</p>
            </div>
            <div className="w-full max-w-xs space-y-1.5">
              {['检查服务器状态', '分析日志文件', '部署应用', '排查报错'].map((text) => (
                <button key={text} onClick={() => {
                  if (inputRef.current) {
                    inputRef.current.innerText = text;
                    inputHtmlRef.current = inputRef.current.innerHTML;
                    setInputText(text);
                    inputRef.current.focus();
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.selectNodeContents(inputRef.current);
                    range.collapse(false);
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                  }
                }} className="w-full text-left px-3 py-2 rounded-md text-xs transition-colors hover:opacity-80" style={{ color: colors.textSecondary, backgroundColor: colors.bgTertiary, border: `1px solid ${colors.border}` }}>
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-3">
            {currentSession.messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isLoading && (
              <div className="px-4 py-2 flex justify-start">
                <div className="px-3.5 py-2.5 flex items-center gap-2" style={{ backgroundColor: colors.bgTertiary, borderRadius: '12px 12px 12px 2px' }}>
                  <div className="flex gap-1">
                    {[0, 150, 300].map((delay) => (
                      <span key={delay} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: `pulse-dot 1.4s ${delay}ms infinite ease-in-out both` }} />
                    ))}
                  </div>
                  <span className="text-[11px]" style={{ color: colors.textDim }}>思考中...</span>
                </div>
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
          <button className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all" style={{ backgroundColor: colors.bgTertiary, color: colors.textSecondary, border: '1px solid transparent' }} title="历史记录">
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
                <div key={tag.id} className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] max-w-[200px]" style={{ backgroundColor: colors.bgTertiary, border: `1px solid ${colors.border}`, color: colors.textSecondary }}>
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
              const text = e.clipboardData.getData('text/plain')
              document.execCommand('insertText', false, text)
              syncInputTextFromDom()
            }}
            className="w-full bg-transparent resize-none outline-none text-[13px] leading-relaxed flex-1 whitespace-pre-wrap break-words min-h-[120px] max-h-[280px] overflow-y-auto"
            style={{
              color: isLoading ? colors.textDim : colors.text,
              padding: inputTags.length > 0 ? '4px 16px 44px 16px' : '8px 16px 44px 16px',
            }}
          />

          {(!inputText || inputText.trim() === '') && (
            <div className="absolute pointer-events-none text-sm" style={{ left: '16px', top: inputTags.length > 0 ? '42px' : '8px', color: colors.textDim, opacity: 0.6 }}>
              {inputPlaceholder()}
            </div>
          )}

          <div className="absolute right-3 bottom-3 flex items-center gap-1.5">
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); setShowAttachmentMenu(!showAttachmentMenu) }} className="p-1.5 rounded-md transition-colors hover:bg-black/10" style={{ backgroundColor: colors.bgTertiary, color: colors.textSecondary }} title="添加上下文">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
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
            <button disabled className="p-1.5 rounded-md cursor-not-allowed" style={{ backgroundColor: colors.bgTertiary, color: colors.textDim, opacity: 0.5 }} title="功能开发中">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
            </button>
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
    </div>
  )
}
