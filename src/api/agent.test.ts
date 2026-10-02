import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./request', () => ({
  del: vi.fn(),
  get: vi.fn(),
  getAuthHeaders: vi.fn(() => ({})),
  getBaseUrl: vi.fn(() => 'http://127.0.0.1:8091'),
  post: vi.fn(() => Promise.resolve({ code: '0000', data: true })),
  put: vi.fn(),
}))

vi.mock('../components/ToolProgressBar', () => ({
  toolProgressStore: {
    clear: vi.fn(),
    remove: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('../config/chat', () => ({
  chatConfig: {
    heartbeatTimeout: 60_000,
    maxRetries: 0,
    maxStreamReconnects: 0,
    requestTimeout: 60_000,
    retryBaseDelay: 1,
    streamReconnectBaseDelay: 1,
  },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import * as request from './request'
import { invoke } from '@tauri-apps/api/core'
import { isAuthorizedLocalWorkspaceCwd, reactChatStream, resolveLocalWorkspaceResultPath } from './agent'

describe('local workspace command boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'retrieve_local_project_context') {
        return Promise.resolve({
          indexVersion: 'local-lexical-v1-1-test', filesIndexed: 0,
          filesChanged: 0, filesRemoved: 0, evidence: [], truncated: false,
        })
      }
      return Promise.resolve(undefined)
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('only authorizes the exact session-bound workspace root', () => {
    expect(isAuthorizedLocalWorkspaceCwd('D:/work/project/', 'd:\\work\\project')).toBe(true)
    expect(isAuthorizedLocalWorkspaceCwd('D:\\work\\project\\subdir', 'D:\\work\\project')).toBe(false)
    expect(isAuthorizedLocalWorkspaceCwd('D:\\other-project', 'D:\\work\\project')).toBe(false)
    expect(isAuthorizedLocalWorkspaceCwd(undefined, 'D:\\work\\project')).toBe(false)
  })

  it('resolves only safe workspace-relative result paths on Windows', () => {
    expect(resolveLocalWorkspaceResultPath('D:\\work\\project', 'src\\main.ts'))
      .toBe('D:\\work\\project/src/main.ts')
    expect(resolveLocalWorkspaceResultPath('D:\\work\\project', '../outside.txt')).toBeNull()
    expect(resolveLocalWorkspaceResultPath('D:\\work\\project', 'D:\\other\\outside.txt')).toBeNull()
    expect(resolveLocalWorkspaceResultPath('D:\\work\\project', 'D:\\work\\project-copy\\outside.txt')).toBeNull()
    expect(resolveLocalWorkspaceResultPath('D:\\work\\project', 'D:\\work\\project\\src\\main.ts'))
      .toBe('D:\\work\\project\\src\\main.ts')
  })

  it('returns a rejected result without invoking Tauri when the server sends another workspace', async () => {
    const commandEvent = {
      event: 'execute_local_command', cmdId: 'cmd-1', command: 'npm test', cwd: 'D:\\other-project', timeoutMs: 60_000,
    }
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(commandEvent)}\n`))
        controller.close()
      },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    reactChatStream(
      'code-agent', 'default', 'session-1', 'test current project',
      vi.fn(), vi.fn(), vi.fn(), vi.fn(),
      undefined, undefined, undefined, undefined, undefined,
      { name: 'project', rootPath: 'D:\\work\\project', workspaceId: 'workspace-1' },
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith(
      'execute_workspace_file_operation', expect.anything(),
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8091/api/v1/tool_result',
      expect.objectContaining({
        body: expect.stringContaining('未绑定到当前会话授权项目'),
      }),
    )
  })

  it('runs read-only workspace requests through the native root-bound file command', async () => {
    const workspaceEvent = {
      event: 'execute_local_workspace_file', cmdId: 'file-1', cwd: 'D:\\work\\project',
      workspaceOperation: 'read', workspaceArgs: { filePath: 'src/main.ts' },
    }
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(workspaceEvent)}\n`))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))))
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'retrieve_local_project_context') {
        return Promise.resolve({
          indexVersion: 'local-lexical-v1-1-test', filesIndexed: 1,
          filesChanged: 1, filesRemoved: 0, evidence: [], truncated: false,
        })
      }
      if (command === 'execute_workspace_file_operation') {
        return Promise.resolve({ success: true, path: 'src/main.ts', content: 'ok' })
      }
      return Promise.resolve(undefined)
    })

    reactChatStream(
      'code-agent', 'default', 'session-1', 'read current project',
      vi.fn(), vi.fn(), vi.fn(), vi.fn(),
      undefined, undefined, undefined, undefined, undefined,
      { name: 'project', rootPath: 'D:\\work\\project', workspaceId: 'workspace-1' },
    )

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'execute_workspace_file_operation',
      expect.objectContaining({ operation: 'read', workspaceId: 'workspace-1', args: { filePath: 'src/main.ts' } }),
    ))
    await vi.waitFor(() => expect(vi.mocked(request.post)).toHaveBeenCalledWith(
      '/api/v1/tool_result',
      expect.objectContaining({ cmdId: 'file-1', status: 'SUCCESS', success: true }),
    ))
    const chatRequest = vi.mocked(fetch).mock.calls[0]?.[1]?.body
    expect(String(chatRequest)).not.toContain('workspace-1')
  })

  it('forwards bounded local evidence but never the native workspace capability', async () => {
    const retrieval = {
      indexVersion: 'local-lexical-v1-4-deadbeef', filesIndexed: 24,
      filesChanged: 2, filesRemoved: 1, truncated: false,
      evidence: [{
        path: 'src/main.ts', lineStart: 7, lineEnd: 12,
        snippet: 'export function main() {}', contentHash: 'fnv1a64:abc', score: 31,
      }],
    }
    vi.mocked(invoke).mockResolvedValueOnce(retrieval)
    const onStatus = vi.fn()
    const body = new ReadableStream({ start(controller) { controller.close() } })
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(body, { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    reactChatStream(
      'code-agent', 'default', 'session-1', 'where is main',
      vi.fn(), vi.fn(), vi.fn(), vi.fn(),
      undefined, undefined, undefined, undefined, undefined,
      { name: 'project', rootPath: 'D:\\work\\project', workspaceId: 'workspace-secret' },
      undefined, undefined, onStatus,
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(request.projectContext.retrieval).toEqual(retrieval)
    expect(JSON.stringify(request)).not.toContain('workspace-secret')
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('src/main.ts:7-12'))
  })

  it('continues without repository evidence and warns when local retrieval fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('index unavailable'))
    const body = new ReadableStream({ start(controller) { controller.close() } })
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(body, { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const onWarning = vi.fn()

    reactChatStream(
      'code-agent', 'default', 'session-1', 'inspect project',
      vi.fn(), vi.fn(), vi.fn(), vi.fn(),
      undefined, undefined, undefined, undefined, undefined,
      { name: 'project', rootPath: 'D:\\work\\project', workspaceId: 'workspace-secret' },
      undefined, undefined, undefined, onWarning,
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('index unavailable'))
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(request.projectContext.retrieval).toBeUndefined()
  })

  it('rejects workspace operations when no native workspace authorization is present', async () => {
    const workspaceEvent = {
      event: 'execute_local_workspace_file', cmdId: 'file-2', cwd: 'D:\\work\\project',
      workspaceOperation: 'read', workspaceArgs: { filePath: 'src/main.ts' },
    }
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(workspaceEvent)}\n`))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))))

    reactChatStream(
      'code-agent', 'default', 'session-1', 'read current project',
      vi.fn(), vi.fn(), vi.fn(), vi.fn(),
      undefined, undefined, undefined, undefined, undefined,
      { name: 'project', rootPath: 'D:\\work\\project' },
    )

    await vi.waitFor(() => expect(vi.mocked(request.post)).toHaveBeenCalledWith(
      '/api/v1/tool_result',
      expect.objectContaining({ cmdId: 'file-2', status: 'ERROR', success: false }),
    ))
    expect(vi.mocked(invoke)).not.toHaveBeenCalled()
  })
})

describe('reactChatStream cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('notifies the server once and aborts the active stream when the user stops a run', async () => {
    const pendingResponse = new Promise<Response>(() => {})
    const fetchMock = vi.fn(() => pendingResponse)
    vi.stubGlobal('fetch', fetchMock)

    const cancel = reactChatStream(
      'code-agent', 'default', 'session-1', 'stop this run',
      vi.fn(), vi.fn(), vi.fn(), vi.fn(),
    )

    cancel()
    cancel()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8091/api/v1/chat_stream',
      expect.objectContaining({
        signal: expect.objectContaining({ aborted: true }),
      }),
    )
    expect(vi.mocked(request.post)).toHaveBeenCalledOnce()
    expect(vi.mocked(request.post)).toHaveBeenCalledWith(
      '/api/v1/chat_stream/cancel',
      expect.objectContaining({ runId: expect.any(String) }),
    )
  })

  it('ignores an SSE event that arrives after cancellation', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
      },
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))))
    const onText = vi.fn()
    const cancel = reactChatStream('code-agent', 'default', 'session-1', 'stop this run', vi.fn(), onText, vi.fn(), vi.fn())

    await vi.waitFor(() => expect(streamController).toBeDefined())
    cancel()
    streamController!.enqueue(new TextEncoder().encode('{"event":"text","content":"late output"}\n'))
    streamController!.close()

    await Promise.resolve()
    expect(onText).not.toHaveBeenCalled()
  })

  it('forwards durable Harness run_state events', async () => {
    const event = {
      event: 'run_state',
      runState: {
        taskId: 'task-1', runId: 'run-1', sessionId: 'session-1',
        status: 'RUNNING', reason: 'execution_started', updatedAt: 42,
      },
    }
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))))
    const onRunState = vi.fn()

    reactChatStream(
      'code-agent', 'default', 'session-1', 'hello',
      vi.fn(), vi.fn(), vi.fn(), vi.fn(),
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, 'turn-1', undefined, onRunState,
    )
    await vi.waitFor(() => expect(onRunState).toHaveBeenCalledWith(event.runState))
  })
})
