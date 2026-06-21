import React, { useState, useCallback } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { useAiPatchStore } from '../stores/aiPatchStore'
import { useLocalFileStore } from '../stores/localFileStore'
import { useFileExplorerStore } from '../stores/fileExplorerStore'
import type { ChangeSummary, ChangeFile } from '../api/agent'
import { InlineDiff } from './InlineDiff'

// ===== 单个文件变更行（可点击展开 diff） =====
function FileChangeRow({ file, colors }: { file: ChangeFile; colors: ReturnType<typeof useThemeStore.getState>['colors'] }) {
  const [showDiff, setShowDiff] = useState(false)

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
    // Revert = 将 beforeContent 写回文件
    try {
      const localStore = useLocalFileStore.getState()
      const remoteStore = useFileExplorerStore.getState()

      if (preview.target === 'local') {
        await localStore.restoreFileContent(preview.path, preview.beforeContent)
      } else if (preview.target === 'remote' && preview.connectionId) {
        await remoteStore.restoreFileContent(preview.connectionId, preview.path, preview.beforeContent)
      }

      // 清除预览
      removePreview(preview.id)
      setShowDiff(false)
    } catch (e) {
      console.error('[Revert] 失败:', e)
    }
  }, [preview, removePreview])

  const handleAccept = useCallback(() => {
    if (!preview) return
    // Accept = 保留当前状态，清除预览记录
    removePreview(preview.id)
    setShowDiff(false)
  }, [preview, removePreview])

  const canShowDiff = file.kind === 'modify' && preview

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
              className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors hover:opacity-80"
              style={{
                backgroundColor: 'rgba(239,68,68,0.12)',
                color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.25)',
              }}
            >
              ↩ Revert
            </button>
            <button
              onClick={handleAccept}
              className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors hover:opacity-80"
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
  const [expanded, setExpanded] = useState(false)

  const totalCreated = summary.created?.length || 0
  const totalModified = summary.modified?.length || 0
  const totalDeleted = summary.deleted?.length || 0
  const totalFiles = totalCreated + totalModified + totalDeleted

  if (totalFiles === 0) return null

  const allFiles = [
    ...(summary.created || []).map(f => ({ ...f, kind: 'create' as const })),
    ...(summary.modified || []).map(f => ({ ...f, kind: 'modify' as const })),
    ...(summary.deleted || []).map(f => ({ ...f, kind: 'delete' as const })),
  ]

  // 折叠时最多显示 3 个文件
  const visibleFiles = expanded ? allFiles : allFiles.slice(0, 3)
  const hiddenCount = allFiles.length - visibleFiles.length

  return (
    <div className="mb-2 rounded-lg overflow-hidden" style={{
      border: `1px solid ${colors.border}60`,
      backgroundColor: `${colors.bgSecondary}80`,
    }}>
      {/* 头部 */}
      <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: expanded ? `1px solid ${colors.border}40` : 'none' }}>
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
        <div className="flex-1" />
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] transition-colors hover:opacity-70"
          style={{ color: colors.textDim }}
        >
          {expanded ? '收起' : `展开${hiddenCount > 0 ? ` (${hiddenCount} 更多)` : ''}`}
        </button>
      </div>

      {/* 文件列表 */}
      {expanded && (
        <div className="px-3 py-2 space-y-0.5 animate-in slide-in-from-top-1 duration-200">
          {visibleFiles.map((file, i) => (
            <FileChangeRow key={i} file={file} colors={colors} />
          ))}
          {hiddenCount > 0 && !expanded && (
            <div className="text-[10px] py-1" style={{ color: colors.textDim }}>
              还有 {hiddenCount} 个文件...
            </div>
          )}
        </div>
      )}

      {/* 描述 */}
      {summary.description && (
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
