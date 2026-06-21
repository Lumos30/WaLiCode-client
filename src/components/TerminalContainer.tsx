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
}

export function TerminalContainer({
  onTerminalSessionChange,
  keepSessionOnUnmount = true,
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

  return (
    <div className="h-full flex flex-col min-w-0" style={{ backgroundColor: colors.bgPrimary }}>
      <TerminalTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        localAvailable={true}
        sshAvailable={sshAvailable}
        hasOutput={outputEntries.length > 0}
      />
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
