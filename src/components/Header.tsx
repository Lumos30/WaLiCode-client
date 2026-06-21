import { useThemeStore } from '../stores/themeStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useLocalFileStore } from '../stores/localFileStore'

interface HeaderProps {
  onToggleSidebar: () => void
  sidebarVisible: boolean
  onToggleChat: () => void
  chatVisible: boolean
  onOpenSSHModal: () => void
  onOpenLocalFolder: () => void
}

export function Header({ onToggleSidebar, sidebarVisible, onToggleChat, chatVisible, onOpenSSHModal, onOpenLocalFolder }: HeaderProps) {
  const { colors } = useThemeStore()
  const { connections, currentConnectionId } = useConnectionStore()
  const currentConn = connections.find(c => c.id === currentConnectionId)
  const { rootPath } = useLocalFileStore()

  return (
    <div
      className="h-12 flex items-center px-4 flex-shrink-0"
      style={{ backgroundColor: colors.bgSecondary, borderBottom: `1px solid ${colors.border}` }}
    >
      {/* 左侧：折叠 + 添加连接 */}
      <div className="flex items-center gap-2">
        {/* 折叠按钮 */}
        <button
          onClick={onToggleSidebar}
          className="w-6 h-[22px] flex items-center justify-center rounded transition-all duration-150"
          style={{ backgroundColor: 'transparent', color: colors.textSecondary }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${colors.accent}18`; e.currentTarget.style.color = colors.accent }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textSecondary }}
          title="切换侧边栏 (⌘B)"
        >
          <svg className="w-[13px] h-[13px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {sidebarVisible ? (
              <path d="M11 17l-4-4 4-4M18 13h-9" />
            ) : (
              <path d="M13 7l4 4-4 4M6 13h9" />
            )}
          </svg>
        </button>

        {/* 添加连接按钮 */}
        <button
          onClick={onOpenSSHModal}
          className="flex items-center gap-1.5 h-[22px] pl-1.5 pr-2 rounded transition-all duration-150"
          style={{ backgroundColor: 'transparent', color: colors.textSecondary }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${colors.accent}18`; e.currentTarget.style.color = colors.accent }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textSecondary }}
          title="添加 SSH 连接"
        >
          <svg className="w-[13px] h-[13px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span className="text-[12px] leading-none">添加连接（SSH）</span>
        </button>

        {/* 打开本地文件夹按钮 */}
        <button
          onClick={onOpenLocalFolder}
          className="flex items-center gap-1.5 h-[22px] pl-1.5 pr-2 rounded transition-all duration-150"
          style={{
            backgroundColor: rootPath ? `${colors.accent}18` : 'transparent',
            color: rootPath ? colors.accent : colors.textSecondary,
          }}
          onMouseEnter={(e) => { if (!rootPath) { e.currentTarget.style.backgroundColor = `${colors.accent}18`; e.currentTarget.style.color = colors.accent } }}
          onMouseLeave={(e) => { if (!rootPath) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textSecondary } }}
          title="打开本地文件夹"
        >
          <svg className="w-[13px] h-[13px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
          <span className="text-[12px] leading-none">{rootPath ? rootPath.split('/').pop() : '打开文件夹'}</span>
        </button>

        {/* 连接信息 */}
        {currentConn && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.green }} />
            <span className="text-xs font-medium" style={{ color: colors.text }}>{currentConn.name}</span>
            <span className="text-[11px] font-mono" style={{ color: colors.textDim }}>
              {currentConn.username}@{currentConn.host}:{currentConn.port}
            </span>
          </div>
        )}
      </div>

      {/* 中间：留白 */}
      <div className="flex-1" />

      {/* 右侧：AI 对话 切换 */}
      <div className="flex items-center gap-2">
        {/* AI 对话切换 */}
        <button
          onClick={onToggleChat}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            chatVisible
              ? ''
              : ''
          }`}
          style={{
            backgroundColor: chatVisible ? `${colors.accent}20` : 'transparent',
            color: chatVisible ? colors.accent : colors.textSecondary,
          }}
          title="显示/隐藏 AI 助手"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>AI 助手</span>
        </button>
      </div>
    </div>
  )
}
