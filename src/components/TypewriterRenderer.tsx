/**
 * TypewriterRenderer — 流式打字机效果渲染器
 *
 * P0-1: 对标 WaLiCode-Android 的即时反馈感
 *
 * 机制：
 * - 后端 SSE onText 推送累积全文 → fullText
 * - 组件用 requestAnimationFrame 逐字追赶显示
 * - 速度自适应：长文本快赶，短文本慢出
 * - 渲染完成后回调 onRenderComplete
 *
 * 使用：
 * <TypewriterRenderer fullText={fullText} isLoading={isLoading} />
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import { useThemeStore } from '../stores/themeStore'

interface TypewriterRendererProps {
  /** 后端推送的累积全文 */
  fullText: string
  /** 是否仍在加载（流式输出中） */
  isLoading: boolean
  /** 渲染完成回调 */
  onRenderComplete?: () => void
  /** 自定义渲染函数（如 Markdown 渲染） */
  renderContent?: (text: string) => React.ReactNode
  /** 每帧渲染字符数（自适应模式下作为上限） */
  maxCharsPerFrame?: number
}

export function TypewriterRenderer({
  fullText,
  isLoading,
  onRenderComplete,
  renderContent,
  maxCharsPerFrame = 8,
}: TypewriterRendererProps) {
  const { colors } = useThemeStore()
  const [displayText, setDisplayText] = useState('')
  const rafRef = useRef<number | null>(null)
  const lastRenderedLenRef = useRef(0)
  const fullTextRef = useRef('')
  const completedRef = useRef(false)

  // 更新目标文本
  useEffect(() => {
    fullTextRef.current = fullText
  }, [fullText])

  // requestAnimationFrame 逐字追赶
  const tick = useCallback(() => {
    const target = fullTextRef.current
    const currentLen = lastRenderedLenRef.current

    if (currentLen >= target.length) {
      // 已追上目标文本
      if (!isLoading && !completedRef.current) {
        completedRef.current = true
        onRenderComplete?.()
      }
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    // 计算本帧渲染字符数（自适应速度）
    const remaining = target.length - currentLen
    // 剩余越多 → 每帧渲染越多字符（快速追赶）
    const speed = Math.min(maxCharsPerFrame, Math.ceil(remaining / 20))
    const newLen = currentLen + speed

    setDisplayText(target.substring(0, newLen))
    lastRenderedLenRef.current = newLen
    completedRef.current = false

    rafRef.current = requestAnimationFrame(tick)
  }, [isLoading, maxCharsPerFrame, onRenderComplete])

  // 启动/停止动画
  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [tick])

  // 流结束后确保完整渲染
  useEffect(() => {
    if (!isLoading && fullText) {
      // 等动画追上
      const timer = setTimeout(() => {
        if (lastRenderedLenRef.current < fullText.length) {
          setDisplayText(fullText)
          lastRenderedLenRef.current = fullText.length
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isLoading, fullText])

  // 渲染内容
  const content = renderContent ? renderContent(displayText) : (
    <div
      className="text-[13px] leading-relaxed whitespace-pre-wrap break-words"
      style={{ color: colors.text }}
      dangerouslySetInnerHTML={{ __html: displayText }}
    />
  )

  return (
    <div className="relative">
      {content}
      {isLoading && displayText.length < (fullTextRef.current?.length || 0) && (
        <span
          className="inline-block w-0.5 h-3.5 ml-0.5 animate-pulse"
          style={{ backgroundColor: colors.accent, verticalAlign: 'text-bottom' }}
        />
      )}
    </div>
  )
}
