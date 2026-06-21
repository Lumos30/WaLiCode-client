import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * ErrorBoundary — React 错误边界组件
 * 捕获子组件渲染异常，防止白屏崩溃。
 *
 * 使用方式：
 * <ErrorBoundary fallback={<div>出错了</div>}>
 *   <SomeRiskyComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center"
          style={{ color: 'var(--text-secondary, #888)' }}>
          <svg className="w-10 h-10 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 9v3.75m0 3.75h.007M5.25 6.75h13.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-9a1.5 1.5 0 0 1 1.5-1.5Z"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="text-sm font-medium" style={{ color: 'var(--text-primary, #ccc)' }}>
            组件渲染异常
          </div>
          <div className="text-xs max-w-md break-all" style={{ color: 'var(--text-dim, #666)' }}>
            {this.state.error?.message || '未知错误'}
          </div>
          <button
            onClick={this.handleReset}
            className="px-3 py-1.5 text-xs rounded-md border transition-colors hover:opacity-80"
            style={{
              borderColor: 'var(--border, #333)',
              color: 'var(--text-primary, #ccc)',
            }}
          >
            重试
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * 全局错误回退组件 — 用于 App 顶层
 */
export function GlobalErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 p-8 bg-[#1e1e1e] text-center">
      <svg className="w-16 h-16 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 9v3.75m0 3.75h.007M5.25 6.75h13.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-9a1.5 1.5 0 0 1 1.5-1.5Z"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="text-base font-medium text-gray-200">应用遇到严重错误</div>
      <div className="text-sm text-gray-400 max-w-lg break-all">{error.message}</div>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors"
      >
        重新加载
      </button>
    </div>
  )
}
