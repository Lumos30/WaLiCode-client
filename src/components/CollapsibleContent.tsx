import React, { useState, useRef, useEffect } from 'react'
import { useThemeStore } from '../stores/themeStore'

const COLLAPSE_THRESHOLD = 2000  // 超过 2000 字符自动折叠
const COLLAPSED_HEIGHT = 300     // 折叠时最大高度 300px

interface CollapsibleContentProps {
  children: React.ReactNode
  contentLength: number
  /** 外部强制折叠/展开（如流式时始终展开） */
  forceExpanded?: boolean
}

/**
 * 超长内容自动折叠容器。
 * - 内容超过 COLLAPSE_THRESHOLD 字符时，默认折叠至 COLLAPSED_HEIGHT
 * - 流式输出时 (forceExpanded) 始终展开
 * - 渐变遮罩 + "展开全部" 按钮
 */
export function CollapsibleContent({ children, contentLength, forceExpanded }: CollapsibleContentProps) {
  const { colors } = useThemeStore()
  const [expanded, setExpanded] = useState(false)
  const [needsCollapse, setNeedsCollapse] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 检测内容是否超过阈值
  useEffect(() => {
    if (contentLength > COLLAPSE_THRESHOLD && !forceExpanded) {
      setNeedsCollapse(true)
    } else {
      setNeedsCollapse(false)
      setExpanded(false)
    }
  }, [contentLength, forceExpanded])

  // 流式时强制展开
  useEffect(() => {
    if (forceExpanded) setExpanded(true)
  }, [forceExpanded])

  const isCollapsed = needsCollapse && !expanded

  return (
    <div className="relative min-w-0">
      <div
        ref={containerRef}
        className="transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isCollapsed ? COLLAPSED_HEIGHT : 'none',
          overflow: isCollapsed ? 'hidden' : 'visible',
        }}
      >
        {children}
      </div>
      {/* 折叠遮罩 + 展开按钮 */}
      {isCollapsed && (
        <div
          className="absolute bottom-0 left-0 right-0 flex flex-col items-center pt-12"
          style={{
            background: `linear-gradient(to bottom, transparent, ${colors.bgTertiary} 70%)`,
            height: '80px',
          }}
        >
          <button
            onClick={() => setExpanded(true)}
            className="mt-2 px-4 py-1.5 rounded-full text-[11px] font-medium transition-all hover:opacity-80"
            style={{
              backgroundColor: `${colors.accent}15`,
              color: colors.accent,
              border: `1px solid ${colors.accent}30`,
            }}
          >
            ▼ 展开全部 ({Math.round(contentLength / 1000)}k 字)
          </button>
        </div>
      )}
      {/* 收起按钮 */}
      {needsCollapse && expanded && !forceExpanded && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-1.5 self-center px-3 py-1 rounded-full text-[10px] font-medium transition-all hover:opacity-80"
          style={{
            color: colors.textDim,
            backgroundColor: colors.bgSecondary,
            border: `1px solid ${colors.border}`,
          }}
        >
          ▲ 收起
        </button>
      )}
    </div>
  )
}
