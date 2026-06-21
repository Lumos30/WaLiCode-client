/**
 * BottomPanelBar — 底部面板边条
 *
 * 终端收起时显示向上箭头，点击展开终端
 * 终端展开后隐藏边条，在终端面板顶部显示向下箭头收起
 */
import { useThemeStore } from '../stores/themeStore'

interface BottomPanelBarProps {
  /** 终端是否可见 */
  terminalVisible: boolean
  /** 切换终端显示 */
  onToggleTerminal: () => void
}

export function BottomPanelBar({
  terminalVisible,
  onToggleTerminal,
}: BottomPanelBarProps) {
  const { colors } = useThemeStore()

  // 终端展开时隐藏底部边条
  if (terminalVisible) {
    return null
  }

  // 终端收起时显示：左侧"终端"文字，右侧向下箭头
  return (
    <div
      className="h-6 flex items-center justify-between px-3 select-none cursor-pointer hover:opacity-80 transition-opacity"
      style={{
        backgroundColor: colors.bgSecondary,
        borderTop: `1px solid ${colors.border}`,
      }}
      onClick={onToggleTerminal}
      title="展开终端"
    >
      {/* 左侧：终端文字 */}
      <span className="text-xs font-medium" style={{ color: colors.textSecondary }}>
        终端
      </span>
      
      {/* 右侧：向上箭头（表示点击后向上展开） */}
      <svg 
        className="w-4 h-4" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2"
        style={{ color: colors.textSecondary }}
      >
        <polyline points="18 15 12 9 6 15"></polyline>
      </svg>
    </div>
  )
}
