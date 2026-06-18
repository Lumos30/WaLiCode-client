import { create } from 'zustand'
import { getFileContent, getFileTree, saveFileContent, getFileContentChunk } from '../api/sshFile'

/** 格式化文件大小为可读字符串 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export interface FileNode {
  name: string
  path: string
  directory: boolean
  size: number | null
  modifiedAt: number | null
}

export interface OpenFileTab {
  key: string
  connectionId: string
  path: string
  name: string
  content: string
  loading: boolean
  binary: boolean
  truncated: boolean
  error?: string
  modified?: boolean
  size?: number
}

interface FileExplorerStore {
  activeConnectionId: string | null
  rootPathByConnection: Record<string, string>
  homePathByConnection: Record<string, string>
  currentPathByConnection: Record<string, string>
  selectedPathByConnection: Record<string, string>
  childrenByConnection: Record<string, Record<string, FileNode[]>>
  expandedByConnection: Record<string, string[]>
  loadingPathsByConnection: Record<string, string[]>
  loadingRootByConnection: Record<string, boolean>
  errorByConnection: Record<string, string | null>

  openTabs: OpenFileTab[]
  activeTabKey: string | null

  /** 追加读取大文件的后续分片 */
  loadMoreContent: (key: string) => Promise<void>

  switchConnection: (connectionId: string) => Promise<void>
  navigateToPath: (connectionId: string, path: string) => Promise<void>
  toggleDirectory: (connectionId: string, path: string) => Promise<void>
  refreshCurrentPath: (connectionId: string) => Promise<void>
  refreshDirectory: (connectionId: string, path: string) => Promise<void>
  setSelectedPath: (connectionId: string, path: string) => void

  openFile: (connectionId: string, path: string, name: string) => Promise<void>
  updateFileContent: (key: string, content: string) => void
  saveFile: (key: string, useSudo?: boolean) => Promise<boolean>
  setActiveTab: (key: string) => void
  closeTab: (key: string) => void
  closeTabsToLeft: (key: string) => void
  closeTabsToRight: (key: string) => void
  closeOtherTabs: (key: string) => void
  closeAllTabs: () => void
}

function listIncludes(list: string[] | undefined, target: string): boolean {
  return !!list?.includes(target)
}

function listAdd(list: string[] | undefined, target: string): string[] {
  const safe = list ?? []
  if (safe.includes(target)) return safe
  return [...safe, target]
}

function listRemove(list: string[] | undefined, target: string): string[] {
  return (list ?? []).filter((item) => item !== target)
}

function tabKeyOf(connectionId: string, path: string): string {
  return `${connectionId}:${path}`
}

export const useFileExplorerStore = create<FileExplorerStore>((set, get) => ({
  activeConnectionId: null,
  rootPathByConnection: {},
  homePathByConnection: {},
  currentPathByConnection: {},
  selectedPathByConnection: {},
  childrenByConnection: {},
  expandedByConnection: {},
  loadingPathsByConnection: {},
  loadingRootByConnection: {},
  errorByConnection: {},

  openTabs: [],
  activeTabKey: null,

  switchConnection: async (connectionId) => {
    set((state) => ({ activeConnectionId: connectionId, errorByConnection: { ...state.errorByConnection, [connectionId]: null } }))
    const currentPath = get().currentPathByConnection[connectionId]
    await get().navigateToPath(connectionId, currentPath || '')
  },

  navigateToPath: async (connectionId, path) => {
    if (get().loadingRootByConnection[connectionId]) {
      return
    }

    set((state) => ({
      loadingRootByConnection: { ...state.loadingRootByConnection, [connectionId]: true },
      loadingPathsByConnection: {
        ...state.loadingPathsByConnection,
        [connectionId]: listAdd(state.loadingPathsByConnection[connectionId], path || '__home__'),
      },
      errorByConnection: { ...state.errorByConnection, [connectionId]: null },
    }))

    const res = await getFileTree(connectionId, path)
    if (res.code !== '0000' || !res.data) {
      set((state) => ({
        loadingRootByConnection: { ...state.loadingRootByConnection, [connectionId]: false },
        loadingPathsByConnection: {
          ...state.loadingPathsByConnection,
          [connectionId]: listRemove(state.loadingPathsByConnection[connectionId], path || '__home__'),
        },
        errorByConnection: { ...state.errorByConnection, [connectionId]: res.info || '读取目录失败' },
      }))
      return
    }

    const data = res.data
    set((state) => {
      const connectionChildren = { ...(state.childrenByConnection[connectionId] || {}) }
      connectionChildren[data.currentPath] = data.items

      return {
        rootPathByConnection: { ...state.rootPathByConnection, [connectionId]: data.rootPath || '/' },
        homePathByConnection: { ...state.homePathByConnection, [connectionId]: data.homePath || '/' },
        currentPathByConnection: { ...state.currentPathByConnection, [connectionId]: data.currentPath || '/' },
        selectedPathByConnection: { ...state.selectedPathByConnection, [connectionId]: state.selectedPathByConnection[connectionId] || data.currentPath || '/' },
        childrenByConnection: { ...state.childrenByConnection, [connectionId]: connectionChildren },
        expandedByConnection: {
          ...state.expandedByConnection,
          [connectionId]: listAdd(state.expandedByConnection[connectionId], data.currentPath || '/'),
        },
        loadingRootByConnection: { ...state.loadingRootByConnection, [connectionId]: false },
        loadingPathsByConnection: {
          ...state.loadingPathsByConnection,
          [connectionId]: listRemove(state.loadingPathsByConnection[connectionId], path || '__home__'),
        },
      }
    })
  },

  toggleDirectory: async (connectionId, path) => {
    const loadingPaths = get().loadingPathsByConnection[connectionId] || []
    if (loadingPaths.includes(path)) {
      return
    }

    const expanded = get().expandedByConnection[connectionId] || []
    const isExpanded = expanded.includes(path)
    if (isExpanded) {
      set((state) => ({
        expandedByConnection: {
          ...state.expandedByConnection,
          [connectionId]: listRemove(state.expandedByConnection[connectionId], path),
        },
      }))
      return
    }

    set((state) => ({
      expandedByConnection: {
        ...state.expandedByConnection,
        [connectionId]: listAdd(state.expandedByConnection[connectionId], path),
      },
    }))

    const hasLoaded = !!get().childrenByConnection[connectionId]?.[path]
    if (!hasLoaded) {
      set((state) => ({
        loadingPathsByConnection: {
          ...state.loadingPathsByConnection,
          [connectionId]: listAdd(state.loadingPathsByConnection[connectionId], path),
        },
      }))

      const res = await getFileTree(connectionId, path)
      if (res.code === '0000' && res.data) {
        set((state) => {
          const connectionChildren = { ...(state.childrenByConnection[connectionId] || {}) }
          connectionChildren[path] = res.data!.items
          return {
            childrenByConnection: { ...state.childrenByConnection, [connectionId]: connectionChildren },
            loadingPathsByConnection: {
              ...state.loadingPathsByConnection,
              [connectionId]: listRemove(state.loadingPathsByConnection[connectionId], path),
            },
          }
        })
      } else {
        set((state) => ({
          loadingPathsByConnection: {
            ...state.loadingPathsByConnection,
            [connectionId]: listRemove(state.loadingPathsByConnection[connectionId], path),
          },
          errorByConnection: { ...state.errorByConnection, [connectionId]: res.info || '读取目录失败' },
        }))
      }
    }
  },

  refreshCurrentPath: async (connectionId) => {
    const currentPath = get().currentPathByConnection[connectionId] || ''
    await get().navigateToPath(connectionId, currentPath)
  },

  refreshDirectory: async (connectionId, path) => {
    await get().navigateToPath(connectionId, path)
  },

  setSelectedPath: (connectionId, path) => {
    set((state) => ({
      selectedPathByConnection: {
        ...state.selectedPathByConnection,
        [connectionId]: path,
      },
    }))
  },

  openFile: async (connectionId, path, name) => {
    const key = tabKeyOf(connectionId, path)
    const existing = get().openTabs.find((tab) => tab.key === key)
    if (existing) {
      get().setActiveTab(key)
      return
    }

    set((state) => ({
      openTabs: [...state.openTabs, {
        key,
        connectionId,
        path,
        name,
        content: '',
        loading: true,
        binary: false,
        truncated: false,
        modified: false,
        size: undefined,
      }],
    }))
    get().setActiveTab(key)

    const res = await getFileContent(connectionId, path)
    if (res.code !== '0000' || !res.data) {
      set((state) => ({
        openTabs: state.openTabs.map((tab) => tab.key === key
          ? { ...tab, loading: false, error: res.info || '读取文件失败' }
          : tab),
      }))
      return
    }

    set((state) => ({
      openTabs: state.openTabs.map((tab) => tab.key === key
        ? {
            ...tab,
            loading: false,
            content: res.data!.content || '',
            binary: !!res.data!.binary,
            truncated: !!res.data!.truncated,
            modified: false,
            size: res.data!.size,
            error: undefined,
          }
        : tab),
    }))
  },


  loadMoreContent: async (key) => {
    const tab = get().openTabs.find(t => t.key === key)
    if (!tab || tab.binary || !tab.truncated) return

    set((state) => ({
      openTabs: state.openTabs.map((t) => t.key === key ? { ...t, loading: true } : t)
    }))

    const CHUNK = 256 * 1024
    const currentOffset = tab.content.length
    const res = await getFileContentChunk(tab.connectionId, tab.path, currentOffset, CHUNK)
    if (res.code === '0000' && res.data) {
      set((state) => ({
        openTabs: state.openTabs.map((t) => t.key === key
          ? {
              ...t,
              loading: false,
              content: t.content + (res.data!.content || ''),
              truncated: !!res.data!.truncated,
            }
          : t)
      }))
    } else {
      set((state) => ({
        openTabs: state.openTabs.map((t) => t.key === key ? { ...t, loading: false } : t)
      }))
    }
  },

  updateFileContent: (key, content) => {
    set((state) => ({
      openTabs: state.openTabs.map((tab) => {
        if (tab.key === key && tab.content !== content) {
          return { ...tab, content, modified: true }
        }
        return tab
      })
    }))
  },

  saveFile: async (key, useSudo = false) => {
    const tab = get().openTabs.find(t => t.key === key)
    if (!tab) return false

    set((state) => ({
      openTabs: state.openTabs.map((t) => t.key === key ? { ...t, loading: true } : t)
    }))

    const res = await saveFileContent(tab.connectionId, tab.path, tab.content, useSudo)
    
    if (res.code === '0000') {
      set((state) => ({
        openTabs: state.openTabs.map((t) => t.key === key ? { ...t, loading: false, modified: false } : t)
      }))
      return true
    } else {
      set((state) => ({
        openTabs: state.openTabs.map((t) => t.key === key ? { ...t, loading: false, error: res.info || '保存失败' } : t)
      }))
      return false
    }
  },

  setActiveTab: (key) => {
    set((state) => {
      // 提取 connectionId 和 path
      const colonIdx = key.indexOf(':')
      if (colonIdx > 0) {
        const connectionId = key.substring(0, colonIdx)
        const path = key.substring(colonIdx + 1)
        
        // 自动展开该文件的所有父级目录
        const parts = path.split('/').filter(Boolean)
        const toExpand: string[] = ['/']
        let cursor = ''
        for (let i = 0; i < parts.length - 1; i++) { // 不包含文件名本身
          cursor += `/${parts[i]}`
          toExpand.push(cursor)
        }
        
        const currentExpanded = state.expandedByConnection[connectionId] || []
        const newExpanded = [...new Set([...currentExpanded, ...toExpand])]
        
        return { 
          activeTabKey: key,
          expandedByConnection: {
            ...state.expandedByConnection,
            [connectionId]: newExpanded
          }
        }
      }
      return { activeTabKey: key }
    })
  },

  closeTab: (key) => {
    set((state) => {
      const tabs = state.openTabs.filter((tab) => tab.key !== key)
      let nextActiveKey = state.activeTabKey
      if (state.activeTabKey === key) {
        nextActiveKey = tabs.length ? tabs[tabs.length - 1].key : null
      }
      return { openTabs: tabs, activeTabKey: nextActiveKey }
    })
  },

  closeTabsToLeft: (key) => {
    set((state) => {
      const idx = state.openTabs.findIndex(tab => tab.key === key)
      if (idx <= 0) return state
      const tabs = state.openTabs.slice(idx)
      let nextActiveKey = state.activeTabKey
      if (state.activeTabKey && !tabs.find(tab => tab.key === state.activeTabKey)) {
        nextActiveKey = key
      }
      return { openTabs: tabs, activeTabKey: nextActiveKey }
    })
  },

  closeTabsToRight: (key) => {
    set((state) => {
      const idx = state.openTabs.findIndex(tab => tab.key === key)
      if (idx < 0 || idx === state.openTabs.length - 1) return state
      const tabs = state.openTabs.slice(0, idx + 1)
      let nextActiveKey = state.activeTabKey
      if (state.activeTabKey && !tabs.find(tab => tab.key === state.activeTabKey)) {
        nextActiveKey = key
      }
      return { openTabs: tabs, activeTabKey: nextActiveKey }
    })
  },

  closeOtherTabs: (key) => {
    set((state) => ({
      openTabs: state.openTabs.filter(tab => tab.key === key),
      activeTabKey: key
    }))
  },

  closeAllTabs: () => {
    set(() => ({ openTabs: [], activeTabKey: null }))
  },
}))

export function isPathLoading(store: FileExplorerStore, connectionId: string, path: string): boolean {
  return listIncludes(store.loadingPathsByConnection[connectionId], path)
}
