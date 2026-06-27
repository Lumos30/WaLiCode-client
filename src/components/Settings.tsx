import { useState, useEffect, useCallback, useRef } from 'react'
import { useThemeStore, themes, type ThemeName } from '../stores/themeStore'
import { useConnectionStore } from '../stores/connectionStore'
import { invoke } from '@tauri-apps/api/core'

interface SettingsProps {
  open: boolean
  onClose: () => void
}

type Section = 'communication' | 'appearance' | 'general' | 'cli' | 'about'

export function Settings({ open, onClose }: SettingsProps) {
  const { currentTheme, setTheme } = useThemeStore()
  const { serverUrl, setServerUrl } = useConnectionStore()

  // ── 各设置项的本地编辑状态 ──
  const [inputUrl, setInputUrl] = useState(serverUrl)
  const [inputLang, setInputLang] = useState('简体中文')
  const [inputFont, setInputFont] = useState('JetBrains Mono')
  const [inputFontSize, setInputFontSize] = useState(13)
  const [section, setSection] = useState<Section>('communication')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'fail'>('idle')

  // CLI 工具状态
  const [cliInstalled, setCliInstalled] = useState(false)
  const [cliLoading, setCliLoading] = useState<'idle' | 'installing' | 'uninstalling'>('idle')
  const [copied, setCopied] = useState(false)

  // ── 可拖拽缩放 ──
  const dialogRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 960, h: 640 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  // 同步 store → 本地
  useEffect(() => { setInputUrl(serverUrl) }, [serverUrl])

  // 检查 CLI 注册状态
  useEffect(() => {
    invoke<boolean>('check_cli_installed').then(setCliInstalled).catch(() => setCliInstalled(false))
  }, [])

  // ── 判断是否有修改 ──
  const hasChanges = inputUrl.trim().replace(/\/+$/, '') !== serverUrl

  /** 测试连接 — 直接请求用户输入的地址，不依赖 store 状态 */
  const handleTest = useCallback(async () => {
    const trimmed = inputUrl.trim().replace(/\/+$/, '')
    if (!trimmed) return
    setTestStatus('testing')
    try {
      const res = await fetch(`${trimmed}/api/v1/ssh/connection_list?userId=default`, {
        signal: AbortSignal.timeout(8000),
      })
      const json = await res.json()
      setTestStatus(json.code === '0000' ? 'success' : 'fail')
    } catch {
      setTestStatus('fail')
    }
    setTimeout(() => setTestStatus('idle'), 3000)
  }, [inputUrl])

  /** 保存所有设置 */
  const handleSave = useCallback(() => {
    const trimmed = inputUrl.trim().replace(/\/+$/, '')
    if (trimmed) setServerUrl(trimmed)
  }, [inputUrl, setServerUrl])

  /** 取消：还原所有本地状态 */
  const handleCancel = useCallback(() => {
    setInputUrl(serverUrl)
    onClose()
  }, [serverUrl, onClose])

  /** 保存并关闭 */
  const handleSaveAndClose = useCallback(() => {
    handleSave()
    onClose()
  }, [handleSave, onClose])

  // ── 拖拽缩放逻辑 ──
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const nw = Math.max(700, dragStart.current.w + ev.clientX - dragStart.current.x)
      const nh = Math.max(460, dragStart.current.h + ev.clientY - dragStart.current.y)
      setSize({ w: nw, h: nh })
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [size])

  // ── ESC 关闭 ──
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, handleCancel])

  /** 复制 walicode-cli 命令 */
  const handleCopyCli = useCallback(async () => {
    try {
      await navigator.clipboard.writeText('walicode-cli')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 降级：用 execCommand
      const ta = document.createElement('textarea')
      ta.value = 'walicode-cli'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch {}
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }, [])

  const { colors } = useThemeStore()
  const themeList = (Object.entries(themes) as [ThemeName, typeof themes[ThemeName]][])

  if (!open) return null

  const sections: { id: Section; label: string; icon: string }[] = [
    { id: 'communication', label: '通信', icon: '⚙️' },
    { id: 'appearance', label: '外观', icon: '🎨' },
    { id: 'general', label: '通用', icon: '💻' },
    { id: 'cli', label: 'CLI 工具', icon: '⌨️' },
    { id: 'about', label: '关于', icon: 'ℹ️' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div
        ref={dialogRef}
        className="rounded-xl shadow-2xl flex flex-col overflow-hidden relative select-none"
        style={{
          backgroundColor: colors.bgSecondary,
          border: `1px solid ${colors.border}`,
          width: size.w,
          height: size.h,
          minWidth: 700,
          minHeight: 460,
        }}
      >
        {/* ── 顶栏 ── */}
        <div
          className="flex items-center justify-between px-6 py-3.5 shrink-0"
          style={{ backgroundColor: colors.bgPrimary, borderBottom: `1px solid ${colors.border}` }}
        >
          <span className="text-[14px] font-semibold" style={{ color: colors.text }}>设置</span>
          <button
            onClick={handleCancel}
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm hover:bg-white/10 transition-colors"
            style={{ color: colors.textDim }}
          >
            ✕
          </button>
        </div>

        {/* ── 主体：左侧导航 + 右侧内容 ── */}
        <div className="flex flex-1 min-h-0">
          {/* 左侧导航 */}
          <div
            className="w-56 p-4 border-r flex flex-col gap-1 shrink-0"
            style={{ borderColor: colors.border }}
          >
            {sections.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[13px] text-left transition-colors"
                style={{
                  backgroundColor: section === item.id ? colors.accentSoft : 'transparent',
                  color: section === item.id ? colors.accent : colors.textSecondary,
                  fontWeight: section === item.id ? 600 : 400,
                }}
              >
                <span className="text-[15px]">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          {/* 右侧内容区 */}
          <div className="flex-1 p-8 overflow-y-auto">
            {/* 通信（原通用） */}
            {section === 'communication' && (
              <div className="space-y-6">
                <h2 className="text-[15px] font-semibold" style={{ color: colors.text }}>通信设置</h2>

                {/* 服务端地址 */}
                <div>
                  <label className="block text-[13px] mb-2" style={{ color: colors.textDim }}>服务端地址</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="http://localhost:8091"
                      className="flex-1 px-3.5 py-2 rounded-md text-[13px] outline-none transition-colors"
                      style={{
                        backgroundColor: colors.bgInput,
                        border: `1px solid ${inputUrl.trim().replace(/\/+$/, '') !== serverUrl ? colors.accent : colors.border}`,
                        color: colors.text,
                      }}
                    />
                    <button
                      onClick={handleTest}
                      disabled={testStatus === 'testing'}
                      className="px-4 py-2 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap"
                      style={{
                        backgroundColor: colors.bgTertiary,
                        border: `1px solid ${colors.border}`,
                        color: testStatus === 'success' ? colors.green : testStatus === 'fail' ? colors.red : colors.textSecondary,
                      }}
                    >
                      {testStatus === 'testing' ? '测试中...' : testStatus === 'success' ? '✓ 连接成功' : testStatus === 'fail' ? '✗ 连接失败' : '测试连接'}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[12px]" style={{ color: colors.textDim }}>后端 API 的完整地址，如 http://localhost:8091</p>
                </div>

                {/* 语言 */}
                <div>
                  <label className="block text-[13px] mb-2" style={{ color: colors.textDim }}>语言</label>
                  <select
                    value={inputLang}
                    onChange={(e) => setInputLang(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-md text-[13px] outline-none"
                    style={{ backgroundColor: colors.bgInput, border: `1px solid ${colors.border}`, color: colors.text }}
                  >
                    <option>简体中文</option>
                    <option>English</option>
                  </select>
                </div>
              </div>
            )}

            {/* 外观 */}
            {section === 'appearance' && (
              <div className="space-y-6">
                <h2 className="text-[15px] font-semibold" style={{ color: colors.text }}>外观设置</h2>
                <div className="grid grid-cols-2 gap-4">
                  {themeList.map(([name, config]) => {
                    const previewColors = name === 'system' ? colors : config.colors
                    return (
                    <button
                      key={name}
                      onClick={() => setTheme(name)}
                      className="p-4 rounded-lg text-left transition-all border-2"
                      style={{
                        backgroundColor: previewColors.bgPrimary,
                        borderColor: currentTheme === name ? previewColors.accent : previewColors.border,
                      }}
                    >
                      <div className="flex gap-1.5 mb-3">
                        {[previewColors.bgPrimary, previewColors.bgSecondary, previewColors.accent, previewColors.green].map((c, i) => (
                          <div key={i} className="w-5 h-5 rounded-full border" style={{ backgroundColor: c, borderColor: previewColors.border }} />
                        ))}
                      </div>
                      <span className="text-[13px] font-medium" style={{ color: previewColors.text }}>{config.label}</span>
                      {currentTheme === name && (
                        <span className="ml-2 text-xs" style={{ color: previewColors.accent }}>✓</span>
                      )}
                    </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 通用（原终端） */}
            {section === 'general' && (
              <div className="space-y-6">
                <h2 className="text-[15px] font-semibold" style={{ color: colors.text }}>通用设置</h2>

                {/* 字体 */}
                <div>
                  <label className="block text-[13px] mb-2" style={{ color: colors.textDim }}>字体</label>
                  <select
                    value={inputFont}
                    onChange={(e) => setInputFont(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-md text-[13px] outline-none"
                    style={{ backgroundColor: colors.bgInput, border: `1px solid ${colors.border}`, color: colors.text }}
                  >
                    <option>JetBrains Mono</option>
                    <option>Fira Code</option>
                    <option>Menlo</option>
                    <option>Source Code Pro</option>
                  </select>
                </div>

                {/* 字号 */}
                <div>
                  <label className="block text-[13px] mb-2" style={{ color: colors.textDim }}>字号</label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="10"
                      max="24"
                      value={inputFontSize}
                      onChange={(e) => setInputFontSize(Number(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-[13px] w-8 text-right tabular-nums" style={{ color: colors.text }}>{inputFontSize}px</span>
                  </div>
                </div>
              </div>
            )}

            {/* CLI 工具（独立栏目） */}
            {section === 'cli' && (
              <div className="space-y-6">
                <h2 className="text-[15px] font-semibold" style={{ color: colors.text }}>CLI 工具</h2>

                {/* 配置区 */}
                <div
                  className="p-4 rounded-lg space-y-3"
                  style={{ backgroundColor: colors.bgInput, border: `1px solid ${colors.border}` }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[14px] font-semibold" style={{ color: colors.text }}>walicode-cli</span>
                    {cliInstalled ? (
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-medium"
                        style={{ backgroundColor: colors.green + '22', color: colors.green }}
                      >
                        已注册
                      </span>
                    ) : (
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-medium"
                        style={{ backgroundColor: colors.textDim + '22', color: colors.textDim }}
                      >
                        未注册
                      </span>
                    )}
                  </div>
                  <p className="text-[12px]" style={{ color: colors.textDim }}>
                    将 <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: colors.bgSecondary, color: colors.accent }}>walicode-cli</code> 注册到系统 PATH，终端中可直接启动应用。
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    {cliInstalled ? (
                      <button
                        onClick={async () => {
                          setCliLoading('uninstalling')
                          try {
                            await invoke<string>('uninstall_cli_command')
                            setCliInstalled(false)
                          } catch (e) {
                            alert(`移除失败: ${e}。可能需要管理员权限。`)
                          }
                          setCliLoading('idle')
                        }}
                        disabled={cliLoading !== 'idle'}
                        className="px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors"
                        style={{
                          backgroundColor: colors.bgTertiary,
                          border: `1px solid ${colors.border}`,
                          color: colors.textSecondary,
                          cursor: cliLoading !== 'idle' ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {cliLoading === 'uninstalling' ? '移除中...' : '移除命令'}
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          setCliLoading('installing')
                          try {
                            await invoke<string>('install_cli_command')
                            setCliInstalled(true)
                          } catch (e) {
                            alert(`注册失败: ${e}。可能需要管理员权限。`)
                          }
                          setCliLoading('idle')
                        }}
                        disabled={cliLoading !== 'idle'}
                        className="px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors"
                        style={{
                          backgroundColor: cliLoading === 'idle' ? colors.accent : colors.bgTertiary,
                          color: cliLoading === 'idle' ? '#fff' : colors.textDim,
                          cursor: cliLoading !== 'idle' ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {cliLoading === 'installing' ? '安装中...' : '点击安装'}
                      </button>
                    )}
                  </div>
                </div>

                {/* 使用说明区 */}
                <div
                  className="p-4 rounded-lg space-y-3"
                  style={{ backgroundColor: colors.bgInput, border: `1px solid ${colors.border}` }}
                >
                  <h3 className="text-[13px] font-semibold" style={{ color: colors.text }}>使用说明</h3>
                  <p className="text-[13px]" style={{ color: colors.textSecondary }}>
                    安装 <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: colors.bgSecondary, color: colors.accent }}>walicode-cli</code> 后，可在任意终端使用以下命令：
                  </p>

                  {/* 命令块：点击整块复制 */}
                  <button
                    onClick={handleCopyCli}
                    className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-md text-left transition-colors group hover:brightness-110"
                    style={{
                      backgroundColor: colors.bgSecondary,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <code className="text-[13px] font-mono" style={{ color: colors.text }}>
                      $ walicode-cli
                    </code>
                    <span
                      className="text-[11px] font-medium shrink-0 transition-colors"
                      style={{ color: copied ? colors.green : colors.textDim }}
                    >
                      {copied ? '✓ 已复制' : '点击复制'}
                    </span>
                  </button>

                  <ul className="text-[12px] space-y-1.5 pt-1" style={{ color: colors.textDim }}>
                    <li>• 在系统任意终端输入 <code style={{ color: colors.accent }}>walicode-cli</code> 即可启动 WaLiCode</li>
                    <li>• 支持 macOS / Linux（写入 <code style={{ color: colors.accent }}>~/.local/bin</code>）</li>
                    <li>• 需重启终端或执行 <code style={{ color: colors.accent }}>source ~/.zshrc</code> 让 PATH 生效</li>
                  </ul>
                </div>
              </div>
            )}

            {/* 关于 */}
            {section === 'about' && (
              <div className="flex flex-col items-center py-10">
                <img src="/logo.png" alt="WaLiCode" className="w-20 h-20 rounded-xl mb-4" />
                <h3 className="text-lg font-semibold mb-1" style={{ color: colors.text }}>WaLiCode</h3>
                <p className="text-[13px] mb-6" style={{ color: colors.textDim }}>v0.1.0 · AI + SSH 智能终端</p>
                <div className="w-full max-w-sm p-4 rounded-lg text-[13px] space-y-3" style={{ backgroundColor: colors.bgInput }}>
                  {[
                    ['前端', 'Tauri 2.0 + React 19'],
                    ['后端', 'Spring AI + Google ADK'],
                    ['构建', 'Vite 7 + TypeScript'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span style={{ color: colors.textDim }}>{k}</span>
                      <span style={{ color: colors.textSecondary }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 底栏：统一操作按钮 ── */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-3.5 shrink-0"
          style={{ backgroundColor: colors.bgPrimary, borderTop: `1px solid ${colors.border}` }}
        >
          <button
            onClick={handleCancel}
            className="px-5 py-2 rounded-md text-[13px] font-medium transition-colors"
            style={{
              backgroundColor: colors.bgTertiary,
              border: `1px solid ${colors.border}`,
              color: colors.textSecondary,
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="px-5 py-2 rounded-md text-[13px] font-medium transition-colors"
            style={{
              backgroundColor: hasChanges ? colors.bgTertiary : colors.bgInput,
              border: `1px solid ${colors.border}`,
              color: hasChanges ? colors.text : colors.textDim,
              cursor: hasChanges ? 'pointer' : 'not-allowed',
            }}
          >
            保存
          </button>
          <button
            onClick={handleSaveAndClose}
            disabled={!hasChanges}
            className="px-5 py-2 rounded-md text-[13px] font-medium transition-colors"
            style={{
              backgroundColor: hasChanges ? colors.accent : colors.bgInput,
              color: hasChanges ? '#fff' : colors.textDim,
              cursor: hasChanges ? 'pointer' : 'not-allowed',
            }}
          >
            保存并关闭
          </button>
        </div>

        {/* ── 右下角拖拽缩放手柄 ── */}
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-end justify-end p-0.5"
          style={{ color: colors.textDim }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <circle cx="8" cy="2" r="1" />
            <circle cx="8" cy="5" r="1" />
            <circle cx="5" cy="5" r="1" />
            <circle cx="8" cy="8" r="1" />
            <circle cx="5" cy="8" r="1" />
            <circle cx="2" cy="8" r="1" />
          </svg>
        </div>
      </div>
    </div>
  )
}
