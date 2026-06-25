import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Header } from '../components/Header'
import { ActivityBar } from '../components/ActivityBar'
import { LeftSidebar } from '../components/LeftSidebar'
import { RightSidebar } from '../components/RightSidebar'
import { HistoryPanel } from '../components/HistoryPanel'
import { TerminalContainer } from '../components/TerminalContainer'
import { SFTPWorkspace } from '../components/SFTPWorkspace'
import { Settings } from '../components/Settings'
import { SSHConnectionModal } from '../components/SSHConnectionModal'
import { useThemeStore } from '../stores/themeStore'
import { useFileExplorerStore } from '../stores/fileExplorerStore'
import { useLocalFileStore } from '../stores/localFileStore'
import { useAgentStore } from '../stores/agentStore'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { BottomPanelBar } from '../components/BottomPanelBar'

// Lazy load Monaco 编辑器组件（减少首屏 bundle）
const FileWorkspace = lazy(() => import('../components/FileWorkspace').then(m => ({ default: m.FileWorkspace })))
const LocalFileWorkspace = lazy(() => import('../components/LocalFileWorkspace').then(m => ({ default: m.LocalFileWorkspace })))

// 编辑器加载占位
const EditorSkeleton = () => (
  <div className="flex items-center justify-center h-full text-gray-400 text-sm">
    <div className="flex gap-1">
      {[0, 150, 300].map(d => (
        <span key={d} className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  </div>
)

type TabId = 'servers' | 'files' | 'sftp' | 'local' | 'extensions'

/**
 * MainView V4 - 统一终端管理 + 多文件标签
 *
 * 优化内容：
 * 1. 终端统一在 MainView 层管理，servers 和 files 标签页共享同一个终端实例
 * 2. 文件标签页支持多种布局模式（标签/水平分屏/垂直分屏）
 * 3. 保持终端会话不因标签页切换而重置
 * 4. 支持多文件标签切换和管理
 */
export function MainView() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sshModalOpen, setSshModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('local')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [chatVisible, setChatVisible] = useState(true)
  const [chatWidth, setChatWidth] = useState(400)
  const [terminalVisible, setTerminalVisible] = useState(true)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [isResizingChat, setIsResizingChat] = useState(false)
  
  // 文件标签页的布局模式
  const [workbenchLayoutMode, setWorkbenchLayoutMode] = useState<'tabs' | 'split-horizontal' | 'split-vertical'>('tabs')
  const [terminalPanelSize, setTerminalPanelSize] = useState(300)
  const [isResizingTerminal, setIsResizingTerminal] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabKey: string } | null>(null)

  // 监听 RightSidebar 触发的 SSH 弹窗事件（来自 /connect 命令）
  useEffect(() => {
    const handler = () => {
      setSshModalOpen(true)
      setSidebarVisible(true)
      setActiveTab('servers')
    }
    window.addEventListener('open-ssh-modal', handler)
    return () => window.removeEventListener('open-ssh-modal', handler)
  }, [])
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  
  // 当前激活的终端会话 ID
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null)
  const [isTerminalActive, setIsTerminalActive] = useState(true)

  const { colors } = useThemeStore()
  const showHistoryPanel = useAgentStore((s) => s.showHistoryPanel)
  const { 
    openTabs, 
    activeTabKey, 
    setActiveTab: setActiveFileTab, 
    closeTab, 
    closeTabsToLeft, 
    closeTabsToRight, 
    closeOtherTabs, 
    closeAllTabs 
  } = useFileExplorerStore()

  // Sidebar 拖拽
  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingSidebar(true)
    const startX = e.clientX
    const startWidth = sidebarWidth

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(500, startWidth + (moveEvent.clientX - startX)))
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      setIsResizingSidebar(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  // Chat 拖拽
  const handleChatResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingChat(true)
    const startX = e.clientX
    const startWidth = chatWidth

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(300, Math.min(700, startWidth - (moveEvent.clientX - startX)))
      setChatWidth(newWidth)
    }

    const onMouseUp = () => {
      setIsResizingChat(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [chatWidth])

  useEffect(() => {
    document.body.style.backgroundColor = colors.bgPrimary
    document.body.style.color = colors.text
  }, [colors])

  // 处理终端会话变化
  const handleTerminalSessionChange = useCallback((sessionId: string | null) => {
    setActiveTerminalSessionId(sessionId)
    // SSH 终端会话创建成功 → 自动打开终端面板
    if (sessionId) {
      setTerminalVisible(true)
    }
  }, [])

  // 监听左侧面板 SSH 连接开关事件：连接成功后自动打开 SSH 终端面板
  useEffect(() => {
    const handler = (_e: CustomEvent<{ connectionId: string }>) => {
      setTerminalVisible(true)
      setIsTerminalActive(true)
      setActiveTab('servers')
    }
    window.addEventListener('open-ssh-terminal', handler as EventListener)
    return () => window.removeEventListener('open-ssh-terminal', handler as EventListener)
  }, [])

  // 监听 fileExplorerStore.activeTabKey 变化：当远程文件/diff tab 被激活时，自动切换到 files 标签页并显示文件视图
  // 注意：使用 ref 避免与 localFileStore 的 activeTabKey 变化产生竞争
  const prevActiveTabKeyRef = useRef<string | null>(activeTabKey)
  useEffect(() => {
    // 只有 activeTabKey 真正变化时才切换（避免与 local 标签页的切换产生竞争）
    if (activeTabKey && activeTabKey !== prevActiveTabKeyRef.current) {
      prevActiveTabKeyRef.current = activeTabKey
      setIsTerminalActive(false)
      // 远程文件 tab 或 diff tab → 确保 activeTab 为 'files'
      if (activeTab !== 'files') {
        setActiveTab('files')
      }
    }
  }, [activeTabKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 监听 localFileStore.activeTabKey 变化：当本地文件 tab 被激活时，自动切换到 local 标签页
  // 注意：使用 ref 避免与 fileExplorerStore 的 activeTabKey 变化产生竞争
  const localActiveTabKey = useLocalFileStore((s) => s.activeTabKey)
  const prevLocalActiveTabKeyRef = useRef<string | null>(localActiveTabKey)
  useEffect(() => {
    // 只有 localActiveTabKey 真正变化时才切换（避免与 files 标签页的切换产生竞争）
    if (localActiveTabKey && localActiveTabKey !== prevLocalActiveTabKeyRef.current) {
      prevLocalActiveTabKeyRef.current = localActiveTabKey
      if (activeTab !== 'local') {
        setActiveTab('local')
      }
    }
  }, [localActiveTabKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 处理终端大小调整
  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingTerminal(true)
    
    const onMouseMove = (moveEvent: MouseEvent) => {
      if (workbenchLayoutMode === 'split-horizontal') {
        const container = document.querySelector('.workbench-container') as HTMLElement
        if (container) {
          const containerRect = container.getBoundingClientRect()
          const newSize = containerRect.bottom - moveEvent.clientY
          setTerminalPanelSize(Math.max(150, Math.min(600, newSize)))
        }
      } else if (workbenchLayoutMode === 'split-vertical') {
        const container = document.querySelector('.workbench-container') as HTMLElement
        if (container) {
          const containerRect = container.getBoundingClientRect()
          const newSize = containerRect.right - moveEvent.clientX
          setTerminalPanelSize(Math.max(250, Math.min(800, newSize)))
        }
      }
    }

    const onMouseUp = () => {
      setIsResizingTerminal(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [workbenchLayoutMode])

  // 点击空白处关闭下拉菜单
  useEffect(() => {
    const closeDropdown = () => setDropdownOpen(false)
    if (dropdownOpen) {
      document.addEventListener('click', closeDropdown)
      return () => document.removeEventListener('click', closeDropdown)
    }
  }, [dropdownOpen])

  // 右键菜单处理
  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null)
    if (contextMenu) {
      document.addEventListener('click', closeContextMenu)
      document.addEventListener('contextmenu', closeContextMenu)
      return () => {
        document.removeEventListener('click', closeContextMenu)
        document.removeEventListener('contextmenu', closeContextMenu)
      }
    }
  }, [contextMenu])

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden" style={{ backgroundColor: colors.bgPrimary }}>
      {/* ===== 顶部标题栏 ===== */}
      <Header
        onToggleSidebar={() => setSidebarVisible(!sidebarVisible)}
        sidebarVisible={sidebarVisible}
        onToggleChat={() => setChatVisible(!chatVisible)}
        chatVisible={chatVisible}
        onOpenSSHModal={() => setSshModalOpen(true)}
        onOpenLocalFolder={() => {
          setActiveTab('local')
          setSidebarVisible(true)
          // 触发文件夹选择对话框
          void useLocalFileStore.getState().openFolder()
        }}
      />

      {/* ===== 主体区域 ===== */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：ActivityBar + Sidebar */}
        {sidebarVisible && (
          <>
            <ActivityBar activeTab={activeTab} onTabChange={setActiveTab} onOpenSettings={() => setSettingsOpen(true)} />

            <div
              className="flex-shrink-0 transition-none overflow-hidden relative"
              style={{ width: sidebarWidth }}
            >
              <LeftSidebar activeTab={activeTab} />
            </div>

            {/* Sidebar 拖拽条 */}
            <div
              className="w-1.5 h-full cursor-col-resize relative z-50 flex-shrink-0"
              style={{ backgroundColor: isResizingSidebar ? colors.accent : 'transparent' }}
              onMouseDown={handleSidebarResizeStart}
            >
              <div
                className={`absolute inset-y-0 -left-[3px] -right-[3px] ${isResizingSidebar ? '' : 'hover:bg-blue-500/30'} rounded-full`}
              />
            </div>
          </>
        )}

        {/* 中间：根据左侧 Tab 切换工作区 */}
        <div className="flex-1 min-w-0 overflow-hidden relative workbench-container">
          {/* 本地文件夹标签页 - 文件树 + Monaco 编辑器 + 终端 */}
          {activeTab === 'local' && (
            <div className="h-full min-w-0 flex flex-col">
              <Suspense fallback={<EditorSkeleton />}>
                <LocalFileWorkspace />
              </Suspense>
              {/* 底部终端面板 */}
              {terminalVisible && (
                <div style={{ height: terminalPanelSize, minHeight: 150, borderTop: `1px solid ${colors.border}` }} className="flex-shrink-0">
                  <ErrorBoundary>
                    <TerminalContainer 
                      onTerminalSessionChange={handleTerminalSessionChange}
                      onCloseTerminal={() => setTerminalVisible(false)}
                    />
                  </ErrorBoundary>
                </div>
              )}
              {/* 终端拖拽条 */}
              {terminalVisible && (
                <div
                  className="h-1 cursor-row-resize hover:bg-blue-500/30 flex-shrink-0"
                  style={{ backgroundColor: isResizingTerminal ? colors.accent : 'transparent' }}
                  onMouseDown={handleTerminalResizeStart}
                />
              )}
              {/* 底部边条 - 始终显示，用于收起/展开终端 */}
              <BottomPanelBar
                terminalVisible={terminalVisible}
                onToggleTerminal={() => setTerminalVisible(!terminalVisible)}
              />
            </div>
          )}

          {/* SSH 服务器标签页 - 只显示终端 */}
          {activeTab === 'servers' && (
            <div className="h-full min-w-0 flex flex-col">
              <div className="flex-1 min-h-0">
                {terminalVisible ? (
                  <ErrorBoundary>
                    <TerminalContainer 
                      onTerminalSessionChange={handleTerminalSessionChange}
                      onCloseTerminal={() => setTerminalVisible(false)}
                    />
                  </ErrorBoundary>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-sm" style={{ color: colors.textDim }}>终端已隐藏 (按 ⌘` 显示)</p>
                  </div>
                )}
              </div>
              {/* 底部边条 - 始终显示，用于收起/展开终端 */}
              <BottomPanelBar
                terminalVisible={terminalVisible}
                onToggleTerminal={() => setTerminalVisible(!terminalVisible)}
              />
            </div>
          )}

          {/* 文件/SFTP 标签页 - 统一终端管理 + 多文件标签 */}
          {(activeTab === 'files' || activeTab === 'sftp') && (
            <div className="h-full min-w-0 flex flex-col">
              {/* 工具栏（仅在 files 标签下显示终端切换和文件标签） */}
              {activeTab === 'files' && (
                <div className="h-9 border-b flex items-center pr-2 relative" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
                  {/* 左侧布局切换按钮 */}
                  {terminalVisible && (
                    <div className="flex-shrink-0 flex items-center h-full px-2 gap-1" style={{ borderRight: `1px solid ${colors.border}` }}>
                      {/* 标签模式按钮组 */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setWorkbenchLayoutMode('tabs')
                            setIsTerminalActive(true)
                          }}
                          className={`h-7 px-2 rounded-md flex items-center gap-1 text-xs transition-colors`}
                          style={{
                            color: workbenchLayoutMode === 'tabs' && isTerminalActive ? colors.accent : colors.textSecondary,
                            backgroundColor: workbenchLayoutMode === 'tabs' && isTerminalActive ? colors.bgPrimary : 'transparent',
                            border: `1px solid ${workbenchLayoutMode === 'tabs' && isTerminalActive ? colors.border : 'transparent'}`,
                          }}
                          title="标签模式"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="4 17 10 11 4 5"></polyline>
                            <line x1="12" y1="19" x2="20" y2="19"></line>
                          </svg>
                          <span className="font-medium">终端</span>
                        </button>
                      </div>
                      
                      <button
                        onClick={() => setWorkbenchLayoutMode('split-horizontal')}
                        className={`h-7 px-2 rounded-md flex items-center gap-1 text-xs transition-colors`}
                        style={{
                          color: workbenchLayoutMode === 'split-horizontal' ? colors.accent : colors.textSecondary,
                          backgroundColor: workbenchLayoutMode === 'split-horizontal' ? colors.bgPrimary : 'transparent',
                          border: `1px solid ${workbenchLayoutMode === 'split-horizontal' ? colors.border : 'transparent'}`,
                        }}
                        title="上下分屏"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="18" height="8" rx="1"></rect>
                          <rect x="3" y="13" width="18" height="8" rx="1"></rect>
                        </svg>
                      </button>
                      
                      <button
                        onClick={() => setWorkbenchLayoutMode('split-vertical')}
                        className={`h-7 px-2 rounded-md flex items-center gap-1 text-xs transition-colors`}
                        style={{
                          color: workbenchLayoutMode === 'split-vertical' ? colors.accent : colors.textSecondary,
                          backgroundColor: workbenchLayoutMode === 'split-vertical' ? colors.bgPrimary : 'transparent',
                          border: `1px solid ${workbenchLayoutMode === 'split-vertical' ? colors.border : 'transparent'}`,
                        }}
                        title="左右分屏"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="8" height="18" rx="1"></rect>
                          <rect x="13" y="3" width="8" height="18" rx="1"></rect>
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* 文件标签区域 */}
                  <div 
                    ref={tabsScrollRef}
                    className="flex-1 h-full flex items-center px-2 gap-1 overflow-x-auto no-scrollbar"
                  >
                    {openTabs.map((tab) => {
                      const isActive = activeTabKey === tab.key
                      const isDiff = 'kind' in tab && tab.kind === 'diff'
                      return (
                        <button
                          key={tab.key}
                          data-tab-key={tab.key}
                          onClick={() => {
                            setActiveFileTab(tab.key)
                            setIsTerminalActive(false)
                            if (workbenchLayoutMode === 'tabs') {
                              setWorkbenchLayoutMode('tabs')
                            }
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setContextMenu({ x: e.clientX, y: e.clientY, tabKey: tab.key })
                          }}
                          className="group h-7 px-3 rounded-md flex items-center gap-2 text-xs max-w-[200px] flex-shrink-0 transition-colors"
                          style={{
                            color: isActive ? colors.text : colors.textSecondary,
                            backgroundColor: isActive ? colors.bgPrimary : 'transparent',
                            border: `1px solid ${isActive ? colors.border : 'transparent'}`,
                          }}
                        >
                          {isDiff && <span className="text-[10px] flex-shrink-0" title="Diff 对比">🔀</span>}
                          <span className="truncate">{tab.name}</span>
                          <span
                            onClick={(e) => {
                              e.stopPropagation()
                              closeTab(tab.key)
                            }}
                            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 flex items-center justify-center w-4 h-4 rounded-sm"
                            style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.1)' : 'transparent' }}
                          >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </span>
                        </button>
                      )
                    })}
                    {openTabs.length === 0 && (
                      <span className="text-xs px-2" style={{ color: colors.textDim }}>
                        点击左侧文件树打开文件
                      </span>
                    )}
                  </div>

                  {/* 右侧下拉菜单按钮 */}
                  {openTabs.length > 0 && (
                    <div className="relative flex-shrink-0 flex items-center pl-1 border-l" style={{ borderColor: colors.border }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDropdownOpen(!dropdownOpen)
                        }}
                        className="h-7 px-2 rounded-md flex items-center gap-1 text-xs hover:bg-white/5 transition-colors"
                        style={{ color: colors.textSecondary }}
                      >
                        <span className="font-mono text-[10px] bg-black/10 px-1 rounded">{openTabs.length}</span>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </button>
                      
                      {/* 下拉菜单面板 */}
                      {dropdownOpen && (
                        <div 
                          className="absolute top-full right-0 mt-1 w-56 rounded-md shadow-lg border py-1 z-50 max-h-80 overflow-y-auto"
                          style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}
                        >
                          <div className="px-3 py-1.5 text-[11px] uppercase font-medium tracking-wider border-b mb-1" style={{ color: colors.textDim, borderColor: colors.border }}>
                            打开的文件
                          </div>
                          {openTabs.map((tab) => (
                            <button
                              key={`menu-${tab.key}`}
                              className="w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-white/5 transition-colors"
                              style={{ color: activeTabKey === tab.key ? colors.accent : colors.text }}
                              onClick={() => {
                                setActiveFileTab(tab.key)
                                setIsTerminalActive(false)
                                setDropdownOpen(false)
                              }}
                            >
                              <span className="truncate pr-4">{tab.name}</span>
                              <span 
                                className="opacity-60 hover:opacity-100 flex-shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  closeTab(tab.key)
                                }}
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <line x1="18" y1="6" x2="6" y2="18"></line>
                                  <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 内容区域 */}
              <div className="flex-1 min-w-0 relative">
                {activeTab === 'sftp' ? (
                  <div className="absolute inset-0">
                    <SFTPWorkspace />
                  </div>
                ) : (
                  <>
                    {/* 标签模式 */}
                    {(workbenchLayoutMode === 'tabs' || !terminalVisible) && (
                      <>
                        {/* 终端标签 */}
                        {terminalVisible && isTerminalActive && (
                          <div className="absolute inset-0">
                            <ErrorBoundary>
                              <TerminalContainer 
                                keepSessionOnUnmount={true}
                                onTerminalSessionChange={handleTerminalSessionChange}
                                onCloseTerminal={() => setTerminalVisible(false)}
                              />
                            </ErrorBoundary>
                          </div>
                        )}
                        {/* 文件标签 */}
                        {(!terminalVisible || !isTerminalActive || openTabs.length > 0) && (
                          <div className="absolute inset-0">
                            <Suspense fallback={<EditorSkeleton />}>
                              <FileWorkspace />
                            </Suspense>
                          </div>
                        )}
                      </>
                    )}

                    {/* 水平分屏模式（文件在上，终端在下） */}
                    {workbenchLayoutMode === 'split-horizontal' && terminalVisible && (
                      <div className="absolute inset-0 flex flex-col">
                        <div className="flex-1 min-h-0">
                          <Suspense fallback={<EditorSkeleton />}>
                            <FileWorkspace />
                          </Suspense>
                        </div>
                        <div 
                          className="h-1 cursor-row-resize hover:bg-blue-500/30" 
                          style={{ backgroundColor: isResizingTerminal ? colors.accent : 'transparent' }}
                          onMouseDown={handleTerminalResizeStart}
                        />
                        <div style={{ height: terminalPanelSize, minHeight: 150 }}>
                          <ErrorBoundary>
                            <TerminalContainer 
                              keepSessionOnUnmount={true}
                              onTerminalSessionChange={handleTerminalSessionChange}
                              onCloseTerminal={() => setTerminalVisible(false)}
                            />
                          </ErrorBoundary>
                        </div>
                      </div>
                    )}

                    {/* 垂直分屏模式（文件在左，终端在右） */}
                    {workbenchLayoutMode === 'split-vertical' && terminalVisible && (
                      <div className="absolute inset-0 flex flex-row">
                        <div className="flex-1 min-w-0">
                          <Suspense fallback={<EditorSkeleton />}>
                            <FileWorkspace />
                          </Suspense>
                        </div>
                        <div 
                          className="w-1 cursor-col-resize hover:bg-blue-500/30" 
                          style={{ backgroundColor: isResizingTerminal ? colors.accent : 'transparent' }}
                          onMouseDown={handleTerminalResizeStart}
                        />
                        <div style={{ width: terminalPanelSize, minWidth: 250 }}>
                          <ErrorBoundary>
                            <TerminalContainer 
                              keepSessionOnUnmount={true}
                              onTerminalSessionChange={handleTerminalSessionChange}
                              onCloseTerminal={() => setTerminalVisible(false)}
                            />
                          </ErrorBoundary>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              {/* 底部边条 - 始终显示，用于收起/展开终端 */}
              <BottomPanelBar
                terminalVisible={terminalVisible}
                onToggleTerminal={() => setTerminalVisible(!terminalVisible)}
              />
            </div>
          )}

          {/* SFTP 传输面板 */}
          {activeTab === 'sftp' && (
            <div className="h-full">
              <SFTPWorkspace />
            </div>
          )}

          {/* 扩展标签页 */}
          {activeTab === 'extensions' && (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm" style={{ color: colors.textDim }}>扩展面板开发中</p>
            </div>
          )}
        </div>

        {/* 右侧：AI 对话面板 */}
        {chatVisible && (
          <>
            {/* Chat 拖拽条 */}
            <div
              className="w-1.5 h-full cursor-col-resize relative z-50 flex-shrink-0 bg-[#3c3c3c]/40"
              style={{ backgroundColor: isResizingChat ? colors.accent : undefined }}
              onMouseDown={handleChatResizeStart}
            >
              <div
                className={`absolute inset-y-0 -left-[3px] -right-[3px] ${isResizingChat ? '' : 'hover:bg-blue-500/30'} rounded-full`}
              />
            </div>
            <ErrorBoundary>
              <RightSidebar width={chatWidth} activeTerminalSessionId={activeTerminalSessionId} />
            </ErrorBoundary>
            {/* 历史面板 - 对话栏右侧展开 */}
            {showHistoryPanel && (
              <HistoryPanel width={320} />
            )}
          </>
        )}
      </div>

      {/* SSH 连接配置弹窗 */}
      <SSHConnectionModal open={sshModalOpen} onClose={() => setSshModalOpen(false)} />

      {/* 设置弹窗 */}
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 w-48 rounded-md shadow-lg border py-1"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            top: Math.min(contextMenu.y, window.innerHeight - 200),
            backgroundColor: colors.bgSecondary,
            borderColor: colors.border,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors"
            style={{ color: colors.text }}
            onClick={() => {
              closeTabsToLeft(contextMenu.tabKey)
              setContextMenu(null)
            }}
          >
            关闭左侧
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors"
            style={{ color: colors.text }}
            onClick={() => {
              closeTabsToRight(contextMenu.tabKey)
              setContextMenu(null)
            }}
          >
            关闭右侧
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors"
            style={{ color: colors.text }}
            onClick={() => {
              closeOtherTabs(contextMenu.tabKey)
              setContextMenu(null)
            }}
          >
            关闭其他
          </button>
          <div style={{ height: 1, backgroundColor: colors.border, margin: '4px 0' }} />
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors"
            style={{ color: colors.text }}
            onClick={() => {
              closeAllTabs()
              setContextMenu(null)
            }}
          >
            全部关闭
          </button>
        </div>
      )}
    </div>
  )
}
