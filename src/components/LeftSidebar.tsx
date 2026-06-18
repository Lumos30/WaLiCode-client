import { useEffect, useMemo, useState, useRef } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { useConnectionStore } from '../stores/connectionStore'
import { ConnectionStatus } from '../types'
import { SSHConnectionModal } from './SSHConnectionModal'
import { useFileExplorerStore, formatFileSize } from '../stores/fileExplorerStore'
import { useSshAgentStore } from '../stores/sshAgentStore'
import { getFileContent, createFile, createDirectory, renameFile, deleteFile, downloadFileUrl, uploadFile } from '../api/sshFile'

type TabId = 'servers' | 'files' | 'sftp' | 'extensions'

function statusColor(status: number, colors: any): string {
  switch (status) {
    case ConnectionStatus.CONNECTED: return colors.green
    case ConnectionStatus.CONNECTING: return colors.yellow
    case ConnectionStatus.FAILED: return colors.red
    default: return colors.textDim
  }
}

function statusText(status: number): string {
  switch (status) {
    case ConnectionStatus.CONNECTED: return '已连接'
    case ConnectionStatus.CONNECTING: return '连接中'
    case ConnectionStatus.FAILED: return '连接失败'
    default: return '未连接'
  }
}

interface FileNode {
  name: string
  path: string
  directory: boolean
  size: number | null
  modifiedAt: number | null
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  node: FileNode | null
  connectionId: string
  parentPath: string
}

interface DialogState {
  type: 'create-file' | 'create-directory' | 'rename' | 'delete' | null
  title: string
  node: FileNode | null
  connectionId: string
  parentPath: string
  initialValue: string
}

export function LeftSidebar({ activeTab }: { activeTab: TabId }) {
  const { colors } = useThemeStore()
  const { connections, currentConnectionId, selectConnection, fetchConnections, removeConnection, connect, disconnect, loading, error, clearError } = useConnectionStore()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const {
    activeConnectionId: activeFileConnectionId,
    rootPathByConnection,
    homePathByConnection,
    currentPathByConnection,
    selectedPathByConnection,
    childrenByConnection,
    expandedByConnection,
    loadingRootByConnection,
    loadingPathsByConnection,
    errorByConnection,
    activeTabKey,
    switchConnection,
    navigateToPath,
    toggleDirectory,
    setSelectedPath,
    openFile,
    refreshDirectory,
  } = useFileExplorerStore()

  const currentConn = connections.find((c) => c.id === currentConnectionId)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingConn, setEditingConn] = useState<{ id: string; name: string; host: string; port: number; username: string; authType: number } | null>(null)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    node: null,
    connectionId: '',
    parentPath: '',
  })

  const [dialog, setDialog] = useState<DialogState>({
    type: null,
    title: '',
    node: null,
    connectionId: '',
    parentPath: '',
    initialValue: '',
  })

  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  
  const [isRemoteDragging, setIsRemoteDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ total: number; current: number; currentFile: string } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const CONCURRENCY = 3

  const cancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  const handleDragOver = (e: React.DragEvent, node: FileNode, parentPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    const targetPath = node.directory ? node.path : parentPath
    if (dragOverPath !== targetPath) {
      setDragOverPath(targetPath)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverPath(null)
  }

  const handleDrop = async (e: React.DragEvent, node: FileNode, connectionId: string, parentPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverPath(null)

    const targetDir = node.directory ? node.path : parentPath

    // 1. 处理从 SFTPWorkspace 拖拽过来的本地文件树节点
    const draggedLocalNode = (window as any).__draggedLocalNode
    if (draggedLocalNode) {
      const getFilesToUpload = (n: any, basePathToRemove: string): { file: File, relativePath: string }[] => {
        if (!n.isDirectory && n.file) {
          let relPath = n.path
          if (basePathToRemove && relPath.startsWith(basePathToRemove)) {
            relPath = relPath.slice(basePathToRemove.length)
          }
          return [{ file: n.file, relativePath: relPath }]
        }
        let list: { file: File, relativePath: string }[] = []
        if (n.children) {
          n.children.forEach((child: any) => { list = list.concat(getFilesToUpload(child, basePathToRemove)) })
        }
        return list
      }
      
      const parentPathToStrip = draggedLocalNode.path.substring(0, draggedLocalNode.path.lastIndexOf('/') + 1)
      const filesToUpload = getFilesToUpload(draggedLocalNode, parentPathToStrip)
      
      if (filesToUpload.length > 0) {
        setUploading(true)
        abortControllerRef.current = new AbortController()
        try {
          // 并发创建目录
          const dirsToCreate = new Set<string>()
          filesToUpload.forEach(f => {
            const parts = f.relativePath.split('/')
            for (let i = 0; i < parts.length - 1; i++) {
              dirsToCreate.add(parts.slice(0, i + 1).join('/'))
            }
          })
          setProgress({ total: filesToUpload.length, current: 0, currentFile: '准备创建目录...' })
          await Promise.all([...dirsToCreate].map(d => createDirectory(connectionId, `${targetDir === '/' ? '/' : targetDir}/${d}`).catch(() => {})))

          // 并发上传
          let uploadIdx = 0
          const workers = Array.from({ length: Math.min(CONCURRENCY, filesToUpload.length) }, () => (async () => {
            while (uploadIdx < filesToUpload.length) {
              if (abortControllerRef.current?.signal.aborted) break
              const idx = uploadIdx++
              const { file, relativePath } = filesToUpload[idx]
              setProgress(p => p ? { ...p, current: idx + 1, currentFile: file.name } : null)
              const remoteFilePath = `${targetDir === '/' ? '/' : targetDir}/${relativePath}`
              const res = await uploadFile(connectionId, remoteFilePath, file, abortControllerRef.current?.signal)
              if (res.code === 'CANCELLED') throw new Error('CANCELLED')
              if (res.code !== '0000') console.error(`上传失败 ${file.name}: ${res.info}`)
            }
          })())
          await Promise.all(workers)

          setProgress(p => p ? { ...p, current: filesToUpload.length, currentFile: '完成' } : null)
          setTimeout(() => setProgress(null), 2000)
          await refreshDirectory(connectionId, targetDir)
        } catch (error: any) {
          if (error.message === 'CANCELLED') {
            setProgress(p => p ? { ...p, currentFile: '已取消上传' } : null)
            setTimeout(() => setProgress(null), 2000)
          } else {
            console.error('上传失败:', error)
            alert('上传过程中发生错误')
          }
        } finally {
          setUploading(false)
          abortControllerRef.current = null
        }
      }
      return
    }

    // 2. 处理从系统外部直接拖拽过来的文件
    const items = e.dataTransfer.items
    if (items && items.length > 0) {
      const filesToUpload: { file: File, relativePath: string }[] = []
      const dirsToCreate = new Set<string>()

      const traverseEntry = async (entry: any, pathPrefix: string = '') => {
        if (entry.isFile) {
          const file = await new Promise<File>((resolve) => entry.file(resolve))
          filesToUpload.push({ file, relativePath: `${pathPrefix}${file.name}` })
        } else if (entry.isDirectory) {
          const dirPath = `${pathPrefix}${entry.name}`
          dirsToCreate.add(dirPath)
          const dirReader = entry.createReader()
          
          const readEntries = async () => {
            const entries = await new Promise<any[]>((resolve, reject) => {
              dirReader.readEntries(resolve, reject)
            })
            if (entries.length > 0) {
              for (const child of entries) {
                await traverseEntry(child, `${dirPath}/`)
              }
              await readEntries()
            }
          }
          await readEntries()
        }
      }

      setUploading(true)
      abortControllerRef.current = new AbortController()
      try {
        const promises = []
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry()
            if (entry) {
              promises.push(traverseEntry(entry))
            }
          }
        }
        await Promise.all(promises)

        if (filesToUpload.length > 0 || dirsToCreate.size > 0) {
          setProgress({ total: filesToUpload.length, current: 0, currentFile: '准备创建目录...' })

          // 并发创建目录
          await Promise.all([...dirsToCreate].map(d => createDirectory(connectionId, `${targetDir === '/' ? '/' : targetDir}/${d}`).catch(() => {})))

          // 并发上传
          let uploadIdx = 0
          const workers = Array.from({ length: Math.min(CONCURRENCY, filesToUpload.length) }, () => (async () => {
            while (uploadIdx < filesToUpload.length) {
              if (abortControllerRef.current?.signal.aborted) break
              const idx = uploadIdx++
              const { file, relativePath } = filesToUpload[idx]
              setProgress(p => p ? { ...p, current: idx + 1, currentFile: file.name } : null)
              const remoteFilePath = `${targetDir === '/' ? '/' : targetDir}/${relativePath}`
              const res = await uploadFile(connectionId, remoteFilePath, file, abortControllerRef.current?.signal)
              if (res.code === 'CANCELLED') throw new Error('CANCELLED')
              if (res.code !== '0000') console.error(`上传失败 ${file.name}: ${res.info}`)
            }
          })())
          await Promise.all(workers)
          setProgress(p => p ? { ...p, current: filesToUpload.length, currentFile: '完成' } : null)
          setTimeout(() => setProgress(null), 2000)
          await refreshDirectory(connectionId, targetDir)
        }
      } catch (error: any) {
        if (error.message === 'CANCELLED') {
          setProgress(p => p ? { ...p, currentFile: '已取消上传' } : null)
          setTimeout(() => setProgress(null), 2000)
        } else {
          console.error('上传失败:', error)
          alert('上传过程中发生错误')
        }
      } finally {
        setUploading(false)
        abortControllerRef.current = null
      }
    } else {
      const files = e.dataTransfer.files
      if (files && files.length > 0) {
        setUploading(true)
        abortControllerRef.current = new AbortController()
        setProgress({ total: files.length, current: 0, currentFile: '准备上传...' })
        try {
          // 并发上传
          let uploadIdx = 0
          const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => (async () => {
            while (uploadIdx < files.length) {
              if (abortControllerRef.current?.signal.aborted) break
              const idx = uploadIdx++
              const file = files[idx]
              setProgress(p => p ? { ...p, current: idx, currentFile: file.name } : null)
              const remoteFilePath = `${targetDir === '/' ? '/' : targetDir}/${file.name}`
              const res = await uploadFile(connectionId, remoteFilePath, file, abortControllerRef.current?.signal)
              if (res.code === 'CANCELLED') throw new Error('CANCELLED')
              if (res.code !== '0000') console.error(`上传失败 ${file.name}: ${res.info}`)
            }
          })())
          await Promise.all(workers)
          setProgress(p => p ? { ...p, current: files.length, currentFile: '完成' } : null)
          setTimeout(() => setProgress(null), 2000)
          await refreshDirectory(connectionId, targetDir)
        } catch (error: any) {
          if (error.message === 'CANCELLED') {
            setProgress(p => p ? { ...p, currentFile: '已取消上传' } : null)
            setTimeout(() => setProgress(null), 2000)
          } else {
            console.error('上传失败:', error)
            alert('上传过程中发生错误')
          }
        } finally {
          setUploading(false)
          abortControllerRef.current = null
        }
      }
    }
  }

  const handleRemoteDragOverArea = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsRemoteDragging(true)
  }

  const handleRemoteDragLeaveArea = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsRemoteDragging(false)
  }

  const handleRemoteDropArea = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsRemoteDragging(false)

    if (!browsingConnectionId) {
      alert('请先选择目标服务器')
      return
    }

    const currentRemotePath = currentPathByConnection[browsingConnectionId] || '/'

    // We can reuse the `handleDrop` logic by faking a directory node
    handleDrop(e, { directory: true, path: currentRemotePath } as any, browsingConnectionId, currentRemotePath)
  }

  const [dialogInputValue, setDialogInputValue] = useState('')
  const dialogInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchConnections()
  }, [fetchConnections])

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDeletingId(id)
    await removeConnection(id)
    setDeletingId(null)
  }

  const handleEdit = (e: React.MouseEvent, conn: { id: string; name: string; host: string; port: number; username: string; authType: number }) => {
    e.stopPropagation()
    setEditingConn(conn)
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setEditingConn(null)
  }

  const handleToggleConnection = async (e: React.MouseEvent, conn: { id: string; status: number }) => {
    e.stopPropagation()
    setConnectingId(conn.id)
    if (conn.status === ConnectionStatus.CONNECTED) {
      await disconnect(conn.id)
    } else {
      await connect(conn.id)
    }
    setConnectingId(null)
  }

  const handleRefresh = () => {
    fetchConnections()
  }

  useEffect(() => {
    if ((activeTab === 'files' || activeTab === 'sftp') && currentConnectionId && currentConnectionId !== activeFileConnectionId) {
      switchConnection(currentConnectionId)
    }
  }, [activeTab, currentConnectionId, activeFileConnectionId, switchConnection])

  const browsingConnectionId = activeFileConnectionId || currentConnectionId
  const browsingConnection = connections.find((c) => c.id === browsingConnectionId) || null
  const currentPath = browsingConnectionId ? currentPathByConnection[browsingConnectionId] : ''
  const selectedPath = browsingConnectionId ? selectedPathByConnection[browsingConnectionId] : ''
  const homePath = browsingConnectionId ? homePathByConnection[browsingConnectionId] : ''
  const rootPath = browsingConnectionId ? rootPathByConnection[browsingConnectionId] : '/'

  const crumbs = useMemo(() => {
    if (!currentPath) return []
    if (currentPath === '/') return ['/']
    const parts = currentPath.split('/').filter(Boolean)
    const result: string[] = ['/']
    let cursor = ''
    for (const part of parts) {
      cursor += `/${part}`
      result.push(cursor)
    }
    return result
  }, [currentPath])

  const handleAddContext = async (connectionId: string, node: FileNode) => {
    const store = useSshAgentStore.getState()
    if (node.directory) {
      const children = childrenByConnection[connectionId]?.[node.path]
      let filesList = ''
      if (children && children.length > 0) {
        filesList = `\n目录内容预览:\n` + children.map((c: FileNode) => `  ${c.directory ? '📁' : '📄'} ${c.name}`).join('\n')
      }
      store.addInputTag({
        label: `目录: ${node.name}`,
        fullContent: `当前操作目录: ${node.path}${filesList}`,
        type: 'custom'
      })
    } else {
      const key = `${connectionId}:${node.path}`
      const existingTab = useFileExplorerStore.getState().openTabs.find(t => t.key === key)
      let content = existingTab?.content
      
      if (!content) {
        const res = await getFileContent(connectionId, node.path)
        if (res.code === '0000' && res.data) content = res.data.content
      }
      
      store.addInputTag({
        label: `文件: ${node.name}`,
        fullContent: `文件路径: ${node.path}\n\n${content || ''}`,
        type: 'file'
      })
    }
  }

  const handleContextMenu = (e: React.MouseEvent, node: FileNode | null, connectionId: string, parentPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      node,
      connectionId,
      parentPath,
    })
  }

  const closeContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }

  useEffect(() => {
    if (contextMenu.visible) {
      const handleClick = () => closeContextMenu()
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu.visible])

  const openDialog = (type: DialogState['type'], title: string, node: FileNode | null, connectionId: string, parentPath: string, initialValue: string = '') => {
    closeContextMenu()
    setDialogInputValue(initialValue)
    setDialog({ type, title, node, connectionId, parentPath, initialValue })
  }

  const closeDialog = () => {
    setDialog({ type: null, title: '', node: null, connectionId: '', parentPath: '', initialValue: '' })
  }

  useEffect(() => {
    if (dialog.type && dialogInputRef.current) {
      setTimeout(() => dialogInputRef.current?.focus(), 50)
    }
  }, [dialog.type])

  const handleFileAction = async (value: string, useSudo = false) => {
    if (!dialog.type) return

    try {
      let res: { code: string; info: string } | undefined

      if (dialog.type === 'create-file') {
        const filePath = dialog.parentPath === '/' ? `/${value}` : `${dialog.parentPath}/${value}`
        res = await createFile(dialog.connectionId, filePath, useSudo)
      } else if (dialog.type === 'create-directory') {
        const dirPath = dialog.parentPath === '/' ? `/${value}` : `${dialog.parentPath}/${value}`
        res = await createDirectory(dialog.connectionId, dirPath, useSudo)
      } else if (dialog.type === 'rename' && dialog.node) {
        const node = dialog.node as FileNode
        const parentPath = node.path ? (node.path.substring(0, node.path.lastIndexOf('/')) || '/') : '/'
        const newPath = parentPath === '/' ? `/${value}` : `${parentPath}/${value}`
        res = await renameFile(dialog.connectionId, node.path, newPath, useSudo)
      } else if (dialog.type === 'delete' && dialog.node) {
        const node = dialog.node as FileNode
        res = await deleteFile(dialog.connectionId, node.path, useSudo)
      }

      if (res && res.code !== '0000') {
        if (res.info && res.info.includes('Permission denied') && !useSudo) {
          if (confirm('权限不足，是否使用 sudo 重试？')) {
            await handleFileAction(value, true)
            return
          }
        }
        alert(`操作失败: ${res.info}`)
        return
      }

      // 刷新父目录
      if (dialog.type === 'create-file' || dialog.type === 'create-directory') {
        await refreshDirectory(dialog.connectionId, dialog.parentPath)
      } else if (dialog.type === 'rename' && dialog.node) {
        const node = dialog.node as FileNode
        const parentPath = node.path ? (node.path.substring(0, node.path.lastIndexOf('/')) || '/') : '/'
        await refreshDirectory(dialog.connectionId, parentPath)
      } else if (dialog.type === 'delete' && dialog.node) {
        const node = dialog.node as FileNode
        const parentPath = node.path ? (node.path.substring(0, node.path.lastIndexOf('/')) || '/') : '/'
        await refreshDirectory(dialog.connectionId, parentPath)
      }
    } catch (error) {
      console.error('文件操作失败:', error)
      alert('操作失败，请检查控制台日志')
    }

    closeDialog()
  }

  const renderContextMenu = () => {
    if (!contextMenu.visible) return null

    const node = contextMenu.node
    const isOnDirectory = !node || node.directory

    return (
      <div
        className="fixed z-50 rounded-md shadow-lg border py-1 min-w-[160px]"
        style={{
          left: Math.min(contextMenu.x, window.innerWidth - 170),
          top: Math.min(contextMenu.y, window.innerHeight - 200),
          backgroundColor: colors.bgSecondary,
          borderColor: colors.border,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {isOnDirectory && (
          <>
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 flex items-center gap-2 transition-colors"
              style={{ color: colors.text }}
              onClick={() => openDialog('create-file', '新建文件', null, contextMenu.connectionId, node?.directory ? node.path : contextMenu.parentPath)}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="11" x2="12" y2="17"></line>
                <line x1="9" y1="14" x2="15" y2="14"></line>
              </svg>
              新建文件
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 flex items-center gap-2 transition-colors"
              style={{ color: colors.text }}
              onClick={() => openDialog('create-directory', '新建文件夹', null, contextMenu.connectionId, node?.directory ? node.path : contextMenu.parentPath)}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                <line x1="12" y1="11" x2="12" y2="17"></line>
                <line x1="9" y1="14" x2="15" y2="14"></line>
              </svg>
              新建文件夹
            </button>
            <div style={{ height: 1, backgroundColor: colors.border, margin: '4px 0' }} />
          </>
        )}

        {node && (
          <>
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 flex items-center gap-2 transition-colors"
              style={{ color: colors.text }}
              onClick={() => openDialog('rename', '重命名', node, contextMenu.connectionId, '', node.name)}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              重命名
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 flex items-center gap-2 transition-colors"
              style={{ color: colors.red }}
              onClick={() => openDialog('delete', '确认删除', node, contextMenu.connectionId, '')}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              删除
            </button>
            {!node.directory && (
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 flex items-center gap-2 transition-colors"
                style={{ color: colors.text }}
                onClick={() => {
                  const url = downloadFileUrl(contextMenu.connectionId, node.path)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = node.name
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  closeContextMenu()
                }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                下载文件
              </button>
            )}
            <div style={{ height: 1, backgroundColor: colors.border, margin: '4px 0' }} />
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 flex items-center gap-2 transition-colors"
              style={{ color: colors.text }}
              onClick={() => {
                handleAddContext(contextMenu.connectionId, node)
                closeContextMenu()
              }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              添加到 AI 对话
            </button>
          </>
        )}
      </div>
    )
  }

  const renderDialog = () => {
    if (!dialog.type) return null

    const isDelete = dialog.type === 'delete'
    const node = dialog.node as FileNode

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <div
            className="rounded-lg shadow-lg border p-4 w-full max-w-sm"
            style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium mb-3" style={{ color: colors.text }}>{dialog.title}</h3>
            
            {!isDelete ? (
            <input
              ref={dialogInputRef}
              type="text"
              className="w-full px-2 py-1.5 rounded text-xs mb-4"
              style={{ backgroundColor: colors.bgPrimary, color: colors.text, border: `1px solid ${colors.border}` }}
              value={dialogInputValue}
              placeholder="请输入名称"
              onChange={(e) => setDialogInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFileAction(dialogInputValue)
                else if (e.key === 'Escape') closeDialog()
              }}
            />
            ) : (
              <p className="text-xs mb-4" style={{ color: colors.textDim }}>
                确定要删除 <span style={{ color: colors.accent, fontWeight: 500 }}>{node?.name || ''}</span> 吗？
                {node?.directory ? ' 此操作将递归删除该目录下的所有内容。' : ''}
              </p>
            )}

          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 rounded text-xs transition-colors"
              style={{ color: colors.textSecondary, backgroundColor: 'transparent' }}
              onClick={closeDialog}
            >
              取消
            </button>
            <button
              className="px-3 py-1.5 rounded text-xs transition-colors"
              style={{ color: '#ffffff', backgroundColor: isDelete ? colors.red : colors.accent }}
              onClick={() => {
                if (!isDelete && !dialogInputValue.trim()) {
                  alert('请输入名称')
                  dialogInputRef.current?.focus()
                  return
                }
                if (!isDelete) {
                  handleFileAction(dialogInputValue)
                } else if (isDelete) {
                  handleFileAction('')
                }
              }}
            >
              {isDelete ? '确认删除' : '确定'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderRemoteTree = (connectionId: string, path: string, depth = 0) => {
    const nodes = childrenByConnection[connectionId]?.[path] || []
    const expanded = expandedByConnection[connectionId] || []
    const loadingPaths = loadingPathsByConnection[connectionId] || []

    return nodes.map((node: FileNode) => {
      const isExpanded = expanded.includes(node.path)
      const isPathLoading = loadingPaths.includes(node.path)
      const childLoaded = !!childrenByConnection[connectionId]?.[node.path]
      const canExpand = node.directory
      
      const isHidden = node.name.startsWith('.')
      const isActive = !node.directory && `${connectionId}:${node.path}` === activeTabKey
      const isSelected = node.directory && selectedPath === node.path
      const hiddenColor = '#b8860b'

      return (
        <div key={`${connectionId}:${node.path}`}>
          <div
            className="w-full flex items-center justify-between px-2 py-1 text-xs transition-colors group cursor-pointer"
            style={{ 
              paddingLeft: `${8 + depth * 14}px`, 
              color: isActive || isSelected ? colors.accent : (isHidden ? hiddenColor : colors.textSecondary), 
              backgroundColor: dragOverPath === node.path ? `${colors.accent}40` : (isActive || isSelected ? `${colors.accent}15` : 'transparent'), 
              opacity: isPathLoading ? 0.7 : 1 
            }}
            onMouseEnter={(e) => { if (!isActive && !isSelected && dragOverPath !== node.path) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)' }}
            onMouseLeave={(e) => { if (!isActive && !isSelected && dragOverPath !== node.path) e.currentTarget.style.backgroundColor = 'transparent' }}
            onContextMenu={(e) => handleContextMenu(e, node, connectionId, path)}
            onDragOver={(e) => handleDragOver(e, node, path)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node, connectionId, path)}
            title={node.path}
          >
            <div className="flex items-center gap-1.5 flex-1 min-w-0" onClick={() => {
              if (node.directory) {
                setSelectedPath(connectionId, node.path)
                void toggleDirectory(connectionId, node.path)
              } else {
                void openFile(connectionId, node.path, node.name)
              }
            }}>
              {canExpand && (
                <span className="text-[10px] w-3 flex items-center justify-center" style={{ color: isHidden ? hiddenColor : colors.textDim }}>
                  {isPathLoading ? (
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 4v6h-6M1 20v-6h6" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 transition-transform" style={{ transform: isExpanded ? '' : 'rotate(-90deg)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  )}
                </span>
              )}
              <svg className="w-4 h-4 shrink-0" style={{ color: node.directory ? (isHidden ? hiddenColor : colors.accent) : (isActive ? colors.accent : (isHidden ? hiddenColor : colors.textDim)) }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {node.directory ? (
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                ) : (
                  <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></>
                )}
              </svg>
              <span className={`truncate ${isActive || isSelected ? 'font-medium' : ''}`}>{node.name}</span>
            </div>
            
            <button className="opacity-0 group-hover:opacity-100 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-black/20" style={{ color: colors.textDim }} title="添加到 AI 对话" onClick={(e) => { e.stopPropagation(); handleAddContext(connectionId, node) }}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
          {node.directory && isExpanded && childLoaded && renderRemoteTree(connectionId, node.path, depth + 1)}
        </div>
      )
    })
  }

  const tabLabels: Record<TabId, string> = {
    servers: 'SSH 服务器',
    files: '文件目录',
    sftp: 'SFTP 文件传输',
    extensions: '扩展',
  }

  return (
    <div className="flex flex-col h-full min-w-0" style={{ backgroundColor: colors.bgSecondary }}>
      <div className="h-9 flex items-center justify-between px-4 border-b flex-shrink-0" style={{ borderColor: colors.border }}>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: colors.textSecondary }}>{tabLabels[activeTab]}</span>
        {activeTab === 'servers' && (
          <button onClick={handleRefresh} className="w-5 h-5 flex items-center justify-center rounded transition-colors" style={{ color: colors.textDim }} onMouseEnter={(e) => { e.currentTarget.style.color = colors.accent }} onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim }} title="刷新连接列表">
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        )}
        {currentConn && activeTab === 'files' && (
          <span className="ml-2 text-xs font-mono truncate" style={{ color: colors.textDim }}>— {currentConn.name}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'servers' ? (
          <div className="p-2">
            {error && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 mb-2 rounded-md text-[11px]" style={{ backgroundColor: `${colors.red}15`, color: colors.red, border: `1px solid ${colors.red}30` }}>
                <span className="truncate">{error}</span>
                <button onClick={clearError} className="flex-shrink-0 opacity-60 hover:opacity-100">✕</button>
              </div>
            )}

            {loading && connections.length === 0 ? (
              <div className="flex items-center justify-center py-10 gap-2">
                <svg className="w-4 h-4 animate-spin" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                <span className="text-xs" style={{ color: colors.textSecondary }}>加载连接列表...</span>
              </div>
            ) : connections.length === 0 ? (
              <div className="text-center py-10 px-4">
                <svg className="w-12 h-12 mx-auto mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke={colors.textDim} strokeWidth="1.5">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                <p className="text-sm mb-1" style={{ color: colors.textSecondary }}>暂无 SSH 连接</p>
                <p className="text-xs" style={{ color: colors.textDim }}>点击上方按钮添加服务器</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {connections.map((conn) => {
                  const active = currentConnectionId === conn.id
                  const isDeleting = deletingId === conn.id
                  return (
                    <div key={conn.id} onClick={() => selectConnection(conn.id)} className="w-full text-left px-3 py-2.5 rounded-md transition-colors group cursor-pointer relative" style={{ backgroundColor: active ? `${colors.accent}15` : undefined, borderLeft: active ? `3px solid ${colors.accent}` : '3px solid transparent' }} onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = `${colors.textDim}08` }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(conn.status, colors) }} />
                        <span className="text-xs font-medium truncate" style={{ color: active ? colors.text : colors.textSecondary }}>{conn.name}</span>
                        <span className="text-[10px] px-1 py-0 rounded" style={{ color: statusColor(conn.status, colors), backgroundColor: `${statusColor(conn.status, colors)}15` }}>{statusText(conn.status)}</span>
                        <button onClick={(e) => handleToggleConnection(e, conn)} disabled={connectingId === conn.id} className="w-8 h-4 rounded-full relative transition-colors flex-shrink-0" style={{ backgroundColor: conn.status === ConnectionStatus.CONNECTED ? colors.green : colors.textDim + '40', opacity: connectingId === conn.id ? 0.5 : 1 }} title={conn.status === ConnectionStatus.CONNECTED ? '断开连接' : '建立连接'}>
                          <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all" style={{ left: conn.status === ConnectionStatus.CONNECTED ? '18px' : '2px' }} />
                        </button>
                        <button onClick={(e) => handleEdit(e, conn)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 w-5 h-5 flex items-center justify-center rounded transition-opacity flex-shrink-0" style={{ color: colors.textDim }} title="编辑连接">
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button onClick={(e) => handleDelete(e, conn.id)} className="ml-auto opacity-0 group-hover:opacity-60 hover:!opacity-100 w-5 h-5 flex items-center justify-center rounded transition-opacity flex-shrink-0" style={{ color: colors.textDim }} title="删除连接">
                          {isDeleting ? (
                            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M23 4v6h-6M1 20v-6h6" />
                              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <div className="text-[11px] font-mono truncate pl-4" style={{ color: colors.textDim }}>{conn.username}@{conn.host}:{conn.port}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'files' ? (
          <div 
            onContextMenu={(e) => { if (browsingConnectionId && currentPath) handleContextMenu(e, null, browsingConnectionId, currentPath) }}
            className="h-full min-h-[200px] transition-colors"
            style={{ backgroundColor: dragOverPath === currentPath ? `${colors.accent}15` : 'transparent' }}
            onDragOver={(e) => {
              if (browsingConnectionId && currentPath) {
                e.preventDefault(); e.stopPropagation();
                if (dragOverPath !== currentPath) setDragOverPath(currentPath);
              }
            }}
            onDragLeave={handleDragLeave}
            onDrop={(e) => {
              if (browsingConnectionId && currentPath) {
                handleDrop(e, { directory: true, path: currentPath } as any, browsingConnectionId, currentPath);
              }
            }}
          >
            {browsingConnection ? (
              <div className="p-2 space-y-2">
                <div>
                  <select className="w-full text-xs rounded px-2 py-1" style={{ backgroundColor: colors.bgPrimary, color: colors.text, border: `1px solid ${colors.border}` }} value={browsingConnection.id} onChange={(e) => { const id = e.target.value; selectConnection(id); void switchConnection(id) }}>
                    {connections.map((conn) => <option key={conn.id} value={conn.id}>{conn.name} ({conn.username}@{conn.host})</option>)}
                  </select>
                </div>
                <div className="text-[11px] px-1 py-1 rounded" style={{ backgroundColor: colors.bgPrimary, border: `1px solid ${colors.border}` }}>
                  <div className="flex items-center gap-1 flex-wrap">
                    <button className="px-1 rounded hover:bg-white/10" style={{ color: colors.accent }} onClick={() => void navigateToPath(browsingConnection.id, rootPath || '/')}>/</button>
                    {crumbs.filter((c) => c !== '/').map((crumb) => <button key={crumb} className="px-1 rounded hover:bg-white/10" style={{ color: colors.textSecondary }} onClick={() => void navigateToPath(browsingConnection.id, crumb)}>{crumb.split('/').pop()}</button>)}
                    {homePath && homePath !== currentPath && <button className="ml-auto px-1 rounded hover:bg-white/10" style={{ color: colors.accent }} onClick={() => void navigateToPath(browsingConnection.id, homePath)}>Home</button>}
                  </div>
                </div>
                {errorByConnection[browsingConnection.id] && (
                  <div className="text-[11px] px-2 py-1 rounded" style={{ backgroundColor: `${colors.red}20`, color: colors.red }}>{errorByConnection[browsingConnection.id]}</div>
                )}
                {loadingRootByConnection[browsingConnection.id] ? (
                  <div className="text-xs px-2 py-4 text-center" style={{ color: colors.textDim }}>目录加载中...</div>
                ) : (
                  <div className="py-1">{currentPath && renderRemoteTree(browsingConnection.id, currentPath)}</div>
                )}
              </div>
            ) : (
              <div className="text-center py-10 px-4">
                <div className="w-12 h-12 mx-auto mb-3 rounded-lg flex items-center justify-center text-sm font-bold" style={{ backgroundColor: `${colors.accent}20`, color: colors.accent }}>FILE</div>
                <p className="text-sm mb-1" style={{ color: colors.textSecondary }}>请先选择 SSH 连接</p>
                <p className="text-xs" style={{ color: colors.textDim }}>在「SSH 服务器」面板中添加并连接</p>
              </div>
            )}
          </div>
        ) : activeTab === 'sftp' ? (
          <div 
            className="h-full flex flex-col min-h-0 relative transition-colors"
            onDragOver={handleRemoteDragOverArea}
            onDragLeave={handleRemoteDragLeaveArea}
            onDrop={handleRemoteDropArea}
          >
            {isRemoteDragging && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm border-2 border-dashed rounded-lg m-2" style={{ borderColor: colors.accent }}>
                <div className="flex flex-col items-center pointer-events-none">
                  <svg className="w-12 h-12 mb-2" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  <span className="text-sm font-medium text-white shadow-sm">上传到远程目录</span>
                </div>
              </div>
            )}
            
            {browsingConnection ? (
              <div className="flex flex-col h-full">
                <div className="p-2 shrink-0 space-y-2 border-b" style={{ borderColor: colors.border }}>
                  <select className="w-full text-xs rounded px-2 py-1" style={{ backgroundColor: colors.bgPrimary, color: colors.text, border: `1px solid ${colors.border}` }} value={browsingConnection.id} onChange={(e) => { const id = e.target.value; selectConnection(id); void switchConnection(id) }}>
                    {connections.map((conn) => <option key={conn.id} value={conn.id}>{conn.name} ({conn.username}@{conn.host})</option>)}
                  </select>
                  
                  <div className="flex items-center text-xs overflow-x-auto no-scrollbar gap-1">
                    <button onClick={() => { setSelectedPath(browsingConnection.id, '/'); navigateToPath(browsingConnection.id, '/') }} className="hover:bg-white/10 px-1 rounded shrink-0" style={{ color: colors.accent }}>/</button>
                    {(currentPathByConnection[browsingConnection.id] || '/').split('/').filter(Boolean).map((part, idx, arr) => {
                      const path = '/' + arr.slice(0, idx + 1).join('/')
                      return (
                        <div key={path} className="flex items-center gap-1 shrink-0">
                          <span style={{ color: colors.textDim }}>/</span>
                          <button onClick={() => { setSelectedPath(browsingConnection.id, path); navigateToPath(browsingConnection.id, path) }} className="hover:bg-white/10 px-1 rounded" style={{ color: colors.textSecondary }}>{part}</button>
                        </div>
                      )
                    })}
                  </div>
                  <input
                    type="text"
                    placeholder="输入路径后回车跳转（如 /home/user/project）"
                    className="w-full text-xs rounded px-2 py-1"
                    style={{ backgroundColor: colors.bgPrimary, color: colors.text, border: `1px solid ${colors.border}` }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const input = e.currentTarget.value.trim()
                        if (input) {
                          const path = input.startsWith('/') ? input : '/' + input
                          navigateToPath(browsingConnection.id, path)
                          e.currentTarget.value = ''
                        }
                      }
                    }}
                  />
                </div>

                <div className="flex-1 overflow-y-auto p-1">
                  {errorByConnection[browsingConnection.id] && (
                    <div className="text-[11px] px-2 py-1 rounded mx-2 mt-1 mb-2" style={{ backgroundColor: `${colors.red}20`, color: colors.red }}>
                      {errorByConnection[browsingConnection.id]}
                    </div>
                  )}
                  {loadingRootByConnection[browsingConnection.id] ? (
                    <div className="text-xs px-2 py-4 text-center" style={{ color: colors.textDim }}>加载中...</div>
                  ) : (
                    <div className="flex flex-col">
                      {currentPathByConnection[browsingConnection.id] && currentPathByConnection[browsingConnection.id] !== '/' && (
                        <div 
                          className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 cursor-pointer rounded"
                          onClick={() => {
                            const current = currentPathByConnection[browsingConnection.id] || '/'
                            const parts = current.split('/').filter(Boolean)
                            parts.pop()
                            const parent = '/' + parts.join('/')
                            setSelectedPath(browsingConnection.id, parent)
                            navigateToPath(browsingConnection.id, parent)
                          }}
                        >
                          <svg className="w-4 h-4 shrink-0" style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 1 1 0 8h-1"/></svg>
                          <span className="text-xs" style={{ color: colors.textSecondary }}>.. (返回上级)</span>
                        </div>
                      )}
                      {(childrenByConnection[browsingConnection.id]?.[currentPathByConnection[browsingConnection.id] || '/'] || []).map(node => (
                        <div 
                          key={node.path}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/json', JSON.stringify({ ...node, connectionId: browsingConnection.id }))
                            e.dataTransfer.effectAllowed = 'copy'
                          }}
                          className="flex items-center justify-between px-2 py-1.5 hover:bg-white/5 cursor-pointer rounded group"
                          onClick={() => {
                            if (node.directory) {
                              setSelectedPath(browsingConnection.id, node.path)
                              navigateToPath(browsingConnection.id, node.path)
                            }
                          }}
                          onContextMenu={(e) => handleContextMenu(e, node, browsingConnectionId!, currentPathByConnection[browsingConnectionId!] || '/')}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <svg className="w-4 h-4 shrink-0" style={{ color: node.directory ? colors.accent : colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              {node.directory ? (
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                              ) : (
                                <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></>
                              )}
                            </svg>
                            <span className="text-xs truncate" style={{ color: colors.text }}>{node.name}</span>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            {!node.directory && node.size !== null && (
                              <span className="text-[10px]" style={{ color: colors.textDim }}>{formatFileSize(node.size)}</span>
                            )}
                            {!node.directory && (
                              <button
                                className="opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded text-[10px] transition-opacity"
                                style={{ backgroundColor: colors.bgPrimary, color: colors.textSecondary, border: `1px solid ${colors.border}` }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const url = downloadFileUrl(browsingConnection.id, node.path)
                                  const a = document.createElement('a')
                                  a.href = url
                                  a.download = node.name
                                  document.body.appendChild(a)
                                  a.click()
                                  document.body.removeChild(a)
                                }}
                              >
                                下载
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {uploading && progress && (
                  <div className="px-2 py-3 border-t text-xs flex flex-col gap-1.5 shrink-0 shadow-lg relative" style={{ borderColor: colors.border, backgroundColor: colors.bgSecondary }}>
                    <div className="flex justify-between items-center" style={{ color: colors.text }}>
                      <span className="font-medium">上传进度 ({progress.current}/{progress.total})</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium" style={{ color: colors.accent }}>{Math.round((progress.current / progress.total) * 100)}%</span>
                        {progress.current < progress.total && (
                          <button 
                            onClick={cancelUpload}
                            className="hover:bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded transition-colors text-[10px]"
                          >
                            取消
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden bg-black/10">
                      <div 
                        className="h-full transition-all duration-200" 
                        style={{ backgroundColor: colors.accent, width: `${(progress.current / progress.total) * 100}%` }}
                      />
                    </div>
                    <div className="truncate opacity-80" style={{ color: colors.textDim }}>正在上传: {progress.currentFile}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-10 px-4">
                <div className="w-12 h-12 mx-auto mb-3 rounded-lg flex items-center justify-center text-sm font-bold" style={{ backgroundColor: `${colors.accent}20`, color: colors.accent }}>SFTP</div>
                <p className="text-sm mb-1" style={{ color: colors.textSecondary }}>请先选择 SSH 连接</p>
                <p className="text-xs" style={{ color: colors.textDim }}>在「SSH 服务器」面板中添加并连接</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-10 px-4">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke={colors.textDim} strokeWidth="1.5">
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
            <p className="text-sm" style={{ color: colors.textSecondary }}>扩展</p>
            <p className="text-xs mt-1" style={{ color: colors.textDim }}>敬请期待</p>
          </div>
        )}
      </div>

      <SSHConnectionModal open={modalOpen} onClose={handleCloseModal} editingConnection={editingConn} />
      {renderContextMenu()}
      {renderDialog()}
    </div>
  )
}
