/**
 * TerminalTabBar — 终端面板标签栏
 *
 * 在底部面板内切换「本地终端」「SSH 终端」「输出」三个子面板。
 */
import { useThemeStore } from '../stores/themeStore'

export type TerminalTabId = 'local' | 'ssh' | 'output'

interface TerminalTabBarProps {
  activeTab: TerminalTabId
  onTabChange: (tab: TerminalTabId) => void
  /** 本地终端是否可用 */
  localAvailable?: boolean
  /** SSH 终端是否可用 */
  sshAvailable?: boolean
  /** 输出面板是否有内容 */
  hasOutput?: boolean
}

export function TerminalTabBar({
  activeTab,
  onTabChange,
  localAvailable = true,
  sshAvailable = true,
  hasOutput = false,
}: TerminalTabBarProps) {
  const { colors } = useThemeStore()

  const tabs: Array<{ id: TerminalTabId; label: string; icon: string; available: boolean; badge?: boolean }> = [
    { id: 'local', label: '本地终端', icon: '💻', available: localAvailable },
    { id: 'ssh', label: 'SSH 终端', icon: '🔗', available: sshAvailable },
    { id: 'output', label: '输出', icon: '📋', available: true, badge: hasOutput },
  ]

  return (
    <div
      className="flex items-center gap-1 px-2 h-8 border-b flex-shrink-0"
      style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => tab.available && onTabChange(tab.id)}
            disabled={!tab.available}
            className="px-3 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1.5"
            style={{
              backgroundColor: isActive ? colors.accent + '20' : 'transparent',
              color: isActive ? colors.accent : tab.available ? colors.textDim : colors.textDim + '50',
              cursor: tab.available ? 'pointer' : 'not-allowed',
            }}
          >
            <span className="text-[10px]">{tab.icon}</span>
            {tab.label}
            {tab.badge && (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: colors.accent }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
