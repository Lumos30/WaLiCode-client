import React, { useState, useCallback } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { useAiPatchStore } from '../stores/aiPatchStore'
import { useLocalFileStore } from '../stores/localFileStore'
import { useFileExplorerStore } from '../stores/fileExplorerStore'
import type { ChangeSummary, ChangeFile } from '../api/agent'
import { InlineDiff } from './InlineDiff'

// ===== 单个文件变更行状态 =====
type FileStatus = 'pending' | 'accepted' | 'reverted'

// ===== 单个文件变更行（可点击展开 diff） =====
function FileChangeRow({ file, colors, onStatusChange }: {
  file: ChangeFile
  colors: ReturnType<typeof useThemeStore.getState>['colors']
  onStatusChange?: (path: string, status: FileStatus) => void
}) {
  const [showDiff, setShowDiff] = useState(false)
  const [status, setStatus] = useState<FileStatus>('pending')
  const [reverting, setReverting] = useState(false)

  const icon = file.kind === 'create' ? '✨' : file.kind === 'delete' ? '🗑️' : '✏️'
  const label = file.kind === 'create' ? '新增' : file.kind === 'delete' ? '删除' : '修改'
  const labelColor = file.kind === 'create' ? '#22c55e' : file.kind === 'delete' ? '#ef4444' : '#f59e0b'

  // 路径太长时只显示文件名
  const sep = file.path.lastIndexOf('/')
  const dir = sep >= 0 ? file.path.substring(0, sep + 1) : ''
  const name = sep >= 0 ? file.path.substring(sep + 1) : file.path

  // 从 aiPatchStore 获取预览数据
  const preview = useAiPatchStore(state => state.getPreviewForFile('local', file.path) || state.getPreviewForFile('remote', file.path))
  const removePreview = useAiPatchStore(state => state.removePreview)

  const handleRevert = useCallback(async () => {
    if (!preview) return
    setReverting(true)
    try {
      const localStore = useLocalFileStore.getState()
      const remoteStore = useFileExplorerStore.getState()

      if (preview.target === 'local') {
        await localStore.restoreFileContent(preview.path, preview.beforeContent)
      } else if (preview.target === 'remote' && preview.connectionId) {
        await remoteStore.restoreFileContent(preview.connectionId, preview.path, preview.beforeContent)
      }

      removePreview(preview.id)
      setStatus('reverted')
      setShowDiff(false)
      onStatusChange?.(file.path, 'reverted')
    } catch (e) {
      console.error('[Revert] 失败:', e)
    } finally {
      setReverting(false)
    }
  }, [preview, removePreview, file.path, onStatusChange])

  const handleAccept = useCallback(() => {
    if (!preview) return
    removePreview(preview.id)
    setStatus('accepted')
    setShowDiff(false)
    onStatusChange?.(file.path, 'accepted')
  }, [preview, removePreview, file.path, onStatusChange])

  const canShowDiff = file.kind === 'modify' && preview

  // 已接受态
  if (status === 'accepted') {
    return (
      <div className="flex items-center gap-1.5 py-0.5 text-[11px] font-mono" style={{ opacity: 0.5 }}>
        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="#22c55e">
          <circle cx="12" cy="12" r="10" />
          <polyline points="8 12 11 15 16 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ color: colors.textDim }}>{dir}</span>
        <span style={{ color: colors.textSecondary }}>{name}</span>
        <span style={{ color: '#22c55e', fontSize: '10px' }}>已接受</span>
      </div>
    )
  }

  // 已回退态
  if (status === 'reverted') {
    return (
      <div className="flex items-center gap-1.5 py-0.5 text-[11px] font-mono" style={{ opacity: 0.5 }}>
        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
        <span style={{ color: colors.textDim }}>{dir}</span>
        <span style={{ color: colors.textSecondary }}>{name}</span>
        <span style={{ color: '#ef4444', fontSize: '10px' }}>已回退</span>
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={() => canShowDiff && setShowDiff(!showDiff)}
        className="w-full flex items-center gap-1.5 py-0.5 text-[11px] font-mono text-left"
        style={{
          color: colors.textSecondary,
          cursor: canShowDiff ? 'pointer' : 'default',
        }}
      >
        <span className="flex-shrink-0">{icon}</span>
        <span className="flex-shrink-0" style={{ color: labelColor, fontSize: '10px' }}>{label}</span>
        <span style={{ color: colors.textDim }}>{dir}</span>
        <span style={{ color: colors.text }}>{name}</span>
        {file.addedLines && file.addedLines > 0 && (
          <span style={{ color: '#22c55e', fontSize: '10px' }}>+{file.addedLines}</span>
        )}
        {file.removedLines && file.removedLines > 0 && (
          <span style={{ color: '#ef4444', fontSize: '10px' }}>-{file.removedLines}</span>
        )}
        {canShowDiff && (
          <span className="ml-auto flex-shrink-0 text-[9px]" style={{ color: colors.textDim }}>
            {showDiff ? '收起' : 'Diff'}
          </span>
        )}
      </button>
      {canShowDiff && showDiff && preview && (
        <div className="mt-1 mb-1 animate-in slide-in-from-top-1 duration-200">
          <InlineDiff beforeContent={preview.beforeContent} afterContent={preview.afterContent} maxHeight={250} />
          <div className="flex items-center justify-end gap-1.5 mt-1">
            <button
              onClick={handleRevert}
              disabled={reverting}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors hover:opacity-80 disabled:opacity-50"
              style={{
                backgroundColor: 'rgba(239,68,68,0.12)',
                color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.25)',
              }}
            >
              {reverting ? (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : '↩'}
              Revert
            </button>
            <button
              onClick={handleAccept}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors hover:opacity-80"
              style={{
                backgroundColor: 'rgba(34,197,94,0.12)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.25)',
              }}
            >
              ✓ Accept
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ===== SessionSummaryCard 主组件 =====
export const SessionSummaryCard = React.memo(function SessionSummaryCard({ summary }: { summary: ChangeSummary }) {
  const { colors } = useThemeStore()
  const [expanded, setExpanded] = useState(true) // 默认展开，提升产物可见性
  const [bulkProcessing, setBulkProcessing] = useState(false)

  // 追踪每个文件的处理状态
  const [fileStatuses, setFileStatuses] = useState<Record<string, FileStatus>>({})

  // 从 aiPatchStore 获取当前所有预览
  const previews = useAiPatchStore(s => s.previews)
  const removePreview = useAiPatchStore(s => s.removePreview)

  const totalCreated = summary.created?.length || 0
  const totalModified = summary.modified?.length || 0
  const totalDeleted = summary.deleted?.length || 0
  const totalFiles = totalCreated + totalModified + totalDeleted

  const allFiles = [
    ...(summary.created || []).map(f => ({ ...f, kind: 'create' as const })),
    ...(summary.modified || []).map(f => ({ ...f, kind: 'modify' as const })),
    ...(summary.deleted || []).map(f => ({ ...f, kind: 'delete' as const })),
  ]

  // 计算待处理文件数（未 accepted/reverted 且有 preview 的）
  const pendingCount = totalFiles === 0 ? 0 : allFiles.filter(f => !fileStatuses[f.path] || fileStatuses[f.path] === 'pending').length
  const processedCount = totalFiles - pendingCount

  // ⚠️ Hook 规则：useCallback 必须在条件 return 之前调用
  // Accept All
  const handleAcceptAll = useCallback(async () => {
    if (totalFiles === 0) return
    setBulkProcessing(true)
    try {
      for (const file of allFiles) {
        const preview = previews.find(p => p.path === file.path)
        if (preview && (!fileStatuses[file.path] || fileStatuses[file.path] === 'pending')) {
          removePreview(preview.id)
          setFileStatuses(prev => ({ ...prev, [file.path]: 'accepted' }))
        }
      }
    } finally {
      setBulkProcessing(false)
    }
  }, [totalFiles, allFiles, previews, removePreview, fileStatuses])

  // Revert All
  const handleRevertAll = useCallback(async () => {
    if (totalFiles === 0) return
    setBulkProcessing(true)
    try {
      const localStore = useLocalFileStore.getState()
      const remoteStore = useFileExplorerStore.getState()

      for (const file of allFiles) {
        if (fileStatuses[file.path] && fileStatuses[file.path] !== 'pending') continue
        const preview = previews.find(p => p.path === file.path)
        if (!preview) continue

        try {
          if (preview.target === 'local') {
            await localStore.restoreFileContent(preview.path, preview.beforeContent)
          } else if (preview.target === 'remote' && preview.connectionId) {
            await remoteStore.restoreFileContent(preview.connectionId, preview.path, preview.beforeContent)
          }
          removePreview(preview.id)
          setFileStatuses(prev => ({ ...prev, [file.path]: 'reverted' }))
        } catch (e) {
          console.error(`[RevertAll] ${file.path} 失败:`, e)
        }
      }
    } finally {
      setBulkProcessing(false)
    }
  }, [totalFiles, allFiles, previews, removePreview, fileStatuses])

  const handleFileStatusChange = useCallback((path: string, status: FileStatus) => {
    setFileStatuses(prev => ({ ...prev, [path]: status }))
  }, [])

  // ⚠️ Hook 规则：所有 Hook 必须在条件 return 之前调用
  // totalFiles 为 0 时返回 null，但 Hook 数量必须与上一次渲染一致
  if (totalFiles === 0) return null

  // 全部已处理 → 简化显示
  const allProcessed = pendingCount === 0 && processedCount > 0

  return (
    <div className="mb-2 rounded-lg overflow-hidden" style={{
      border: `1px solid ${allProcessed ? `${colors.border}30` : `${colors.accent}30`}`,
      backgroundColor: allProcessed ? `${colors.bgSecondary}40` : `${colors.bgSecondary}80`,
    }}>
      {/* 头部 */}
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap" style={{ borderBottom: expanded ? `1px solid ${colors.border}40` : 'none' }}>
        {/* 标题图标 */}
        <svg className="w-4 h-4 flex-shrink-0" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>

        <div className="flex items-center gap-1.5">
          {/* 统计徽章 */}
          {totalCreated > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{
              backgroundColor: 'rgba(34,197,94,0.15)', color: '#22c55e',
            }}>
              +{totalCreated} 新增
            </span>
          )}
          {totalModified > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{
              backgroundColor: 'rgba(245,158,11,0.15)', color: '#f59e0b',
            }}>
              ~{totalModified} 修改
            </span>
          )}
          {totalDeleted > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{
              backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444',
            }}>
              -{totalDeleted} 删除
            </span>
          )}
        </div>

        {/* 进度指示 */}
        {processedCount > 0 && (
          <span className="text-[10px] tabular-nums" style={{ color: colors.textDim }}>
            {processedCount}/{totalFiles} 已处理
          </span>
        )}

        <div className="flex-1" />
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] transition-colors hover:opacity-70 flex items-center gap-1"
          style={{ color: colors.textDim }}
        >
          {expanded ? '收起' : '展开'}
          <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* 文件列表 */}
      {expanded && (
        <div className="px-3 py-2 space-y-0.5 animate-in slide-in-from-top-1 duration-200">
          {allFiles.map((file, i) => (
            <FileChangeRow key={i} file={file} colors={colors} onStatusChange={handleFileStatusChange} />
          ))}
        </div>
      )}

      {/* 底部操作栏：批量 Accept/Revert + 描述 */}
      {!allProcessed && pendingCount > 0 && (
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderTop: `1px solid ${colors.border}30` }}
        >
          {summary.description && (
            <span className="text-[10px] flex-1 truncate" style={{ color: colors.textDim }}>
              {summary.description}
            </span>
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleRevertAll}
              disabled={bulkProcessing}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-all hover:opacity-80 disabled:opacity-50"
              style={{
                backgroundColor: 'rgba(239,68,68,0.10)',
                color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.25)',
              }}
            >
              {bulkProcessing ? (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
              )}
              Revert All
            </button>
            <button
              onClick={handleAcceptAll}
              disabled={bulkProcessing}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-all hover:opacity-80 disabled:opacity-50"
              style={{
                backgroundColor: 'rgba(34,197,94,0.10)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.25)',
              }}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Accept All
            </button>
          </div>
        </div>
      )}

      {/* 全部处理完 → 简洁提示 */}
      {allProcessed && (
        <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ borderTop: `1px solid ${colors.border}20` }}>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#22c55e">
            <circle cx="12" cy="12" r="10" />
            <polyline points="8 12 11 15 16 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px]" style={{ color: colors.textDim }}>所有变更已处理</span>
        </div>
      )}

      {/* 描述（未全部处理时显示） */}
      {summary.description && !allProcessed && pendingCount === totalFiles && (
        <div className="px-3 py-1.5 text-[11px]" style={{
          color: colors.textDim,
          borderTop: `1px solid ${colors.border}30`,
        }}>
          {summary.description}
        </div>
      )}
    </div>
  )
}, (prev, next) => {
  return prev.summary === next.summary
})
