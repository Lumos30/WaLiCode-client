import { useThemeStore } from '../stores/themeStore'
import { useAgentStore } from '../stores/agentStore'

interface HistoryPanelProps {
  width?: number
}

export function HistoryPanel({ width = 320 }: HistoryPanelProps) {
  const { colors } = useThemeStore()
  const { sessions, currentSessionId, setCurrentSession, toggleHistoryPanel } = useAgentStore()

  const sessionList = Array.from(sessions.values()).filter(s => s.messages.length > 0)

  return (
    <div
      className="flex flex-col h-full flex-shrink-0"
      style={{
        width,
        backgroundColor: colors.bgPrimary,
        borderLeft: `1px solid ${colors.border}`,
      }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${colors.border}` }}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span className="text-[13px] font-semibold" style={{ color: colors.text }}>历史对话</span>
        </div>
        <button
          onClick={toggleHistoryPanel}
          className="p-1 rounded-md hover:bg-black/10 transition-colors"
          style={{ color: colors.textDim }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {sessionList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6">
            <svg className="w-10 h-10 mb-2" style={{ color: colors.textDim, opacity: 0.4 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span className="text-[12px]" style={{ color: colors.textDim }}>暂无历史对话</span>
          </div>
        ) : (
          sessionList.map((session) => {
            const lastMsg = session.messages[session.messages.length - 1]
            const lastTime = lastMsg
              ? new Date(lastMsg.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
              : ''
            const firstUserMsg = session.messages.find(m => m.role === 'user')
            const title = firstUserMsg
              ? firstUserMsg.content.replace(/<[^>]+>/g, '').substring(0, 40)
              : '新对话'
            const isActive = session.id === currentSessionId

            return (
              <div
                key={session.id}
                onClick={() => {
                  setCurrentSession(session.id)
                }}
                className="mx-3 my-1 px-3 py-2.5 rounded-lg cursor-pointer transition-all"
                style={{
                  backgroundColor: isActive ? `${colors.accent}10` : colors.bgSecondary,
                  border: `1px solid ${isActive ? `${colors.accent}40` : colors.border}`,
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-medium truncate flex-1" style={{ color: isActive ? colors.accent : colors.text }}>
                    {title}
                  </span>
                  <span className="text-[10px] flex-shrink-0 ml-2" style={{ color: colors.textDim }}>{lastTime}</span>
                </div>
                <div className="text-[10px] truncate" style={{ color: colors.textDim }}>
                  {session.messages.length} 条消息
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
