import { useEffect, useRef } from 'react'
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
  /** @deprecated 已废弃，保留仅为接口兼容 */
  maxCharsPerFrame?: number
}

export function TypewriterRenderer({
  fullText,
  isLoading,
  onRenderComplete,
  renderContent,
}: TypewriterRendererProps) {
  const { colors } = useThemeStore()
  const completedRef = useRef(false)

  // isLoading 变为 false 时调用一次 onRenderComplete
  useEffect(() => {
    if (!isLoading && !completedRef.current) {
      completedRef.current = true
      onRenderComplete?.()
    }
    if (isLoading) {
      completedRef.current = false
    }
  }, [isLoading, onRenderComplete])

  const content = renderContent ? renderContent(fullText) : (
    <div
      className="text-[13px] leading-relaxed whitespace-pre-wrap break-words"
      style={{ color: colors.text }}
      dangerouslySetInnerHTML={{ __html: fullText }}
    />
  )

  return (
    <div className="relative">
      {content}
      {isLoading && (
        <span
          className="inline-block w-0.5 animate-pulse"
          style={{
            backgroundColor: colors.accent,
            verticalAlign: 'text-bottom',
            height: '1em',
          }}
        />
      )}
    </div>
  )
}
