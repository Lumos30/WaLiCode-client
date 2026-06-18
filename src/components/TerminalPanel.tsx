import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { useThemeStore } from '../stores/themeStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useSshAgentStore } from '../stores/sshAgentStore'
import { openTerminal, writeInput, readOutput, resizeTerminal, closeTerminal } from '../api/terminal'
import { ConnectionStatus } from '../types'
import { COMMAND_CATEGORIES, type CommandCategory, type CommandItem } from './CommandData/commandData'

/** 终端会话状态 */
interface TerminalSession {
  sessionId: string
  connectionId: string
}

/** 每个连接持有的终端状态 */
interface ConnectionTerminalState {
  terminal: Terminal
  fitAddon: FitAddon
  container: HTMLDivElement
  session: TerminalSession | null
  pollTimer: ReturnType<typeof setInterval> | null
  onDataDisposable: { dispose(): void } | null
  disconnected: boolean
  connecting: boolean
  resizeObserver: ResizeObserver | null
  lastSentSize: { cols: number; rows: number }
  inputBuffer: string[] | null
  inputFlushTimer: ReturnType<typeof setTimeout> | null
}

/** 全局终端会话存储 - 保持跨组件的会话 */
const globalTerminalStates = new Map<string, ConnectionTerminalState>()

/** 轮询间隔（ms） */
const POLL_INTERVAL = 50

/** 后端返回的断连标记 */
const DISCONNECT_MARKER = '[连接已断开]'

/** 轮询连续错误阈值 */
const POLL_ERROR_THRESHOLD = 3

/** 右键菜单位置 */
interface ContextMenuPos {
  x: number
  y: number
}

interface TerminalPanelProps {
  onTerminalSessionChange?: (sessionId: string | null) => void
  /** 是否在组件卸载时保留终端会话（默认 true，实现切换标签页保持连接） */
  keepSessionOnUnmount?: boolean
}

export function TerminalPanel({ 
  onTerminalSessionChange, 
  keepSessionOnUnmount = true 
}: TerminalPanelProps) {
  const { colors } = useThemeStore()
  const { currentConnectionId, connections, connect, disconnect } = useConnectionStore()
  const { addInputTag } = useSshAgentStore()

  // 使用全局终端状态而不是组件内状态
  const terminalStates = useRef<Map<string, ConnectionTerminalState>>(globalTerminalStates)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const activeConnectionIdRef = useRef<string | null>(null)

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    pos: ContextMenuPos
    selectedText: string
  }>({ visible: false, pos: { x: 0, y: 0 }, selectedText: '' })

  // 命令辅助侧边栏状态
  const [showCommandSidebar, setShowCommandSidebar] = useState(false)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  // 当前连接状态
  const currentConn = connections.find((c) => c.id === currentConnectionId)

  /** 获取当前终端会话 ID */
  const getCurrentTerminalSessionId = useCallback(() => {
    if (!currentConnectionId) return null
    const state = terminalStates.current.get(currentConnectionId)
    return state?.session?.sessionId || null
  }, [currentConnectionId])

  /** 通知父组件终端会话变化 */
  useEffect(() => {
    const sessionId = getCurrentTerminalSessionId()
    onTerminalSessionChange?.(sessionId)
  }, [currentConnectionId, getCurrentTerminalSessionId, onTerminalSessionChange])

  /** 创建 xterm Terminal 实例 */
  const createTerminalInstance = useCallback(() => {
    return new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      scrollback: 100000,
      theme: {
        background: colors.bgPrimary,
        foreground: colors.text,
        cursor: colors.accent,
        cursorAccent: colors.bgPrimary,
        selectionBackground: colors.accent + '50',
        selectionForeground: '#ffffff',
        black: '#000000',
        red: colors.red,
        green: colors.green,
        yellow: colors.yellow,
        blue: colors.accent,
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: colors.text,
        brightBlack: '#555555',
        brightRed: colors.red,
        brightGreen: colors.green,
        brightYellow: colors.yellow,
        brightBlue: colors.accent,
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      rows: 24,
      cols: 120,
      allowProposedApi: false,
    })
  }, [colors])

  /** 停止指定连接的轮询 */
  const stopPolling = useCallback((state: ConnectionTerminalState) => {
    if (state.pollTimer) {
      clearInterval(state.pollTimer)
      state.pollTimer = null
    }
  }, [])

  /** 标记终端断开并清理 */
  const markDisconnected = useCallback(async (state: ConnectionTerminalState, reason: string) => {
    if (state.disconnected) return
    state.disconnected = true
    stopPolling(state)

    const conn = connections.find((c) => c.id === state.session!.connectionId)
    if (conn && conn.status === ConnectionStatus.CONNECTED) {
      try {
        await disconnect(conn.id)
      } catch {
        // 忽略断开连接的错误
      }
    }

    state.terminal.writeln(`\x1b[33m\r\n*** ${reason} ***\x1b[0m`)
  }, [stopPolling, connections, disconnect])

  /** 启动轮询 */
  const startPolling = useCallback((state: ConnectionTerminalState) => {
    stopPolling(state)
    const sessionId = state.session!.sessionId
    let errorCount = 0

    state.pollTimer = setInterval(async () => {
      try {
        const res = await readOutput(sessionId)

        if (res.code === '0000') {
          errorCount = 0
          if (res.data?.output) {
            const output = res.data.output
            if (output.includes(DISCONNECT_MARKER)) {
              markDisconnected(state, '连接已断开')
              return
            }
            state.terminal.write(output)
          }
          return
        }

        if (res.code === 'ILLEGAL_PARAMETER' && res.info?.includes('不存在')) {
          markDisconnected(state, '会话已失效')
          return
        }

        errorCount++
        if (errorCount >= POLL_ERROR_THRESHOLD) {
          markDisconnected(state, '连接异常')
        }
      } catch {
        errorCount++
        if (errorCount >= POLL_ERROR_THRESHOLD) {
          markDisconnected(state, '网络异常')
        }
      }
    }, POLL_INTERVAL)
  }, [stopPolling, markDisconnected])

  /** 销毁指定连接的终端 */
  const destroyTerminal = useCallback((connectionId: string) => {
    const state = terminalStates.current.get(connectionId)
    if (!state) return

    stopPolling(state)

    if (state.inputFlushTimer) {
      clearTimeout(state.inputFlushTimer)
    }

    if (state.session) {
      closeTerminal(state.session.sessionId).catch(() => {})
    }

    state.onDataDisposable?.dispose()
    state.resizeObserver?.disconnect()
    state.terminal.dispose()
    if (state.container.parentNode) {
      state.container.remove()
    }

    terminalStates.current.delete(connectionId)
  }, [stopPolling])

  /** 创建并打开终端会话 */
  const openTerminalSession = useCallback(async (connectionId: string) => {
    // 检查是否已经有一个会话了
    const existingState = terminalStates.current.get(connectionId)
    if (existingState) {
      if (existingState.connecting) return
      // 每次都强制销毁旧会话，避免使用失效的会话
      destroyTerminal(connectionId)
    }

    if (!wrapperRef.current) return

    const term = createTerminalInstance()
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    try {
      term.loadAddon(new WebglAddon())
    } catch {
      /* WebGL 不可用时降级 */
    }

    const container = document.createElement('div')
    container.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;padding:0 8px 25px 8px;overflow:hidden;'
    wrapperRef.current.appendChild(container)

    // 监听选中事件
    term.onSelectionChange(() => {
      const selection = term.getSelection()
      if (selection) {
        // 使用 timeout 等待鼠标事件完成，获取正确的位置
        setTimeout(() => {
          // 这里我们无法直接获取到鼠标位置，所以显示在一个固定位置或通过其他方式
          // 但由于我们想在选中后直接弹出，我们需要在 xterm 的容器上监听 mouseup
        }, 10)
      }
    })

    // 添加右键菜单和选中事件
    container.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const selection = term.getSelection()
      if (selection) {
        setContextMenu({
          visible: true,
          pos: { x: e.clientX, y: e.clientY },
          selectedText: selection,
        })
      }
    })

    // 鼠标抬起时，如果有选中内容，直接弹出菜单
    container.addEventListener('mouseup', (e) => {
      // 延迟一下确保 xterm 的 selection 已经更新
      setTimeout(() => {
        const selection = term.getSelection()
        if (selection && selection.trim().length > 0) {
          setContextMenu({
            visible: true,
            pos: { x: e.clientX, y: e.clientY },
            selectedText: selection,
          })
        } else {
          // 如果没有选中内容，且不是右键点击，关闭菜单
          if (e.button !== 2) {
            setContextMenu((prev) => ({ ...prev, visible: false }))
          }
        }
      }, 50)
    })

    term.open(container)
    fitAddon.fit()

    const state: ConnectionTerminalState = {
      terminal: term,
      fitAddon,
      container,
      session: null,
      pollTimer: null,
      onDataDisposable: null,
      disconnected: false,
      connecting: true,
      resizeObserver: null,
      lastSentSize: { cols: term.cols, rows: term.rows },
      inputBuffer: null,
      inputFlushTimer: null,
    }
    terminalStates.current.set(connectionId, state)

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (resizeTimer) return
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (!state.session) return
        fitAddon.fit()
        if (term.cols > 0 && term.rows > 0) {
          const { cols, rows } = term
          if (cols === state.lastSentSize.cols && rows === state.lastSentSize.rows) return
          state.lastSentSize = { cols, rows }
          resizeTerminal({ sessionId: state.session.sessionId, cols, rows }).catch(() => {})
        }
      }, 300)
    })
    ro.observe(container)
    state.resizeObserver = ro

    try {
      const res = await openTerminal({
        connectionId,
        cols: term.cols,
        rows: term.rows,
      })

      if (res.code !== '0000' || !res.data) {
        term.writeln(`\x1b[31m打开终端失败: ${res.info}\x1b[0m`)
        state.connecting = false
        return
      }

      const { sessionId, initialOutput } = res.data!
      state.session = { sessionId, connectionId }

      // 通知父组件会话已建立
      if (connectionId === currentConnectionId) {
        onTerminalSessionChange?.(sessionId)
      }

      if (initialOutput) {
        term.write(initialOutput)
      }

      state.onDataDisposable = term.onData((data) => {
        if (state.disconnected || !state.session) return

        if (!state.inputBuffer) {
          state.inputBuffer = []
          state.inputFlushTimer = setTimeout(() => {
            if (state.inputBuffer && state.session && !state.disconnected) {
              const input = state.inputBuffer.join('')
              writeInput({ sessionId: state.session.sessionId, input }).catch(() => {
                term.writeln('\r\n\x1b[31m输入发送失败\x1b[0m')
              })
            }
            state.inputBuffer = null
            state.inputFlushTimer = null
          }, 10)
        }
        state.inputBuffer.push(data)
      })

      startPolling(state)
    } catch (err: any) {
      term.writeln(`\x1b[31m连接错误: ${err.message || '未知错误'}\x1b[0m`)
    } finally {
      state.connecting = false
    }
  }, [createTerminalInstance, destroyTerminal, startPolling, currentConnectionId, onTerminalSessionChange])

  /** 切换终端显示 */
  useEffect(() => {
    activeConnectionIdRef.current = currentConnectionId
    
    // 先确保所有终端容器从 DOM 移除
    terminalStates.current.forEach((state) => {
      if (state.container.parentNode) {
        state.container.parentNode.removeChild(state.container)
      }
    })

    // 然后添加当前连接的终端到 DOM
    if (currentConnectionId && wrapperRef.current) {
      const currentState = terminalStates.current.get(currentConnectionId)
      if (currentState) {
        wrapperRef.current.appendChild(currentState.container)
        currentState.container.style.visibility = 'visible'
        currentState.container.style.zIndex = '1'
        requestAnimationFrame(() => {
          currentState.terminal.focus()
        })
      }
    }

    // 切换连接时通知父组件当前会话ID
    const activeState = currentConnectionId ? terminalStates.current.get(currentConnectionId) : undefined
    onTerminalSessionChange?.(activeState?.session?.sessionId ?? null)
  }, [currentConnectionId, onTerminalSessionChange])

  /** 监听连接状态变化 */
  useEffect(() => {
    if (!currentConn) return

    const isConnected = currentConn.status === ConnectionStatus.CONNECTED
    const state = terminalStates.current.get(currentConn.id)

    if (isConnected) {
      if (!state) {
        openTerminalSession(currentConn.id)
      } else if (state.disconnected) {
        destroyTerminal(currentConn.id)
        openTerminalSession(currentConn.id)
      }
    } else {
      // 当 SSH 连接断开时，总是清理终端会话
      if (state) {
        destroyTerminal(currentConn.id)
      }
    }
  }, [currentConn, openTerminalSession, destroyTerminal])

  /**
   * 组件挂载时恢复已有的终端会话
   * 
   * 场景：MainView 中 servers/files 标签页各有一个 TerminalPanel 实例。
   * 从 servers 切换到 files 时，servers 的 TerminalPanel 卸载并把 terminal container
   * 从 DOM 移除（但会话保留在 globalTerminalStates）。files 的 TerminalPanel 挂载时，
   * currentConnectionId 没变，所以 openTerminalSession 不会重新调用。
   * 此 useEffect 确保挂载时把已有会话 attach 到当前 wrapperRef。
   */
  useLayoutEffect(() => {
    if (!wrapperRef.current || !currentConnectionId) return

    const state = terminalStates.current.get(currentConnectionId)
    if (!state || !state.session) return

    // 会话已存在，只恢复 DOM 挂载和轮询
    if (!state.container.parentNode) {
      wrapperRef.current.appendChild(state.container)
      state.container.style.visibility = 'visible'
      state.container.style.zIndex = '1'
      startPolling(state)
    }

    requestAnimationFrame(() => {
      state.terminal.focus()
    })
  }, [currentConnectionId, startPolling])

  /** 组件卸载清理 - 根据配置决定是否保留会话 */
  useEffect(() => {
    return () => {
      if (!keepSessionOnUnmount) {
        // 完全清理模式 - 销毁所有会话
        terminalStates.current.forEach((_, connId) => {
          destroyTerminal(connId)
        })
      } else {
        // 保留会话模式 - 只停止轮询和从 DOM 移除，不关闭后端会话
        terminalStates.current.forEach((state) => {
          stopPolling(state)
          if (state.container.parentNode) {
            state.container.parentNode.removeChild(state.container)
          }
        })
      }
    }
  }, [destroyTerminal, stopPolling, keepSessionOnUnmount])

  /** 重新连接 */
  const handleReconnect = useCallback((connectionId: string) => {
    destroyTerminal(connectionId)
    openTerminalSession(connectionId)
  }, [destroyTerminal, openTerminalSession])

  /** 处理添加到对话 */
  const handleAddToChat = useCallback(() => {
    if (contextMenu.selectedText) {
      addInputTag({
        label: contextMenu.selectedText.length > 20 ? contextMenu.selectedText.slice(0, 20) + '...' : contextMenu.selectedText,
        fullContent: contextMenu.selectedText,
        type: 'terminal-selection'
      })
    }
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }, [contextMenu.selectedText, addInputTag])

  /** 处理复制 */
  const handleCopy = useCallback(() => {
    if (contextMenu.selectedText) {
      navigator.clipboard.writeText(contextMenu.selectedText)
    }
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }, [contextMenu.selectedText])

  /** 点击其他地方关闭右键菜单 */
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu((prev) => ({ ...prev, visible: false }))
    }
    if (contextMenu.visible) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenu.visible])

  const currentState = currentConn ? terminalStates.current.get(currentConn.id) : undefined

  if (!currentConn) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-w-0" style={{ backgroundColor: colors.bgPrimary }}>
        <div className="text-center">
          <div className="text-6xl mb-4">🖥️</div>
          <h2 className="text-lg font-medium mb-2" style={{ color: colors.text }}>
            未连接 SSH 服务器
          </h2>
          <p className="text-sm mb-6" style={{ color: colors.textDim }}>
            请在左侧选择或添加 SSH 连接
          </p>
        </div>
      </div>
    )
  }

  const isConnected = currentConn.status === ConnectionStatus.CONNECTED

  return (
    <div className="h-full flex flex-col min-w-0 relative" style={{ backgroundColor: colors.bgPrimary }}>
      {/* 终端工具栏 */}
      <div className="h-9 flex items-center justify-between px-3 border-b flex-shrink-0" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: isConnected ? colors.green : colors.yellow }} />
          <span className="text-xs font-medium" style={{ color: colors.text }}>
            {currentConn.name}
          </span>
          <span className="text-[10px] font-mono" style={{ color: colors.textDim }}>
            {currentConn.username}@{currentConn.host}:{currentConn.port}
          </span>
          {currentState?.disconnected && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: colors.red + '20', color: colors.red }}>
              已断开
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {currentState?.disconnected ? (
            <button
              onClick={() => handleReconnect(currentConn.id)}
              className="px-2 py-1 rounded text-[11px] font-medium transition-colors"
              style={{ backgroundColor: colors.green, color: '#ffffff' }}
            >
              重新连接
            </button>
          ) : (
            <>
              <button
                onClick={() => currentState?.terminal.clear()}
                className="p-1.5 rounded hover:bg-white/10 transition-colors"
                style={{ color: colors.textDim }}
                title="清屏"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
              <button
                onClick={async () => {
                  // 先断开 SSH 连接
                  await disconnect(currentConn.id)
                  // 然后清理终端会话
                  destroyTerminal(currentConn.id)
                }}
                className="p-1.5 rounded hover:bg-white/10 transition-colors"
                style={{ color: colors.textDim }}
                title="断开连接"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
              {/* 命令辅助按钮 */}
              <button
                onClick={() => setShowCommandSidebar(!showCommandSidebar)}
                className="p-1.5 rounded hover:bg-white/10 transition-colors"
                style={{ color: showCommandSidebar ? colors.accent : colors.textDim }}
                title="命令辅助"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 17l6-6-6-6M12 19h8" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 命令辅助侧边栏 */}
      {showCommandSidebar && (
        <CommandSidebar
          categories={COMMAND_CATEGORIES}
          expandedCategory={expandedCategory}
          onToggleCategory={(name: string | null) => setExpandedCategory(name)}
          onSelectCommand={(cmd) => {
            // 直接将命令粘贴到终端输入行，让用户可以编辑后再执行
            if (!currentConnectionId) return
            const state = terminalStates.current.get(currentConnectionId)
            if (state?.terminal) {
              // 如果不是 root 用户，自动添加 sudo（排除已经有 sudo 的命令和一些不需要 sudo 的命令）
              let finalCmd = cmd
              if (currentConn && currentConn.username !== 'root') {
                const noSudoCommands = ['cd', 'pwd', 'ls', 'echo', 'cat', 'exit', 'clear', 'history']
                const cmdFirstWord = cmd.trim().split(' ')[0]
                if (!cmd.startsWith('sudo') && !noSudoCommands.includes(cmdFirstWord)) {
                  finalCmd = `sudo ${cmd}`
                }
              }
              // 使用 terminal.paste() 方法将文本粘贴到终端
              state.terminal.paste(finalCmd)
              // 聚焦到终端
              state.terminal.focus()
            }
          }}
          colors={colors}
          isRoot={currentConn?.username === 'root'}
        />
      )}

      {/* 终端容器 */}
      <div className="flex-1 overflow-hidden" style={{ position: 'relative' }}>
        <div ref={wrapperRef} className="absolute inset-0" />

        {/* 非 CONNECTED 状态：遮罩层 */}
        {!isConnected && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center" style={{ backgroundColor: colors.bgPrimary }}>
            {currentConn.status === ConnectionStatus.CONNECTING && (
              <div className="text-center">
                <div className="animate-spin text-4xl mb-4" style={{ color: colors.accent }}>⚙️</div>
                <p style={{ color: colors.text }}>正在连接 {currentConn.name}...</p>
              </div>
            )}
            {currentConn.status === ConnectionStatus.FAILED && (
              <div className="text-center">
                <div className="text-6xl mb-4">❌</div>
                <h2 className="text-lg font-medium mb-2" style={{ color: colors.red }}>连接失败</h2>
                <p className="text-sm mb-6" style={{ color: colors.textDim }}>
                  {currentConn.name} 无法连接
                </p>
                <button
                  onClick={() => connect(currentConn.id)}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{ backgroundColor: colors.accent, color: '#ffffff' }}
                >
                  重试连接
                </button>
              </div>
            )}
            {currentConn.status === ConnectionStatus.DISCONNECTED && (
              <div className="text-center">
                <div className="text-6xl mb-4">🔌</div>
                <h2 className="text-lg font-medium mb-2" style={{ color: colors.text }}>
                  {currentConn.name}
                </h2>
                <p className="text-sm mb-2" style={{ color: colors.textDim }}>
                  {currentConn.username}@{currentConn.host}:{currentConn.port}
                </p>
                <p className="text-sm mb-6" style={{ color: colors.textDim }}>
                  点击下方按钮建立 SSH 连接
                </p>
                <button
                  onClick={() => connect(currentConn.id)}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{ backgroundColor: colors.accent, color: '#ffffff' }}
                >
                  连接服务器
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 断连提示 */}
      {currentState?.disconnected && (
        <div className="p-3 border-t flex items-center justify-between" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
          <span className="text-xs" style={{ color: colors.red }}>
            ⚠️ 终端连接已断开
          </span>
          <button
            onClick={() => handleReconnect(currentConn.id)}
            className="px-3 py-1 rounded text-xs font-medium transition-colors"
            style={{ backgroundColor: colors.accent, color: '#ffffff' }}
          >
            重新连接
          </button>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu.visible && (
        <div
          className="fixed z-50 rounded-lg py-1 shadow-lg border"
          style={{
            left: contextMenu.pos.x,
            top: contextMenu.pos.y,
            backgroundColor: colors.bgPrimary,
            borderColor: colors.border,
            minWidth: '140px',
          }}
        >
          <button
            onClick={handleAddToChat}
            className="w-full px-3 py-2 text-left text-[12px] hover:bg-black/5 flex items-center gap-2"
            style={{ color: colors.text }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            添加到对话
          </button>
          <button
            onClick={handleCopy}
            className="w-full px-3 py-2 text-left text-[12px] hover:bg-black/5 flex items-center gap-2"
            style={{ color: colors.text }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            复制
          </button>
        </div>
      )}
    </div>
  )
}

/** 命令辅助侧边栏组件 */
function CommandSidebar({
  categories,
  expandedCategory,
  onToggleCategory,
  onSelectCommand,
  colors,
  isRoot,
}: {
  categories: CommandCategory[]
  expandedCategory: string | null
  onToggleCategory: (name: string | null) => void
  onSelectCommand: (cmd: string) => void
  colors: ReturnType<typeof useThemeStore.getState>['colors']
  isRoot: boolean
}) {
  const handleCopyCommand = (e: React.MouseEvent, cmd: string) => {
    e.stopPropagation()
    let finalCmd = cmd
    if (!isRoot) {
      const noSudoCommands = ['cd', 'pwd', 'ls', 'echo', 'cat', 'exit', 'clear', 'history']
      const cmdFirstWord = cmd.trim().split(' ')[0]
      if (!cmd.startsWith('sudo') && !noSudoCommands.includes(cmdFirstWord)) {
        finalCmd = `sudo ${cmd}`
      }
    }
    navigator.clipboard.writeText(finalCmd)
  }

  const needsSudo = (cmd: string) => {
    if (isRoot || cmd.startsWith('sudo')) return false
    const noSudoCommands = ['cd', 'pwd', 'ls', 'echo', 'cat', 'exit', 'clear', 'history']
    const cmdFirstWord = cmd.trim().split(' ')[0]
    return !noSudoCommands.includes(cmdFirstWord)
  }

  return (
    <div
      className="absolute right-0 top-9 bottom-0 w-80 border-l overflow-hidden flex flex-col z-20"
      style={{ backgroundColor: colors.bgPrimary, borderColor: colors.border }}
    >
      <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: colors.border }}>
        <span className="text-xs font-medium" style={{ color: colors.text }}>命令辅助</span>
        {!isRoot && (
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: colors.accent + '20', color: colors.accent }}>
            非 root，自动加 sudo
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {categories.map((category) => (
          <div key={category.name} className="mb-4">
            <button
              onClick={() => onToggleCategory(expandedCategory === category.name ? null : category.name)}
              className="w-full flex items-center justify-between px-3 py-2 rounded text-left mb-2"
              style={{ backgroundColor: colors.bgSecondary, color: colors.text }}
            >
              <span className="text-xs flex items-center gap-1.5">
                <span>{category.emoji}</span>
                <span className="font-medium">{category.name}</span>
                <span className="text-[10px]" style={{ color: colors.textDim }}>
                  ({category.commands.length})
                </span>
              </span>
              <span style={{ color: colors.textDim }}>
                {expandedCategory === category.name ? '▼' : '▶'}
              </span>
            </button>
            {expandedCategory === category.name && (
              <div className="space-y-2">
                {category.commands.map((cmdItem: CommandItem, index: number) => (
                  <div key={`${category.name}-${index}`} className="group">
                    <div 
                      className="flex items-center gap-2 px-3 py-3 rounded-lg cursor-pointer border hover:opacity-90 transition-all"
                      style={{ backgroundColor: colors.bgPrimary, borderColor: colors.border }}
                      onClick={() => onSelectCommand(cmdItem.command)}
                    >
                      {/* 行号 */}
                      <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-mono" style={{ backgroundColor: colors.bgSecondary, color: colors.textDim }}>
                        {index + 1}
                      </div>
                      
                      {/* 命令内容区 */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-mono flex items-center gap-1.5 mb-1">
                          {needsSudo(cmdItem.command) && (
                            <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: colors.green + '20', color: colors.green }}>sudo</span>
                          )}
                          <span style={{ color: colors.accent }}>{cmdItem.command}</span>
                        </div>
                        <div className="text-[10px] leading-relaxed" style={{ color: colors.textDim }}>
                          {cmdItem.description}
                        </div>
                      </div>
                      
                      {/* 复制按钮 */}
                      <button
                        onClick={(e) => handleCopyCommand(e, cmdItem.command)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-white/10 flex-shrink-0 transition-all"
                        style={{ color: colors.textDim }}
                        title="复制命令"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
