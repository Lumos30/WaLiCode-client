import React, { memo, useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { all } from 'lowlight'
import { useThemeStore } from '../stores/themeStore'
import type { AgentMessage } from '../types'
import type { ReActStep } from '../api/agent'
import { SessionSummaryCard } from './SessionSummaryCard'

// ===== 代码块组件 =====
function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const { colors } = useThemeStore()
  const [copied, setCopied] = useState(false)
  const lang = className?.replace('language-', '') || 'text'
  const text = String(children || '').replace(/\n$/, '')

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative group/code my-2" style={{ borderRadius: '6px', overflow: 'hidden', border: `1px solid ${colors.border}` }}>
      <div className="flex items-center justify-between px-3 py-1" style={{ backgroundColor: colors.bgSecondary, borderBottom: `1px solid ${colors.border}` }}>
        <span className="text-[10px] font-mono" style={{ color: colors.textDim }}>{lang}</span>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover/code:opacity-100 transition-opacity flex items-center gap-1 text-[10px]"
          style={{ color: colors.textSecondary }}
        >
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      <pre className="px-3 py-2.5 overflow-x-auto text-[11px] leading-relaxed max-w-full" style={{ backgroundColor: colors.bgPrimary, fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", monospace' }}>
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

// ===== <think> 思考过程组件 =====
function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const { colors } = useThemeStore()
  const [open, setOpen] = useState(isStreaming)

  // 流式结束时自动可折叠（但不强制折叠，保持用户体验）
  React.useEffect(() => {
    if (isStreaming) setOpen(true)
  }, [isStreaming])

  return (
    <details
      open={open}
      className="mb-3 rounded-lg overflow-hidden"
      style={{ backgroundColor: `${colors.bgSecondary}80`, border: `1px solid ${colors.border}40` }}
    >
      <summary
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden transition-colors hover:bg-black/5"
        onClick={(e) => { e.preventDefault(); setOpen(!open) }}
      >
        <div className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: `${colors.accent}20` }}>
          {isStreaming ? (
            <svg className="w-3 h-3 animate-spin" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg className="w-3 h-3" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
        <span className="text-[11px] font-medium" style={{ color: colors.textSecondary }}>
          {isStreaming ? '思考中...' : '思考过程'}
        </span>
        <div className="flex-1" />
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="px-3 pb-3 pt-1 text-[12px] italic" style={{ color: colors.textSecondary }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { languages: all, aliases: { vue: 'xml', ts: 'typescript', tsx: 'typescript', jsx: 'javascript' } }]]}
          components={{
            code: ({ className: cn, children }: { className?: string; children?: React.ReactNode }) => <CodeBlock className={cn}>{children}</CodeBlock>,
            p: ({ children }: { children?: React.ReactNode }) => <p className="m-0 mb-2 last:mb-0 leading-relaxed">{children}</p>,
            ul: ({ children }: { children?: React.ReactNode }) => <ul className="m-0 mb-2 pl-4 list-disc">{children}</ul>,
            ol: ({ children }: { children?: React.ReactNode }) => <ol className="m-0 mb-2 pl-4 list-decimal">{children}</ol>,
            li: ({ children }: { children?: React.ReactNode }) => <li className="m-0 mb-1">{children}</li>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </details>
  )
}

// ===== Markdown 渲染组件 =====
function MarkdownContent({ content, colors, isUser }: { content: string; colors: ReturnType<typeof useThemeStore.getState>['colors']; isUser?: boolean }) {
  // 用户气泡内的文字色：确保在 userBubble 背景上清晰可读
  const textColor = isUser ? colors.userBubbleText : colors.text
  const linkColor = isUser ? '#93c5fd' : colors.accent  // 用户消息用亮蓝链接，AI 消息用主题 accent
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { languages: all, aliases: { vue: 'xml', ts: 'typescript', tsx: 'typescript', jsx: 'javascript' } }]]}
      components={{
        code: ({ className, children }: { className?: string; children?: React.ReactNode }) => <CodeBlock className={className}>{children}</CodeBlock>,
        p: ({ children }: { children?: React.ReactNode }) => <p className="m-0 mb-2 last:mb-0 leading-relaxed">{children}</p>,
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline cursor-pointer" style={{ color: linkColor }}>
            {children}
          </a>
        ),
        ul: ({ children }: { children?: React.ReactNode }) => <ul className="m-0 mb-2 pl-4 list-disc">{children}</ul>,
        ol: ({ children }: { children?: React.ReactNode }) => <ol className="m-0 mb-2 pl-4 list-decimal">{children}</ol>,
        li: ({ children }: { children?: React.ReactNode }) => <li className="m-0 mb-1">{children}</li>,
        h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-[15px] font-bold mt-3 mb-1.5" style={{ color: textColor }}>{children}</h1>,
        h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-[14px] font-bold mt-3 mb-1" style={{ color: textColor }}>{children}</h2>,
        h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-[13px] font-semibold mt-2.5 mb-1" style={{ color: textColor }}>{children}</h3>,
        h4: ({ children }: { children?: React.ReactNode }) => <h4 className="text-[12px] font-semibold mt-2 mb-0.5" style={{ color: textColor }}>{children}</h4>,
        blockquote: ({ children }: { children?: React.ReactNode }) => (
          <blockquote className="my-1.5 pl-3 py-1 rounded-r" style={{
            borderLeft: `3px solid ${isUser ? '#7aa2f7' : colors.accent}`,
            backgroundColor: isUser ? 'rgba(255,255,255,0.08)' : `${colors.bgSecondary}80`,
            color: isUser ? textColor : colors.textDim
          }}>
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-2 border-0" style={{ borderTop: `1px solid ${colors.border}40` }} />,
        table: ({ children }: { children?: React.ReactNode }) => (
          <div className="overflow-x-auto">
            <table className="my-2 w-full max-w-full text-[11px] border-collapse table-fixed" style={{ border: `1px solid ${colors.border}` }}>{children}</table>
          </div>
        ),
        thead: ({ children }: { children?: React.ReactNode }) => <thead style={{ backgroundColor: colors.bgSecondary }}>{children}</thead>,
        th: ({ children }: { children?: React.ReactNode }) => <th className="px-2 py-1 text-left font-semibold border" style={{ borderColor: colors.border, color: textColor }}>{children}</th>,
        td: ({ children }: { children?: React.ReactNode }) => <td className="px-2 py-1 border" style={{ borderColor: colors.border, color: textColor }}>{children}</td>,
        strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold" style={{ color: textColor }}>{children}</strong>,
        em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

// ===== ReAct 步骤渲染（从 RightSidebar 迁移）=====
const STEP_COLORS: Record<string, string> = {
  thinking: '#f59e0b',
  tool_call: '#8b5cf6',
  result: '#22c55e',
}

function ToolCallView({ step, colors, compact }: { step: ReActStep; colors: ReturnType<typeof useThemeStore.getState>['colors']; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const isSuccess = step.status === 'success'
  const isFailure = step.status === 'failure'
  const isInProgress = step.status === 'in_progress'
  const isSubAgent = step.toolName?.startsWith('🤖')
  const statusIcon = isSubAgent
    ? (<span className="text-sm flex-shrink-0">🤖</span>)
    : isFailure
    ? (<svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="#ef4444"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>)
    : isSuccess
      ? (<svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="#22c55e"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>)
      : (<svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="2s" repeatCount="indefinite"/></svg>)
  const resultText = step.toolResult || ''
  const hasResult = resultText.length > 0

  // 判断结果类型：JSON、代码、纯文本
  const isJsonResult = resultText.trimStart().startsWith('{') || resultText.trimStart().startsWith('[')
  const isFileRead = step.toolName === 'readFile' || step.toolName === 'readLocalFile'
  let formattedResult = resultText
  let resultLang = 'text'
  if (isJsonResult) {
    try {
      formattedResult = JSON.stringify(JSON.parse(resultText), null, 2)
      resultLang = 'json'
    } catch {}
  } else if (isFileRead) {
    const extMatch = step.toolParams?.match(/\.(\w+)(?:\s|$|,)/)
    if (extMatch) {
      const ext = extMatch[1].toLowerCase()
      const langMap: Record<string, string> = {
        java: 'java', js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
        py: 'python', go: 'go', rs: 'rust', rb: 'ruby', php: 'php',
        xml: 'xml', html: 'xml', vue: 'xml', css: 'css', scss: 'css',
        json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml',
        sh: 'bash', bash: 'bash', zsh: 'bash',
        sql: 'sql', md: 'markdown',
      }
      resultLang = langMap[ext] || 'text'
    }
  }

  // 紧凑模式：单行展示，无背景无边框
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded group/tool hover:bg-black/5 transition-colors min-w-0">
        {statusIcon}
        <span className="text-[11px] font-mono font-medium truncate flex-shrink-0" style={{ color: isSubAgent ? '#8b5cf6' : colors.accent }}>
          {step.toolName || '工具'}
        </span>
        {step.toolParams && (
          <span className="text-[10px] font-mono truncate flex-1 min-w-0" style={{ color: colors.textDim }}>
            {step.toolParams.length > 40 ? step.toolParams.substring(0, 40) + '...' : step.toolParams}
          </span>
        )}
        {hasResult && !isInProgress && (
          <span className="text-[9px] flex-shrink-0 px-1 rounded" style={{ color: isSuccess ? '#22c55e' : '#ef4444', backgroundColor: isSuccess ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>
            {isSuccess ? '✓' : '✗'} {resultText.length > 999 ? `${(resultText.length/1000).toFixed(1)}k` : resultText.length}B
          </span>
        )}
        {isInProgress && (
          <span className="text-[9px] animate-pulse flex-shrink-0" style={{ color: STEP_COLORS.tool_call }}>执行中...</span>
        )}
      </div>
    )
  }

  return (
    <div className={`rounded-lg overflow-hidden transition-opacity ${isInProgress ? 'opacity-80' : ''} min-w-0`} style={{
      border: `1px solid ${isFailure ? '#ef444440' : isInProgress ? `${colors.accent}30` : `${colors.border}`}`,
      backgroundColor: colors.bgSecondary,
    }}>
      <button
        onClick={() => hasResult && setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/5 overflow-hidden"
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
        {!step.toolParams && <div className="flex-1 min-w-0" />}
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
      {hasResult && expanded && (
        <div className="px-3 pb-2.5 border-t" style={{ borderColor: colors.border }}>
          <div className="flex justify-end mt-1.5">
            <button
              onClick={() => navigator.clipboard.writeText(formattedResult)}
              className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:opacity-80"
              style={{ color: colors.textDim, backgroundColor: colors.bgTertiary }}
            >
              复制
            </button>
          </div>
          <pre className="text-[11px] mt-1 px-2.5 py-2 rounded-md overflow-x-auto leading-relaxed" style={{
            backgroundColor: colors.bgPrimary,
            color: colors.text,
            fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '320px',
            overflowY: 'auto',
            lineHeight: '1.5',
          }}>
            {resultLang !== 'text' ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[[rehypeHighlight, { languages: all, aliases: { vue: 'xml', ts: 'typescript', tsx: 'typescript', jsx: 'javascript' } }]]}
                components={{
                  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => (
                    <code className={className}>{children}</code>
                  ),
                }}
              >
                {`\`\`\`${resultLang}\n${formattedResult}\n\`\`\``}
              </ReactMarkdown>
            ) : (
              formattedResult
            )}
          </pre>
        </div>
      )}
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

function ThinkingStepView({ step, colors, compact }: { step: ReActStep; colors: ReturnType<typeof useThemeStore.getState>['colors']; compact?: boolean }) {
  // 紧凑模式：单行无背景
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded group/think hover:bg-black/5 transition-colors min-w-0">
        <svg className="w-3 h-3 flex-shrink-0" style={{ color: STEP_COLORS.thinking, opacity: 0.7 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/>
          <path d="M9 21h6"/>
        </svg>
        <span className="text-[10px] italic truncate flex-1 min-w-0" style={{ color: colors.textDim }}>
          {step.content || '思考中...'}
        </span>
      </div>
    )
  }
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

// ===== ProcessTimeline（从 RightSidebar 迁移）=====
function ProcessTimeline({ steps, colors, isStreaming, isLoading }: {
  steps: ReActStep[]
  colors: ReturnType<typeof useThemeStore.getState>['colors']
  isStreaming?: boolean
  isLoading?: boolean
}) {
  const processSteps = steps.filter(s => s.stepType !== 'result')
  if (processSteps.length === 0) return null

  const allDone = processSteps.every(s => s.status !== 'in_progress')
  // 对话完成时默认折叠（不管 isStreaming 首次值如何）
  const [collapsed, setCollapsed] = useState(() => true)
  const [showAll, setShowAll] = useState(false)
  // 追踪流式状态跳变：isStreaming isLoading 从 true→false 时触发自动折叠
  const prevStreamingRef = useRef(isStreaming || isLoading)
  // 追踪用户是否手动操作过折叠/展开
  const userToggledRef = useRef(false)
  // 是否已经触发过自动折叠（防止重复）
  const autoCollapsedRef = useRef(false)

  React.useEffect(() => {
    // 流式/加载中 → 强制展开
    if ((isStreaming || isLoading) && collapsed) {
      setCollapsed(false)
      autoCollapsedRef.current = false  // 重置，允许再次自动折叠
    }
  }, [isStreaming, isLoading])

  // 核心自动折叠：检测 isStreaming||isLoading 从 true→false 的跳变
  React.useEffect(() => {
    const wasStreaming = prevStreamingRef.current
    const nowStreaming = isStreaming || isLoading
    prevStreamingRef.current = nowStreaming
    // 从流式中 → 流式结束 且全部完成 → 1.5s 后自动折叠
    if (wasStreaming && !nowStreaming && allDone && !userToggledRef.current && !autoCollapsedRef.current) {
      const timer = setTimeout(() => {
        setCollapsed(true)
        autoCollapsedRef.current = true
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [allDone, isStreaming, isLoading])

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

  // 智能折叠：步骤 >5 个且非流式时，折叠中间步骤
  const MAX_COLLAPSED = 5  // 折叠模式下最多显示数量
  const shouldSmartCollapse = !showAll && !isStreaming && !isLoading && allDone && processSteps.length > MAX_COLLAPSED + 2
  // 紧凑模式：步骤较多时使用单行展示（无背景无边框），点击可展开完整视图
  const useCompactMode = !isStreaming && !isLoading && allDone && processSteps.length > 8
  const visibleSteps = shouldSmartCollapse
    ? [
        ...processSteps.slice(0, 2),
        ...processSteps.slice(-2),
      ]
    : processSteps
  const hiddenCount = processSteps.length - visibleSteps.length

  return (
    <div className="mb-2 rounded-lg overflow-hidden min-w-0" style={{
      border: `1px solid ${colors.border}40`,
      backgroundColor: `${colors.bgSecondary}60`,
    }}>
      <button
        onClick={() => { userToggledRef.current = true; setCollapsed(!collapsed) }}
        className="w-full flex items-center gap-2 px-3 py-2 transition-colors hover:bg-black/5 overflow-hidden"
        style={{ color: colors.textDim }}
      >
        <svg className={`w-3.5 h-3.5 transition-transform duration-200 flex-shrink-0 ${collapsed ? 'rotate-0' : '-rotate-90'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="text-[11px] font-medium select-none">
          {collapsed ? '展开过程' : '收起过程'}
        </span>
        <span className="text-[11px] font-medium tabular-nums" style={{ color: colors.textSecondary }}>
          {toolCount > 0 && `${toolCount} 次工具`}
          {thinkingCount > 0 && toolCount > 0 && ' · '}
          {thinkingCount > 0 && `${thinkingCount} 轮思考`}
        </span>
        {failCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{
            backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444',
          }}>
            {failCount} 失败
          </span>
        )}
        <div className="flex-1" />
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
      {!collapsed && (
        <div className="px-2 pb-2 space-y-1.5 animate-in slide-in-from-top-1 duration-200">
          {visibleSteps.map((step, i) => {
            // 在折叠点插入摘要行
            const isBeforeGap = shouldSmartCollapse && i === 2
            if (isBeforeGap) {
              return (
                <React.Fragment key={`gap-${i}`}>
                  <button
                    onClick={() => setShowAll(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-colors hover:bg-black/5"
                    style={{
                      border: `1px dashed ${colors.border}60`,
                      backgroundColor: `${colors.bgPrimary}40`,
                    }}
                  >
                    <svg className="w-3 h-3" style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="6" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18" r="1"/>
                    </svg>
                    <span className="text-[10px]" style={{ color: colors.textDim }}>
                      展开中间 {hiddenCount} 个步骤
                    </span>
                  </button>
                  {step.stepType === 'tool_call' ? <ToolCallView key={i} step={step} colors={colors} compact={useCompactMode} />
                    : step.stepType === 'thinking' ? <ThinkingStepView key={i} step={step} colors={colors} compact={useCompactMode} /> : null}
                </React.Fragment>
              )
            }
            if (step.stepType === 'tool_call') return <ToolCallView key={i} step={step} colors={colors} compact={useCompactMode} />
            if (step.stepType === 'thinking') return <ThinkingStepView key={i} step={step} colors={colors} compact={useCompactMode} />
            return null
          })}
          {shouldSmartCollapse && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-colors hover:bg-black/5"
              style={{
                border: `1px dashed ${colors.border}60`,
                backgroundColor: `${colors.bgPrimary}40`,
              }}
            >
              <span className="text-[10px]" style={{ color: colors.textDim }}>
                展开全部 {processSteps.length} 个步骤
              </span>
            </button>
          )}
          {showAll && !shouldSmartCollapse && processSteps.length > MAX_COLLAPSED + 2 && (
            <button
              onClick={() => setShowAll(false)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-colors hover:bg-black/5"
              style={{
                border: `1px dashed ${colors.border}60`,
                backgroundColor: `${colors.bgPrimary}40`,
              }}
            >
              <span className="text-[10px]" style={{ color: colors.textDim }}>
                折叠中间步骤
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ===== 复制按钮 =====
function CopyButton({ text, isUser, colors }: { text: string; isUser: boolean; colors: ReturnType<typeof useThemeStore.getState>['colors'] }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={handleCopy}
      title="复制消息"
      className="rounded cursor-pointer transition-all hover:opacity-80 flex items-center justify-center"
      style={{
        padding: '2px 4px',
        backgroundColor: isUser ? 'rgba(0,0,0,0.18)' : colors.bgSecondary,
        color: isUser ? colors.userBubbleText : colors.textSecondary,
        border: isUser ? '1px solid rgba(0,0,0,0.15)' : `1px solid ${colors.border}`,
      }}
    >
      {copied ? (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  )
}

// ===== 时间格式化 =====
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

// ===== 内容分割：提取 <think> 块 =====
function splitThinkTags(content: string): Array<{ type: 'think' | 'text'; content: string; isStreaming?: boolean }> {
  const parts: Array<{ type: 'think' | 'text'; content: string; isStreaming?: boolean }> = []
  const regex = /<think>([\s\S]*?)(<\/think>|$)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) })
    }
    const isStreaming = match[2] !== '</think>'
    parts.push({ type: 'think', content: match[1].trim(), isStreaming })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) })
  }
  return parts
}

// ===== MessageBubble 主组件 =====
export const MessageBubble = memo(function MessageBubble({ message, isLoading, onEditRetry }: {
  message: AgentMessage
  isLoading?: boolean
  onEditRetry?: (messageId: string) => void
}) {
  const { colors } = useThemeStore()
  const isUser = message.role === 'user'

  // 对于有 steps 的 assistant 消息，复制按钮应使用最终展示内容
  const copyText = isUser ? message.content : (message.steps && message.steps.length > 0
    ? (message.steps.find(s => s.stepType === 'result' && s.content)?.content || message.content || '')
    : message.content || '')

  const timeStr = formatTime(message.timestamp)
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

  // ===== 有 steps 的 assistant 消息 =====
  if (message.steps && message.steps.length > 0) {
    const resultStep = message.steps.find(s => s.stepType === 'result' && s.content)
    const hasProcessSteps = message.steps.some(s => s.stepType !== 'result')
    const displayContent = resultStep?.content || message.content
    const isStreaming = !resultStep && message.content === ''

    // 分割 <think> 标签
    const contentParts = displayContent ? splitThinkTags(displayContent) : []

    return (
      <div className="px-4 py-1.5 flex justify-start overflow-hidden">
        <div className="flex flex-col items-start max-w-[88%] min-w-0">
          {/* 过程时间线 */}
          {hasProcessSteps && (
            <ProcessTimeline
              steps={message.steps}
              colors={colors}
              isStreaming={isStreaming}
              isLoading={isLoading}
            />
          )}
          {/* AI 回复内容（带 think 标签解析） */}
          {contentParts.length > 0 ? (
            <div
              className="px-3.5 py-2.5 text-[13px] leading-relaxed overflow-hidden min-w-0"
              style={{
                backgroundColor: colors.bgTertiary,
                color: colors.text,
                borderRadius: '12px 12px 12px 2px',
                maxWidth: '100%',
              }}
            >
              {contentParts.map((part, idx) => {
                if (part.type === 'think') {
                  return <ThinkingBlock key={idx} content={part.content} isStreaming={part.isStreaming || false} />
                }
                if (!part.content.trim()) return null
                return <MarkdownContent key={idx} content={part.content} colors={colors} />
              })}
            </div>
          ) : !resultStep && !displayContent ? (
            /* 流式加载指示器 */
            <div className="px-3.5 py-2.5 flex items-center gap-2" style={{ backgroundColor: colors.bgTertiary, borderRadius: '12px 12px 12px 2px' }}>
              <div className="flex gap-1">
                {[0, 150, 300].map((delay) => (
                  <span key={delay} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent, animation: `pulse-dot 1.4s ${delay}ms infinite ease-in-out both` }} />
                ))}
              </div>
            </div>
          ) : null}
          {/* 文件变更摘要卡片 */}
          {message.changeSummary && (
            <SessionSummaryCard summary={message.changeSummary} />
          )}
          {timeBar}
        </div>
      </div>
    )
  }

  // ===== 普通消息（用户 / 无 steps 的 assistant）=====
  const contentParts = message.content ? splitThinkTags(message.content) : []

  return (
    <div className={`px-4 py-1.5 ${isUser ? 'flex justify-end' : 'flex justify-start'} overflow-hidden`}>
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[88%] min-w-0`}>
        <div
          className="w-full px-3.5 py-2.5 text-[13px] leading-relaxed overflow-hidden"
          style={{
            backgroundColor: isUser ? colors.userBubble : colors.bgTertiary,
            color: isUser ? colors.userBubbleText : colors.text,
            borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
            maxWidth: '100%',
          }}
        >
          {contentParts.map((part, idx) => {
            if (part.type === 'think') {
              return <ThinkingBlock key={idx} content={part.content} isStreaming={part.isStreaming || false} />
            }
            if (!part.content.trim()) return null
            if (isUser) {
              // 用户消息纯文本渲染（支持简单 Markdown）
              return <MarkdownContent key={idx} content={part.content} colors={colors} isUser />
            }
            return <MarkdownContent key={idx} content={part.content} colors={colors} />
          })}
        </div>
        {timeBar}
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // 自定义比较：只在消息内容或加载状态变化时重渲染
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.steps === nextProps.message.steps &&
    prevProps.message.taskBreakdown === nextProps.message.taskBreakdown &&
    prevProps.message.changeSummary === nextProps.message.changeSummary &&
    prevProps.isLoading === nextProps.isLoading
  )
})
