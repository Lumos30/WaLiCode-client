import { useState } from 'react'
import { useThemeStore } from '../stores/themeStore'
import type { AgentMessage } from '../types'

interface ChatExportProps {
  open: boolean
  onClose: () => void
  messages: AgentMessage[]
  sessionTitle?: string
}

/**
 * 对话导出面板。
 * 支持 Markdown / JSON 两种格式，可复制或下载。
 */
export function ChatExport({ open, onClose, messages, sessionTitle }: ChatExportProps) {
  const { colors } = useThemeStore()
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown')
  const [copied, setCopied] = useState(false)

  if (!open) return null

  const title = sessionTitle || 'AI 对话'

  // 生成 Markdown 格式
  const toMarkdown = (): string => {
    const lines: string[] = [`# ${title}`, '', `> 导出时间: ${new Date().toLocaleString('zh-CN')}`, '']
    for (const msg of messages) {
      const time = new Date(msg.timestamp).toLocaleString('zh-CN')
      if (msg.role === 'user') {
        lines.push(`## 👤 用户 (${time})`, '', msg.content, '')
      } else {
        // 助手消息：优先取 result step content
        const resultStep = msg.steps?.find(s => s.stepType === 'result' && s.content)
        const content = resultStep?.content || msg.content || ''
        if (content) {
          lines.push(`## 🤖 助手 (${time})`, '', content, '')
        }
        // 工具调用摘要
        const toolSteps = msg.steps?.filter(s => s.stepType === 'tool_call') || []
        if (toolSteps.length > 0) {
          lines.push('**工具调用:**')
          for (const step of toolSteps) {
            const status = step.status === 'success' ? '✅' : step.status === 'failure' ? '❌' : '⏳'
            lines.push(`- ${status} \`${step.toolName || '工具'}\` ${step.toolParams ? `\`${step.toolParams.substring(0, 60)}\`` : ''}`)
          }
          lines.push('')
        }
      }
    }
    return lines.join('\n')
  }

  // 生成 JSON 格式
  const toJSON = (): string => {
    const data = {
      title,
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.timestamp).toISOString(),
        steps: msg.steps?.map(s => ({
          stepType: s.stepType,
          toolName: s.toolName,
          status: s.status,
          content: s.stepType === 'result' ? s.content : undefined,
        })),
      })),
    }
    return JSON.stringify(data, null, 2)
  }

  const content = format === 'markdown' ? toMarkdown() : toJSON()
  const fileExt = format === 'markdown' ? 'md' : 'json'
  const mimeType = format === 'markdown' ? 'text/markdown' : 'application/json'

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = () => {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[/\\?%*:|"<>]/g, '_')}.${fileExt}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      />
      <div
        className="relative w-[560px] max-h-[80vh] flex flex-col rounded-xl shadow-2xl"
        style={{
          backgroundColor: colors.bgPrimary,
          border: `1px solid ${colors.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${colors.border}` }}>
          <div className="flex items-center gap-2">
            <span className="text-base">📤</span>
            <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>导出对话</h2>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:opacity-70"
            style={{ backgroundColor: colors.bgSecondary, color: colors.textDim }}
          >
            ✕
          </button>
        </div>

        {/* 格式选择 + 操作按钮 */}
        <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: `1px solid ${colors.border}40` }}>
          <div className="flex rounded-md overflow-hidden" style={{ border: `1px solid ${colors.border}` }}>
            <button
              onClick={() => setFormat('markdown')}
              className="px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: format === 'markdown' ? `${colors.accent}15` : 'transparent',
                color: format === 'markdown' ? colors.accent : colors.textDim,
              }}
            >
              Markdown
            </button>
            <button
              onClick={() => setFormat('json')}
              className="px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: format === 'json' ? `${colors.accent}15` : 'transparent',
                color: format === 'json' ? colors.accent : colors.textDim,
                borderLeft: `1px solid ${colors.border}`,
              }}
            >
              JSON
            </button>
          </div>
          <div className="flex-1" />
          <span className="text-[10px]" style={{ color: colors.textDim }}>
            {messages.length} 条消息 · {(content.length / 1024).toFixed(1)} KB
          </span>
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors hover:opacity-80"
            style={{ backgroundColor: colors.bgSecondary, color: colors.text, border: `1px solid ${colors.border}` }}
          >
            {copied ? '✓ 已复制' : '📋 复制'}
          </button>
          <button
            onClick={handleDownload}
            className="px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors hover:opacity-80"
            style={{ backgroundColor: `${colors.accent}15`, color: colors.accent, border: `1px solid ${colors.accent}30` }}
          >
            💾 下载 .{fileExt}
          </button>
        </div>

        {/* 预览 */}
        <div
          className="flex-1 overflow-auto px-5 py-3 min-h-0"
          style={{ maxHeight: '50vh' }}
        >
          <pre
            className="text-[11px] leading-relaxed whitespace-pre-wrap break-all"
            style={{
              color: colors.textSecondary,
              fontFamily: '"SF Mono", "JetBrains Mono", monospace',
            }}
          >
            {content.substring(0, 10000)}{content.length > 10000 ? '\n\n... (预览截断，下载查看完整内容)' : ''}
          </pre>
        </div>
      </div>
    </div>
  )
}
