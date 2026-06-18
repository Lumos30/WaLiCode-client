import { useState, useRef } from 'react'
import { useThemeStore } from '../stores/themeStore'
import { useFileExplorerStore, formatFileSize } from '../stores/fileExplorerStore'
import { uploadFile, createDirectory } from '../api/sshFile'
import { getBaseUrl } from '../api/request'
import { useConnectionStore } from '../stores/connectionStore'

interface LocalFileNode {
  name: string
  path: string
  webkitRelativePath: string
  file?: File
  isDirectory: boolean
  children?: LocalFileNode[]
}

interface LocalFolder {
  id: string
  name: string
  tree: LocalFileNode[]
  handle?: any
}

export function SFTPWorkspace() {
  const { colors } = useThemeStore()
  const fileExplorerStore = useFileExplorerStore()
  const { activeConnectionId, currentPathByConnection, selectedPathByConnection, refreshDirectory } = fileExplorerStore
  const { currentConnectionId } = useConnectionStore()
  
  const [folders, setFolders] = useState<LocalFolder[]>([])
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ total: number; current: number; currentFile: string } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [isDragging, setIsDragging] = useState(false)

  const connectionId = activeConnectionId || currentConnectionId
  const currentRemotePath = connectionId ? (selectedPathByConnection[connectionId] || currentPathByConnection[connectionId] || '/') : '/'

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleOpenLocalFolder = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
        
        const buildTree = async (dirHandle: any, currentPath: string): Promise<LocalFileNode> => {
          const node: LocalFileNode = {
            name: dirHandle.name,
            path: currentPath,
            webkitRelativePath: currentPath,
            isDirectory: true,
            children: []
          }
          
          for await (const [name, childHandle] of dirHandle.entries()) {
            // 跳过常见的庞大目录或隐藏目录，防止浏览器卡死
            if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue

            const childPath = currentPath ? `${currentPath}/${name}` : name
            if (childHandle.kind === 'directory') {
              node.children!.push(await buildTree(childHandle, childPath))
            } else {
              const file = await childHandle.getFile()
              node.children!.push({
                name,
                path: childPath,
                webkitRelativePath: childPath,
                isDirectory: false,
                file
              })
            }
          }
          
          node.children!.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1
            if (!a.isDirectory && b.isDirectory) return 1
            return a.name.localeCompare(b.name)
          })
          
          return node
        }

        const rootNode = await buildTree(handle, handle.name)
        
        const newFolder: LocalFolder = {
          id: Date.now().toString(),
          name: handle.name,
          tree: [rootNode],
          handle
        }
        
        setFolders(prev => [...prev, newFolder])
        setActiveFolderId(newFolder.id)
        setExpandedNodes(prev => new Set(prev).add(rootNode.path))
      } catch (e) {
        console.error(e)
      }
    } else {
      if (fileInputRef.current) {
        fileInputRef.current.click()
      }
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    // Build a tree from FileList
    const root: LocalFileNode = { name: 'root', path: '', webkitRelativePath: '', isDirectory: true, children: [] }
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const parts = file.webkitRelativePath.split('/')
      
      let currentDir = root
      let currentPath = ''
      
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j]
        const isFile = j === parts.length - 1
        currentPath = currentPath ? `${currentPath}/${part}` : part
        
        let node = currentDir.children?.find(c => c.name === part)
        if (!node) {
          node = {
            name: part,
            path: currentPath,
            webkitRelativePath: isFile ? file.webkitRelativePath : '',
            file: isFile ? file : undefined,
            isDirectory: !isFile,
            children: isFile ? undefined : []
          }
          currentDir.children?.push(node)
        }
        if (!isFile) {
          currentDir = node
        }
      }
    }
    
    // Sort directories first
    const sortTree = (node: LocalFileNode) => {
      if (node.children) {
        node.children.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1
          if (!a.isDirectory && b.isDirectory) return 1
          return a.name.localeCompare(b.name)
        })
        node.children.forEach(sortTree)
      }
    }
    sortTree(root)
    
    if (root.children && root.children.length > 0) {
      const folderNode = root.children[0]
      const newFolder: LocalFolder = {
        id: Date.now().toString(),
        name: folderNode.name,
        tree: [folderNode]
      }
      
      setFolders(prev => [...prev, newFolder])
      setActiveFolderId(newFolder.id)
      
      setExpandedNodes(prev => new Set(prev).add(folderNode.path))
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDragOverArea = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeaveArea = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDropArea = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    // 1. 处理从左侧远程目录拖拽过来的文件（下载到本地）
    try {
      const remoteData = e.dataTransfer.getData('application/json')
      if (remoteData) {
        const remoteNode = JSON.parse(remoteData)
        if (remoteNode && remoteNode.connectionId && remoteNode.path) {
          if (!activeFolderId) {
            alert('请先在右侧选择或打开一个本地文件夹')
            return
          }
          const activeFolder = folders.find(f => f.id === activeFolderId)
          if (!activeFolder?.handle) {
            alert('当前本地文件夹不支持直接写入，请使用"打开本地文件夹"重新选择目录。')
            return
          }
          
          if (remoteNode.directory) {
            alert('暂不支持直接拖拽下载整个远程文件夹，请单选文件下载')
            return
          }

          setUploading(true)
          setProgress({ total: 1, current: 0, currentFile: `正在下载: ${remoteNode.name}` })
          abortControllerRef.current = new AbortController()

          try {
            const url = `${getBaseUrl()}/api/v1/ssh/file/download?connectionId=${encodeURIComponent(remoteNode.connectionId)}&path=${encodeURIComponent(remoteNode.path)}`
            const response = await fetch(url, { signal: abortControllerRef.current.signal })
            if (!response.ok) throw new Error('下载请求失败')

            const fileHandle = await activeFolder.handle.getFileHandle(remoteNode.name, { create: true })
            const writable = await fileHandle.createWritable()
            
            // Streaming the download
            const reader = response.body?.getReader()
            if (reader) {
              const contentLength = +(response.headers.get('Content-Length') || remoteNode.size || 0)
              let receivedLength = 0
              
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                await writable.write(value)
                receivedLength += value.length
                
                if (contentLength > 0) {
                  setProgress(p => p ? { ...p, current: Math.round(receivedLength / contentLength * 100), total: 100 } : null)
                }
              }
            } else {
              await writable.write(await response.blob())
            }
            await writable.close()

            // Update the local tree manually to show the new file
            const newFile = await fileHandle.getFile()
            setFolders(prev => prev.map(f => {
              if (f.id === activeFolderId) {
                const newTree = [...f.tree]
                const existingIdx = newTree.findIndex(n => n.name === remoteNode.name)
                const newNode: LocalFileNode = {
                  name: remoteNode.name,
                  path: remoteNode.name,
                  webkitRelativePath: remoteNode.name,
                  isDirectory: false,
                  file: newFile
                }
                if (existingIdx >= 0) newTree[existingIdx] = newNode
                else newTree.push(newNode)
                
                newTree.sort((a, b) => {
                  if (a.isDirectory && !b.isDirectory) return -1
                  if (!a.isDirectory && b.isDirectory) return 1
                  return a.name.localeCompare(b.name)
                })
                return { ...f, tree: newTree }
              }
              return f
            }))

            setProgress(p => p ? { ...p, current: 1, currentFile: '下载完成' } : null)
            setTimeout(() => setProgress(null), 2000)
          } catch (error: any) {
            if (error.name === 'AbortError') {
              setProgress(p => p ? { ...p, currentFile: '已取消下载' } : null)
              setTimeout(() => setProgress(null), 2000)
            } else {
              console.error('下载失败:', error)
              alert('下载失败')
            }
          } finally {
            setUploading(false)
            abortControllerRef.current = null
          }
          return
        }
      }
    } catch (e) {
      // ignore JSON parse error, continue to normal file drop
    }

    // 2. 处理从系统外部直接拖拽过来的文件（打开为本地工作区）
    const items = e.dataTransfer.items
    if (!items || items.length === 0) return

    const root: LocalFileNode = { name: 'root', path: '', webkitRelativePath: '', isDirectory: true, children: [] }
    
    const traverseEntry = async (entry: any, currentDir: LocalFileNode, pathPrefix: string = '') => {
      const currentPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name
      
      if (entry.isFile) {
        const file = await new Promise<File>((resolve) => entry.file(resolve))
        currentDir.children!.push({
          name: entry.name,
          path: currentPath,
          webkitRelativePath: currentPath,
          file,
          isDirectory: false
        })
      } else if (entry.isDirectory) {
        const dirNode: LocalFileNode = {
          name: entry.name,
          path: currentPath,
          webkitRelativePath: '',
          isDirectory: true,
          children: []
        }
        currentDir.children!.push(dirNode)
        
        const dirReader = entry.createReader()
        const readEntries = async () => {
          const entries = await new Promise<any[]>((resolve, reject) => {
            dirReader.readEntries(resolve, reject)
          })
          if (entries.length > 0) {
            for (const child of entries) {
              await traverseEntry(child, dirNode, currentPath)
            }
            await readEntries()
          }
        }
        await readEntries()
      }
    }

    try {
      const promises = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry()
          if (entry) {
            promises.push(traverseEntry(entry, root))
          }
        }
      }
      await Promise.all(promises)

      const sortTree = (node: LocalFileNode) => {
        if (node.children) {
          node.children.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1
            if (!a.isDirectory && b.isDirectory) return 1
            return a.name.localeCompare(b.name)
          })
          node.children.forEach(sortTree)
        }
      }
      sortTree(root)

      if (root.children && root.children.length > 0) {
        let folderName = 'Dropped Files'
        let tree = root.children
        if (root.children.length === 1 && root.children[0].isDirectory) {
          folderName = root.children[0].name
          tree = [root.children[0]]
        } else {
          tree = [{
            name: folderName,
            path: 'Dropped Files',
            webkitRelativePath: '',
            isDirectory: true,
            children: root.children.map(c => {
              const updatePath = (n: LocalFileNode, prefix: string) => {
                n.path = `${prefix}/${n.path}`
                if (n.children) n.children.forEach(child => updatePath(child, prefix))
              }
              updatePath(c, 'Dropped Files')
              return c
            })
          }]
        }

        const newFolder: LocalFolder = {
          id: Date.now().toString(),
          name: folderName,
          tree: tree
        }
        
        setFolders(prev => [...prev, newFolder])
        setActiveFolderId(newFolder.id)
        setExpandedNodes(prev => new Set(prev).add(tree[0].path))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const closeFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFolders(prev => {
      const next = prev.filter(f => f.id !== id)
      if (activeFolderId === id) {
        setActiveFolderId(next.length > 0 ? next[next.length - 1].id : null)
      }
      return next
    })
  }

  const toggleExpand = (path: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const getFilesToUpload = (node: LocalFileNode, basePathToRemove: string): { file: File, relativePath: string }[] => {
    if (!node.isDirectory && node.file) {
      let relPath = node.path
      if (basePathToRemove && relPath.startsWith(basePathToRemove)) {
        relPath = relPath.slice(basePathToRemove.length)
      }
      return [{ file: node.file, relativePath: relPath }]
    }
    let list: { file: File, relativePath: string }[] = []
    if (node.children) {
      node.children.forEach(child => {
        list = list.concat(getFilesToUpload(child, basePathToRemove))
      })
    }
    return list
  }

  const handleUploadNode = async (node: LocalFileNode) => {
    if (!connectionId) {
      alert('请先选择目标服务器和目录')
      return
    }
    if (!currentRemotePath) {
      alert('无法获取当前的远程目录，请在右侧文件树中点击目标目录')
      return
    }

    const parentPathToStrip = node.path.substring(0, node.path.lastIndexOf('/') + 1)
    const filesToUpload = getFilesToUpload(node, parentPathToStrip)
    if (filesToUpload.length === 0) return

    setUploading(true)
    setProgress({ total: filesToUpload.length, current: 0, currentFile: '' })
    abortControllerRef.current = new AbortController()

    try {
      // Collect unique directories to create
      const dirsToCreate = new Set<string>()
      filesToUpload.forEach(f => {
        const parts = f.relativePath.split('/')
        if (parts.length > 1) {
          let dirPath = ''
          for (let i = 0; i < parts.length - 1; i++) {
            dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i]
            dirsToCreate.add(dirPath)
          }
        }
      })

      // Create directories sequentially
      for (const dir of dirsToCreate) {
        const remoteDirPath = currentRemotePath === '/' ? `/${dir}` : `${currentRemotePath}/${dir}`
        try {
          await createDirectory(connectionId, remoteDirPath)
        } catch (e) {
          console.warn('Directory may already exist:', remoteDirPath)
        }
      }

      // 上传文件（并发，限制同时 3 个）
      const CONCURRENCY = 3
      let uploadIdx = 0
      const workers = Array.from({ length: Math.min(CONCURRENCY, filesToUpload.length) }, () => {
        const run = async () => {
          while (uploadIdx < filesToUpload.length) {
            if (abortControllerRef.current?.signal.aborted) break
            const idx = uploadIdx++
            const { file, relativePath } = filesToUpload[idx]
            setProgress(p => p ? { ...p, current: idx + 1, currentFile: file.name } : null)
            const remoteFilePath = currentRemotePath === '/' ? `/${relativePath}` : `${currentRemotePath}/${relativePath}`
            const res = await uploadFile(connectionId, remoteFilePath, file, abortControllerRef.current?.signal)
            if (res.code === 'CANCELLED') { throw new Error('CANCELLED') }
            if (res.code !== '0000') console.error(`上传失败 ${file.name}: ${res.info}`)
          }
        }
        return run()
      })
      await Promise.all(workers)

      setProgress(p => p ? { ...p, current: filesToUpload.length, currentFile: '完成' } : null)
      setTimeout(() => setProgress(null), 2000)
      
      // Refresh left sidebar
      await refreshDirectory(connectionId, currentRemotePath)
      
    } catch (e: any) {
      if (e.message === 'CANCELLED') {
        setProgress(p => p ? { ...p, currentFile: '已取消上传' } : null)
        setTimeout(() => setProgress(null), 2000)
      } else {
        console.error(e)
        alert('上传过程中发生错误')
      }
    } finally {
      setUploading(false)
      abortControllerRef.current = null
    }
  }

  const cancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  const handleDragStart = (e: React.DragEvent, node: LocalFileNode) => {
    e.dataTransfer.setData('text/plain', node.path)
    e.dataTransfer.effectAllowed = 'copy'
    // 借用全局变量传递 node 数据
    ;(window as any).__draggedLocalNode = node
  }

  const renderTree = (nodes: LocalFileNode[], depth = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedNodes.has(node.path)
      return (
        <div key={node.path}>
          <div 
            draggable
            onDragStart={(e) => handleDragStart(e, node)}
            onDragEnd={() => { delete (window as any).__draggedLocalNode }}
            className="flex items-center justify-between py-1 px-2 hover:bg-white/5 group transition-colors cursor-grab"
            style={{ paddingLeft: `${8 + depth * 16}px` }}
          >
            <div 
              className="flex items-center gap-1.5 cursor-pointer min-w-0 flex-1"
              onClick={() => node.isDirectory ? toggleExpand(node.path) : null}
            >
              {node.isDirectory ? (
                <span className="w-4 h-4 flex items-center justify-center shrink-0" style={{ color: colors.textDim }}>
                  <svg className="w-3 h-3 transition-transform" style={{ transform: isExpanded ? '' : 'rotate(-90deg)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </span>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <svg className="w-4 h-4 shrink-0" style={{ color: node.isDirectory ? colors.accent : colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {node.isDirectory ? (
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                ) : (
                  <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></>
                )}
              </svg>
              <span className="text-xs truncate" style={{ color: colors.text }}>{node.name}</span>
              {!node.isDirectory && node.file && (
                <span className="text-[10px] ml-2" style={{ color: colors.textDim }}>
                  {formatFileSize(node.file.size)}
                </span>
              )}
            </div>
            
            <button
              className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[10px] shrink-0 ml-2 transition-opacity"
              style={{ backgroundColor: colors.accent, color: '#fff' }}
              onClick={() => handleUploadNode(node)}
              disabled={uploading}
            >
              上传到左侧目录
            </button>
          </div>
          {node.isDirectory && isExpanded && node.children && (
            <div>{renderTree(node.children, depth + 1)}</div>
          )}
        </div>
      )
    })
  }

  return (
    <div className="h-full flex flex-row min-w-0" style={{ backgroundColor: colors.bgTertiary }}>
      {/* 隐藏的 input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        className="hidden" 
        // @ts-ignore
        webkitdirectory="true" 
        directory="true"
        multiple
      />

      {/* Local Pane */}
      <div 
        className="flex-1 flex flex-col min-h-0 relative border-r"
        style={{ borderColor: colors.border }}
        onDragOver={handleDragOverArea}
        onDragLeave={handleDragLeaveArea}
        onDrop={handleDropArea}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm border-2 border-dashed rounded-lg m-2" style={{ borderColor: colors.accent }}>
            <div className="flex flex-col items-center pointer-events-none">
              <svg className="w-16 h-16 mb-4" style={{ color: colors.accent }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span className="text-xl font-medium text-white shadow-sm">将文件拖拽至此准备上传</span>
            </div>
          </div>
        )}

        <div className="h-10 border-b flex items-center justify-between px-4 shrink-0" style={{ borderColor: colors.border, backgroundColor: colors.bgSecondary }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: colors.text }}>本地文件</span>
          </div>
          <button
            onClick={handleOpenLocalFolder}
            className="px-3 py-1.5 rounded text-xs transition-colors flex items-center gap-1.5"
            style={{ backgroundColor: colors.accent, color: '#fff' }}
            disabled={uploading}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            打开本地文件夹
          </button>
        </div>

        {/* Tabs */}
        {folders.length > 0 && (
          <div className="flex items-center overflow-x-auto border-b shrink-0 bg-black/5" style={{ borderColor: colors.border }}>
            {folders.map(folder => (
              <div
                key={folder.id}
                onClick={() => setActiveFolderId(folder.id)}
                className="flex items-center gap-2 px-3 py-2 text-xs border-r cursor-pointer min-w-0 shrink-0 group transition-colors"
                style={{
                  borderColor: colors.border,
                  backgroundColor: activeFolderId === folder.id ? colors.bgTertiary : 'transparent',
                  color: activeFolderId === folder.id ? colors.accent : colors.textSecondary,
                  borderTop: `2px solid ${activeFolderId === folder.id ? colors.accent : 'transparent'}`,
                }}
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                <span className="truncate max-w-[120px]">{folder.name}</span>
                <button
                  onClick={(e) => closeFolder(folder.id, e)}
                  className={`w-4 h-4 flex items-center justify-center rounded-full hover:bg-black/10 ${activeFolderId === folder.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {folders.length > 0 && activeFolderId ? (
            <div className="py-1">
              {renderTree(folders.find(f => f.id === activeFolderId)?.tree || [])}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center">
              <svg className="w-12 h-12 mb-3 opacity-30" style={{ color: colors.textDim }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              <p className="text-sm" style={{ color: colors.textSecondary }}>暂未选择本地文件夹</p>
              <p className="text-xs mt-1" style={{ color: colors.textDim }}>拖拽文件到此或点击上方按钮选择文件夹，然后上传至左侧远程目录</p>
            </div>
          )}
        </div>

        {progress && (
          <div className="px-4 py-3 border-t text-xs flex flex-col gap-1.5 shrink-0 shadow-lg relative" style={{ borderColor: colors.border, backgroundColor: colors.bgSecondary }}>
            <div className="flex justify-between items-center" style={{ color: colors.text }}>
              <span className="font-medium">上传进度 ({progress.current}/{progress.total})</span>
              <div className="flex items-center gap-3">
                <span className="font-medium" style={{ color: colors.accent }}>{Math.round((progress.current / progress.total) * 100)}%</span>
                {progress.current < progress.total && (
                  <button 
                    onClick={cancelUpload}
                    className="hover:bg-red-500/10 text-red-500 px-2 py-0.5 rounded transition-colors"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden bg-black/10">
              <div 
                className="h-full transition-all duration-200" 
                style={{ backgroundColor: colors.accent, width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
            <div className="truncate opacity-80" style={{ color: colors.textDim }}>正在上传: {progress.currentFile}</div>
          </div>
        )}
      </div>
    </div>
  )
}
