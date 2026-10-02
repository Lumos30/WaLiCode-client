import { useCallback, useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import { DiffEditor } from '@monaco-editor/react'
import { useThemeStore } from '../stores/themeStore'
import { useLocalFileStore, isLocalDiffTab, type LocalDiffTab, type LocalOpenTab } from '../stores/localFileStore'
import { canSafelyRevertAiPatch, useAiPatchStore } from '../stores/aiPatchStore'
import { useSshAgentStore } from '../stores/sshAgentStore'
import '../editor/configureMonaco'

/** Diff 视图组件：左右对比 before / after（本地文件） */
function LocalDiffEditorView({ activeTab, onAccept, onRestore }: { activeTab: LocalDiffTab; onAccept: () => void; onRestore: () => void }) {
  const { colors, currentTheme } = useThemeStore()
  const preview = useAiPatchStore((state) => state.previews.find((p) => p.id === activeTab.previewId))
  const canRestore = preview ? canSafelyRevertAiPatch(preview) : false
  const openSourceFile = useLocalFileStore((s) => s.openFile)

  // 点击文件名打开源文件（切换到普通编辑标签页）
  const handleOpenSource = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!preview) return
    await openSourceFile(preview.path)
  }, [preview, openSourceFile])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: colors.text }}>
            🔀 Diff:{' '}
          </span>
          {/* 可点击的文件名 — 跳转到源文件 */}
          <span
            onClick={handleOpenSource}
            className="text-xs font-medium underline cursor-pointer hover:opacity-70 transition-opacity"
            style={{ color: colors.accent }}
            title={`打开源文件: ${activeTab.path}`}
          >
            {activeTab.name}
          </span>
          <span className="text-[10px] font-mono" style={{ color: '#22c55e' }}>+{activeTab.addedLines}</span>
          <span className="text-[10px] font-mono" style={{ color: '#ef4444' }}>-{activeTab.removedLines}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px]" style={{ color: colors.textDim }}>{activeTab.path}</span>
          {preview && (
            <div className="flex items-center gap-2">
              <button
                onClick={onRestore}
                disabled={!canRestore}
                className="px-2 py-1 rounded text-[11px]"
                style={{ backgroundColor: `${colors.red}15`, color: colors.red }}
              >
                {canRestore ? '还原' : '无法安全还原'}
              </button>
              <button
                onClick={onAccept}
                className="px-2 py-1 rounded text-[11px]"
                style={{ backgroundColor: colors.accent, color: '#fff' }}
              >
                接受
              </button>
            </div>
          )}
        </div>
      </div>
      {preview && !canRestore && (
        <div className="px-3 py-1 text-[10px]" style={{ backgroundColor: `${colors.yellow}10`, color: colors.yellow }}>
          修改前内容未捕获，此 Diff 仅供查看，不能安全还原。
        </div>
      )}
      <div className="flex-1 min-h-0">
        <DiffEditor
          height="100%"
          language={activeTab.language}
          theme={currentTheme === 'light' ? 'vs-light' : 'vs-dark'}
          original={activeTab.beforeContent}
          modified={activeTab.afterContent}
          options={{
            readOnly: true,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            renderSideBySide: true,
          }}
        />
      </div>
    </div>
  )
}

export function LocalFileWorkspace() {
  const { colors, currentTheme } = useThemeStore()
  const { openTabs, activeTabKey, updateFileContent, saveFile, setActiveTab, closeTab, restoreFileContent } = useLocalFileStore()
  const removePreview = useAiPatchStore((state) => state.removePreview)
  const [hasSelection, setHasSelection] = useState(false)

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.key === activeTabKey) ?? null,
    [openTabs, activeTabKey],
  )

  const isDiffTab = isLocalDiffTab(activeTab)
  const fileTab = isDiffTab ? null : (activeTab as LocalOpenTab | null)
  const diffTab = isDiffTab ? (activeTab as LocalDiffTab) : null

  // Diff Tab 接受/还原回调 — 必须在条件分支前调用（hooks 规则）
  const handleAcceptDiff = useCallback(() => {
    if (!diffTab) return
    removePreview(diffTab.previewId)
    closeTab(diffTab.key)
  }, [diffTab, removePreview, closeTab])

  const handleRestoreDiff = useCallback(async () => {
    if (!diffTab) return
    const preview = useAiPatchStore.getState().previews.find((p) => p.id === diffTab.previewId)
    if (!preview || !canSafelyRevertAiPatch(preview)) return
    const success = await restoreFileContent(preview.path, preview.beforeContent)
    if (success) {
      removePreview(diffTab.previewId)
      closeTab(diffTab.key)
    }
  }, [diffTab, restoreFileContent, removePreview, closeTab])

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
            (t) => !isLocalDiffTab(t) && t.key === useLocalFileStore.getState().activeTabKey,
          ) as LocalOpenTab | undefined
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

  // ── 标签栏（共用） ──
  const tabBar = (
    <div className="h-9 border-b flex items-center px-2 flex-shrink-0" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
      <div className="flex-1 h-full flex items-center gap-1 overflow-x-auto no-scrollbar">
        {openTabs.map((tab) => {
          const isActive = activeTabKey === tab.key
          const isDiff = isLocalDiffTab(tab)
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
              {isDiff && <span className="text-[10px] flex-shrink-0" title="Diff 对比">🔀</span>}
              {!isDiff && tab.modified && (
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.yellow }} />
              )}
              <span className="truncate">{tab.name}</span>
              <span
                onClick={(e) => { e.stopPropagation(); closeTab(tab.key) }}
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
  )

  // ── 渲染分支 ──
  // 所有 hooks 已在上层调用完毕，以下只做条件渲染

  // 1. Diff Tab
  if (isDiffTab && activeTab) {
    return (
      <div className="h-full flex flex-col min-w-0" style={{ backgroundColor: colors.bgTertiary }}>
        {tabBar}
        <LocalDiffEditorView activeTab={activeTab} onAccept={handleAcceptDiff} onRestore={handleRestoreDiff} />
      </div>
    )
  }

  // 2. 无活动 tab
  if (!fileTab) {
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

  // 3. 加载中
  if (fileTab.loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: colors.bgTertiary }}>
        <p className="text-sm" style={{ color: colors.textSecondary }}>加载中...</p>
      </div>
    )
  }

  // 4. 错误
  if (fileTab.error) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: colors.bgTertiary }}>
        <p className="text-sm" style={{ color: colors.red }}>{fileTab.error}</p>
      </div>
    )
  }

  // 5. 正常文件编辑
  return (
    <div className="h-full flex flex-col min-w-0" style={{ backgroundColor: colors.bgTertiary }}>
      {tabBar}

      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs truncate" style={{ color: colors.textDim }}>{fileTab.path}</span>
          {fileTab.modified && (
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

      {/* Monaco 编辑器 */}
      <div className="flex-1 min-h-0 relative">
        <Editor
          key={`${fileTab.key}:${fileTab.contentVersion ?? 0}`}
          height="100%"
          language={fileTab.language}
          theme={currentTheme === 'light' ? 'vs-light' : 'vs-dark'}
          value={fileTab.content}
          path={fileTab.path}
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
