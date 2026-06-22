import React, { memo, useState, useEffect, useRef } from 'react'
import { useThemeStore } from '../stores/themeStore'

/**
 * ToolProgressBar — 工具执行进度条
 * 在工具执行过程中显示进度条，支持 indeterminate（不确定）和 determinate（确定）两种模式。
 *
 * 后端 progress 字段格式（通过 SSE tool_progress 事件传递）：
 * { toolCallId: string, percent: number, label?: string, detail?: string }
 *
 * 当 percent > 0 时为 determinate 模式，否则为 indeterminate 模式。
 */

export interface ToolProgressData {
  toolCallId: string
  toolName?: string
  percent?: number   // 0-100，未提供时为 indeterminate
  label?: string     // 当前步骤标签（如 "正在读取文件..."）
  detail?: string    // 详细信息（如 "已处理 1200/3000 行"）
  status?: 'running' | 'success' | 'failure'
}

interface ToolProgressBarProps {
  toolName?: string
  toolCallId?: string
}

export const ToolProgressBar = memo(function ToolProgressBar({ toolName, toolCallId }: ToolProgressBarProps) {
  const { colors } = useThemeStore()
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number>(0)
  const progressState = useToolProgress()

  // 获取当前工具的进度数据
  const allProgress = Object.values(progressState)
  const progress = toolCallId ? progressState[toolCallId] : allProgress.find(p => p.status === 'running')

  // 计时器
  useEffect(() => {
    if (progress?.status === 'running') {
      startTimeRef.current = Date.now()
      const timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
      return () => clearInterval(timer)
    }
  }, [progress?.status])

  if (!progress || progress.status === 'success' || progress.status === 'failure') {
    return null
  }

  const percent = progress.percent ?? 0
  const isDeterminate = percent > 0 && percent < 100

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-md my-1"
      style={{
        backgroundColor: `${colors.bgPrimary}60`,
        border: `1px solid ${colors.border}40`,
      }}
    >
      {/* 工具图标 + 名称 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <svg className="w-3.5 h-3.5 animate-spin" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span className="text-[11px] font-mono font-medium" style={{ color: colors.accent }}>
          {toolName || progress.toolName || progress.label || '执行中'}
        </span>
      </div>

      {/* 进度条主体 */}
      <div className="flex-1 min-w-0">
        {isDeterminate ? (
          <>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `${colors.border}30` }}>
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${percent}%`,
                  backgroundColor: colors.accent,
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[9px] truncate" style={{ color: colors.textDim }}>
                {progress.detail || progress.label || ''}
              </span>
              <span className="text-[9px] flex-shrink-0 tabular-nums" style={{ color: colors.textDim }}>
                {percent}%
              </span>
            </div>
          </>
        ) : (
          <div className="h-1.5 rounded-full overflow-hidden relative" style={{ backgroundColor: `${colors.border}30` }}>
            {/* Indeterminate 动画 */}
            <div
              className="absolute h-full rounded-full"
              style={{
                width: '40%',
                backgroundColor: colors.accent,
                animation: 'indeterminate-slide 1.5s ease-in-out infinite',
              }}
            />
          </div>
        )}
      </div>

      {/* 计时 */}
      <span className="text-[9px] flex-shrink-0 tabular-nums" style={{ color: colors.textDim }}>
        {elapsed}s
      </span>

      {/* CSS 动画 */}
      <style>{`
        @keyframes indeterminate-slide {
          0% { left: -40%; }
          50% { left: 100%; }
          100% { left: -40%; }
        }
      `}</style>
    </div>
  )
})

// ===== Store: 工具进度状态管理 =====
// 在 RightSidebar 或 agent.ts 中使用

interface ToolProgressState {
  [toolCallId: string]: ToolProgressData
}

// 简单的事件发射器，用于非 React 环境更新进度
const progressListeners: Set<(state: ToolProgressState) => void> = new Set()
let progressState: ToolProgressState = {}

export const toolProgressStore = {
  set(data: ToolProgressData) {
    progressState = { ...progressState, [data.toolCallId]: data }
    progressListeners.forEach(fn => fn(progressState))
  },
  update(toolCallId: string, patch: Partial<ToolProgressData>) {
    if (progressState[toolCallId]) {
      progressState = { ...progressState, [toolCallId]: { ...progressState[toolCallId], ...patch } }
      progressListeners.forEach(fn => fn(progressState))
    }
  },
  remove(toolCallId: string) {
    const next = { ...progressState }
    delete next[toolCallId]
    progressState = next
    progressListeners.forEach(fn => fn(progressState))
  },
  clear() {
    progressState = {}
    progressListeners.forEach(fn => fn(progressState))
  },
  subscribe(fn: (state: ToolProgressState) => void) {
    progressListeners.add(fn)
    return () => { progressListeners.delete(fn) }
  },
  getState() {
    return progressState
  },
}

// ===== Hook =====
export function useToolProgress() {
  const [state, setState] = React.useState<ToolProgressState>(progressState)
  React.useEffect(() => {
    return toolProgressStore.subscribe(setState)
  }, [])
  return state
}
