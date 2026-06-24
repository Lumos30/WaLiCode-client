import React, { memo, useState, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { common } from 'lowlight'
import { useThemeStore } from '../stores/themeStore'
import type { AgentMessage } from '../types'
import type { ReActStep } from '../api/agent'
import { SessionSummaryCard } from './SessionSummaryCard'
import { TypewriterRenderer } from './TypewriterRenderer'
import { MessageActionMenu } from './MessageActionMenu'
import { CollapsibleContent } from './CollapsibleContent'
import { useAiPatchStore } from '../stores/aiPatchStore'

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

// ===== 文件路径提取（从 ToolGroup 中）=====
// extractFilePathFromGroup 已移至 ArtifactSummaryPanel 使用，此处不再需要
// function extractFilePathFromGroup(group: ToolGroup): string | null { ... }

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
          rehypePlugins={[[rehypeHighlight, { languages: common, aliases: { vue: 'xml', ts: 'typescript', tsx: 'typescript', jsx: 'javascript' } }]]}
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

// ===== Markdown 格式规范化 =====
// AI 模型（尤其 Gemini/Google ADK）返回的 Markdown 经常缺少换行符，
// 导致标题、列表、表格、水平线等元素粘在一行，ReactMarkdown 无法正确解析。
// 在前端渲染前做统一处理，确保内容符合 CommonMark 规范。
function normalizeMarkdown(text: string): string {
  if (!text) return text
  let result = text

  // ══════ Phase 0: 保护代码块 ══════
  const codeBlocks: string[] = []
  result = result.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m)
    return `\x00CB${codeBlocks.length - 1}\x00`
  })

  // ══════ Phase 1: 表格 || → |\n| ══════
  result = result.replace(/\|\|/g, '|\n|')

  // ══════ Phase 2: 断行 ══════

  // 2a. 标题后无空格 → 补空格 (##标题 → ## 标题)
  result = result.replace(/(#{1,6})([^\s#\n])/g, '$1 $2')
  // 2b. 标题前断行
  result = result.replace(/([^\n#])(#{1,6}\s)/g, '$1\n\n$2')
  // 2c. 标题后紧跟 ** → 断行（不含列表标记中的数字）
  result = result.replace(/(#{1,6}\s[^\n#*\d]+?)(\*\*)/g, '$1\n\n$2')
  // 2d. 标题后紧跟 | → 断行
  result = result.replace(/(#{1,6}\s[^|\n]+)(\|)/g, '$1\n\n$2')

  // 2e. 标题+正文粘连：用句首模式检测
  const sentenceStarts = ['这是一个', '这是', '它是', '该系统', '该项目', '我们', '以下', '其中', '它通过', '它基于']
  result = result.replace(/^(#{1,6}\s)([^\n]+)$/gm, (match, prefix, content) => {
    for (const start of sentenceStarts) {
      const idx = content.indexOf(start)
      if (idx >= 2 && idx <= 12) {
        return prefix + content.substring(0, idx) + '\n\n' + content.substring(idx)
      }
    }
    return match
  })

  // 2f. 有序列表前断行
  result = result.replace(/([^\n])(\d+\.\s)/g, '$1\n$2')
  // 2g. 代码块前断行
  result = result.replace(/([^\n])(```)/g, '$1\n$2')
  // 2h. 分割线前后断行
  result = result.replace(/([^\n-])(---)/g, '$1\n$2')
  result = result.replace(/(---)([^\n|-])/g, '$1\n$2')

  // ══════ Phase 3: 间距修复 ══════
  result = result.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
  result = result.replace(/(^|\n)(#{1,6}\s[^\n]+)(\n)(?!\n|#{1,6}\s)/gm, '$1$2$3\n')
  result = result.replace(/([^\n])\n(```)/g, '$1\n\n$2')
  result = result.replace(/([^\n|])\n(\|)/g, '$1\n\n$2')
  result = result.replace(/(\|[^\n]+)\n(?!\n|\|)([^\n|])/g, '$1\n\n$2')
  result = result.replace(/([^\n])\n(---)/g, '$1\n\n$2')
  result = result.replace(/(---)\n([^\n])/g, '$1\n\n$2')
  // 列表项之间保持紧凑
  result = result.replace(/(\d+\.\s[^\n]+)\n\n(\d+\.\s)/g, '$1\n$2')

  // ══════ Phase 4: 表格分隔行格式化 ══════
  result = result.replace(/^\|([-:\s|]+)\|$/gm, (match, inner: string) => {
    if (!inner.includes('-')) return match
    const cells = inner.split('|').map(c => ' ' + c.trim() + ' ')
    return '|' + cells.join('|') + '|'
  })

  // ══════ Phase 4.5: 单行长文本拆分 ══════
  // 按中文句末标点（。！？）或英文句末标点（.!?）后跟中文/大写字母 → 插入换行
  result = result.replace(/([。！？!?])([\u4e00-\u9fa5A-Z])/g, '$1\n\n$2')

  // ══════ Phase 5: 清理 ══════
  result = result.replace(/\n{3,}/g, '\n\n')

  // ══════ Phase 6: 恢复代码块 ══════
  result = result.replace(/\x00CB(\d+)\x00/g, (_m, idx: string) => {
    return codeBlocks[parseInt(idx)]
  })

  return result
}

// ===== Markdown 渲染组件 =====
function MarkdownContent({ content, colors, isUser }: { content: string; colors: ReturnType<typeof useThemeStore.getState>['colors']; isUser?: boolean }) {
  // 用户气泡内的文字色：确保在 userBubble 背景上清晰可读
  const textColor = isUser ? colors.userBubbleText : colors.text
  const linkColor = isUser ? '#93c5fd' : colors.accent  // 用户消息用亮蓝链接，AI 消息用主题 accent

  // 如果 content 为空或 undefined，不渲染
  if (!content || !content.trim()) {
    return null
  }

  // 先规范化 Markdown 格式，再处理 data:image
  const normalizedContent = useMemo(() => normalizeMarkdown(content), [content])
  const contentWithImages = useMemo(
    () => normalizedContent.replace(/(?<!\]\()(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]{100,})/g, (match) => `![](${match})`),
    [normalizedContent]
  )

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { languages: common, aliases: { vue: 'xml', ts: 'typescript', tsx: 'typescript', jsx: 'javascript' } }]]}
      components={{
        // 自定义 pre：避免 react-markdown 默认 pre 与 CodeBlock 内部 pre 嵌套
        pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
        code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
          // 判断是否为代码块（父节点为 pre）或行内代码
          const isBlock = className?.startsWith('language-') || (typeof children === 'string' && children.includes('\n'))
          if (isBlock) {
            return <CodeBlock className={className}>{children}</CodeBlock>
          }
          // 行内代码
          return <code className="px-1 py-0.5 rounded text-[12px]" style={{ backgroundColor: `${colors.border}30`, fontFamily: '"SF Mono", "JetBrains Mono", monospace', color: colors.text }}>{children}</code>
        },
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
        strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-bold" style={{ color: textColor }}>{children}</strong>,
        em: ({ children }: { children?: React.ReactNode }) => <em style={{ color: colors.textSecondary }}>{children}</em>,
        img: ({ src, alt }: { src?: string; alt?: string }) => {
          // 只渲染 data:image URL 和 http(s) 图片，过滤掉超长的纯文本误匹配
          if (!src || src.length < 100) return null
          // 用户消息中：紧凑缩略图卡片样式
          if (isUser) {
            return (
              <div
                className="inline-flex items-center gap-2.5 px-3 py-2 rounded-lg my-1.5 max-w-[240px] cursor-pointer transition-colors hover:opacity-80"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  border: `1px solid ${colors.border}50`,
                }}
                onClick={() => window.open(src, '_blank')}
                title="点击放大"
              >
                <img
                  src={src}
                  alt={alt || '上传的图片'}
                  className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                  style={{ border: `1px solid ${colors.border}30` }}
                />
                <span className="text-[11px] truncate" style={{ color: colors.textSecondary }}>
                  📎 {alt || '图片'}
                </span>
              </div>
            )
          }
          // AI 消息中：正常大图预览
          return (
            <img
              src={src}
              alt={alt || '上传的图片'}
              className="max-w-full max-h-64 rounded-lg my-2 object-contain cursor-pointer"
              style={{ border: `1px solid ${colors.border}40` }}
              onClick={() => window.open(src, '_blank')}
              title="点击放大"
            />
          )
        },
      }}
    >
      {contentWithImages}
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
                rehypePlugins={[[rehypeHighlight, { languages: common, aliases: { vue: 'xml', ts: 'typescript', tsx: 'typescript', jsx: 'javascript' } }]]}
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

// ===== ProcessTimeline 辅助函数 =====

/** 从 toolParams/toolResult 中提取语义化标签 */
function extractToolLabel(step: ReActStep): string {
  const params = step.toolParams || ''
  const result = step.toolResult || ''
  const toolName = step.toolName || ''

  // 尝试从 params 中提取文件路径
  const filePathMatch = params.match(/(?:[\w.-]+\/)*[\w.-]+\.(java|js|ts|jsx|tsx|py|go|rs|rb|php|xml|html|vue|css|scss|json|yml|yaml|toml|sh|bash|zsh|sql|md|txt|properties|conf|cfg|env|gradle|xml|kt|swift|c|cpp|h|hpp)/i)
  if (filePathMatch) {
    const parts = filePathMatch[0].split('/')
    return parts[parts.length - 1]
  }

  // SSH 命令：提取命令摘要
  if (toolName.toLowerCase().includes('ssh') || toolName.toLowerCase().includes('exec') || toolName.toLowerCase().includes('shell')) {
    const cmd = params.trim().split('\n')[0].trim()
    if (cmd) return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd
  }

  // readLocalFile / readFile → 取路径最后一段
  if (toolName === 'readLocalFile' || toolName === 'readFile') {
    const pathMatch = params.match(/['"]?([^'"\s]+)['"]?/)
    if (pathMatch) {
      const parts = pathMatch[1].split('/')
      return parts[parts.length - 1] || pathMatch[1]
    }
  }

  // CodeEditTool → 从 params 或 result 中提取 file/path
  if (toolName === 'CodeEditTool' || toolName === 'CodeEdit') {
    const fileFromParams = params.match(/(?:file|path|filePath)['"]?\s*[:=]\s*['"]?([^'"\s,]+)/i)
    if (fileFromParams) {
      const parts = fileFromParams[1].split('/')
      return parts[parts.length - 1]
    }
    const fileFromResult = result.match(/(?:file|path|filePath)['"]?\s*[:=]\s*['"]?([^'"\s,]+)/i)
    if (fileFromResult) {
      const parts = fileFromResult[1].split('/')
      return parts[parts.length - 1]
    }
  }

  // 通用：尝试从 JSON params 中提取 file/path/command
  if (params.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(params)
      const fileVal = parsed.file || parsed.path || parsed.filePath || parsed.filename
      if (fileVal) {
        const parts = String(fileVal).split('/')
        return parts[parts.length - 1]
      }
      const cmdVal = parsed.command || parsed.cmd
      if (cmdVal) return String(cmdVal).substring(0, 50)
    } catch {}
  }

  // 通用：尝试从 JSON result 中提取 file/path
  if (result.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(result)
      const fileVal = parsed.file || parsed.path || parsed.filePath
      if (fileVal) {
        const parts = String(fileVal).split('/')
        return parts[parts.length - 1]
      }
    } catch {}
  }

  // 退回工具名本身
  return toolName || '工具'
}

/** 工具分组接口 */
interface ToolGroup {
  toolName: string
  label: string
  steps: ReActStep[]
  successCount: number
  failCount: number
}

/** 将工具步骤按 (toolName, label) 分组聚合 */
function groupToolSteps(steps: ReActStep[]): ToolGroup[] {
  const groups: ToolGroup[] = []
  const keyMap = new Map<string, number>()

  for (const step of steps) {
    const label = extractToolLabel(step)
    const toolName = step.toolName || '未知'
    const key = `${toolName}::${label}`

    const idx = keyMap.get(key)
    if (idx !== undefined) {
      groups[idx].steps.push(step)
      if (step.status === 'success') groups[idx].successCount++
      if (step.status === 'failure') groups[idx].failCount++
    } else {
      keyMap.set(key, groups.length)
      groups.push({
        toolName,
        label,
        steps: [step],
        successCount: step.status === 'success' ? 1 : 0,
        failCount: step.status === 'failure' ? 1 : 0,
      })
    }
  }

  return groups
}

/** 获取工具对应的 emoji 图标 */
/** 工具类型分类 */
function classifyTool(toolName: string): 'file-read' | 'file-edit' | 'terminal' | 'search' | 'directory' | 'agent' | 'mcp' | 'other' {
  const n = toolName.toLowerCase()
  if (n === 'readlocalfile' || n === 'readfile' || n === 'read_file') return 'file-read'
  if (n === 'writelocalfile' || n === 'writefile' || n === 'write_file' || n === 'codeedit' || n === 'codeedittool' || n === 'fileedittool' || n.includes('edit') || n.includes('write')) return 'file-edit'
  if (n.includes('ssh') || n.includes('exec') || n.includes('shell') || n.includes('terminal') || n.includes('bash')) return 'terminal'
  if (n.includes('search') || n.includes('find') || n.includes('grep')) return 'search'
  if (n.includes('list') || n.includes('dir') || n.includes('directory')) return 'directory'
  if (n.includes('agent') || n.includes('sub')) return 'agent'
  // MCP 工具通常包含点号或非标准前缀
  if (n.includes('.') && !n.includes(' ') && !['readlocalfile','writelocalfile','listlocalfiles'].includes(n)) return 'mcp'
  return 'other'
}

/** 获取工具的 SVG 图标 + 颜色 */
function getToolIconInfo(toolName: string): { icon: React.ReactNode; color: string; bgColor: string; label: string } {
  const type = classifyTool(toolName)
  switch (type) {
    case 'file-read':
      return {
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
        color: '#3b82f6',
        bgColor: 'rgba(59,130,246,0.10)',
        label: '读取文件',
      }
    case 'file-edit':
      return {
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
        color: '#f97316',
        bgColor: 'rgba(249,115,22,0.10)',
        label: '修改文件',
      }
    case 'terminal':
      return {
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
        color: '#10b981',
        bgColor: 'rgba(16,185,129,0.10)',
        label: '终端命令',
      }
    case 'search':
      return {
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
        color: '#8b5cf6',
        bgColor: 'rgba(139,92,246,0.10)',
        label: '搜索',
      }
    case 'directory':
      return {
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
        color: '#eab308',
        bgColor: 'rgba(234,179,8,0.10)',
        label: '目录操作',
      }
    case 'agent':
      return {
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>,
        color: '#ec4899',
        bgColor: 'rgba(236,72,153,0.10)',
        label: '子代理',
      }
    case 'mcp':
      return {
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>,
        color: '#a855f7',
        bgColor: 'rgba(168,85,247,0.10)',
        label: toolName,
      }
    default:
      return {
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
        color: '#6b7280',
        bgColor: 'rgba(107,114,128,0.10)',
        label: toolName || '工具',
      }
  }
}

// getToolIcon 已废弃，统一使用 getToolIconInfo

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

/** 从工具步骤组中估算总耗时 */
function formatDuration(groups: ToolGroup[]): string {
  // ReActStep 没有内置时间戳，用步骤数估算（粗略）
  const totalSteps = groups.reduce((sum, g) => sum + g.steps.length, 0)
  if (totalSteps === 0) return ''
  // 粗略估算：平均每个工具 1-3s
  const estimatedMs = totalSteps * 1500
  if (estimatedMs < 1000) return `${estimatedMs}ms`
  if (estimatedMs < 60000) return `${(estimatedMs / 1000).toFixed(0)}s`
  return `${Math.floor(estimatedMs / 60000)}m${Math.round((estimatedMs % 60000) / 1000)}s`
}

// ===== ToolGroupCard — compact/collapsed 模式下的单行 Android 风格卡片 =====
const ToolGroupCard = memo(function ToolGroupCard({ group, colors, compact }: {
  group: ToolGroup
  colors: ReturnType<typeof useThemeStore.getState>['colors']
  compact?: boolean  // true = collapsed 模式（不可展开）；false = compact 模式（可展开查看详情）
}) {
  const [expanded, setExpanded] = useState(false)
  const toolInfo = getToolIconInfo(group.toolName)
  const total = group.steps.length
  const anyInProgress = group.steps.some(s => s.status === 'in_progress')
  const hasFail = group.failCount > 0
  const allDone = group.steps.every(s => s.status !== 'in_progress')

  // 从第一个 step 的 params 中提取副标题
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
    const pathMatch = params.match(/['"]?([\w./-]+\.[\w]+)['"]?/)
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
    <div className="min-w-0">
      <button
        onClick={() => { if (!compact) setExpanded(!expanded) }}
        className="w-full flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg transition-all group min-w-0 text-left"
        style={{
          backgroundColor: `${colors.bgSecondary}80`,
          border: `1px solid ${hasFail ? 'rgba(239,68,68,0.2)' : `${colors.border}20`}`,
        }}
      >
        {/* 图标（带背景色） */}
        <div className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-all shadow-sm" style={{ backgroundColor: toolInfo.bgColor, color: toolInfo.color }}>
          {anyInProgress ? (
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          ) : toolInfo.icon}
        </div>

        {/* 标题 + 副标题 */}
        <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[12px] font-medium truncate" style={{ color: colors.text }}>
              {toolInfo.label}
            </span>
            {total > 1 && (
              <span className="text-[10px] px-1 rounded flex-shrink-0" style={{ backgroundColor: toolInfo.bgColor, color: toolInfo.color }}>×{total}</span>
            )}
          </div>
          {subTitle && (
            <span className="text-[10px] font-mono truncate mt-0.5 opacity-60" style={{ color: colors.textSecondary }} title={subTitle}>
              {subTitle}
            </span>
          )}
        </div>

        {/* 状态 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {statusDot}
          {!compact && (
            <svg className={`w-3 h-3 transition-transform flex-shrink-0 opacity-0 group-hover:opacity-100 ${expanded ? '!opacity-100 rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </div>
      </button>

      {/* compact 模式展开内容 */}
      {!compact && expanded && (
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
  )
})

// ===== ToolGroupView 组件（Android 风格卡片，expanded 模式使用）=====
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
  if (processSteps.length === 0) return null

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

  React.useEffect(() => {
    // 流式/加载中 → compact（显示进度但不占太多空间）
    if ((isStreaming || isLoading) && expandMode === 'collapsed' && !userToggledRef.current) {
      setExpandMode('compact')
      autoCollapsedRef.current = false
    }
  }, [isStreaming, isLoading])

  const toolSteps = processSteps.filter(s => s.stepType === 'tool_call')
  const thinkingSteps = processSteps.filter(s => s.stepType === 'thinking')

  // 核心自动折叠：检测 isStreaming||isLoading 从 true→false 的跳变
  // 有文件变更时 → 折叠到 compact（保留变更可见性）+ 延迟 3s
  // 无文件变更时 → 折叠到 collapsed + 延迟 1.5s
  React.useEffect(() => {
    const wasStreaming = prevStreamingRef.current
    const nowStreaming = isStreaming || isLoading
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
  }, [allDone, isStreaming, isLoading, toolSteps])

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

  // 折叠状态摘要
  // collapsedSummary 保留用于未来扩展（如 tooltip）
  // const collapsedSummary = buildCollapsedSummary(toolGroups)

  // 文件变更数量已移至 ArtifactSummaryPanel 展示，此处不再需要
  // const allPreviews = useAiPatchStore(s => s.previews)
  // const relatedPreviewCount = useMemo(() => { ... }, [toolGroups, allPreviews])

  // 筛选后的步骤（仅显示失败时）
  const filteredToolGroups = showFailuresOnly
    ? toolGroups.map(g => ({ ...g, steps: g.steps.filter(s => s.status === 'failure') })).filter(g => g.steps.length > 0)
    : toolGroups
  const filteredThinkingSteps = showFailuresOnly ? [] : thinkingSteps

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
        /* ===== Android 风格卡片列表（collapsed + compact）===== */
        <div className="space-y-1">
          {/* 摘要头 */}
          <div className="flex items-center gap-2 px-1 py-0.5">
            <button
              onClick={cycleExpandMode}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity min-w-0"
            >
              <svg className={`w-3 h-3 transition-transform flex-shrink-0 ${expandMode === 'compact' ? 'rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span className="text-[11px] font-medium flex-shrink-0" style={{ color: colors.textSecondary }}>
                {toolCount} 个工具
              </span>
            </button>
            <div className="flex-1" />
            {failCount > 0 && (
              <span className="text-[10px] text-red-500 flex-shrink-0">{failCount} 失败</span>
            )}
            {allDone && (
              <span className="text-[9px] tabular-nums flex-shrink-0" style={{ color: colors.textDim }}>{formatDuration(toolGroups)}</span>
            )}
          </div>
          {/* 工具卡片列表 */}
          {toolGroups.map((group, gi) => (
            <ToolGroupCard key={gi} group={group} colors={colors} compact={expandMode === 'collapsed'} />
          ))}
        </div>
      ) : (
        /* ===== 展开模式（Android 风格标题 + 内容区）===== */
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
              {toolCount > 0 && `${toolCount} 次工具`}
              {thinkingCount > 0 && toolCount > 0 && ' · '}
              {thinkingCount > 0 && `${thinkingCount} 轮思考`}
            </span>
            {/* 状态点阵 */}
            <div className="flex gap-1 items-center flex-shrink-0 ml-auto">
              {processSteps.slice(0, 8).map((s, i) => (
                <div key={i} className="w-1.5 h-1.5 rounded-full transition-colors" style={{
                  backgroundColor: s.status === 'failure' ? '#ef4444'
                    : s.status === 'success' ? '#22c55e'
                    : STEP_COLORS[s.stepType] || colors.accent,
                }} />
              ))}
              {processSteps.length > 8 && (
                <span className="text-[9px] ml-0.5" style={{ color: colors.textDim }}>+{processSteps.length - 8}</span>
              )}
            </div>
          </button>

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
          <div className="px-3 pb-3 pt-2 space-y-1.5 animate-in slide-in-from-top-1 duration-200">
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
            {/* 工具分组卡片 */}
            {filteredToolGroups.map((group, i) => (
              <ToolGroupView key={`group-${i}`} group={group} colors={colors} compact={useCompactMode} />
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
