import { describe, expect, it, vi } from 'vitest'

vi.mock('../api/sshFile', () => ({
  getFileContent: vi.fn(),
  getFileContentChunk: vi.fn(),
  getFileTree: vi.fn(),
  saveFileContent: vi.fn(),
}))
vi.mock('./aiPatchStore', () => ({
  useAiPatchStore: { getState: () => ({ previews: [] }) },
}))

import { useFileExplorerStore } from './fileExplorerStore'

describe('fileExplorerStore clearBrowserContext', () => {
  it('clears remote tree state and editor tabs without touching the SSH connection layer', () => {
    useFileExplorerStore.setState({
      activeConnectionId: 'connection-1',
      rootPathByConnection: { 'connection-1': '/' },
      homePathByConnection: { 'connection-1': '/home/demo' },
      currentPathByConnection: { 'connection-1': '/workspace' },
      selectedPathByConnection: { 'connection-1': '/workspace/App.java' },
      childrenByConnection: { 'connection-1': { '/workspace': [] } },
      expandedByConnection: { 'connection-1': ['/workspace'] },
      loadingPathsByConnection: { 'connection-1': ['/workspace'] },
      loadingRootByConnection: { 'connection-1': true },
      errorByConnection: { 'connection-1': 'previous error' },
      openTabs: [{
        key: 'connection-1:/workspace/App.java', connectionId: 'connection-1', path: '/workspace/App.java',
        name: 'App.java', content: 'class App {}', loading: false, binary: false, truncated: false,
      }],
      activeTabKey: 'connection-1:/workspace/App.java',
    })

    useFileExplorerStore.getState().clearBrowserContext()

    const state = useFileExplorerStore.getState()
    expect(state.activeConnectionId).toBeNull()
    expect(state.childrenByConnection).toEqual({})
    expect(state.expandedByConnection).toEqual({})
    expect(state.openTabs).toEqual([])
    expect(state.activeTabKey).toBeNull()
  })
})
