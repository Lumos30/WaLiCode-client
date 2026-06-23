import React, { useRef, useEffect, useState } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { useAgentStore } from '../stores/agentStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useSshAgentStore } from '../stores/sshAgentStore'
import { useFileExplorerStore } from '../stores/fileExplorerStore'
import { useLocalFileStore } from '../stores/localFileStore'
import { useAiPatchStore } from '../stores/aiPatchStore'
import { useOutputStore } from '../stores/outputStore'
import { usePermissionStore } from '../stores/permissionStore'
import { useStreamStore } from '../stores/streamStore'
import * as agentApi from '../api/agent'
import type { ReActStep, TaskBreakdownDTO } from '../api/agent'
import { ConnectionStatus } from '../types'
import type { AgentMessage } from '../types'
import { MessageBubble } from './MessageBubble'
import { PermissionConfirmModal } from './PermissionConfirmModal'
import { StreamStatusBar } from './StreamStatusBar'
import { ErrorRecoveryCard, type ErrorRecovery } from './ErrorRecoveryCard'
import { TopicDivider, shouldInsertTopicDivider } from './TopicDivider'
import { CommandMenu, useCommandMenu, type MenuItem } from './CommandMenu'
import { ToolProgressBar, toolProgressStore } from './ToolProgressBar'
import { ShortcutHelp } from './ShortcutHelp'
import { ChatExport } from './ChatExport'
import { EmptyState } from './EmptyState'

function parseToolResultPayload(raw?: string): Record<string, any> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const match = raw.match(/"path"\s*:\s*"([^"]+)"/)
    return match ? { path: match[1] } : null
  }
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
    updateMessage,
    updateMessageSteps,
    updateMessageTaskBreakdown,
    updateSubTaskStatus,
    updateMessageChangeSummary,
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
      console.log('[RightSidebar] autoBindCurrentConnection check: activeTerminalSessionId=', activeTerminalSessionId, 'activeBinding=', activeBinding?.terminalSessionId, 'currentSessionId=', useAgentStore.getState().currentSessionId, 'currentAgentId=', currentAgentId)
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

  const insertTagAtCursor = (tag: { id: string; label: string; type: 'terminal-selection' | 'file' | 'custom'; fullContent: string }) => {
    if (!inputRef.current) return
    // 仅写入 Zustand store（store 渲染层负责显示标签，避免 DOM 插入导致重复）
    addInputTag(tag)
    inputRef.current.focus()
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

    // 更新 SSE 流状态
    useStreamStore.getState().setStatus('connecting')
    useStreamStore.getState().touchActivity()

    abortRef.current = agentApi.reactChatStream(
      currentAgentId,
      'default',
      sessionId,
      messageContent,
      (step: ReActStep) => {
        console.log('[onStep]', step.stepType, step.content?.substring(0, 80))
        steps.push(step)
        updateMessageSteps(sessionId, assistantId, steps)

        // 检测命令执行工具 → 写入输出面板
        const commandExecTools = ['executeLocalCommand', 'compileProject', 'compileTests', 'runUnitTests', 'executeSshCommand']
        if (step.stepType === 'tool_call' && step.toolName && commandExecTools.includes(step.toolName)) {
          const outputStore = useOutputStore.getState()
          const entrySessionId = `step-${step.stepIndex}`

          if (step.status === 'in_progress') {
            // 命令开始执行 → 创建 running 条目
            const commandStr = step.toolParams || ''
            outputStore.addEntry({
              sessionId: entrySessionId,
              command: commandStr,
              status: 'running',
              stdout: '',
              stderr: '',
              exitCode: null,
              durationMs: null,
            })
          } else if (step.status === 'success' || step.status === 'failure') {
            // 命令执行完成 → 更新条目
            const existing = outputStore.entries.find((e) => e.sessionId === entrySessionId)
            if (existing) {
              // 解析工具返回结果
              let stdout = ''
              let stderr = ''
              let exitCode = -1
              let durationMs = 0

              if (step.toolResult) {
                try {
                  const result = JSON.parse(step.toolResult)
                  stdout = result.output || result.stdout || ''
                  stderr = result.stderr || ''
                  exitCode = result.exitCode ?? -1
                  durationMs = result.timeoutMs || 0
                } catch {
                  stdout = step.toolResult
                }
              }

              outputStore.updateEntry(entrySessionId, {
                status: step.status === 'success' ? 'success' : 'failed',
                stdout,
                stderr,
                exitCode,
                durationMs,
              })
            } else {
            // 没有找到 in_progress 时创建的条目（可能 step 被合并了），直接创建完成态条目
              let stdout = ''
              let exitCode = -1
              if (step.toolResult) {
                try {
                  const result = JSON.parse(step.toolResult)
                  stdout = result.output || result.stdout || ''
                  exitCode = result.exitCode ?? -1
                } catch {
                  stdout = step.toolResult
                }
              }
              outputStore.addEntry({
                sessionId: entrySessionId,
                command: step.toolParams || '',
                status: step.status === 'success' ? 'success' : 'failed',
                stdout,
                stderr: '',
                exitCode,
                durationMs: 0,
              })
            }
          }
        }

        // 检测文件操作工具完成 → 刷新文件树 + 重载编辑器
        if (step.stepType === 'tool_call' && step.status === 'success' && step.toolName) {
          const fileWriteTools = ['writeLocalFile', 'createLocalFile', 'deleteLocalFile', 'writeFile', 'createFile', 'deleteFile']
          if (fileWriteTools.includes(step.toolName)) {
            console.log('[onStep] 文件操作工具完成，刷新文件树和编辑器:', step.toolName, 'toolResult=', step.toolResult?.substring(0, 200))

            const payload = parseToolResultPayload(step.toolResult)
            let changedPath = payload?.path as string | undefined
            // 兜底1: 从 toolParams/args 中提取路径（tool_progress 事件的 summary 不是 JSON）
            if (!changedPath && step.toolParams) {
              // toolParams 可能就是文件路径，或包含路径参数
              const params = step.toolParams.trim()
              if (params.startsWith('/')) {
                changedPath = params
              } else {
                const pathMatch = params.match(/(\/\w[\w./-]+\.[\w]+)/)
                if (pathMatch) changedPath = pathMatch[1]
              }
            }
            // 兜底2: 从 toolResult 文本中提取路径（非 JSON 格式时）
            if (!changedPath && step.toolResult) {
              const m = step.toolResult.match(/([\/][\w./-]+\.[\w]+)/)
              if (m) changedPath = m[1]
            }
            console.log('[onStep] payload=', payload, 'changedPath=', changedPath, 'toolParams=', step.toolParams?.substring(0, 100))

            const isLocalTool = step.toolName.includes('Local')
            const isDeleteOp = step.toolName === 'deleteLocalFile' || step.toolName === 'deleteFile'

            // 本地文件操作
            if (isLocalTool) {
              const localStore = useLocalFileStore.getState()

              // 如果有明确路径，重载对应文件
              if (changedPath && !isDeleteOp) {
                const targetTab = localStore.openTabs.find((tab) => tab.path === changedPath)
                const beforeContent = targetTab?.content ?? ''
                localStore.reloadFileByPath(changedPath).then((afterContent) => {
                  if (afterContent != null && afterContent !== beforeContent) {
                    useAiPatchStore.getState().upsertPreview({
                      target: 'local',
                      path: changedPath!,
                      toolName: step.toolName!,
                      beforeContent,
                      afterContent,
                    })
                  }
                }).catch(() => {})
              }

              // 兜底3: 路径提取失败时，刷新当前活动 tab（本地）
              if (!changedPath) {
                const activeTab = localStore.openTabs.find((tab) => tab.key === localStore.activeTabKey)
                if (activeTab && !isDeleteOp) {
                  console.log('[onStep] 路径提取失败，兜底刷新当前活动 tab:', activeTab.path)
                  localStore.reloadFileByPath(activeTab.path).catch(() => {})
                }
              }

              // 文件树刷新
              const changedDir = changedPath ? changedPath.substring(0, changedPath.lastIndexOf('/')) : null
              if (changedDir) {
                localStore.refreshDirectory(changedDir).catch(() => {})
              } else if (localStore.rootPath) {
                localStore.refreshDirectory(localStore.rootPath).catch(() => {})
              }
            }

            // 远程文件操作
            if (!isLocalTool) {
              const connectionId = activeBinding?.connectionId || currentConnectionId
              if (connectionId) {
                const fileStore = useFileExplorerStore.getState()

                if (changedPath && !isDeleteOp) {
                  const targetTab = fileStore.openTabs.find((tab) => tab.connectionId === connectionId && tab.path === changedPath)
                  const beforeContent = targetTab?.content ?? ''
                  fileStore.reloadFileByPath(connectionId, changedPath).then((afterContent) => {
                    if (afterContent != null && afterContent !== beforeContent) {
                      useAiPatchStore.getState().upsertPreview({
                        target: 'remote',
                        path: changedPath!,
                        connectionId,
                        toolName: step.toolName!,
                        beforeContent,
                        afterContent,
                      })
                    }
                  }).catch(() => {})
                }

                // 兜底3: 路径提取失败时，刷新当前活动 tab（远程）
                if (!changedPath) {
                  const activeTab = fileStore.openTabs.find((tab) => tab.connectionId === connectionId && tab.key === fileStore.activeTabKey)
                  if (activeTab && !isDeleteOp) {
                    console.log('[onStep] 路径提取失败，兜底刷新当前活动远程 tab:', activeTab.path)
                    fileStore.reloadFileByPath(connectionId, activeTab.path).catch(() => {})
                  }
                }

                const changedDir = changedPath ? changedPath.substring(0, changedPath.lastIndexOf('/')) : null
                if (changedDir) {
                  fileStore.refreshDirectory(connectionId, changedDir).catch(() => {})
                }
              }
            }
          }
        }
      },
      (fullText: string) => {
        console.log('[onText]', fullText.substring(0, 80))
        fullContent = fullText
        updateMessage(sessionId, assistantId, fullContent)
        // 标记流式输出中 + 刷新心跳
        useStreamStore.getState().setStatus('streaming')
        useStreamStore.getState().touchActivity()
      },
      (finalContent: string) => {
        console.log('[onDone] finalContent=', finalContent?.substring(0, 80))
        if (finalContent) {
          fullContent = finalContent
          updateMessage(sessionId, assistantId, fullContent)
        }
        abortRef.current = null
        setLoading(false)
        useStreamStore.getState().reset()
        // 完成所有 running 状态的工具输出条目
        const outputStore = useOutputStore.getState()
        outputStore.entries.forEach((entry) => {
          if (entry.status === 'running' && entry.sessionId.startsWith('tool-')) {
            outputStore.updateEntry(entry.sessionId, { status: 'success' })
          }
        })
      },
      (err: string) => {
        console.error('[reactChatStream] error:', err)
        updateMessage(sessionId, assistantId, `请求失败: ${err}`)
        abortRef.current = null
        setLoading(false)
        useStreamStore.getState().setError(err)
        // 设置错误恢复卡片
        setErrorRecovery({
          type: err.includes('network') || err.includes('Failed') || err.includes('fetch') ? 'network' : 'unknown',
          title: err.includes('413') ? '请求体过大' : '请求失败',
          message: err,
        })
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
      // onChangeSummary: 文件变更摘要 → 自动重载已打开的文件
      (changeSummary) => {
        console.log('[onChangeSummary]', changeSummary.description, changeSummary.created?.length, changeSummary.modified?.length, changeSummary.deleted?.length)
        updateMessageChangeSummary(sessionId, assistantId, changeSummary)

        // 自动重载所有被修改/创建的已打开文件
        const changedFiles = [...(changeSummary.modified || []), ...(changeSummary.created || [])]
        if (changedFiles.length === 0) return

        // 本地文件重载
        const localStore = useLocalFileStore.getState()
        for (const file of changedFiles) {
          if (localStore.openTabs.some((t) => t.path === file.path)) {
            localStore.reloadFileByPath(file.path).catch(() => {})
          }
        }

        // 远程文件重载
        const connectionId = activeBinding?.connectionId || currentConnectionId
        if (connectionId) {
          const fileStore = useFileExplorerStore.getState()
          for (const file of changedFiles) {
            if (fileStore.openTabs.some((t) => t.connectionId === connectionId && t.path === file.path)) {
              fileStore.reloadFileByPath(connectionId, file.path).catch(() => {})
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
        console.log('[onPermissionConfirm]', permissionData.toolName, permissionData.riskLevel, permissionData.reason)
        usePermissionStore.getState().pushConfirmation({
          ...permissionData,
          arrivedAt: Date.now(),
        })
      },
      // onToolOutput: 工具实时输出片段 → 更新输出面板
      (toolCallId, outputChunk) => {
        console.log('[onToolOutput]', toolCallId, outputChunk.substring(0, 80))
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
        console.log('[onStatus]', statusMessage)
        useStreamStore.getState().setStatusMessage(statusMessage)
      },
      // onWarning: 警告消息
      (warningMessage) => {
        console.log('[onWarning]', warningMessage)
      },
      // onRoundStart: 新轮次开始
      (roundIndex) => {
        console.log('[onRoundStart] round', roundIndex)
      },
      // onReconnect: 流中途断开重连
      (attempt, maxAttempts) => {
        console.log(`[onReconnect] attempt ${attempt}/${maxAttempts}`)
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
    // 清除工具进度条状态，避免停止后进度条仍在跑
    toolProgressStore.clear()
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
            {currentSession.messages.map((msg, msgIdx) => {
              const showDivider = msgIdx > 0 && (() => {
                const prev = currentSession.messages[msgIdx - 1]
                return shouldInsertTopicDivider(prev, msg).shouldInsert
              })()
              const dividerTitle = msgIdx > 0 ? (() => {
                const prev = currentSession.messages[msgIdx - 1]
                const result = shouldInsertTopicDivider(prev, msg)
                return result.title
              })() : undefined
              return (
                <React.Fragment key={msg.id}>
                  {showDivider && (
                    <TopicDivider
                      prevTimestamp={currentSession.messages[msgIdx - 1].timestamp}
                      currTimestamp={msg.timestamp}
                      topicIndex={msgIdx}
                      defaultTitle={dividerTitle}
                    />
                  )}
                  <MessageBubble message={msg} isLoading={isLoading} onEditRetry={(msgId) => {
                    if (currentSessionId) {
                      editAndRetry(currentSessionId, msgId)
                      // 聚焦输入框
                      setTimeout(() => inputRef.current?.focus(), 50)
                    }
                  }} />
                </React.Fragment>
              )
            })}
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
            {/* 错误恢复卡片 */}
            {errorRecovery && (
              <div className="px-4 py-2">
                <ErrorRecoveryCard
                  error={errorRecovery}
                  canRetry={true}
                  onRetry={() => {
                    setErrorRecovery(null)
                    // 重试：重新发送最后一条用户消息
                    if (currentSession && currentSession.messages.length >= 2) {
                      const lastUserMsg = [...currentSession.messages].reverse().find(m => m.role === 'user')
                      if (lastUserMsg) {
                        // 模拟重新发送
                        const inputEl = inputRef.current
                        if (inputEl) {
                          inputEl.innerText = lastUserMsg.content
                          // 触发发送
                          setTimeout(() => {
                            const sendBtn = inputEl.parentElement?.querySelector('[data-send-btn]') as HTMLButtonElement
                            sendBtn?.click()
                          }, 50)
                        }
                      }
                    }
                  }}
                  onSkip={() => setErrorRecovery(null)}
                  onResetContext={() => {
                    setErrorRecovery(null)
                    // 清空当前会话消息以重置上下文
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
                  console.log('Reset context - API not yet available')
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
