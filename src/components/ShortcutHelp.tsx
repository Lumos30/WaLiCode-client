import { useThemeStore } from '../stores/themeStore'

interface ShortcutHelpProps {
  open: boolean
  onClose: () => void
}

interface ShortcutGroup {
  title: string
  shortcuts: Array<{ keys: string; description: string }>
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '对话',
    shortcuts: [
      { keys: 'Enter', description: '发送消息' },
      { keys: '⇧ Enter', description: '换行' },
      { keys: '⌘ Enter', description: '发送（当 Enter 为换行时）' },
      { keys: '↑ / ↓', description: '浏览历史输入' },
      { keys: '⌘ N', description: '新建会话' },
    ],
  },
  {
    title: '输入增强',
    shortcuts: [
      { keys: '/', description: '打开命令菜单' },
      { keys: '@', description: '提及文件/目录/上下文' },
    ],
  },
  {
    title: '导航',
    shortcuts: [
      { keys: '⌘ B', description: '切换侧边栏' },
      { keys: '⌘ ⇧ E', description: '文件浏览器' },
      { keys: '⌘ ⇧ X', description: '扩展面板' },
      { keys: '⌘ `', description: '切换终端' },
    ],
  },
  {
    title: '工具',
    shortcuts: [
      { keys: '?', description: '打开快捷键帮助' },
      { keys: 'Esc', description: '关闭弹窗/取消' },
      { keys: '⌘ C', description: '复制选中内容' },
      { keys: '⌘ S', description: '保存当前文件' },
    ],
  },
]

/**
 * 快捷键速查表面板。
 * 按 ? 键弹出，Esc 关闭。
 */
export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  const { colors } = useThemeStore()

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      />
      {/* 面板 */}
      <div
        className="relative w-[480px] max-h-[70vh] overflow-y-auto rounded-xl shadow-2xl"
        style={{
          backgroundColor: colors.bgPrimary,
          border: `1px solid ${colors.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${colors.border}` }}>
          <div className="flex items-center gap-2">
            <span className="text-base">⌨️</span>
            <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>快捷键速查</h2>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:opacity-70"
            style={{ backgroundColor: colors.bgSecondary, color: colors.textDim }}
          >
            ✕
          </button>
        </div>
        {/* 快捷键列表 */}
        <div className="px-5 py-3 space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: colors.textDim }}>
                {group.title}
              </h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div key={s.keys} className="flex items-center justify-between">
                    <span className="text-[12px]" style={{ color: colors.textSecondary }}>{s.description}</span>
                    <kbd
                      className="px-2 py-0.5 rounded text-[10px] font-mono"
                      style={{
                        backgroundColor: colors.bgSecondary,
                        color: colors.text,
                        border: `1px solid ${colors.border}`,
                        boxShadow: `0 1px 0 ${colors.border}`,
                      }}
                    >
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* 底部 */}
        <div className="px-5 py-3 text-center" style={{ borderTop: `1px solid ${colors.border}` }}>
          <span className="text-[10px]" style={{ color: colors.textDim }}>按 Esc 或点击外部关闭</span>
        </div>
      </div>
    </div>
  )
}
