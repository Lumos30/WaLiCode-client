/**
 * LocalTerminal — 本地 PTY 终端组件
 *
 * 基于 xterm.js + Tauri local_pty 实现真实本地终端。
 * 与 SSH 终端（TerminalPanel）并列，由 TerminalTabBar 切换。
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { useThemeStore } from '../stores/themeStore'
import { useSshAgentStore } from '../stores/sshAgentStore'
import {
  spawnLocalPty,
  writeToPty,
  resizeLocalPty,
  killLocalPty,
  onLocalPtyOutput,
  onLocalPtyExit,
} from '../api/localTerminal'
import type { UnlistenFn } from '@tauri-apps/api/event'

interface LocalTerminalProps {
  /** 终端会话 ID（外部管理时传入，否则内部生成） */
  sessionId?: string
  /** 工作目录 */
  cwd?: string
  /** 会话变更回调 */
  onSessionChange?: (sessionId: string | null) => void
  /** 添加到对话回调 */
  onAddToChat?: (text: string) => void
}

/** 生成唯一会话 ID */
function generateSessionId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function LocalTerminal({
  sessionId: externalSessionId,
  cwd,
  onSessionChange,
  onAddToChat,
}: LocalTerminalProps) {
  const { colors } = useThemeStore()
  const { addInputTag } = useSshAgentStore()

  const wrapperRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string>(externalSessionId || generateSessionId())
  const unlistenOutputRef = useRef<UnlistenFn | null>(null)
  const unlistenExitRef = useRef<UnlistenFn | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentSizeRef = useRef({ cols: 0, rows: 0 })

  const [exited, setExited] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    selectedText: string
  }>({ visible: false, x: 0, y: 0, selectedText: '' })

  /** 创建 xterm 实例 */
  const createTerminal = useCallback(() => {
    const term = new Terminal({
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
    return term
  }, [colors])

  /** 初始化终端并创建 PTY 会话 */
  useEffect(() => {
    if (!wrapperRef.current) return

    const term = createTerminal()
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    try {
      term.loadAddon(new WebglAddon())
    } catch {
      /* WebGL 不可用时降级 */
    }

    const container = document.createElement('div')
    container.style.cssText =
      'position:absolute;top:0;left:0;right:0;bottom:0;padding:0 8px 25px 8px;overflow:hidden;'
    wrapperRef.current.appendChild(container)

    term.open(container)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    const sid = sessionIdRef.current

    // 监听 PTY 输出
    onLocalPtyOutput(sid, (data) => {
      term.write(data)
    }).then((unlisten) => {
      unlistenOutputRef.current = unlisten
    })

    // 监听 PTY 退出
    onLocalPtyExit(sid, (exitCode) => {
      setExited(true)
      term.writeln(`\x1b[33m\r\n*** 终端已退出 (exit code: ${exitCode}) ***\x1b[0m`)
    }).then((unlisten) => {
      unlistenExitRef.current = unlisten
    })

    // 用户输入 → PTY
    const onDataDisposable = term.onData((data) => {
      writeToPty(sid, data).catch(() => {
        term.writeln('\r\n\x1b[31m输入发送失败\x1b[0m')
      })
    })

    // ResizeObserver（debounced，避免频繁 resize 导致 shell 重绘 prompt）
    const ro = new ResizeObserver(() => {
      if (resizeTimerRef.current) return
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null
        fitAddon.fit()
        const { cols, rows } = term
        if (cols <= 0 || rows <= 0) return
        if (cols === lastSentSizeRef.current.cols && rows === lastSentSizeRef.current.rows) return
        lastSentSizeRef.current = { cols, rows }
        resizeLocalPty(sid, cols, rows).catch(() => {})
      }, 300)
    })
    ro.observe(container)

    // 延迟创建 PTY：等待 DOM 布局稳定后再 spawn，避免初始 size 不准导致多次 SIGWINCH
    // requestAnimationFrame 确保 open + fit 已渲染，再延迟一帧让 ResizeObserver 首次 fit 完成
    let rafId1: number
    let rafId2: number
    const scheduleSpawn = () => {
      rafId1 = requestAnimationFrame(() => {
        fitAddon.fit()
        rafId2 = requestAnimationFrame(() => {
          // 此时 DOM 已稳定，尺寸准确
          const { cols, rows } = term
          lastSentSizeRef.current = { cols, rows }
          spawnLocalPty({
            sessionId: sid,
            cwd,
            cols,
            rows,
          })
            .then(() => {
              onSessionChange?.(sid)
            })
            .catch((err) => {
              term.writeln(`\x1b[31m创建本地终端失败: ${err}\x1b[0m`)
            })
        })
      })
    }
    scheduleSpawn()

    // 右键菜单
    container.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const selection = term.getSelection()
      if (selection) {
        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, selectedText: selection })
      }
    })

    container.addEventListener('mouseup', (e) => {
      setTimeout(() => {
        const selection = term.getSelection()
        if (selection && selection.trim().length > 0) {
          setContextMenu({ visible: true, x: e.clientX, y: e.clientY, selectedText: selection })
        } else if (e.button !== 2) {
          setContextMenu((prev) => ({ ...prev, visible: false }))
        }
      }, 50)
    })

    requestAnimationFrame(() => term.focus())

    // 清理
    return () => {
      cancelAnimationFrame(rafId1)
      cancelAnimationFrame(rafId2)
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      onDataDisposable.dispose()
      ro.disconnect()
      unlistenOutputRef.current?.()
      unlistenExitRef.current?.()
      killLocalPty(sid).catch(() => {})
      term.dispose()
      if (container.parentNode) {
        container.remove()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 主题变化时更新终端颜色 */
  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = {
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
    }
  }, [colors])

  /** 重置终端 */
  const handleReset = useCallback(() => {
    if (!termRef.current || !sessionIdRef.current) return
    const sid = sessionIdRef.current

    // 关闭旧会话
    killLocalPty(sid).catch(() => {})

    // 清屏
    termRef.current.clear()
    termRef.current.reset()
    setExited(false)

    // 创建新会话
    const newSid = generateSessionId()
    sessionIdRef.current = newSid

    // 重新监听
    unlistenOutputRef.current?.()
    unlistenExitRef.current?.()

    onLocalPtyOutput(newSid, (data) => {
      termRef.current?.write(data)
    }).then((unlisten) => {
      unlistenOutputRef.current = unlisten
    })

    onLocalPtyExit(newSid, (exitCode) => {
      setExited(true)
      termRef.current?.writeln(`\x1b[33m\r\n*** 终端已退出 (exit code: ${exitCode}) ***\x1b[0m`)
    }).then((unlisten) => {
      unlistenExitRef.current = unlisten
    })

    spawnLocalPty({
      sessionId: newSid,
      cwd,
      cols: termRef.current.cols,
      rows: termRef.current.rows,
    })
      .then(() => {
        onSessionChange?.(newSid)
      })
      .catch((err) => {
        termRef.current?.writeln(`\x1b[31m创建本地终端失败: ${err}\x1b[0m`)
      })
  }, [cwd, onSessionChange])

  /** 添加到对话 */
  const handleAddToChat = useCallback(() => {
    if (contextMenu.selectedText) {
      if (onAddToChat) {
        onAddToChat(contextMenu.selectedText)
      } else {
        addInputTag({
          label:
            contextMenu.selectedText.length > 20
              ? contextMenu.selectedText.slice(0, 20) + '...'
              : contextMenu.selectedText,
          fullContent: contextMenu.selectedText,
          type: 'terminal-selection',
        })
      }
    }
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }, [contextMenu.selectedText, onAddToChat, addInputTag])

  /** 复制 */
  const handleCopy = useCallback(() => {
    if (contextMenu.selectedText) {
      navigator.clipboard.writeText(contextMenu.selectedText)
    }
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }, [contextMenu.selectedText])

  /** 点击外部关闭右键菜单 */
  useEffect(() => {
    if (!contextMenu.visible) return
    const handler = () => setContextMenu((prev) => ({ ...prev, visible: false }))
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu.visible])

  return (
    <div
      className="h-full flex flex-col min-w-0 relative"
      style={{ backgroundColor: colors.bgPrimary }}
    >
      {/* 工具栏 */}
      <div
        className="h-9 flex items-center justify-between px-3 border-b flex-shrink-0"
        style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: exited ? colors.red : colors.green }}
          />
          <span className="text-xs font-medium" style={{ color: colors.text }}>
            本地终端
          </span>
          {exited && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ backgroundColor: colors.red + '20', color: colors.red }}
            >
              已退出
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => termRef.current?.clear()}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            style={{ color: colors.textDim }}
            title="清屏"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          <button
            onClick={handleReset}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            style={{ color: colors.textDim }}
            title="重置终端"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* 终端容器 */}
      <div className="flex-1" style={{ position: 'relative', overflow: 'hidden' }}>
        <div ref={wrapperRef} className="absolute inset-0" style={{ overflow: 'hidden' }} />
      </div>

      {/* 右键菜单 */}
      {contextMenu.visible && (
        <div
          className="fixed z-50 rounded-lg py-1 shadow-lg border"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
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
