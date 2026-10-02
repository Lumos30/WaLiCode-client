import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspaceContexts = vi.hoisted(() => ({
  clearRemote: vi.fn(),
  closeLocal: vi.fn(),
}))

vi.mock('../api/agent', () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSessionMessages: vi.fn(),
  listSessions: vi.fn(),
  queryAgentList: vi.fn(),
  resumeSession: vi.fn(),
  updateExecutionTarget: vi.fn(),
}))

vi.mock('../components/ToolProgressBar', () => ({
  toolProgressStore: { clear: vi.fn() },
}))

vi.mock('./fileExplorerStore', () => ({
  useFileExplorerStore: { getState: () => ({ clearBrowserContext: workspaceContexts.clearRemote }) },
}))

vi.mock('./localFileStore', () => ({
  useLocalFileStore: { getState: () => ({ closeFolder: workspaceContexts.closeLocal }) },
}))

import * as agentApi from '../api/agent'
import type { AgentMessage } from '../types'
import { useAgentStore } from './agentStore'

const api = vi.mocked(agentApi)

function resetStore() {
  useAgentStore.setState({
    currentSessionId: null,
    sessions: new Map(),
    inputText: '',
    isLoading: false,
    historyLoading: false,
    historyError: null,
    showHistoryPanel: false,
    agents: [],
    currentAgentId: null,
  })
}

function message(id: string, role: AgentMessage['role'], groupId: string): AgentMessage {
  return {
    id,
    role,
    content: id,
    timestamp: 1,
    messageType: 'text',
    groupId,
  }
}

describe('agentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('loads the most recent persisted session and restores its ADK context', async () => {
    api.listSessions.mockResolvedValue([
      {
        sessionId: 'session-new', agentId: 'ssh-agent', title: '最新会话', messageCount: 2,
        executionTargetType: 'SSH', executionTargetRef: 'server-1', createdAt: 10, updatedAt: 20,
      },
      {
        sessionId: 'session-old', agentId: 'ssh-agent', title: '旧会话', messageCount: 1,
        executionTargetType: null, executionTargetRef: null, createdAt: 1, updatedAt: 2,
      },
    ])
    api.getSessionMessages.mockResolvedValue([
      { id: 1, turnId: 'turn-1', role: 'user', content: '检查服务器', createdAt: 10 },
      { id: 2, turnId: 'turn-1', role: 'assistant', content: '好的', createdAt: 11 },
    ])
    api.resumeSession.mockResolvedValue({ sessionId: 'session-new', restored: true, replayedMessageCount: 2 })

    await useAgentStore.getState().loadHistorySessions()

    const state = useAgentStore.getState()
    const session = state.sessions.get('session-new')
    expect(state.currentSessionId).toBe('session-new')
    expect(session?.messages.map(item => item.content)).toEqual(['检查服务器', '好的'])
    expect(session?.executionTargetType).toBe('SSH')
    expect(session?.executionTargetRef).toBe('server-1')
    expect(session?.messagesLoaded).toBe(true)
    expect(session?.resumeLoaded).toBe(true)
    expect(api.getSessionMessages).toHaveBeenCalledWith('session-new')
    expect(api.resumeSession).toHaveBeenCalledWith('session-new')
  })

  it('keeps loaded history visible when restoring the server-side context fails', async () => {
    api.listSessions.mockResolvedValue([
      {
        sessionId: 'session-1', agentId: 'code-agent', title: '历史会话', messageCount: 1,
        executionTargetType: 'LOCAL', executionTargetRef: 'D:/project', createdAt: 1, updatedAt: 2,
      },
    ])
    api.getSessionMessages.mockResolvedValue([
      { id: 1, turnId: 'turn-1', role: 'user', content: '你好', createdAt: 1 },
    ])
    api.resumeSession.mockRejectedValue(new Error('服务暂不可用'))

    await useAgentStore.getState().loadHistorySessions()

    const state = useAgentStore.getState()
    const session = state.sessions.get('session-1')
    expect(session?.messagesLoaded).toBe(true)
    expect(session?.resumeLoaded).toBe(false)
    expect(session?.loadError).toContain('历史消息已加载，但会话恢复失败')
    expect(state.historyError).toContain('服务暂不可用')
  })

  it('deletes the current session and selects the most recently updated remaining session', async () => {
    api.deleteSession.mockResolvedValue()
    useAgentStore.setState({
      currentSessionId: 'current',
      sessions: new Map([
        ['current', {
          id: 'current', name: '当前', agentId: 'agent', messages: [message('current-message', 'user', 'turn-current')],
          createdAt: 1, updatedAt: 1, messageCount: 1, executionTargetType: null, executionTargetRef: null,
          messagesLoaded: true, messagesLoading: false, resumeLoaded: true, resumeLoading: false, loadError: null,
        }],
        ['next', {
          id: 'next', name: '下一条', agentId: 'agent', messages: [message('next-message', 'user', 'turn-next')],
          createdAt: 2, updatedAt: 10, messageCount: 1, executionTargetType: null, executionTargetRef: null,
          messagesLoaded: true, messagesLoading: false, resumeLoaded: true, resumeLoading: false, loadError: null,
        }],
      ]),
    })

    await useAgentStore.getState().deleteSession('current')

    const state = useAgentStore.getState()
    expect(api.deleteSession).toHaveBeenCalledWith('current')
    expect(state.sessions.has('current')).toBe(false)
    expect(state.currentSessionId).toBe('next')
  })

  it('marks only running tools in a cancelled group as failed', () => {
    useAgentStore.setState({
      sessions: new Map([
        ['session-1', {
          id: 'session-1', name: '会话', agentId: 'agent', createdAt: 1, updatedAt: 1, messageCount: 3,
          executionTargetType: null, executionTargetRef: null, messagesLoaded: true, messagesLoading: false,
          resumeLoaded: true, resumeLoading: false, loadError: null,
          messages: [
            { ...message('running', 'assistant', 'turn-1'), messageType: 'tool_call', status: 'in_progress' },
            { ...message('complete', 'assistant', 'turn-1'), messageType: 'tool_call', status: 'success' },
            { ...message('other-turn', 'assistant', 'turn-2'), messageType: 'tool_call', status: 'in_progress' },
          ],
        }],
      ]),
    })

    useAgentStore.getState().markGroupInProgressAsFailure('session-1', 'turn-1')

    const messages = useAgentStore.getState().sessions.get('session-1')?.messages ?? []
    expect(messages.find(item => item.id === 'running')).toMatchObject({ status: 'failure', content: '用户取消' })
    expect(messages.find(item => item.id === 'complete')?.status).toBe('success')
    expect(messages.find(item => item.id === 'other-turn')?.status).toBe('in_progress')
  })

  it('preserves the stream-completion reason for an unconfirmed tool result', () => {
    useAgentStore.setState({
      sessions: new Map([
        ['session-1', {
          id: 'session-1', name: '会话', agentId: 'agent', createdAt: 1, updatedAt: 1, messageCount: 1,
          executionTargetType: null, executionTargetRef: null, messagesLoaded: true, messagesLoading: false,
          resumeLoaded: true, resumeLoading: false, loadError: null,
          messages: [{ ...message('running', 'assistant', 'turn-1'), messageType: 'tool_call', status: 'in_progress' }],
        }],
      ]),
    })

    useAgentStore.getState().markGroupInProgressAsFailure('session-1', 'turn-1', '流已结束，但未收到工具完成结果')

    const messages = useAgentStore.getState().sessions.get('session-1')?.messages ?? []
    expect(messages[0]).toMatchObject({ status: 'failure', content: '流已结束，但未收到工具完成结果' })
  })

  it('adds a neutral notice for a user-initiated stop without treating it as an agent error', () => {
    useAgentStore.setState({
      sessions: new Map([['session-1', {
        id: 'session-1', name: '会话', agentId: 'agent', createdAt: 1, updatedAt: 1, messageCount: 1,
        executionTargetType: null, executionTargetRef: null, messagesLoaded: true, messagesLoading: false,
        resumeLoaded: true, resumeLoading: false, loadError: null, messages: [],
      }]]),
    })

    useAgentStore.getState().addNoticeMessage('session-1', 'turn-1', '本次对话已停止')

    const messages = useAgentStore.getState().sessions.get('session-1')?.messages ?? []
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'system', messageType: 'notice', groupId: 'turn-1', content: '本次对话已停止' })
  })

  it('switches to the revised session and discards the edited message and later turns', () => {
    useAgentStore.setState({
      currentSessionId: 'source',
      sessions: new Map([
        ['source', {
          id: 'source', name: '原会话', agentId: 'agent', createdAt: 1, updatedAt: 1, messageCount: 3,
          executionTargetType: 'LOCAL', executionTargetRef: 'D:/project', messagesLoaded: true, messagesLoading: false,
          resumeLoaded: true, resumeLoading: false, loadError: null,
          messages: [message('before', 'user', 'turn-1'), message('edit', 'user', 'turn-2'), message('after', 'assistant', 'turn-2')],
        }],
      ]),
    })

    useAgentStore.getState().applySessionRevision('source', 'revised', 'edit')

    const state = useAgentStore.getState()
    expect(state.currentSessionId).toBe('revised')
    expect(state.sessions.has('source')).toBe(false)
    expect(state.sessions.get('revised')?.messages.map(item => item.id)).toEqual(['before'])
    expect(state.sessions.get('revised')?.executionTargetRef).toBe('D:/project')
  })

  it('creates a blank conversation and clears the previous file-browser context', async () => {
    api.createSession.mockResolvedValue('fresh-session')

    await useAgentStore.getState().newConversation('agent')

    const session = useAgentStore.getState().sessions.get('fresh-session')
    expect(api.createSession).toHaveBeenCalledWith('agent', 'default', null)
    expect(session?.executionTargetType).toBeNull()
    expect(session?.executionTargetRef).toBeNull()
    expect(workspaceContexts.clearRemote).toHaveBeenCalledTimes(1)
    expect(workspaceContexts.closeLocal).toHaveBeenCalledTimes(1)
  })
})
