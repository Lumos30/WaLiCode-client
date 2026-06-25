import { useCallback, useMemo, useState } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { useFileExplorerStore, formatFileSize, isDiffTab } from '../stores/fileExplorerStore'
import { DiffFileTab } from '../stores/fileExplorerStore'
import { useAiPatchStore } from '../stores/aiPatchStore'
import { useSshAgentStore } from '../stores/sshAgentStore'
import Editor from '@monaco-editor/react'
import { DiffEditor } from '@monaco-editor/react'

/** Diff 视图组件：左右对比 before / after */
function DiffEditorView({ activeTab }: { activeTab: DiffFileTab }) {
  const { colors, currentTheme } = useThemeStore()

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: colors.text }}>
            🔀 Diff: {activeTab.name}
          </span>
        </div>
      </div>
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

export function FileWorkspace() {
  const { colors, currentTheme } = useThemeStore()
  const { openTabs, activeTabKey, updateFileContent, saveFile, loadMoreContent, restoreFileContent } = useFileExplorerStore()
  const previews = useAiPatchStore((state) => state.previews)
  const removePreview = useAiPatchStore((state) => state.removePreview)
  const [hasSelection, setHasSelection] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [useSudo, setUseSudo] = useState(false)

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.key === activeTabKey) ?? null,
    [openTabs, activeTabKey],
  )
  // Narrowed: only non-diff file tabs (OpenFileTab)
  const fileTab = useMemo(
    () => activeTab && !isDiffTab(activeTab) ? activeTab : null,
    [activeTab],
  )
  const activePreview = useMemo(
    () => fileTab
      ? previews.find((item) => item.target === 'remote' && item.connectionId === fileTab.connectionId && item.path === fileTab.path) ?? null
      : null,
    [previews, fileTab],
  )

  // 简单的扩展名推断语言
  const getLanguage = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'js': case 'jsx': return 'javascript'
      case 'ts': case 'tsx': return 'typescript'
      case 'json': return 'json'
      case 'html': return 'html'
      case 'css': return 'css'
      case 'md': return 'markdown'
      case 'py': return 'python'
      case 'java': return 'java'
      case 'sh': case 'bash': return 'shell'
      case 'yml': case 'yaml': return 'yaml'
      case 'xml': return 'xml'
      case 'sql': return 'sql'
      default: return 'plaintext'
    }
  }

  const handleChange = useCallback((value: string | undefined) => {
    if (activeTabKey && value !== undefined) {
      updateFileContent(activeTabKey, value)
    }
  }, [activeTabKey, updateFileContent])

  const handleSave = useCallback(async () => {
    if (activeTabKey) {
      const success = await saveFile(activeTabKey, useSudo)
      if (!success) {
        if (useSudo) {
          alert('保存失败，sudo 权限也无法写入，请检查文件权限')
        } else {
          if (confirm('保存失败: Permission denied\n是否尝试使用 sudo 权限保存？')) {
            setUseSudo(true)
            // 用 sudo 重试
            const retrySuccess = await saveFile(activeTabKey, true)
            if (retrySuccess) {
              setIsEditing(false)
              setUseSudo(false)
            }
          }
        }
      } else {
        setIsEditing(false)
        setUseSudo(false)
      }
    }
  }, [activeTabKey, saveFile, useSudo])

  const handleStartEdit = () => {
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    if (fileTab?.modified) {
      if (confirm('文件已修改，确定要取消吗？')) {
        setIsEditing(false)
      }
    } else {
      setIsEditing(false)
    }
  }

  return (
    <div className="h-full flex flex-col min-w-0" style={{ backgroundColor: colors.bgTertiary }}>
      <div className="flex-1 overflow-hidden relative">
        {/* Diff Tab：使用 Monaco DiffEditor 对比 before/after */}
        {isDiffTab(activeTab) ? (
          <DiffEditorView activeTab={activeTab} />
        ) : !fileTab ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm" style={{ color: colors.textSecondary }}>暂无打开文件</p>
              <p className="text-xs mt-1" style={{ color: colors.textDim }}>从左侧文件树点击一个文件开始查看</p>
            </div>
          </div>
        ) : fileTab.loading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm" style={{ color: colors.textSecondary }}>文件加载中...</p>
          </div>
        ) : fileTab.error ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm" style={{ color: colors.red }}>{fileTab.error}</p>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {fileTab.binary && (
              <div className="text-xs px-3 py-2 shrink-0 border-b" style={{ backgroundColor: `${colors.yellow}10`, color: colors.yellow, borderColor: colors.border }}>
                当前文件疑似二进制，暂不支持在线预览。
              </div>
            )}
            {fileTab.truncated && !fileTab.binary && (
              <div className="text-xs px-3 py-2 shrink-0 border-b flex items-center justify-between" style={{ backgroundColor: `${colors.yellow}10`, color: colors.yellow, borderColor: colors.border }}>
                <span>文件过大（{formatFileSize(fileTab.content.length)}/{formatFileSize(fileTab.size ?? 0)}），当前仅展示前 {formatFileSize(fileTab.content.length)} 内容。</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => loadMoreContent(fileTab.key)}
                    disabled={fileTab.loading}
                    className="px-2 py-0.5 rounded text-[11px] transition-colors hover:scale-105"
                    style={{ backgroundColor: colors.yellow, color: '#000' }}
                  >
                    {fileTab.loading ? '加载中...' : '加载更多'}
                  </button>
                </div>
              </div>
            )}
            {/* 保存按钮和修改标记 */}
            {!fileTab.binary && (
              <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
                <div className="flex items-center gap-2">
                  {fileTab.modified && (
                    <span className="text-xs" style={{ color: colors.yellow }}>● 已修改</span>
                  )}
                  {useSudo && (
                    <span className="text-xs" style={{ color: colors.accent }}>⚡ sudo模式</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!isEditing ? (
                    <button
                      onClick={handleStartEdit}
                      className="flex items-center gap-1 px-3 py-1 rounded text-xs transition-colors"
                      style={{
                        backgroundColor: colors.accent,
                        color: '#fff',
                      }}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                      编辑
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleCancelEdit}
                        className="flex items-center gap-1 px-3 py-1 rounded text-xs transition-colors"
                        style={{
                          color: colors.textDim,
                        }}
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={!fileTab.modified}
                        className="flex items-center gap-1 px-3 py-1 rounded text-xs transition-colors"
                        style={{
                          backgroundColor: fileTab.modified ? colors.accent : 'transparent',
                          color: fileTab.modified ? '#fff' : colors.textDim,
                          cursor: fileTab.modified ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M19 21H5a2 2 0 01-2-2V7a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
                          <polyline points="17 21 17 13 7 13 7 21"/>
                          <polyline points="7 3 7 8 15 8"/>
                        </svg>
                        保存
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            {activePreview && (
              <div className="border-b px-3 py-2 text-xs shrink-0" style={{ backgroundColor: `${colors.accent}10`, borderColor: colors.border }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div style={{ color: colors.text }}>
                      AI 已修改当前远程文件，新增 {activePreview.addedLines} 行，删除 {activePreview.removedLines} 行
                    </div>
                    <div className="mt-1 truncate" style={{ color: colors.textDim }}>
                      {activePreview.path}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={async () => {
                        const success = await restoreFileContent(activePreview.connectionId!, activePreview.path, activePreview.beforeContent)
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
            {!fileTab.binary && (
              <div className="flex-1 min-h-0 relative">
                {hasSelection && isEditing && (
                  <div className="absolute top-2 right-6 z-10">
                    <button
                      onClick={() => {
                        // @ts-ignore
                        const editor = window.__activeMonacoEditor
                        if (editor) {
                          editor.getAction('add-to-ai-chat')?.run()
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded shadow-lg border transition-all hover:scale-105"
                      style={{
                        backgroundColor: colors.accent,
                        borderColor: colors.border,
                        color: '#fff',
                      }}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      <span className="text-[11px] font-medium">发送选中内容至 AI</span>
                    </button>
                  </div>
                )}
                <Editor
                  key={`${fileTab.key}:${fileTab.contentVersion ?? 0}`}
                  height="100%"
                  language={getLanguage(fileTab.name)}
                  theme={currentTheme === 'light' ? 'vs-light' : 'vs-dark'}
                  value={fileTab.content || ''}
                  path={fileTab.path}
                  onChange={(value) => {
                    // 始终注册 onChange 确保 value prop 能同步到 editor
                    if (isEditing && value !== undefined) {
                      handleChange(value)
                    }
                  }}
                  onMount={(editor) => {
                    // @ts-ignore
                    window.__activeMonacoEditor = editor

                    editor.onDidChangeCursorSelection((e) => {
                      if (!e.selection.isEmpty()) {
                        setHasSelection(true)
                      } else {
                        setHasSelection(false)
                      }
                    })

                    editor.addAction({
                      id: 'add-to-ai-chat',
                      label: '添加到 AI 对话',
                      contextMenuGroupId: '1_modification',
                      contextMenuOrder: 1,
                      run: (ed) => {
                        const selection = ed.getSelection()
                        if (!selection) return
                        const text = ed.getModel()?.getValueInRange(selection)
                        
                        const currentActiveTabKey = useFileExplorerStore.getState().activeTabKey
                        const currentActiveTab = useFileExplorerStore.getState().openTabs.find(t => t.key === currentActiveTabKey)
                        if (!currentActiveTab || isDiffTab(currentActiveTab)) return

                        if (text && text.trim()) {
                          useSshAgentStore.getState().addInputTag({
                            label: '选中文本',
                            fullContent: `文件: ${currentActiveTab.path}\n选中的代码/文本:\n\`\`\`\n${text}\n\`\`\``,
                            type: 'custom'
                          })
                        } else {
                          // 没有选中文字时，添加整个文件
                          useSshAgentStore.getState().addInputTag({
                            label: `文件: ${currentActiveTab.name}`,
                            fullContent: `文件路径: ${currentActiveTab.path}\n\n${currentActiveTab.content}`,
                            type: 'file'
                          })
                        }
                      }
                    })
                  }}
                  options={{
                    readOnly: !isEditing,
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: 'on',
                    lineNumbers: 'on',
                    renderWhitespace: 'selection',
                    padding: { top: 16 },
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
