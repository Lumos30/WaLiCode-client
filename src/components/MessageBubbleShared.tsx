/**
 * 共享工具函数和类型
 * MessageBubble 和 MessageStream 共用
 */
import React, { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { common } from 'lowlight'
import { useThemeStore } from '../stores/themeStore'
import type { ReActStep } from '../api/agent'

// ═══════════════════════════════════════════════════════════════
//  工具分组接口
// ═══════════════════════════════════════════════════════════════

export interface ToolGroup {
  toolName: string
  label: string
  steps: ReActStep[]
  successCount: number
  failCount: number
}

// ═══════════════════════════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════════════════════════

export function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function splitThinkTags(content: string): Array<{ type: 'think' | 'text'; content: string; isStreaming?: boolean }> {
  if (!content) return []
  const parts: Array<{ type: 'think' | 'text'; content: string; isStreaming?: boolean }> = []
  const regex = /<think>([\s\S]*?)(<\/think>|$)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) })
    }
    parts.push({
      type: 'think',
      content: match[1].trim(),
      isStreaming: !match[2] || match[2] !== '</think>',
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) })
  }

  return parts.length > 0 ? parts : [{ type: 'text', content }]
}

/** 从 toolParams/toolResult 中提取语义化标签 */
export function extractToolLabel(step: ReActStep): string {
  const params = step.toolParams || ''
  const result = step.toolResult || ''
  const toolName = step.toolName || ''

  const filePathMatch = params.match(/(?:[\w.-]+\/)*[\w.-]+\.(java|js|ts|jsx|tsx|py|go|rs|rb|php|xml|html|vue|css|scss|json|yml|yaml|toml|sh|bash|zsh|sql|md|txt|properties|conf|cfg|env|gradle|xml|kt|swift|c|cpp|h|hpp)/i)
  if (filePathMatch) {
    const parts = filePathMatch[0].split('/')
    return parts[parts.length - 1]
  }

  if (toolName.toLowerCase().includes('ssh') || toolName.toLowerCase().includes('exec') || toolName.toLowerCase().includes('shell')) {
    const cmd = params.trim().split('\n')[0].trim()
    if (cmd) return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd
  }

  if (toolName === 'readLocalFile' || toolName === 'readFile') {
    const pathMatch = params.match(/['"]?([^'"\s]+)['"]?/)
    if (pathMatch) {
      const parts = pathMatch[1].split('/')
      return parts[parts.length - 1] || pathMatch[1]
    }
  }

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

  return toolName || '工具'
}

/** 将工具步骤按 (toolName, label) 分组聚合 */
export function groupToolSteps(steps: ReActStep[]): ToolGroup[] {
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

/** 工具类型分类 */
export function classifyTool(toolName: string): 'file-read' | 'file-edit' | 'terminal' | 'search' | 'directory' | 'agent' | 'mcp' | 'other' {
  const n = toolName.toLowerCase()
  if (n === 'readlocalfile' || n === 'readfile' || n === 'read_file') return 'file-read'
  if (n === 'writelocalfile' || n === 'writefile' || n === 'write_file' || n === 'codeedit' || n === 'codeedittool' || n === 'fileedittool' || n.includes('edit') || n.includes('write')) return 'file-edit'
  if (n.includes('ssh') || n.includes('exec') || n.includes('shell') || n.includes('terminal') || n.includes('bash')) return 'terminal'
  if (n.includes('search') || n.includes('find') || n.includes('grep')) return 'search'
  if (n.includes('list') || n.includes('dir') || n.includes('directory')) return 'directory'
  if (n.includes('agent') || n.includes('sub')) return 'agent'
  if (n.includes('.') && !n.includes(' ') && !['readlocalfile','writelocalfile','listlocalfiles'].includes(n)) return 'mcp'
  return 'other'
}

/** 获取工具的 SVG 图标 + 颜色 */
export function getToolIconInfo(toolName: string): { icon: React.ReactNode; color: string; bgColor: string; label: string } {
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

// ═══════════════════════════════════════════════════════════════
//  Markdown 格式规范化
// ═══════════════════════════════════════════════════════════════

export function normalizeMarkdown(text: string): string {
  if (!text) return text
  let result = text

  const codeBlocks: string[] = []
  result = result.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m)
    return `\x00CB${codeBlocks.length - 1}\x00`
  })

  result = result.replace(/\|\|/g, '|\n|')
  result = result.replace(/(#{1,6})([^\s#\n])/g, '$1 $2')
  result = result.replace(/([^\n#])(#{1,6}\s)/g, '$1\n\n$2')
  result = result.replace(/(#{1,6}\s[^\n#*\d]+?)(\*\*)/g, '$1\n\n$2')
  result = result.replace(/(#{1,6}\s[^|\n]+)(\|)/g, '$1\n\n$2')

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

  result = result.replace(/([^\n])(\d+\.\s)/g, '$1\n$2')
  result = result.replace(/([^\n])(```)/g, '$1\n$2')
  result = result.replace(/([^\n-])(---)/g, '$1\n$2')
  result = result.replace(/(---)([^\n|-])/g, '$1\n$2')

  result = result.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
  result = result.replace(/(^|\n)(#{1,6}\s[^\n]+)(\n)(?!\n|#{1,6}\s)/gm, '$1$2$3\n')
  result = result.replace(/([^\n])\n(```)/g, '$1\n\n$2')
  result = result.replace(/([^\n|])\n(\|)/g, '$1\n\n$2')
  result = result.replace(/(\|[^\n]+)\n(?!\n|\|)([^\n|])/g, '$1\n\n$2')
  result = result.replace(/([^\n])\n(---)/g, '$1\n\n$2')
  result = result.replace(/(---)\n([^\n])/g, '$1\n\n$2')
  result = result.replace(/(\d+\.\s[^\n]+)\n\n(\d+\.\s)/g, '$1\n$2')

  result = result.replace(/^\|([-:\s|]+)\|$/gm, (match, inner: string) => {
    if (!inner.includes('-')) return match
    const cells = inner.split('|').map(c => ' ' + c.trim() + ' ')
    return '|' + cells.join('|') + '|'
  })

  // 普通文本行之间的单换行 → 双换行（段落分隔）
  // 条件：前一行和后一行都不是列表、标题、代码、表格等 Markdown 元素
  const isSpecialLine = (line: string) =>
    /^(\s*[*+\-]\s|\s*\d+\.\s|\s*#{1,6}\s|\s*```|\s*\||\s*>|\s*---|\s*<!--|\s*\-\-\-)/.test(line)
  const lines = result.split('\n')
  const processed: string[] = []
  for (let i = 0; i < lines.length; i++) {
    processed.push(lines[i])
    if (i < lines.length - 1) {
      const cur = lines[i].trim()
      const next = lines[i + 1].trim()
      // 当前行和下一行都是非空普通文本 → 插入额外换行
      if (cur && next && !isSpecialLine(cur) && !isSpecialLine(next)) {
        // 检查下一行是否已经紧跟一个空行
        if (i + 2 >= lines.length || lines[i + 2].trim() !== '') {
          processed.push('')
        }
      }
    }
  }
  result = processed.join('\n')

  result = result.replace(/\n{3,}/g, '\n\n')
  result = result.replace(/\x00CB(\d+)\x00/g, (_m, idx: string) => codeBlocks[parseInt(idx)])

  return result
}

// ═══════════════════════════════════════════════════════════════
//  共享组件
// ═══════════════════════════════════════════════════════════════

/** 代码块 */
function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const { colors } = useThemeStore()
  const [copied, setCopied] = React.useState(false)
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
        <button onClick={handleCopy} className="opacity-0 group-hover/code:opacity-100 transition-opacity flex items-center gap-1 text-[10px]" style={{ color: colors.textSecondary }}>
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      <pre className="px-3 py-2.5 overflow-x-auto text-[11px] leading-relaxed max-w-full" style={{ backgroundColor: colors.bgPrimary, fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", monospace' }}>
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

/** Markdown 渲染 */
export function MarkdownContent({ content, colors, isUser }: { content: string; colors: ReturnType<typeof useThemeStore.getState>['colors']; isUser?: boolean }) {
  const textColor = isUser ? colors.userBubbleText : colors.text
  const linkColor = isUser ? '#93c5fd' : colors.accent

  if (!content || !content.trim()) return null

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
        pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
        code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
          const isBlock = className?.startsWith('language-') || (typeof children === 'string' && children.includes('\n'))
          if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>
          return <code className="px-1 py-0.5 rounded text-[12px]" style={{ backgroundColor: `${colors.border}30`, fontFamily: '"SF Mono", "JetBrains Mono", monospace', color: colors.text }}>{children}</code>
        },
        p: ({ children }: { children?: React.ReactNode }) => <p className="m-0 mb-2 last:mb-0 leading-relaxed">{children}</p>,
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline cursor-pointer" style={{ color: linkColor }}>{children}</a>
        ),
        ul: ({ children }: { children?: React.ReactNode }) => <ul className="m-0 mb-2 pl-4 list-disc">{children}</ul>,
        ol: ({ children }: { children?: React.ReactNode }) => <ol className="m-0 mb-2 pl-4 list-decimal">{children}</ol>,
        li: ({ children }: { children?: React.ReactNode }) => <li className="m-0 mb-1">{children}</li>,
        h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-[15px] font-bold mt-3 mb-1.5" style={{ color: textColor }}>{children}</h1>,
        h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-[14px] font-bold mt-3 mb-1" style={{ color: textColor }}>{children}</h2>,
        h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-[13px] font-semibold mt-2.5 mb-1" style={{ color: textColor }}>{children}</h3>,
        h4: ({ children }: { children?: React.ReactNode }) => <h4 className="text-[12px] font-semibold mt-2 mb-0.5" style={{ color: textColor }}>{children}</h4>,
        blockquote: ({ children }: { children?: React.ReactNode }) => (
          <blockquote className="my-1.5 pl-3 py-1 rounded-r" style={{ borderLeft: `3px solid ${isUser ? '#7aa2f7' : colors.accent}`, backgroundColor: isUser ? 'rgba(255,255,255,0.08)' : `${colors.bgSecondary}80`, color: isUser ? textColor : colors.textDim }}>{children}</blockquote>
        ),
        hr: () => <hr className="my-2 border-0" style={{ borderTop: `1px solid ${colors.border}40` }} />,
        table: ({ children }: { children?: React.ReactNode }) => (
          <div className="overflow-x-auto"><table className="my-2 w-full max-w-full text-[11px] border-collapse table-fixed" style={{ border: `1px solid ${colors.border}` }}>{children}</table></div>
        ),
        thead: ({ children }: { children?: React.ReactNode }) => <thead style={{ backgroundColor: colors.bgSecondary }}>{children}</thead>,
        th: ({ children }: { children?: React.ReactNode }) => <th className="px-2 py-1 text-left font-semibold border" style={{ borderColor: colors.border, color: textColor }}>{children}</th>,
        td: ({ children }: { children?: React.ReactNode }) => <td className="px-2 py-1 border" style={{ borderColor: colors.border, color: textColor }}>{children}</td>,
        strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-bold" style={{ color: textColor }}>{children}</strong>,
        em: ({ children }: { children?: React.ReactNode }) => <em style={{ color: colors.textSecondary }}>{children}</em>,
        img: ({ src, alt }: { src?: string; alt?: string }) => {
          if (!src || src.length < 100) return null
          if (isUser) {
            return (
              <div className="inline-flex items-center gap-2.5 px-3 py-2 rounded-lg my-1.5 max-w-[240px] cursor-pointer transition-colors hover:opacity-80"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: `1px solid ${colors.border}50` }}
                onClick={() => window.open(src, '_blank')} title="点击放大">
                <img src={src} alt={alt || '上传的图片'} className="w-10 h-10 rounded-md object-cover flex-shrink-0" style={{ border: `1px solid ${colors.border}30` }} />
                <span className="text-[11px] truncate" style={{ color: colors.textSecondary }}>📎 {alt || '图片'}</span>
              </div>
            )
          }
          return <img src={src} alt={alt || '上传的图片'} className="max-w-full max-h-64 rounded-lg my-2 object-contain cursor-pointer" style={{ border: `1px solid ${colors.border}40` }} onClick={() => window.open(src, '_blank')} title="点击放大" />
        },
      }}
    >
      {contentWithImages}
    </ReactMarkdown>
  )
}

/** 思考过程折叠块 */
export function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const { colors } = useThemeStore()
  const [open, setOpen] = React.useState(isStreaming)

  React.useEffect(() => {
    if (isStreaming) setOpen(true)
  }, [isStreaming])

  return (
    <details open={open} className="mb-3 rounded-lg overflow-hidden" style={{ backgroundColor: `${colors.bgSecondary}80`, border: `1px solid ${colors.border}40` }}>
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden transition-colors hover:bg-black/5"
        onClick={(e) => { e.preventDefault(); setOpen(!open) }}>
        <div className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: `${colors.accent}20` }}>
          {isStreaming ? (
            <svg className="w-3 h-3 animate-spin" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          ) : (
            <svg className="w-3 h-3" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
          )}
        </div>
        <span className="text-[11px] font-medium" style={{ color: colors.textSecondary }}>{isStreaming ? '思考中...' : '思考过程'}</span>
        <div className="flex-1" />
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
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

/** 工具调用步骤视图 */
export function ToolCallView({ step, colors, compact }: { step: ReActStep; colors: ReturnType<typeof useThemeStore.getState>['colors']; compact?: boolean }) {
  const [expanded, setExpanded] = React.useState(false)
  const toolName = step.toolName || '工具'
  const toolInfo = getToolIconInfo(toolName)

  if (compact) {
    return (
      <div className="py-1 text-[11px]" style={{ color: colors.textSecondary }}>
        <div className="flex items-center gap-1.5">
          <span className="font-medium" style={{ color: colors.text }}>{toolName}</span>
          {step.status === 'in_progress' && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#f59e0b' }} />}
          {step.status === 'success' && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#22c55e' }} />}
          {step.status === 'failure' && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />}
        </div>
        {step.toolParams && (
          <div className="mt-0.5 font-mono text-[10px] truncate opacity-70" style={{ maxWidth: '100%' }}>{step.toolParams.substring(0, 120)}</div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg overflow-hidden my-1" style={{ border: `1px solid ${colors.border}30`, backgroundColor: `${colors.bgSecondary}40` }}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-black/5">
        <div className="flex items-center justify-center w-5 h-5 rounded shrink-0" style={{ backgroundColor: toolInfo.bgColor, color: toolInfo.color }}>
          {step.status === 'in_progress' ? (
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          ) : toolInfo.icon}
        </div>
        <span className="text-[11px] font-medium truncate" style={{ color: colors.text }}>{toolName}</span>
        {step.status === 'in_progress' && <span className="w-1.5 h-1.5 rounded-full animate-pulse ml-auto" style={{ backgroundColor: '#f59e0b' }} />}
        {step.status === 'success' && <span className="w-1.5 h-1.5 rounded-full ml-auto" style={{ backgroundColor: '#22c55e' }} />}
        {step.status === 'failure' && <span className="w-1.5 h-1.5 rounded-full ml-auto" style={{ backgroundColor: '#ef4444' }} />}
        <svg className={`w-3 h-3 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-[11px] space-y-1" style={{ color: colors.textSecondary }}>
          {step.toolParams && (
            <div>
              <span className="font-medium" style={{ color: colors.textDim }}>参数:</span>
              <pre className="mt-0.5 p-1.5 rounded text-[10px] overflow-x-auto" style={{ backgroundColor: colors.bgPrimary, fontFamily: '"SF Mono", "JetBrains Mono", monospace' }}>{step.toolParams}</pre>
            </div>
          )}
          {step.toolResult && (
            <div>
              <span className="font-medium" style={{ color: colors.textDim }}>结果:</span>
              <pre className="mt-0.5 p-1.5 rounded text-[10px] overflow-x-auto max-h-40" style={{ backgroundColor: colors.bgPrimary, fontFamily: '"SF Mono", "JetBrains Mono", monospace' }}>{step.toolResult.substring(0, 500)}</pre>
            </div>
          )}
          {step.error && (
            <div className="text-red-500">
              <span className="font-medium">错误:</span> {step.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 复制按钮 */
export function CopyButton({ text, colors }: { text: string; colors: ReturnType<typeof useThemeStore.getState>['colors'] }) {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button onClick={handleCopy} className="flex items-center gap-0.5 px-1 py-0.5 rounded transition-colors hover:opacity-70" style={{ color: colors.textDim }} title="复制">
      {copied ? (
        <svg className="w-3 h-3 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      )}
      <span className="text-[10px]">{copied ? '已复制' : '复制'}</span>
    </button>
  )
}

/** STEP_COLORS */
export const STEP_COLORS: Record<string, string> = {
  thinking: '#a78bfa',
  tool_call: '#60a5fa',
  result: '#34d399',
}

/** 从工具步骤组中估算总耗时 */
export function formatDuration(groups: ToolGroup[]): string {
  const totalSteps = groups.reduce((sum, g) => sum + g.steps.length, 0)
  if (totalSteps === 0) return ''
  const estimatedMs = totalSteps * 1500
  if (estimatedMs < 1000) return `${estimatedMs}ms`
  if (estimatedMs < 60000) return `${(estimatedMs / 1000).toFixed(0)}s`
  return `${Math.floor(estimatedMs / 60000)}m${Math.round((estimatedMs % 60000) / 1000)}s`
}
