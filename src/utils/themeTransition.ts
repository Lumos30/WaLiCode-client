/**
 * 主题切换过渡动画。
 * 使用 View Transitions API（Chrome 111+）实现平滑主题切换。
 * 不支持时静默降级（无动画切换）。
 */

/**
 * 检查浏览器是否支持 View Transitions API
 */
export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document
}

/**
 * 带过渡动画的主题切换。
 * 在回调中修改主题状态，API 自动捕获前后快照并做交叉淡入淡出。
 *
 * @param updateCallback - 执行主题切换的回调（如 setTheme('dark')）
 * @param options - 可选配置
 * @param options.durationMs - 过渡时长（默认 300ms）
 * @param options.selector - 参与过渡的根选择器（默认 'body'）
 *
 * @example
 * ```tsx
 * animateThemeChange(() => setTheme(theme === 'dark' ? 'light' : 'dark'))
 * ```
 */
export function animateThemeChange(
  updateCallback: () => void,
  options?: { durationMs?: number; selector?: string }
): void {
  const durationMs = options?.durationMs ?? 300
  const selector = options?.selector ?? 'body'

  if (!supportsViewTransitions()) {
    // 不支持 View Transitions → 直接切换
    updateCallback()
    return
  }

  // 使用 View Transitions API
  const transition = (document as any).startViewTransition(() => {
    updateCallback()
  })

  // 自定义动画：root 交叉淡入淡出
  transition.ready.then(() => {
    const root = document.querySelector(selector)
    if (!root) return

    root.animate(
      [
        { opacity: 0.85, filter: 'brightness(0.95)' },
        { opacity: 1, filter: 'brightness(1)' },
      ],
      {
        duration: durationMs,
        easing: 'ease-out',
      }
    )
  }).catch(() => {
    // 过渡失败静默忽略
  })
}
