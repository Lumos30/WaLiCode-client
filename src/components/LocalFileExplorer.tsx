import { useEffect, useState } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { useLocalFileStore, type LocalFileNode, type LocalOpenTab, isLocalDiffTab } from '../stores/localFileStore'
import { useSshAgentStore } from '../stores/sshAgentStore'

export function LocalFileExplorer() {
  const { colors } = useThemeStore()
  const {
    rootPath,
    tree,
    expandedPaths,
    selectedPath,
    loading,
    error,
    openFolder,
    toggleDirectory,
    openFile,
    setSelectedPath,
    closeFolder,
    activeTabKey,
  } = useLocalFileStore()

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: LocalFileNode | null } | null>(null)

  useEffect(() => {
    if (contextMenu) {
      const close = () => setContextMenu(null)
      document.addEventListener('click', close)
      return () => document.removeEventListener('click', close)
    }
  }, [contextMenu])

  const handleAddToChat = async (node: LocalFileNode) => {
    const store = useSshAgentStore.getState()
    if (node.directory) {
      // 目录：列出子文件
      const children = node.children || []
      const fileList = children
        .map((c) => `  ${c.directory ? '📁' : '📄'} ${c.name}`)
        .join('\n')
      store.addInputTag({
        label: `目录: ${node.name}`,
        fullContent: `本地目录: ${node.path}\n\n目录内容:\n${fileList}`,
        type: 'directory',
      })
    } else {
      // 文件：读取内容
      const tab = useLocalFileStore.getState().openTabs.find((t) => !isLocalDiffTab(t) && t.path === node.path) as LocalOpenTab | undefined
      let content = tab?.content
      if (!content) {
        // 触发文件加载
        await openFile(node.path)
        const updated = useLocalFileStore.getState().openTabs.find((t) => !isLocalDiffTab(t) && t.path === node.path) as LocalOpenTab | undefined
        content = updated?.content || ''
      }
      store.addInputTag({
        label: `文件: ${node.name}`,
        fullContent: `本地文件: ${node.path}\n\n\`\`\`\n${content}\n\`\`\``,
        type: 'file',
      })
    }
  }

  const renderTree = (nodes: LocalFileNode[], depth = 0) => {
    return nodes.map((node) => {
      const isExpanded = expandedPaths.has(node.path)
      const isSelected = selectedPath === node.path
      const isActive = !node.directory && activeTabKey === node.path

      return (
        <div key={node.path}>
          <div
            className="w-full flex items-center justify-between px-2 py-1 text-xs transition-colors group cursor-pointer"
            style={{
              paddingLeft: `${8 + depth * 14}px`,
              color: isActive || isSelected ? colors.accent : colors.textSecondary,
              backgroundColor: isActive || isSelected ? `${colors.accent}15` : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!isActive && !isSelected) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'
            }}
            onMouseLeave={(e) => {
              if (!isActive && !isSelected) e.currentTarget.style.backgroundColor = 'transparent'
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setContextMenu({ x: e.clientX, y: e.clientY, node })
            }}
            title={node.path}
          >
            <div
              className="flex items-center gap-1.5 flex-1 min-w-0"
              onClick={() => {
                if (node.directory) {
                  setSelectedPath(node.path)
                  void toggleDirectory(node.path)
                } else {
                  void openFile(node.path)
                }
              }}
            >
              {node.directory && (
                <span className="text-[10px] w-3 flex items-center justify-center" style={{ color: colors.textDim }}>
                  <svg
                    className="w-3 h-3 transition-transform"
                    style={{ transform: isExpanded ? '' : 'rotate(-90deg)' }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </span>
              )}
              {!node.directory && <span className="w-3" />}
              <svg
                className="w-4 h-4 shrink-0"
                style={{
                  color: node.directory
                    ? colors.accent
                    : isActive
                      ? colors.accent
                      : colors.textDim,
                }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                {node.directory ? (
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                ) : (
                  <>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                  </>
                )}
              </svg>
              <span className={`truncate ${isActive || isSelected ? 'font-medium' : ''} ${depth === 0 && node.directory && !node.name.startsWith('.') ? 'font-bold' : ''}`} style={depth === 0 && node.directory && !node.name.startsWith('.') ? { color: colors.text } : undefined}>{node.name}</span>
            </div>

            <button
              className="opacity-0 group-hover:opacity-100 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-black/20"
              style={{ color: colors.textDim }}
              title="添加到 AI 对话"
              onClick={(e) => {
                e.stopPropagation()
                void handleAddToChat(node)
              }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
          {node.directory && isExpanded && node.children && renderTree(node.children, depth + 1)}
        </div>
      )
    })
  }

  if (!rootPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-4 py-8">
        <svg className="w-12 h-12 opacity-30" viewBox="0 0 24 24" fill="none" stroke={colors.textDim} strokeWidth="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <p className="text-sm" style={{ color: colors.textSecondary }}>
          打开本地文件夹
        </p>
        <p className="text-xs text-center" style={{ color: colors.textDim }}>
          选择一个项目文件夹开始编码
        </p>
        <button
          onClick={() => void openFolder()}
          className="mt-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{
            backgroundColor: colors.accent,
            color: '#fff',
          }}
        >
          选择文件夹
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* 根目录标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0" style={{ borderColor: colors.border }}>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <svg className="w-3.5 h-3.5 shrink-0" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span className="text-xs font-medium truncate" style={{ color: colors.text }}>
            {rootPath.split('/').pop() || rootPath}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={async () => {
              const store = useLocalFileStore.getState()
              if (store.rootPath) {
                // 刷新根目录文件树
                await store.refreshDirectory(store.rootPath)
                // 重载当前活动标签的文件内容
                if (store.activeTabKey) {
                  const tab = store.openTabs.find((t) => t.key === store.activeTabKey)
                  if (tab) void store.reloadFileByPath(tab.path)
                }
              }
            }}
            className="w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-white/10"
            style={{ color: colors.textDim }}
            title="刷新文件树和编辑器"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
          <button
            onClick={() => void openFolder()}
            className="w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-white/10"
            style={{ color: colors.textDim }}
            title="切换文件夹"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>
          <button
            onClick={() => closeFolder()}
            className="w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-white/10"
            style={{ color: colors.textDim }}
            title="关闭文件夹"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      {/* 文件树 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <svg className="w-4 h-4 animate-spin" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span className="text-xs" style={{ color: colors.textSecondary }}>加载中...</span>
          </div>
        ) : error ? (
          <div className="px-3 py-4">
            <p className="text-xs" style={{ color: colors.red }}>{error}</p>
          </div>
        ) : (
          <div className="py-1">{renderTree(tree)}</div>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded-md shadow-lg border py-1 min-w-[140px]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 150),
            top: Math.min(contextMenu.y, window.innerHeight - 200),
            backgroundColor: colors.bgSecondary,
            borderColor: colors.border,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.node && (
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 flex items-center gap-2 transition-colors"
              style={{ color: colors.text }}
              onClick={() => {
                void handleAddToChat(contextMenu.node!)
                setContextMenu(null)
              }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              添加到 AI 对话
            </button>
          )}
        </div>
      )}
    </div>
  )
}
