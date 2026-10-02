import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import {
  readDir,
  readTextFile,
  writeTextFile,
  type DirEntry,
} from '@tauri-apps/plugin-fs'
import { useAiPatchStore } from './aiPatchStore'

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

/** Diff 标签页：用于在编辑器中对比 AI 修改前后的内容（本地文件） */
export interface LocalDiffTab {
  key: string
  /** 标记为 diff 类型 */
  kind: 'diff'
  /** 关联的 AiPatchPreview id */
  previewId: string
  path: string
  name: string
  language: string
  /** 修改前的原始内容 */
  beforeContent: string
  /** 修改后的内容 */
  afterContent: string
  /** 新增行数 */
  addedLines: number
  /** 删除行数 */
  removedLines: number
}

export type LocalAnyTab = LocalOpenTab | LocalDiffTab

export function isLocalDiffTab(tab: LocalAnyTab | null | undefined): tab is LocalDiffTab {
  return !!tab && (tab as LocalDiffTab).kind === 'diff'
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

/**
 * Windows 本地工作区的路径比较。历史会话保存的是目录引用而不是目录权限，
 * 因此恢复时必须确认用户在原生选择器中再次选择了同一个根目录。
 */
export function isSameLocalWorkspacePath(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false
  const normalize = (value: string) => value
    .replace(/[\\/]+/g, '\\')
    .replace(/\\+$/, '')
    .toLocaleLowerCase()
  return normalize(left) === normalize(right)
}

interface LocalFileStore {
  rootPath: string | null
  /** 原生目录选择器签发的临时工作区授权标识。 */
  workspaceId: string | null
  tree: LocalFileNode[]
  expandedPaths: Set<string>
  selectedPath: string | null
  loading: boolean
  error: string | null

  openTabs: LocalAnyTab[]
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
  /** 读取文件内容（不打开 tab），用于 AI 变更后获取 afterContent */
  readFileContent: (path: string) => Promise<string | null>
  /** 按文件路径恢复指定内容，并落盘保存 */
  restoreFileContent: (path: string, content: string) => Promise<boolean>
  setSelectedPath: (path: string | null) => void
  closeFolder: () => void
  restoreFolder: () => Promise<boolean>
  /**
   * 为历史会话重新选择它绑定的项目目录。不会接受其它目录替代原会话目标。
   * 返回 true 仅表示已拿到该目录的新原生授权并完成文件树加载。
   */
  restoreBoundFolder: (expectedRootPath: string) => Promise<boolean>
  /** 打开本地文件的 Diff 标签页 */
  openDiffTab: (previewId: string) => void
  /** 关闭本地文件的 Diff 标签页 */
  closeDiffTab: (previewId: string) => void
  /** 展开文件树到指定路径的目录（确保文件在树中可见） */
  expandPathTo: (filePath: string) => Promise<void>
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
  workspaceId: null,
  tree: [],
  expandedPaths: new Set(),
  selectedPath: null,
  loading: false,
  error: null,
  openTabs: [],
  activeTabKey: null,

  openFolder: async () => {
    let selectedWorkspaceId: string | null = null
    try {
      const selected = await invoke<{ workspaceId: string; rootPath: string } | null>('select_local_workspace')
      if (!selected) return
      selectedWorkspaceId = selected.workspaceId

      set({ loading: true, error: null })

      const tree = await get().readDirectory(selected.rootPath, 1)

      const previousWorkspaceId = get().workspaceId

      set({
        rootPath: selected.rootPath,
        workspaceId: selected.workspaceId,
        tree,
        expandedPaths: new Set([selected.rootPath]),
        loading: false,
        openTabs: [],
        activeTabKey: null,
        selectedPath: null,
      })
      if (previousWorkspaceId && previousWorkspaceId !== selected.workspaceId) {
        void invoke('revoke_local_workspace', { workspaceId: previousWorkspaceId }).catch(() => {})
      }
      saveFolder(selected.rootPath)
    } catch (err: any) {
      if (selectedWorkspaceId) {
        void invoke('revoke_local_workspace', { workspaceId: selectedWorkspaceId }).catch(() => {})
      }
      const message = err instanceof Error ? err.message : String(err || '打开文件夹失败')
      set({
        rootPath: null,
        workspaceId: null,
        tree: [],
        expandedPaths: new Set(),
        loading: false,
        error: message,
      })
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
      console.error('readDirectory error:', err instanceof Error ? err.name : 'unknown')
      throw err
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
    const node = findNodeInTree(get().tree, path)
    if (!node || !node.directory || node.loaded) return

    // A caller such as expandPathTo awaits this operation before it selects a
    // file.  Do not resolve early and leave React with an empty placeholder
    // subtree: that race made nested folders intermittently appear empty.
    const children = await get().readDirectory(path, 1)
    set((state) => ({
      tree: updateNodeInTree(state.tree, path, { children, loaded: true }),
    }))
  },

  openFile: async (path: string) => {
    const key = path
    const existing = get().openTabs.find((t) => t.key === key)
    if (existing) {
      // 文件已打开：激活 tab 并定位到文件树
      set({ activeTabKey: key, selectedPath: path })
      // 展开文件树到文件所在目录
      await get().expandPathTo(path)
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
    // 展开文件树到文件所在目录
    await get().expandPathTo(path)

    try {
      const content = await readTextFile(path)
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === key ? { ...t, content, loading: false } : t
        ),
      }))
    } catch (err: any) {
      console.error('readTextFile error:', err instanceof Error ? err.name : 'unknown')
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
        !isLocalDiffTab(t) && t.key === key && t.content !== content
          ? { ...t, content, modified: true }
          : t
      ),
    }))
  },

  saveFile: async (key: string) => {
    const tab = get().openTabs.find((t) => !isLocalDiffTab(t) && t.key === key) as LocalOpenTab | undefined
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
    const rootPath = get().rootPath
    set((state) => ({
      // The workspace root is represented by `tree` itself, rather than by a
      // LocalFileNode. Updating it through updateNodeInTree is therefore a
      // no-op and made the visible root stale after Agent-created files.
      tree: rootPath && path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        === rootPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        ? children
        : updateNodeInTree(state.tree, path, { children, loaded: true }),
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
          t.key === activeTabKey ? { ...t, content, loading: false, modified: false, contentVersion: ((t as LocalOpenTab).contentVersion ?? 0) + 1 } : t
        ),
      }))
    } catch (err: any) {
      console.error('[localFileStore] reloadActiveFile error:', err instanceof Error ? err.name : 'unknown')
    }
  },

  reloadFileByPath: async (path: string) => {
    const tab = get().openTabs.find((t) => t.path === path)
    if (!tab) return null
    try {
      const content = await readTextFile(path)
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.path === path ? { ...t, content, loading: false, modified: false, error: undefined, contentVersion: ((t as LocalOpenTab).contentVersion ?? 0) + 1 } : t
        ),
      }))
      return content
    } catch (err: any) {
      console.error('[localFileStore] reloadFileByPath error:', err instanceof Error ? err.name : 'unknown')
      return null
    }
  },

  readFileContent: async (path: string) => {
    try {
      const content = await readTextFile(path)
      return content
    } catch (err: any) {
      console.error('[localFileStore] readFileContent error:', err instanceof Error ? err.name : 'unknown')
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
      console.error('[localFileStore] restoreFileContent error:', err instanceof Error ? err.name : 'unknown')
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
    const workspaceId = get().workspaceId
    if (workspaceId) {
      void invoke('revoke_local_workspace', { workspaceId }).catch(() => {})
    }
    clearSavedFolder()
    set({
      rootPath: null,
      workspaceId: null,
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
      // A persisted path is not authority. Native dialog selection grants the
      // filesystem scope for this app session; startup must never restore it.
      clearSavedFolder()
      set({ loading: false, error: null })
      return false
    } catch (err: any) {
      // 保存的路径可能不存在了，清除它
      clearSavedFolder()
      set({ loading: false, error: null })
      return false
    }
  },

  restoreBoundFolder: async (expectedRootPath: string): Promise<boolean> => {
    const current = get()
    if (isSameLocalWorkspacePath(current.rootPath, expectedRootPath) && current.workspaceId) {
      return true
    }

    let selectedWorkspaceId: string | null = null
    try {
      const selected = await invoke<{ workspaceId: string; rootPath: string } | null>('select_local_workspace')
      if (!selected) return false
      selectedWorkspaceId = selected.workspaceId

      if (!isSameLocalWorkspacePath(selected.rootPath, expectedRootPath)) {
        void invoke('revoke_local_workspace', { workspaceId: selected.workspaceId }).catch(() => {})
        set({
          loading: false,
          error: '所选文件夹与该历史会话绑定的项目不一致；未恢复本地文件访问。',
        })
        return false
      }

      set({ loading: true, error: null })
      const tree = await get().readDirectory(selected.rootPath, 1)
      const previousWorkspaceId = get().workspaceId
      set({
        rootPath: selected.rootPath,
        workspaceId: selected.workspaceId,
        tree,
        expandedPaths: new Set([selected.rootPath]),
        selectedPath: null,
        openTabs: [],
        activeTabKey: null,
        loading: false,
      })
      if (previousWorkspaceId && previousWorkspaceId !== selected.workspaceId) {
        void invoke('revoke_local_workspace', { workspaceId: previousWorkspaceId }).catch(() => {})
      }
      saveFolder(selected.rootPath)
      return true
    } catch (err: any) {
      if (selectedWorkspaceId) {
        void invoke('revoke_local_workspace', { workspaceId: selectedWorkspaceId }).catch(() => {})
      }
      const message = err instanceof Error ? err.message : String(err || '恢复会话项目失败')
      set({ loading: false, error: message })
      return false
    }
  },

  /** 打开本地文件 Diff 标签页：通过 AiPatchPreview id 查找 preview，创建 LocalDiffTab */
  openDiffTab: (previewId) => {
    const preview = useAiPatchStore.getState().previews.find(p => p.id === previewId)
    if (!preview) return

    const key = `diff:${previewId}`
    const existing = get().openTabs.find(t => t.key === key)
    if (existing) {
      get().setActiveTab(key)
      return
    }

    const sep = preview.path.lastIndexOf('/')
    const name = sep >= 0 ? preview.path.substring(sep + 1) : preview.path
    const language = getLanguage(name)

    const newTab: LocalDiffTab = {
      kind: 'diff',
      key,
      previewId: preview.id,
      path: preview.path,
      name,
      language,
      beforeContent: preview.beforeContent,
      afterContent: preview.afterContent,
      addedLines: preview.addedLines,
      removedLines: preview.removedLines,
    }

    set((state) => ({ openTabs: [...state.openTabs, newTab] }))
    get().setActiveTab(key)
  },

  /** 关闭本地文件 Diff 标签页 */
  closeDiffTab: (previewId) => {
    const key = `diff:${previewId}`
    get().closeTab(key)
  },

  /** 展开文件树到指定路径的目录层级（确保文件在树中可见并被选中） */
  expandPathTo: async (filePath: string) => {
    const { rootPath, expandedPaths } = get()
    if (!rootPath) return

    // 从根目录开始，逐级展开到文件所在目录
    const normalized = filePath.replace(/\\/g, '/')
    const segments = normalized.replace(rootPath + '/', '').replace(rootPath, '').split('/').filter(Boolean)
    // 文件名在最后，目录路径是除最后一段以外的全部
    const dirSegments = segments.slice(0, -1)

    const newExpanded = new Set(expandedPaths)
    let currentPath = rootPath
    let needsTreeUpdate = false

    for (const seg of dirSegments) {
      currentPath = joinPath(currentPath, seg)
      if (!newExpanded.has(currentPath)) {
        newExpanded.add(currentPath)
        needsTreeUpdate = true
        // 确保该目录已加载子节点
        await get().expandDirectory(currentPath)
      }
    }

    if (needsTreeUpdate) {
      set({ expandedPaths: newExpanded, selectedPath: filePath })
    } else {
      set({ selectedPath: filePath })
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

function findNodeInTree(nodes: LocalFileNode[], targetPath: string): LocalFileNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node
    if (node.children) {
      const found = findNodeInTree(node.children, targetPath)
      if (found) return found
    }
  }
  return undefined
}
