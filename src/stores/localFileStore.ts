import { create } from 'zustand'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  readDir,
  readTextFile,
  writeTextFile,
  type DirEntry,
} from '@tauri-apps/plugin-fs'

/** 本地文件节点 */
export interface LocalFileNode {
  name: string
  path: string
  directory: boolean
  size: number | null
  children?: LocalFileNode[]
  /** 是否已加载过子节点 */
  loaded: boolean
}

/** 打开的文件标签 */
export interface LocalOpenTab {
  key: string
  path: string
  name: string
  content: string
  loading: boolean
  modified: boolean
  error?: string
  language: string
  /** 每次外部（AI）重载内容时递增，用于强制 Monaco Editor 刷新 */
  contentVersion?: number
}

/** 根据扩展名推断语言 */
export function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'js': return 'javascript'
    case 'jsx': return 'javascript'
    case 'ts': return 'typescript'
    case 'tsx': return 'typescript'
    case 'json': return 'json'
    case 'html': return 'html'
    case 'css': return 'css'
    case 'scss': return 'scss'
    case 'less': return 'less'
    case 'md': return 'markdown'
    case 'py': return 'python'
    case 'java': return 'java'
    case 'kt': return 'kotlin'
    case 'go': return 'go'
    case 'rs': return 'rust'
    case 'c': return 'c'
    case 'cpp': return 'cpp'
    case 'h': return 'c'
    case 'sh': return 'shell'
    case 'bash': return 'shell'
    case 'yml': return 'yaml'
    case 'yaml': return 'yaml'
    case 'xml': return 'xml'
    case 'sql': return 'sql'
    case 'vue': return 'html'
    case 'php': return 'php'
    case 'rb': return 'ruby'
    case 'swift': return 'swift'
    case 'toml': return 'ini'
    case 'ini': return 'ini'
    case 'conf': return 'ini'
    default: return 'plaintext'
  }
}

/** 忽略的目录名 */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'target', '.cache', '__pycache__', '.idea', '.vscode',
  '.gradle', '.mvn', 'venv', '.venv', 'env',
])

/** Maven/Gradle 标准 Java 源码集 scope */
const JAVA_SOURCE_SCOPES = ['main', 'test', 'integrationTest', 'it', 'e2e']

/** 忽略的文件 */
const IGNORED_FILES = new Set([
  '.DS_Store', 'Thumbs.db',
])

/**
 * 拼接路径，处理 macOS/Linux 路径
 */
function joinPath(parent: string, child: string): string {
  if (parent.endsWith('/')) return `${parent}${child}`
  return `${parent}/${child}`
}

function getPathSegments(targetPath: string): string[] {
  return targetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
}

function getPathBasename(targetPath: string): string {
  const normalized = targetPath.replace(/\\/g, '/').replace(/\/+$/g, '')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || normalized
}

function findJavaSourcePattern(segments: string[]): number {
  for (let i = 0; i <= segments.length - 3; i++) {
    if (
      segments[i] === 'src' &&
      JAVA_SOURCE_SCOPES.includes(segments[i + 1]) &&
      segments[i + 2] === 'java'
    ) {
      return i + 2
    }
  }
  return -1
}

function isInsideJavaSourcePath(dirPath: string): boolean {
  const segments = getPathSegments(dirPath)
  const javaIdx = findJavaSourcePattern(segments)
  if (javaIdx === -1) return false
  return segments.length > javaIdx + 1
}

function filterVisibleEntries(entries: DirEntry[]): DirEntry[] {
  return entries.filter((entry) => {
    if (IGNORED_FILES.has(entry.name)) return false
    if (entry.isDirectory && IGNORED_DIRS.has(entry.name)) return false
    return true
  })
}

async function readVisibleEntries(dirPath: string): Promise<DirEntry[]> {
  const entries = await readDir(dirPath)
  return filterVisibleEntries(entries)
}

interface LocalFileStore {
  rootPath: string | null
  tree: LocalFileNode[]
  expandedPaths: Set<string>
  selectedPath: string | null
  loading: boolean
  error: string | null

  openTabs: LocalOpenTab[]
  activeTabKey: string | null

  openFolder: () => Promise<void>
  readDirectory: (dirPath: string, maxDepth?: number) => Promise<LocalFileNode[]>
  toggleDirectory: (path: string) => Promise<void>
  expandDirectory: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  updateFileContent: (key: string, content: string) => void
  saveFile: (key: string) => Promise<boolean>
  setActiveTab: (key: string) => void
  closeTab: (key: string) => void
  closeAllTabs: () => void
  closeOtherTabs: (key: string) => void
  refreshDirectory: (path: string) => Promise<void>
  /** 强制重新读取当前活动标签的文件内容（AI 修改文件后刷新编辑器） */
  reloadActiveFile: () => Promise<void>
  /** 按文件路径重载指定标签内容，返回重载后的文本 */
  reloadFileByPath: (path: string) => Promise<string | null>
  /** 按文件路径恢复指定内容，并落盘保存 */
  restoreFileContent: (path: string, content: string) => Promise<boolean>
  setSelectedPath: (path: string | null) => void
  closeFolder: () => void
  restoreFolder: () => Promise<boolean>
}

const STORAGE_KEY = 'walicode-local-folder'

/** 从 localStorage 恢复上次打开的文件夹 */
function loadSavedFolder(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** 保存文件夹路径到 localStorage */
function saveFolder(path: string) {
  try {
    localStorage.setItem(STORAGE_KEY, path)
  } catch { /* ignore */ }
}

/** 清除保存的文件夹 */
function clearSavedFolder() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
}

export const useLocalFileStore = create<LocalFileStore>((set, get) => ({
  rootPath: null,
  tree: [],
  expandedPaths: new Set(),
  selectedPath: null,
  loading: false,
  error: null,
  openTabs: [],
  activeTabKey: null,

  openFolder: async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: '选择文件夹',
      })

      if (!selected || typeof selected !== 'string') return

      set({ loading: true, error: null })

      const tree = await get().readDirectory(selected, 1)

      set({
        rootPath: selected,
        tree,
        expandedPaths: new Set([selected]),
        loading: false,
        openTabs: [],
        activeTabKey: null,
        selectedPath: null,
      })
      saveFolder(selected)
    } catch (err: any) {
      set({ loading: false, error: err?.message || '打开文件夹失败' })
    }
  },

  readDirectory: async (dirPath: string, maxDepth = 1): Promise<LocalFileNode[]> => {
    const result: LocalFileNode[] = []

    try {
      const entries = await readVisibleEntries(dirPath)

      for (const entry of entries) {
        const entryPath = joinPath(dirPath, entry.name)
        if (!entry.isDirectory) {
          result.push({
            name: entry.name,
            path: entryPath,
            directory: false,
            size: null,
            loaded: false,
          })
          continue
        }

        if (isInsideJavaSourcePath(entryPath)) {
          let currentPath = entryPath
          const mergedSegments = [getPathBasename(entryPath)]

          try {
            while (true) {
              const childEntries = await readVisibleEntries(currentPath)
              const childDirs = childEntries.filter((item) => item.isDirectory)
              const childFiles = childEntries.filter((item) => !item.isDirectory)
              if (childFiles.length > 0 || childDirs.length !== 1) break

              const onlyChild = childDirs[0]
              currentPath = joinPath(currentPath, onlyChild.name)
              mergedSegments.push(onlyChild.name)
            }
          } catch {
            // 目录扫描失败时保留当前层级，避免整个树渲染中断
          }

          const node: LocalFileNode = {
            name: mergedSegments.join('.'),
            path: currentPath,
            directory: true,
            size: null,
            loaded: false,
          }

          if (maxDepth > 0) {
            try {
              node.children = await get().readDirectory(currentPath, maxDepth - 1)
              node.loaded = true
            } catch {
              node.children = []
              node.loaded = false
            }
          }

          result.push(node)
          continue
        }

        const node: LocalFileNode = {
          name: entry.name,
          path: entryPath,
          directory: true,
          size: null,
          loaded: false,
        }

        if (maxDepth > 0) {
          try {
            node.children = await get().readDirectory(entryPath, maxDepth - 1)
            node.loaded = true
          } catch {
            node.children = []
            node.loaded = false
          }
        }

        result.push(node)
      }
    } catch (err) {
      console.error('readDirectory error:', dirPath, err)
    }

    // 目录在前，文件在后
    result.sort((a, b) => {
      if (a.directory !== b.directory) return a.directory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return result
  },

  toggleDirectory: async (path: string) => {
    const expanded = new Set(get().expandedPaths)
    if (expanded.has(path)) {
      expanded.delete(path)
      set({ expandedPaths: expanded })
    } else {
      expanded.add(path)
      set({ expandedPaths: expanded })
      // 加载子目录内容
      await get().expandDirectory(path)
    }
  },

  expandDirectory: async (path: string) => {
    /**
     * 在树中找到目标目录节点并加载其 children。
     * 使用不可变更新确保 React 检测到变化。
     */
    const loadChildren = (nodes: LocalFileNode[]): LocalFileNode[] => {
      return nodes.map((node) => {
        if (node.path === path && node.directory && !node.loaded) {
          // 异步加载子节点
          get().readDirectory(path, 1).then((children) => {
            set((state) => ({
              tree: updateNodeInTree(state.tree, path, { children, loaded: true }),
            }))
          }).catch(() => {})
          return { ...node, children: [], loaded: false } // 占位，实际由上面的 set 更新
        }
        if (node.children && node.children.length > 0) {
          return { ...node, children: loadChildren(node.children) }
        }
        return node
      })
    }

    const newTree = loadChildren(get().tree)
    // 如果有变化才更新（避免不必要的渲染）
    set({ tree: newTree })
  },

  openFile: async (path: string) => {
    const key = path
    const existing = get().openTabs.find((t) => t.key === key)
    if (existing) {
      get().setActiveTab(key)
      return
    }

    const name = path.split('/').pop() || path
    const language = getLanguage(name)

    set((state) => ({
      openTabs: [...state.openTabs, {
        key,
        path,
        name,
        content: '',
        loading: true,
        modified: false,
        language,
      }],
      activeTabKey: key,
      selectedPath: path,
    }))

    try {
      const content = await readTextFile(path)
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === key ? { ...t, content, loading: false } : t
        ),
      }))
    } catch (err: any) {
      console.error('readTextFile error:', path, err)
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === key ? { ...t, loading: false, error: err?.message || '无法读取文件' } : t
        ),
      }))
    }
  },

  updateFileContent: (key, content) => {
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.key === key && t.content !== content
          ? { ...t, content, modified: true }
          : t
      ),
    }))
  },

  saveFile: async (key: string) => {
    const tab = get().openTabs.find((t) => t.key === key)
    if (!tab) return false

    try {
      await writeTextFile(tab.path, tab.content)
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === key ? { ...t, modified: false } : t
        ),
      }))
      return true
    } catch (err: any) {
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === key ? { ...t, error: err?.message || '保存失败' } : t
        ),
      }))
      return false
    }
  },

  setActiveTab: (key) => {
    const tab = get().openTabs.find((t) => t.key === key)
    set({ activeTabKey: key, selectedPath: tab?.path || null })
  },

  closeTab: (key) => {
    set((state) => {
      const tabs = state.openTabs.filter((t) => t.key !== key)
      let nextKey = state.activeTabKey
      if (state.activeTabKey === key) {
        nextKey = tabs.length ? tabs[tabs.length - 1].key : null
      }
      return { openTabs: tabs, activeTabKey: nextKey }
    })
  },

  closeAllTabs: () => set({ openTabs: [], activeTabKey: null }),

  closeOtherTabs: (key) =>
    set((state) => ({
      openTabs: state.openTabs.filter((t) => t.key === key),
      activeTabKey: key,
    })),

  refreshDirectory: async (path: string) => {
    const children = await get().readDirectory(path, 1)
    set((state) => ({
      tree: updateNodeInTree(state.tree, path, { children, loaded: true }),
    }))
  },

  reloadActiveFile: async () => {
    const { activeTabKey, openTabs } = get()
    if (!activeTabKey) return
    const tab = openTabs.find((t) => t.key === activeTabKey)
    if (!tab) return
    try {
      const content = await readTextFile(tab.path)
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === activeTabKey ? { ...t, content, loading: false, modified: false, contentVersion: (t.contentVersion ?? 0) + 1 } : t
        ),
      }))
    } catch (err: any) {
      console.error('[localFileStore] reloadActiveFile error:', tab.path, err)
    }
  },

  reloadFileByPath: async (path: string) => {
    const tab = get().openTabs.find((t) => t.path === path)
    if (!tab) return null
    try {
      const content = await readTextFile(path)
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.path === path ? { ...t, content, loading: false, modified: false, error: undefined, contentVersion: (t.contentVersion ?? 0) + 1 } : t
        ),
      }))
      return content
    } catch (err: any) {
      console.error('[localFileStore] reloadFileByPath error:', path, err)
      return null
    }
  },

  restoreFileContent: async (path: string, content: string) => {
    try {
      await writeTextFile(path, content)
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.path === path ? { ...t, content, loading: false, modified: false, error: undefined } : t
        ),
      }))
      return true
    } catch (err: any) {
      console.error('[localFileStore] restoreFileContent error:', path, err)
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.path === path ? { ...t, error: err?.message || '恢复文件失败' } : t
        ),
      }))
      return false
    }
  },

  setSelectedPath: (path) => set({ selectedPath: path }),

  closeFolder: () => {
    clearSavedFolder()
    set({
      rootPath: null,
      tree: [],
      expandedPaths: new Set(),
      selectedPath: null,
      openTabs: [],
      activeTabKey: null,
    })
  },

  restoreFolder: async (): Promise<boolean> => {
    const saved = loadSavedFolder()
    if (!saved) return false

    try {
      set({ loading: true, error: null })
      const tree = await get().readDirectory(saved, 1)
      set({
        rootPath: saved,
        tree,
        expandedPaths: new Set([saved]),
        loading: false,
      })
      return true
    } catch (err: any) {
      // 保存的路径可能不存在了，清除它
      clearSavedFolder()
      set({ loading: false, error: null })
      return false
    }
  },
}))

/**
 * 不可变更新：在树中找到指定路径的节点并合并新属性
 */
function updateNodeInTree(
  nodes: LocalFileNode[],
  targetPath: string,
  updates: Partial<LocalFileNode>,
): LocalFileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, ...updates }
    }
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, targetPath, updates) }
    }
    return node
  })
}
