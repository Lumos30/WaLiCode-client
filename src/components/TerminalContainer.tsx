/**
 * TerminalContainer — 终端容器
 *
 * 统一管理本地终端、SSH 终端、AI 输出面板的标签切换。
 */
import { useState, useEffect } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { useConnectionStore } from '../stores/connectionStore'
import { ConnectionStatus } from '../types'
import { TerminalTabBar, type TerminalTabId } from './TerminalTabBar'
import { LocalTerminal } from './LocalTerminal'
import { TerminalPanel } from './TerminalPanel'
import { OutputPanel } from './OutputPanel'
import { useOutputStore } from '../stores/outputStore'

interface TerminalContainerProps {
  /** 终端会话变化回调 */
  onTerminalSessionChange?: (sessionId: string | null) => void
  /** 是否保持终端会话（卸载时不关闭） */
  keepSessionOnUnmount?: boolean
  /** 收起终端回调 */
  onCloseTerminal?: () => void
}

export function TerminalContainer({
  onTerminalSessionChange,
  keepSessionOnUnmount = true,
  onCloseTerminal,
}: TerminalContainerProps) {
  const { colors } = useThemeStore()
  const { currentConnectionId, connections } = useConnectionStore()
  const { entries: outputEntries } = useOutputStore()
  const [activeTab, setActiveTab] = useState<TerminalTabId>('local')

  const currentConn = connections.find((c) => c.id === currentConnectionId)
  const sshAvailable = !!currentConn && currentConn.status === ConnectionStatus.CONNECTED

  // SSH 断开时自动切到本地终端
  useEffect(() => {
    if (!sshAvailable && activeTab === 'ssh') {
      setActiveTab('local')
    }
  }, [sshAvailable, activeTab])

  // SSH 连接成功时自动切到 SSH 终端
  useEffect(() => {
    if (sshAvailable && activeTab !== 'ssh') {
      setActiveTab('ssh')
    }
  }, [sshAvailable])

  return (
    <div className="h-full flex flex-col min-w-0" style={{ backgroundColor: colors.bgPrimary }}>
      <div className="flex items-center" style={{ borderBottom: `1px solid ${colors.border}` }}>
        <div className="flex-1">
          <TerminalTabBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            localAvailable={true}
            sshAvailable={sshAvailable}
            hasOutput={outputEntries.length > 0}
          />
        </div>
        {/* 收起终端按钮 */}
        {onCloseTerminal && (
          <button
            onClick={onCloseTerminal}
            className="h-8 px-2 flex items-center justify-center hover:opacity-80 transition-opacity"
            style={{ color: colors.textSecondary }}
            title="向下收起终端"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        {activeTab === 'local' && (
          <LocalTerminal onSessionChange={onTerminalSessionChange} />
        )}
        {activeTab === 'ssh' && (
          <TerminalPanel
            onTerminalSessionChange={onTerminalSessionChange}
            keepSessionOnUnmount={keepSessionOnUnmount}
          />
        )}
        {activeTab === 'output' && <OutputPanel />}
      </div>
    </div>
  )
}
