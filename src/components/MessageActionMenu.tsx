import React, { memo, useState, useRef, useEffect } from 'react'
import { useThemeStore } from '../stores/themeStore'

/**
 * MessageActionMenu — 消息操作浮动菜单
 * 鼠标 hover 到消息气泡上时显示，提供快捷操作。
 *
 * 操作列表：
 * - 复制（复制消息内容到剪贴板）
 * - 编辑（用户消息：编辑重发；助手消息：不支持）
 * - 引用（引用该消息内容到输入框）
 * - 重新生成（仅助手消息：重新生成回复）
 * - 收藏（标记/取消标记重要消息）
 */

export interface MessageAction {
  type: 'copy' | 'edit' | 'quote' | 'regenerate' | 'bookmark'
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
}

interface MessageActionMenuProps {
  /** 是否是用户消息 */
  isUser: boolean
  /** 是否已收藏 */
  isBookmarked: boolean
  /** 操作回调 */
  onCopy: () => void
  onEdit?: () => void
  onQuote: () => void
  onRegenerate?: () => void
  onToggleBookmark: () => void
}

// SVG 图标组件
const IconCopy = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

const IconEdit = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
)

const IconQuote = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
    <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
  </svg>
)

const IconRegenerate = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

const IconBookmark = ({ filled }: { filled: boolean }) => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

export const MessageActionMenu = memo(function MessageActionMenu({
  isUser,
  isBookmarked,
  onCopy,
  onEdit,
  onQuote,
  onRegenerate,
  onToggleBookmark,
}: MessageActionMenuProps) {
  const { colors } = useThemeStore()
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const handleCopy = () => {
    onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // 构建操作列表
  const actions: { key: string; label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }[] = [
    {
      key: 'copy',
      label: copied ? '已复制' : '复制',
      icon: <IconCopy />,
      onClick: handleCopy,
    },
    {
      key: 'quote',
      label: '引用',
      icon: <IconQuote />,
      onClick: () => { onQuote(); setMenuOpen(false) },
    },
  ]

  // 用户消息：编辑
  if (isUser && onEdit) {
    actions.push({
      key: 'edit',
      label: '编辑',
      icon: <IconEdit />,
      onClick: () => { onEdit(); setMenuOpen(false) },
    })
  }

  // 助手消息：重新生成
  if (!isUser && onRegenerate) {
    actions.push({
      key: 'regenerate',
      label: '重新生成',
      icon: <IconRegenerate />,
      onClick: () => { onRegenerate(); setMenuOpen(false) },
    })
  }

  // 收藏（所有消息）
  actions.push({
    key: 'bookmark',
    label: isBookmarked ? '取消收藏' : '收藏',
    icon: <IconBookmark filled={isBookmarked} />,
    onClick: () => { onToggleBookmark(); setMenuOpen(false) },
  })

  return (
    <div ref={menuRef} className="relative flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
      {/* 快捷按钮（始终显示） */}
      <button
        onClick={handleCopy}
        title="复制"
        className="rounded p-1 transition-all hover:opacity-70"
        style={{ color: copied ? '#22c55e' : colors.textDim }}
      >
        {copied ? (
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <IconCopy />
        )}
      </button>

      {/* 收藏快捷按钮 */}
      <button
        onClick={onToggleBookmark}
        title={isBookmarked ? '取消收藏' : '收藏'}
        className="rounded p-1 transition-all hover:opacity-70"
        style={{ color: isBookmarked ? '#f59e0b' : colors.textDim }}
      >
        <IconBookmark filled={isBookmarked} />
      </button>

      {/* 更多按钮 */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        title="更多操作"
        className="rounded p-1 transition-all hover:opacity-70"
        style={{ color: colors.textDim }}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>

      {/* 下拉菜单 */}
      {menuOpen && (
        <div
          className="absolute z-50 rounded-lg shadow-xl overflow-hidden"
          style={{
            backgroundColor: colors.bgSecondary,
            border: `1px solid ${colors.border}`,
            top: '100%',
            right: 0,
            marginTop: '4px',
            minWidth: '140px',
          }}
        >
          {actions.map((action) => (
            <button
              key={action.key}
              onClick={action.onClick}
              disabled={action.disabled}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: action.danger ? '#ef4444' : colors.text }}
            >
              <span className="flex-shrink-0">{action.icon}</span>
              <span className="text-[11px]">{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
