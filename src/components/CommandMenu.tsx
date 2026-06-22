import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { useThemeStore } from '../stores/themeStore'

/**
 * CommandMenu — `/` 命令 + `@` 提及菜单
 * 在输入框中输入 `/` 或 `@` 时弹出菜单，支持键盘导航和鼠标选择。
 *
 * / 命令：快捷操作（清空、重置上下文、导出等）
 * @ 提及：插入上下文标签（文件、连接、终端等）
 */

export interface MenuItem {
  id: string
  label: string
  description?: string
  icon: string
  insertText: string
}

interface CommandMenuProps {
  /** 触发类型 */
  trigger: '/' | '@'
  /** 触发位置（在输入文本中的索引） */
  triggerIndex: number
  /** 查询字符串（触发符后面的文本） */
  query: string
  /** 选择回调 */
  onSelect: (item: MenuItem) => void
  /** 关闭回调 */
  onClose: () => void
  /** 可用的 @ 提及项 */
  mentions?: MenuItem[]
}

// ===== 预定义 / 命令 =====
const SLASH_COMMANDS: MenuItem[] = [
  { id: 'connect', label: '连接服务器', description: '打开 SSH 连接配置', icon: '🔌', insertText: '' },
  { id: 'disconnect', label: '断开连接', description: '断开当前 SSH 连接', icon: '⚡', insertText: '' },
  { id: 'clear', label: '清空对话', description: '清除当前会话所有消息', icon: '🗑️', insertText: '' },
  { id: 'reset', label: '重置上下文', description: '清除上下文但保留消息', icon: '🔄', insertText: '' },
  { id: 'export', label: '导出对话', description: '导出为 Markdown 文件', icon: '📥', insertText: '' },
  { id: 'summary', label: '生成摘要', description: '总结当前对话内容', icon: '📋', insertText: '请总结一下当前的对话内容，列出关键决策和待办事项。' },
  { id: 'debug', label: '调试模式', description: '显示详细的 ReAct 执行过程', icon: '🐛', insertText: '' },
  { id: 'help', label: '帮助', description: '查看可用命令和快捷键', icon: '❓', insertText: '' },
  { id: 'ssh', label: 'SSH 命令', description: '快速执行 SSH 命令', icon: '💻', insertText: '请帮我执行以下 SSH 命令：' },
  { id: 'edit', label: '编辑文件', description: '编辑远程文件', icon: '✏️', insertText: '请帮我编辑文件 ' },
  { id: 'read', label: '读取文件', description: '读取远程文件内容', icon: '📄', insertText: '请帮我读取文件 ' },
  { id: 'search', label: '搜索', description: '在远程服务器上搜索', icon: '🔍', insertText: '请帮我在服务器上搜索 ' },
]

export const CommandMenu = memo(function CommandMenu({ trigger, query, onSelect, onClose, mentions }: Omit<CommandMenuProps, 'triggerIndex'>) {
  const { colors } = useThemeStore()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  // 根据触发符选择数据源
  const items: MenuItem[] = trigger === '/'
    ? SLASH_COMMANDS.filter(cmd =>
        cmd.label.toLowerCase().includes(query.toLowerCase()) ||
        cmd.id.toLowerCase().includes(query.toLowerCase())
      )
    : (mentions || []).filter(m =>
        m.label.toLowerCase().includes(query.toLowerCase())
      )

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(0)
  }, [query, trigger])

  // 键盘导航
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (items[selectedIndex]) {
        onSelect(items[selectedIndex])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [items, selectedIndex, onSelect, onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  if (items.length === 0) {
    return (
      <div
        ref={menuRef}
        className="absolute z-50 rounded-lg shadow-xl pointer-events-none"
        style={{
          backgroundColor: colors.bgSecondary,
          border: `1px solid ${colors.border}`,
          padding: '8px 12px',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '4px',
        }}
      >
        <span className="text-[11px]" style={{ color: colors.textDim }}>
          {trigger === '/' ? '无匹配命令' : '无匹配项'}
        </span>
      </div>
    )
  }

  return (
    <div
      ref={menuRef}
      className="absolute z-50 rounded-lg shadow-xl overflow-hidden"
      style={{
        backgroundColor: colors.bgSecondary,
        border: `1px solid ${colors.border}`,
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: '4px',
        maxHeight: '280px',
        overflowY: 'auto',
        minWidth: '240px',
        maxWidth: '320px',
      }}
    >
      {/* 头部标签 */}
      <div
        className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider"
        style={{ backgroundColor: colors.bgTertiary, color: colors.textDim }}
      >
        {trigger === '/' ? '快捷命令' : '提及'}
      </div>

      {/* 菜单项 */}
      {items.map((item, index) => (
        <button
          key={item.id}
          onClick={() => onSelect(item)}
          onMouseEnter={() => setSelectedIndex(index)}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
          style={{
            backgroundColor: index === selectedIndex ? `${colors.accent}15` : 'transparent',
          }}
        >
          <span className="text-base flex-shrink-0">{item.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium truncate" style={{ color: colors.text }}>
              {item.label}
            </div>
            {item.description && (
              <div className="text-[10px] truncate" style={{ color: colors.textDim }}>
                {item.description}
              </div>
            )}
          </div>
          {index === selectedIndex && (
            <span className="text-[10px] flex-shrink-0 px-1 rounded" style={{ backgroundColor: `${colors.accent}20`, color: colors.accent }}>
              ↵
            </span>
          )}
        </button>
      ))}

      {/* 底部提示 */}
      <div
        className="px-3 py-1 text-[9px] flex items-center gap-2"
        style={{ backgroundColor: colors.bgTertiary, color: colors.textDim, borderTop: `1px solid ${colors.border}30` }}
      >
        <span>↑↓ 导航</span>
        <span>↵ 选择</span>
        <span>ESC 取消</span>
      </div>
    </div>
  )
})

// ===== Hook: useCommandMenu =====
// 在输入框中使用，检测 / 或 @ 触发
export function useCommandMenu(
  inputValue: string,
  cursorPosition: number,
  mentions: MenuItem[],
): { trigger: '/' | '@' | null; triggerIndex: number; query: string; mentionsList: MenuItem[] } {
  // 从光标位置向前查找最近的 / 或 @
  const beforeCursor = inputValue.slice(0, cursorPosition)

  // 查找最后一个未闭合的 / 或 @
  let trigger: '/' | '@' | null = null
  let triggerIndex = -1
  let query = ''

  for (let i = beforeCursor.length - 1; i >= 0; i--) {
    const char = beforeCursor[i]
    if (char === '/' || char === '@') {
      // 确保前面是空格或行首
      if (i === 0 || /\s/.test(beforeCursor[i - 1])) {
        trigger = char
        triggerIndex = i
        query = beforeCursor.slice(i + 1)
        // 如果 query 中有空格，说明不是触发菜单
        if (query.includes(' ') || query.includes('\n')) {
          trigger = null
          triggerIndex = -1
          query = ''
        }
        break
      }
    }
    // 遇到空格就停止向前查找
    if (/\s/.test(char) && i < beforeCursor.length - 1) {
      break
    }
  }

  return {
    trigger,
    triggerIndex,
    query,
    mentionsList: trigger === '@' ? mentions : [],
  }
}
