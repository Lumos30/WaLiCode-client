/**
 * 共享工具函数和组件
 * 统一供 AiTurnBlock / MessageBubble / MessageStream 使用
 *
 * 重构说明：
 * - 移除前端 normalizeMarkdown（后端 MarkdownNormalizer 已处理）
 * - 前端 cleanMarkdown 作为兜底（加粗空格 + 连续空行 + 代码块保护）
 * - 统一工具图标/分组/分类函数
 * - 精简 ToolCallView 为单行折叠
 */
import React, { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { common } from 'lowlight'
import { useThemeStore } from '../stores/themeStore'
import type { ReActStep } from '../api/agent'

// ═══════════════════════════════════════════════════════════════
//  类型
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

/**
 * 分割 \x3Cthink\x3E...\x3C/think\x3E 标签
 * 后端虽不推送 thinking 事件，但 AI 文本中可能内嵌 think 标签
 */
export function splitThinkTags(content: string): Array<{ type: 'think' | 'text'; content: string; isStreaming?: boolean }> {
  if (!content) return []
  const parts: Array<{ type: 'think' | 'text'; content: string; isStreaming?: boolean }> = []
  const thinkOpen = String.fromCharCode(60) + 'think' + String.fromCharCode(62)
  const thinkClose = String.fromCharCode(60) + '/think' + String.fromCharCode(62)
  const regex = new RegExp(thinkOpen + '([\\s\\S]*?)(' + thinkClose.replace(/\//g, '\\/') + '|$)', 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) })
    }
    parts.push({
      type: 'think',
      content: match[1].trim(),
      isStreaming: !match[2] || match[2] !== thinkClose,
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
//  Markdown 归一化（与后端 MarkdownNormalizer 对齐）
//  流式阶段前端也做归一化，确保渲染一致性
// ═══════════════════════════════════════════════════════════════

const CB_PREFIX = '\u0001CB'
const CB_SUFFIX = '\u0001'
const IC_PREFIX = '\u0001IC'

/**
 * 保护代码块和行内元素，替换为占位符
 * CB_PREFIX: 代码块（前后需断行）
 * IC_PREFIX: 行内元素（加粗/斜体/行内代码，前后不断行）
 */
const TB_PREFIX = '\u0001TB'
const TB_SUFFIX = '\u0001'

/**
 * 保护表格行（| 开头的行），避免被列表规则误匹配
 * 表格行中的 | -- | 等内容会被 [-*+]\s 规则误判为列表
 */
function protectTableLines(text: string, store: string[]): string {
  const lines = text.split('\n')
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('|') && trimmed.length > 1 && isTableRowJS(trimmed)) {
      const placeholder = TB_PREFIX + store.length + TB_SUFFIX
      store.push(lines[i])
      result.push(placeholder)
    } else {
      result.push(lines[i])
    }
  }
  return result.join('\n')
}

function restoreTableLines(text: string, store: string[]): string {
  let r = text
  for (let i = store.length - 1; i >= 0; i--) {
    r = r.replace(TB_PREFIX + i + TB_SUFFIX, store[i])
  }
  return r
}

function protectElements(text: string, store: string[]): string {
  let r = text
  // 1. 围栏代码块 ```...``` → CB（严格匹配，需闭合）
  r = replaceAndStoreJS(r, /```[^\n]*\n[\s\S]*?```/g, store, CB_PREFIX)
  // 1b. 兜底：未闭合的围栏代码块（AI 流式输出可能缺少结尾 ```）
  r = replaceAndStoreJS(r, /```[^\n]*\n[\s\S]*$/g, store, CB_PREFIX)
  // 2. 行内代码 `...` → IC
  r = replaceAndStoreJS(r, /`[^`\n]+`/g, store, IC_PREFIX)
  // 3. 加粗 **...** → IC（必须在斜体之前提取）
  r = replaceAndStoreJS(r, /\*\*[^*\n]+\*\*/g, store, IC_PREFIX)
  // 4. 斜体 *...* → IC（加粗已提取，剩余单 * 即斜体）
  r = replaceAndStoreJS(r, /\*[^*\n]+\*/g, store, IC_PREFIX)
  return r
}

function replaceAndStoreJS(text: string, pattern: RegExp, store: string[], prefix: string): string {
  return text.replace(pattern, (m) => {
    const placeholder = prefix + store.length + CB_SUFFIX
    store.push(m)
    return placeholder
  })
}

function restoreElements(text: string, store: string[]): string {
  let r = text
  for (let i = store.length - 1; i >= 0; i--) {
    // 清理代码块内容开头的垃圾文本（飞书/语雀导出的"复制"按钮文字）
    const cleaned = stripCopyLabelFromCodeBlockJS(store[i])
    r = r.replace(CB_PREFIX + i + CB_SUFFIX, cleaned)
    r = r.replace(IC_PREFIX + i + CB_SUFFIX, store[i])
  }
  return r
}

/**
 * 清理代码块内容开头的"复制"垃圾行。
 * 飞书/语雀等富文本编辑器导出 Markdown 时，将"复制代码"按钮文字写入代码块：
 * ```text
 * 复制
 * 真正的代码内容...
 * ```
 * 与后端 stripCopyLabelFromCodeBlock 对齐
 */
function stripCopyLabelFromCodeBlockJS(codeBlock: string): string {
  if (!codeBlock.startsWith('```')) return codeBlock
  const firstNewline = codeBlock.indexOf('\n')
  if (firstNewline < 0) return codeBlock
  const content = codeBlock.substring(firstNewline + 1)
  const secondNewline = content.indexOf('\n')
  let firstLine: string
  let rest: string
  if (secondNewline < 0) {
    firstLine = content.trim()
    rest = ''
  } else {
    firstLine = content.substring(0, secondNewline).trim()
    rest = content.substring(secondNewline + 1)
  }
  if (firstLine === '复制' || firstLine === 'Copy' || firstLine === '复制代码') {
    return codeBlock.substring(0, firstNewline + 1) + rest
  }
  return codeBlock
}

/**
 * 表格处理：|| 拆行 + 补全分隔行
 * 与后端 processTables / fixTableBlocks 对齐
 */
function processTablesJS(text: string): string {
  let r = mergeTableFragmentsJS(text)
  r = cleanupOrphanedDashFragmentsJS(r)
  r = splitTableContentFromListItemsJS(r)
  r = splitDoublePipeTablesJS(r)
  r = fixTableBlocksJS(r)
  r = dedupSeparatorRowsJS(r)
  r = compactTableBlocksJS(r)
  return r
}

function splitDoublePipeTablesJS(text: string): string {
  if (!text.includes('||')) return text
  const lines = text.split('\n')
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) result.push('\n')
    if (lines[i].includes('||')) {
      result.push(splitSingleGluedLineJS(lines[i]))
    } else {
      result.push(lines[i])
    }
  }
  return result.join('')
}

function splitSingleGluedLineJS(line: string): string {
  const firstPipe = line.indexOf('|')
  if (firstPipe < 0) return line

  let prefix = ''
  let tablePart = line
  if (firstPipe > 0) {
    const before = line.substring(0, firstPipe).trim()
    if (before && !before.startsWith('|')) {
      prefix = before + '\n'
      tablePart = line.substring(firstPipe)
    }
  }

  const segments = tablePart.split('||')
  const rows: string[] = []

  for (const seg of segments) {
    let row = seg.trim()
    if (!row) continue

    // 检查尾部非表格内容
    const trailingIdx = findTrailingContentIndexJS(row)
    let tableRowPart = row
    let trailingContent: string | null = null

    if (trailingIdx > 0) {
      tableRowPart = row.substring(0, trailingIdx + 1).trim()
      trailingContent = row.substring(trailingIdx + 1).trim()
    }

    if (tableRowPart) {
      if (!tableRowPart.startsWith('|')) tableRowPart = '|' + tableRowPart
      if (!tableRowPart.endsWith('|')) tableRowPart = tableRowPart + '|'
      if (isSeparatorContentJS(tableRowPart)) {
        tableRowPart = formatSeparatorRowJS(tableRowPart)
      } else {
        tableRowPart = normalizeCellSpacingJS(tableRowPart)
      }
      rows.push(tableRowPart)
    }

    if (trailingContent) rows.push(trailingContent)
  }

  return prefix + rows.join('\n')
}

function findTrailingContentIndexJS(segment: string): number {
  // | 后紧跟 ## 标题
  const m1 = /\|\s*(#{1,6}\s)/.exec(segment)
  if (m1) return m1.index

  // | 后紧跟中文且后面无更多 | 且长度>30或含标点
  const m2 = /\|\s*([\u4e00-\u9fa5])/.exec(segment)
  if (m2) {
    const after = segment.substring(m2.index + m2[0].length)
    if (!after.includes('|')) {
      const textAfter = segment.substring(m2.index + 1).trim()
      if (/[。！？]/.test(textAfter) || textAfter.length > 30) return m2.index
    }
  }
  return -1
}

function isSeparatorContentJS(row: string): boolean {
  const trimmed = row.trim()
  if (!trimmed.startsWith('|') || trimmed.length <= 2) return false
  let inner = trimmed.substring(1, trimmed.endsWith('|') ? trimmed.length - 1 : trimmed.length)
  if (!inner) return false
  const cells = inner.split('|')
  let hasDash = false
  for (const cell of cells) {
    const c = cell.trim()
    if (!c) continue
    if (!/^[-:]+$/.test(c)) return false
    if (c.includes('-')) hasDash = true
  }
  return hasDash
}

function formatSeparatorRowJS(row: string): string {
  const trimmed = row.trim()
  let inner = trimmed.substring(1, trimmed.endsWith('|') ? trimmed.length - 1 : trimmed.length)
  const cells = inner.split('|')
  const sb: string[] = ['|']
  for (const cell of cells) {
    const c = cell.trim()
    if (!c) continue
    sb.push(' ' + c + ' |')
  }
  return sb.join('')
}

function normalizeCellSpacingJS(row: string): string {
  const trimmed = row.trim()
  let inner = trimmed.substring(1, trimmed.endsWith('|') ? trimmed.length - 1 : trimmed.length)
  const cells = inner.split('|')
  const sb: string[] = ['|']
  for (const cell of cells) {
    sb.push(' ' + cell.trim() + ' |')
  }
  return sb.join('')
}

/**
 * 合并 AI 流式输出中的碎片化表格行。
 * AI 流式输出时，分隔行 |---|---| 可能被拆成多个碎片：
 *   |          (只有竖线)
 *   ------|    (分隔内容碎片)
 *   ------|    (另一个碎片)
 * 本方法将这些碎片合并为完整的表格分隔行。
 * 与后端 mergeTableFragments 对齐
 */
function mergeTableFragmentsJS(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()

    // 检测碎片模式：一个 | 行后紧跟碎片行
    if (line === '|') {
      let j = i + 1
      // 跳过空行
      while (j < lines.length && !lines[j].trim()) j++
      // 收集碎片
      const fragments: string[] = []
      while (j < lines.length && /^-+\|?$/.test(lines[j].trim())) {
        fragments.push(lines[j].trim())
        j++
        // 跳过碎片之间的空行
        while (j < lines.length && !lines[j].trim()) j++
      }

      if (fragments.length > 0) {
        // 合并碎片为完整的分隔行
        const separator = '|' + fragments.map(() => ' --- |').join('')
        result.push(separator)
        i = j
      } else {
        // 没有碎片，检查下一行是否是表格数据行
        let nextNonEmpty = i + 1
        while (nextNonEmpty < lines.length && !lines[nextNonEmpty].trim()) nextNonEmpty++
        if (nextNonEmpty < lines.length && lines[nextNonEmpty].trim().startsWith('|') && lines[nextNonEmpty].trim().length > 1) {
          // | 是分隔行的碎片开头，需要检查前一行是否是表格数据行
          const prevIsTable = result.length > 0 && result[result.length - 1].trim().startsWith('|') && result[result.length - 1].trim().length > 1
          if (prevIsTable) {
            const colCount = countColumnsJS(result[result.length - 1])
            result.push(buildSeparatorRowJS(colCount))
          }
          i = nextNonEmpty
        } else {
          result.push(lines[i])
          i++
        }
      }
    } else if (/^-+\|?$/.test(line)) {
      // 独立碎片行 ------|，可能是分隔行的残留
      const prevIsTable = result.length > 0 && result[result.length - 1].trim().startsWith('|') && result[result.length - 1].trim().length > 1
      if (prevIsTable) {
        i++ // 跳过碎片
        continue
      }
      result.push(lines[i])
      i++
    } else {
      result.push(lines[i])
      i++
    }
  }
  return result.join('\n')
}

/**
 * 清理碎片化表格分隔行留下的孤立短横线行。
 * 如 "--"、"-"、"------" 等不是表格行的纯短横线行。
 * 与后端 cleanupOrphanedDashFragments 对齐
 */
function cleanupOrphanedDashFragmentsJS(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    // 删除孤立的纯短横线碎片（如 "--", "-", "------"）
    if (/^-{1,50}$/.test(trimmed) && trimmed !== '---') continue
    // 删除孤立的短横线+管道碎片（如 "------|", "---------|"）
    if (/^-{2,50}\|$/.test(trimmed)) continue
    // 处理碎片粘合行：如 "---------| | IC24 | 对外 API契约 |"
    const glueMatch = /^-{2,50}\|(.+\|.+)/.exec(trimmed)
    if (glueMatch) {
      const pipeIdx = trimmed.indexOf('|')
      const afterPipe = trimmed.substring(pipeIdx + 1).trim()
      result.push('| ' + afterPipe)
      continue
    }
    // 删除表格行中的纯短横线碎片：| ------ | 等
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const noSep = trimmed.replace(/[|\-\s:]/g, '')
      if (!noSep && !trimmed.includes('---')) continue
    }
    result.push(line)
  }
  return result.join('\n')
}

/**
 * 去除连续重复的分隔行。
 * mergeTableFragments 和 fixTableBlocks 可能各生成一次分隔行，
 * 导致连续出现多个 | --- | --- |。
 * 与后端 dedupSeparatorRows 对齐
 */
function dedupSeparatorRowsJS(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let lastWasSep = false
  for (const line of lines) {
    const trimmed = line.trim()
    const isSep = trimmed.startsWith('|') && trimmed.includes('---') && /^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(trimmed)
    if (isSep && lastWasSep) continue
    if (isSep) {
      lastWasSep = true
      // 回删分隔行后的空行
      if (result.length > 0 && !result[result.length - 1].trim()) {
        result.pop()
      }
    } else if (trimmed) {
      lastWasSep = false
    }
    result.push(line)
  }
  return result.join('\n')
}

/**
 * 分离表格行中粘合的列表/标题内容。
 * AI 有时把表格最后一行和后续列表粘在一起：
 *   | 缺点 | 扩展困难 |\u0001IC1\u0001- ✅私有构造函数
 * 与后端 splitTableContentFromListItems 对齐
 */
function splitTableContentFromListItemsJS(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('|') && trimmed.length > 1) {
      const splitPos = findSplitPositionJS(trimmed)
      if (splitPos > 0 && splitPos < trimmed.length - 1) {
        const tablePart = trimmed.substring(0, splitPos + 1) // 包含 |
        const trailing = trimmed.substring(splitPos + 1)
        if (countPipesJS(tablePart) >= 2) {
          result.push(tablePart)
          result.push('')
          result.push(trailing.replace(/^[ \t]+/, ''))
          continue
        }
      }
      result.push(line)
    } else {
      result.push(line)
    }
  }
  return result.join('\n')
}

/**
 * 从右往左找到表格行中最后一个有效拆分点。
 * 返回该 | 的索引，-1 表示无粘合内容。
 */
function findSplitPositionJS(line: string): number {
  for (let pos = line.length - 1; pos >= 0; pos--) {
    if (line[pos] !== '|') continue
    const after = line.substring(pos + 1)
    if (!after) continue
    if (after.startsWith(IC_PREFIX) || after.startsWith(CB_PREFIX)
      || after.startsWith('**') || after.startsWith('##')
      || /^-\s*[✅❌⚠].*/.test(after) || /^-\s+\S/.test(after)) {
      const before = line.substring(0, pos)
      if (countPipesJS(before) >= 1) return pos
    }
  }
  return -1
}

function countPipesJS(line: string): number {
  let count = 0
  for (const c of line) { if (c === '|') count++ }
  return count
}

/**
 * 压缩表格块内的空行。
 * 表格行之间不应有空行，否则 Markdown 渲染器不识别为表格。
 * 与后端 compactTableBlocks 对齐
 */
function compactTableBlocksJS(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    // 如果当前行是空行，检查前后是否都是表格行
    if (!trimmed && result.length > 0) {
      const prev = result[result.length - 1].trim()
      const next = (i + 1 < lines.length) ? lines[i + 1].trim() : ''
      if (prev.startsWith('|') && prev.endsWith('|') && next.startsWith('|') && next.endsWith('|')) {
        continue // 跳过表格行之间的空行
      }
    }
    result.push(lines[i])
  }
  return result.join('\n')
}

function fixTableBlocksJS(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    if (isTableRowJS(lines[i])) {
      const tableRows: string[] = []
      while (i < lines.length && isTableRowJS(lines[i])) {
        tableRows.push(lines[i])
        i++
      }
      result.push(...fixSingleTableJS(tableRows))
    } else {
      result.push(lines[i])
      i++
    }
  }
  return result.join('\n')
}

function isTableRowJS(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.length > 1
}

function fixSingleTableJS(rows: string[]): string[] {
  if (rows.length === 0) return rows
  if (isSeparatorContentJS(rows[0])) return rows

  const colCount = countColumnsJS(rows[0])
  const fixed: string[] = []

  for (let j = 0; j < rows.length; j++) {
    const row = rows[j]
    if (isSeparatorContentJS(row)) {
      const sepCols = countColumnsJS(row)
      if (sepCols !== colCount) {
        fixed.push(buildSeparatorRowJS(colCount))
      } else {
        fixed.push(formatSeparatorRowJS(row))
      }
    } else {
      // 所有数据行都做 normalizeCellSpacingJS（确保 | 属性 | 值 | 格式）
      let r = row.trim()
      if (!r.startsWith('|')) r = '|' + r
      if (!r.endsWith('|')) r = r + '|'
      r = normalizeCellSpacingJS(r)
      fixed.push(r)
      if (j === 0) {
        const nextIsSep = (j + 1 < rows.length) && isSeparatorContentJS(rows[j + 1])
        if (!nextIsSep) fixed.push(buildSeparatorRowJS(colCount))
      }
    }
  }
  return fixed
}

function countColumnsJS(row: string): number {
  const trimmed = row.trim()
  if (!trimmed.startsWith('|')) return 0
  let inner = trimmed
  if (inner.startsWith('|')) inner = inner.substring(1)
  if (inner.endsWith('|')) inner = inner.substring(0, inner.length - 1)
  return inner.split('|').length
}

function buildSeparatorRowJS(colCount: number): string {
  const cells: string[] = []
  for (let c = 0; c < colCount; c++) cells.push(' --- ')
  return '|' + cells.join('|') + '|'
}

/**
 * 对 Markdown 展示块 (```markdown ... ```) 内容做二次归一化
 * 与后端 normalizeMarkdownShowcaseBlocks 对齐
 */
function normalizeMarkdownShowcaseBlocksJS(text: string): string {
  return text.replace(/(```(?:markdown|md)\n?)([\s\S]*?)(```)/g, (_m, opening, inner, closing) => {
    return opening + normalizeMarkdown(inner) + closing
  })
}

/**
 * 空行修复：确保标题/列表/表格/代码块前后有空行
 * 与后端 ensureBlankLines 对齐
 */
function ensureBlankLinesJS(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      const prev = lines[i - 1].replace(/[ \t]+$/, '')
      const curr = lines[i].replace(/[ \t]+$/, '')

      if (!prev) {
        result.push(lines[i])
        continue
      }

      let needBlank = false

      if (/^#{1,6}\s/.test(curr) && !/^#{1,6}\s/.test(prev)) needBlank = true
      if (/^#{1,6}\s/.test(prev) && !/^#{1,6}\s/.test(curr) && curr && !curr.startsWith('|') && !isSeparatorContentJS(curr)) needBlank = true
      if (/^\d+\.\s/.test(curr) && !/^\d+\.\s/.test(prev)) needBlank = true
      if (/^[\-*+]\s/.test(curr) && !/^[\-*+]\s/.test(prev)) needBlank = true
      if (curr.startsWith('|') && !prev.startsWith('|')) needBlank = true
      if (prev.startsWith('|') && !curr.startsWith('|') && curr) needBlank = true
      if (curr.startsWith(CB_PREFIX) && !prev.startsWith(CB_PREFIX)) needBlank = true
      if (prev.endsWith(CB_SUFFIX) && !curr.startsWith(CB_PREFIX) && curr) needBlank = true

      if (needBlank) result.push('')
    }
    result.push(lines[i])
  }
  return result.join('\n')
}

/**
 * 完整的 Markdown 归一化函数
 * 与后端 MarkdownNormalizer.normalize() 规则对齐
 * 用于前端流式阶段的文本处理
 */
function normalizeMarkdown(text: string): string {
  if (!text) return text

  // ═══ 阶段 0：保护代码块和行内元素 ═══
  const store: string[] = []
  let r = protectElements(text, store)

  // ═══ 阶段 1：表格处理（必须在断行修复之前） ═══
  // 碎片合并 + 孤立短横线清理 + 表格尾部粘合拆分 + || 拆行 + 分隔行修复 + 去重 + 压缩空行
  r = processTablesJS(r)

  // ═══ 阶段 1.5：保护表格行——避免被后续列表规则误匹配 ═══
  const tableStore: string[] = []
  r = protectTableLines(r, tableStore)

  // ═══ 阶段 2：断行修复 ═══
  // 2a. ## 后补空格
  r = r.replace(/(#{2,6})([^\s#])/g, '$1 $2')
  r = r.replace(/(^|\n)(#)([^\s#])/g, '$1$2 $3')

  // 2b. 标题标记前断行+空行
  r = r.replace(/([^\n\s#])(#{1,6}\s)/g, '$1\n\n$2')

  // 2d. 标题后紧跟表格标记 → 断行
  r = r.replace(/(#{1,6}\s[^\n|]+)(\|)/g, '$1\n\n$2')

  // 2d2. 标题后紧跟代码块占位符 → 断行
  r = r.replace(/(#{1,6}\s[^\n\u0001]+)(\u0001CB)/g, '$1\n\n$2')

  // 2f0. 有序列表标记后补空格
  r = r.replace(/(\d{1,2})\.([^\s\d\n.])/g, '$1. $2')

  // 2h0. 无序列表标记后补空格（中文场景）
  // 排除连字符场景：字母/数字后的 - 是连字符而非列表标记（如 x64-架构）
  r = r.replace(/(?<![a-zA-Z0-9\u0001])([-*+])([\u4e00-\u9fa5])/g, '$1 $2')
  // 2h0-en. 列表标记后紧跟英文大写字母也补空格（类名/文件名通常大写开头）
  // 排除连字符场景：字母/数字后的 - 是连字符而非列表标记（xfg-wrench、JSON-RPC、UTF-8）
  r = r.replace(/(?<![a-zA-Z0-9\u0001])([-*+])([A-Z])/g, '$1 $2')
  // 2h0-en2. 列表标记后紧跟小写字母+中文混合内容时补空格（排除纯英文连字符如 self-contained）
  // 排除连字符场景：字母/数字后的 - 是连字符而非列表标记（xfg-wrench框架）
  r = r.replace(/(?<![a-zA-Z0-9\u0001])([-*+])([a-z]+)([\u4e00-\u9fa5])/g, '$1 $2$3')
  // 2h0-ext. 列表标记后紧跟 IC 占位符也补空格
  r = r.replace(/([-*+])(\u0001IC)/g, '$1 $2')

  // 2h1. 中文字符与数字之间补空格
  r = r.replace(/([\u4e00-\u9fa5])(\d)/g, '$1 $2')
  r = r.replace(/(?<!-)(\d)([\u4e00-\u9fa5])/g, '$1 $2')

  // 2f. 有序列表前断行
  r = r.replace(/([^\n\d\s.])(1\.\s)/g, '$1\n$2')

  // 2g. 有序列表项之间断行
  r = r.replace(/([^\n\d.#\s])(\d{1,2}\.\s)/g, '$1\n$2')

  // 2h. 无序列表前断行
  r = r.replace(/([^\n\s])([-*+]\s)/g, '$1\n$2')

  // 2i. 树形符号前断行
  r = r.replace(/([^\n])(├──|└──)/g, '$1\n$2')

  // 2j. 代码块占位符前断行
  r = r.replace(/([^\n\u0001])(\u0001CB)/g, '$1\n$2')

  // 2k. 代码块占位符后断行
  r = r.replace(/(\u0001CB\d+\u0001)([^\n\u0001])/g, '$1\n$2')

  // 阶段 2.5：断行后新暴露的表格行修复
  r = fixTableBlocksJS(r)

  // 阶段 3：空行修复
  r = ensureBlankLinesJS(r)

  // 阶段 4：清理
  r = r.replace(/\n{3,}/g, '\n\n')
  r = r.replace(/[ \t]+\n/g, '\n')
  r = r.replace(/^\s+/, '').replace(/\s+$/, '')

  // 阶段 5：恢复被保护的表格行（必须在恢复代码块之前，因为表格行内可能含 IC/CB 占位符）
  r = restoreTableLines(r, tableStore)

  // 阶段 5.5：恢复代码块和行内元素
  r = restoreElements(r, store)

  // 阶段 6：Markdown 展示块二次归一化
  r = normalizeMarkdownShowcaseBlocksJS(r)

  // 阶段 7：压缩表格块内空行（必须在最后，因为前面的规则可能插入空行）
  r = compactTableBlocksJS(r)

  return r
}

/**
 * 兜底 Markdown 清理
 * 1. 保护代码块
 * 2. ** text ** → **text**（加粗标记内空格清理）
 * 3. 连续 3+ 空行 → 2 空行
 *
 * ⚠️ 此函数已升级为完整归一化（与后端 MarkdownNormalizer 对齐），
 *    名称 cleanMarkdown 保持不变以兼容现有调用点
 */
// cleanMarkdown 已升级为完整归一化（与后端 MarkdownNormalizer.normalize() 对齐）
// 流式阶段前端做同样的归一化，确保渲染一致
function cleanMarkdown(text: string): string {
  return normalizeMarkdown(text)
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

  // ⚠️ Hook 规则：useMemo 必须在条件 return 之前调用
  const processedContent = useMemo(() => {
    if (!content || !content.trim()) return ''
    const normalized = cleanMarkdown(content)
    return normalized.replace(/(?<!\]\()(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]{100,})/g, (match) => `![](${match})`)
  }, [content])

  if (!content || !content.trim()) return null

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
        tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
        tr: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
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
      {processedContent}
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

/** 工具调用步骤视图（单行折叠） */
export function ToolCallView({ step, colors, compact }: { step: ReActStep; colors: ReturnType<typeof useThemeStore.getState>['colors']; compact?: boolean }) {
  const [expanded, setExpanded] = React.useState(false)
  const toolName = step.toolName || '工具'
  const label = extractToolLabel(step)
  const paramSummary = step.toolParams ? step.toolParams.substring(0, 80) : ''

  if (compact) {
    return (
      <div className="py-1 text-[11px]" style={{ color: colors.textSecondary }}>
        <div className="flex items-center gap-1.5">
          <span className="font-medium" style={{ color: colors.text }}>{toolName}</span>
          {step.status === 'in_progress' && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#f59e0b' }} />}
          {step.status === 'success' && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#22c55e' }} />}
          {step.status === 'failure' && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />}
          {label !== toolName && <span className="text-[10px] opacity-70 truncate">· {label}</span>}
        </div>
        {paramSummary && (
          <div className="mt-0.5 font-mono text-[10px] truncate opacity-70" style={{ maxWidth: '100%' }}>{paramSummary}</div>
        )}
      </div>
    )
  }

  return (
    <div className="my-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left rounded transition-colors hover:bg-black/5"
      >
        {step.status === 'in_progress' && <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ backgroundColor: '#f59e0b' }} />}
        {step.status === 'success' && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#22c55e' }} />}
        {step.status === 'failure' && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#ef4444' }} />}
        <span className="text-[11px] font-medium shrink-0" style={{ color: colors.text }}>{toolName}</span>
        {label !== toolName && <span className="text-[11px] opacity-60 truncate">{label}</span>}
        {paramSummary && <span className="text-[10px] font-mono opacity-40 truncate hidden sm:inline">{paramSummary}</span>}
        <div className="flex-1" />
        <svg className={`w-3 h-3 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`} style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-[11px] space-y-1.5" style={{ color: colors.textSecondary }}>
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
