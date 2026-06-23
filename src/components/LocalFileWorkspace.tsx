import { useCallback, useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useThemeStore } from '../stores/themeStore'
import { useLocalFileStore } from '../stores/localFileStore'
import { useAiPatchStore } from '../stores/aiPatchStore'
import { useSshAgentStore } from '../stores/sshAgentStore'

export function LocalFileWorkspace() {
  const { colors, currentTheme } = useThemeStore()
  const { openTabs, activeTabKey, updateFileContent, saveFile, setActiveTab, closeTab, restoreFileContent } = useLocalFileStore()
  const previews = useAiPatchStore((state) => state.previews)
  const removePreview = useAiPatchStore((state) => state.removePreview)
  const [hasSelection, setHasSelection] = useState(false)

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.key === activeTabKey) ?? null,
    [openTabs, activeTabKey],
  )
  const activePreview = useMemo(
    () => activeTab ? previews.find((item) => item.target === 'local' && item.path === activeTab.path) ?? null : null,
    [previews, activeTab],
  )

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (activeTabKey && value !== undefined) {
        updateFileContent(activeTabKey, value)
      }
    },
    [activeTabKey, updateFileContent],
  )

  const handleSave = useCallback(async () => {
    if (activeTabKey) {
      const success = await saveFile(activeTabKey)
      if (!success) {
        alert('保存失败，请检查文件权限')
      }
    }
  }, [activeTabKey, saveFile])

  // Monaco 编辑器键盘快捷键：Cmd/Ctrl+S 保存
  const handleEditorMount = useCallback(
    (editor: any) => {
      // @ts-ignore
      window.__activeMonacoEditor = editor

      editor.addCommand(
        // 2048 = Cmd/Ctrl modifier, 49 = 'S' key
        2048 | 49,
        () => {
          void handleSave()
        },
      )

      editor.onDidChangeCursorSelection((e: any) => {
        setHasSelection(!e.selection.isEmpty())
      })

      // 右键菜单：添加到 AI 对话
      editor.addAction({
        id: 'add-to-ai-chat',
        label: '添加到 AI 对话',
        contextMenuGroupId: '1_modification',
        contextMenuOrder: 1,
        run: (ed: any) => {
          const selection = ed.getSelection()
          if (!selection) return
          const text = ed.getModel()?.getValueInRange(selection)

          const currentTab = useLocalFileStore.getState().openTabs.find(
            (t) => t.key === useLocalFileStore.getState().activeTabKey,
          )
          if (!currentTab) return

          if (text && text.trim()) {
            useSshAgentStore.getState().addInputTag({
              label: `选中: ${currentTab.name}`,
              fullContent: `本地文件: ${currentTab.path}\n选中的代码/文本:\n\`\`\`\n${text}\n\`\`\``,
              type: 'terminal-selection',
            })
          } else {
            useSshAgentStore.getState().addInputTag({
              label: `文件: ${currentTab.name}`,
              fullContent: `本地文件: ${currentTab.path}\n\n\`\`\`\n${currentTab.content}\n\`\`\``,
              type: 'file',
            })
          }
        },
      })
    },
    [handleSave],
  )

  if (!activeTab) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: colors.bgTertiary }}>
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-20" viewBox="0 0 24 24" fill="none" stroke={colors.textDim} strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <p className="text-sm" style={{ color: colors.textSecondary }}>打开一个文件开始编辑</p>
          <p className="text-xs mt-1" style={{ color: colors.textDim }}>从左侧文件树点击文件</p>
        </div>
      </div>
    )
  }

  if (activeTab.loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: colors.bgTertiary }}>
        <p className="text-sm" style={{ color: colors.textSecondary }}>加载中...</p>
      </div>
    )
  }

  if (activeTab.error) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: colors.bgTertiary }}>
        <p className="text-sm" style={{ color: colors.red }}>{activeTab.error}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col min-w-0" style={{ backgroundColor: colors.bgTertiary }}>
      {/* 文件标签栏 */}
      <div className="h-9 border-b flex items-center px-2 flex-shrink-0" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
        <div className="flex-1 h-full flex items-center gap-1 overflow-x-auto no-scrollbar">
          {openTabs.map((tab) => {
            const isActive = activeTabKey === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="group h-7 px-3 rounded-md flex items-center gap-2 text-xs max-w-[200px] flex-shrink-0 transition-colors"
                style={{
                  color: isActive ? colors.text : colors.textSecondary,
                  backgroundColor: isActive ? colors.bgPrimary : 'transparent',
                  border: `1px solid ${isActive ? colors.border : 'transparent'}`,
                }}
              >
                {tab.modified && (
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.yellow }} />
                )}
                <span className="truncate">{tab.name}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.key)
                  }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 flex items-center justify-center w-4 h-4 rounded-sm"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs truncate" style={{ color: colors.textDim }}>{activeTab.path}</span>
          {activeTab.modified && (
            <span className="text-xs flex-shrink-0" style={{ color: colors.yellow }}>● 已修改</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasSelection && (
            <button
              onClick={() => {
                // @ts-ignore
                const editor = window.__activeMonacoEditor
                if (editor) {
                  editor.getAction('add-to-ai-chat')?.run()
                }
              }}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors"
              style={{ backgroundColor: colors.accent, color: '#fff' }}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              发送至 AI
            </button>
          )}
        </div>
      </div>

      {activePreview && (
        <div className="border-b px-3 py-2 text-xs" style={{ backgroundColor: `${colors.accent}10`, borderColor: colors.border }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div style={{ color: colors.text }}>
                AI 已修改当前文件，新增 {activePreview.addedLines} 行，删除 {activePreview.removedLines} 行
              </div>
              <div className="mt-1 truncate" style={{ color: colors.textDim }}>
                {activePreview.path}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={async () => {
                  const success = await restoreFileContent(activePreview.path, activePreview.beforeContent)
                  if (success) {
                    removePreview(activePreview.id)
                  }
                }}
                className="px-2 py-1 rounded text-[11px]"
                style={{ backgroundColor: `${colors.red}15`, color: colors.red }}
              >
                还原
              </button>
              <button
                onClick={() => removePreview(activePreview.id)}
                className="px-2 py-1 rounded text-[11px]"
                style={{ backgroundColor: colors.accent, color: '#fff' }}
              >
                接受
              </button>
            </div>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer select-none" style={{ color: colors.textSecondary }}>
              查看修改前后
            </summary>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <pre className="text-[11px] p-2 rounded overflow-auto max-h-48" style={{ backgroundColor: colors.bgPrimary, color: colors.text }}>
                {activePreview.beforeContent}
              </pre>
              <pre className="text-[11px] p-2 rounded overflow-auto max-h-48" style={{ backgroundColor: colors.bgPrimary, color: colors.text }}>
                {activePreview.afterContent}
              </pre>
            </div>
          </details>
        </div>
      )}

      {/* Monaco 编辑器 */}
      <div className="flex-1 min-h-0 relative">
        <Editor
          key={`${activeTab.key}:${activeTab.contentVersion ?? 0}`}
          height="100%"
          language={activeTab.language}
          theme={currentTheme === 'light' ? 'vs-light' : 'vs-dark'}
          value={activeTab.content}
          path={activeTab.path}
          onChange={handleChange}
          onMount={handleEditorMount}
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            padding: { top: 16 },
            tabSize: 2,
            formatOnPaste: true,
            formatOnType: true,
          }}
        />
      </div>
    </div>
  )
}
