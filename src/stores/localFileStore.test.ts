import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}))
vi.mock('./aiPatchStore', () => ({
  useAiPatchStore: { getState: () => ({ previews: [] }) },
}))

import { readDir } from '@tauri-apps/plugin-fs'
import { useLocalFileStore } from './localFileStore'

const mockedReadDir = vi.mocked(readDir)
const root = 'D:/workspace'
const source = `${root}/src`

describe('localFileStore nested directory expansion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLocalFileStore.setState({
      rootPath: root,
      workspaceId: 'workspace-test',
      tree: [{ name: 'src', path: source, directory: true, size: null, loaded: false }],
      expandedPaths: new Set(),
      selectedPath: null,
      loading: false,
      error: null,
      openTabs: [],
      activeTabKey: null,
    })
  })

  it('waits for native directory entries before exposing an expanded nested folder', async () => {
    mockedReadDir.mockResolvedValue([
      { name: 'nested', isDirectory: true },
      { name: 'App.java', isDirectory: false },
    ] as never)

    await useLocalFileStore.getState().toggleDirectory(source)

    const state = useLocalFileStore.getState()
    const node = state.tree[0]
    expect(mockedReadDir).toHaveBeenCalledWith(source)
    expect(state.expandedPaths.has(source)).toBe(true)
    expect(node.loaded).toBe(true)
    expect(node.children?.map((child) => [child.name, child.path, child.directory])).toEqual([
      ['nested', `${source}/nested`, true],
      ['App.java', `${source}/App.java`, false],
    ])
  })
})
