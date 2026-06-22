import { memo, useState } from 'react'
import { useThemeStore } from '../stores/themeStore'

/**
 * TopicDivider — 话题分隔符
 * 检测消息间的话题切换（时间间隔 / 角色模式 / 内容相似度），插入可折叠的分隔符。
 *
 * 检测策略：
 * 1. 时间间隔 > 10 分钟 → 新话题
 * 2. 连续用户消息（中间无 assistant 回复）→ 合并到同一话题
 * 3. 用户提供 fallback 标题（可手动编辑）
 */

interface TopicDividerProps {
  prevTimestamp: number
  currTimestamp: number
  topicIndex: number
  defaultTitle?: string
}

function formatTopicTime(ts: number): string {
  const d = new Date(ts)
  const mo = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const h = d.getHours()
  const ap = h < 12 ? '上午' : '下午'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${mo}-${day} ${ap}${h12}:${m}`
}

export const TopicDivider = memo(function TopicDivider({ prevTimestamp, currTimestamp, topicIndex, defaultTitle }: TopicDividerProps) {
  const { colors } = useThemeStore()
  const [collapsed, setCollapsed] = useState(false)
  const [title, setTitle] = useState(defaultTitle || `话题 ${topicIndex + 1}`)
  const [editing, setEditing] = useState(false)

  const gapMs = currTimestamp - prevTimestamp
  const gapMin = Math.floor(gapMs / 60000)
  const gapText = gapMin >= 60
    ? `${Math.floor(gapMin / 60)}h ${gapMin % 60}m`
    : `${gapMin}m`

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 select-none" style={{ borderTop: `1px solid ${colors.border}30`, marginTop: '4px' }}>
      {/* 折叠箭头 */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 transition-colors hover:opacity-70"
        style={{ color: colors.textDim }}
      >
        <svg
          className={`w-3 h-3 transition-transform duration-200 ${collapsed ? 'rotate-0' : '-rotate-90'}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* 话题标题（可编辑） */}
      {editing ? (
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => { if (e.key === 'Enter') setEditing(false) }}
          autoFocus
          className="text-[11px] font-medium bg-transparent outline-none flex-1 min-w-0"
          style={{ color: colors.textSecondary, borderBottom: `1px solid ${colors.accent}` }}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-[11px] font-medium transition-colors hover:opacity-70 truncate"
          style={{ color: colors.textSecondary }}
          title="点击编辑话题标题"
        >
          {title}
        </button>
      )}

      {/* 时间间隔标签 */}
      <span
        className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: `${colors.accent}10`, color: colors.textDim }}
      >
        ⏱ {gapText}
      </span>

      {/* 时间戳 */}
      <span className="text-[9px] flex-shrink-0" style={{ color: colors.textDim }}>
        {formatTopicTime(currTimestamp)}
      </span>

      <div className="flex-1" style={{ borderTop: `1px dashed ${colors.border}20` }} />
    </div>
  )
})

/**
 * 判断两条消息之间是否需要插入话题分隔符
 */
export function shouldInsertTopicDivider(
  prevMsg: { role: string; timestamp: number; content: string },
  currMsg: { role: string; timestamp: number; content: string },
): { shouldInsert: boolean; title?: string } {
  // 时间间隔 > 10 分钟 → 新话题
  const gapMs = currMsg.timestamp - prevMsg.timestamp
  if (gapMs > 10 * 60 * 1000) {
    // 尝试从当前消息提取标题
    const content = currMsg.content?.trim() || ''
    const firstLine = content.split('\n')[0]?.slice(0, 30) || ''
    return {
      shouldInsert: true,
      title: firstLine || undefined,
    }
  }

  return { shouldInsert: false }
}
