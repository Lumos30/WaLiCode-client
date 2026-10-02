import { create } from 'zustand'
import type { AgentMessage } from '../types'
import * as agentApi from '../api/agent'
import type { AiAgentConfigDTO, ReActStep, ChangeSummary, ExecutionTargetType } from '../api/agent'
import { toolProgressStore } from '../components/ToolProgressBar'
import { useFileExplorerStore } from './fileExplorerStore'
import { useLocalFileStore } from './localFileStore'

interface AgentSessionState {
  id: string
  name: string
  agentId: string
  messages: AgentMessage[]
  createdAt: number
  updatedAt: number
  messageCount: number
  executionTargetType: ExecutionTargetType | null
  executionTargetRef: string | null
  messagesLoaded: boolean
  messagesLoading: boolean
  resumeLoaded: boolean
  resumeLoading: boolean
  loadError: string | null
}

interface AgentStore {
  // 当前会话 ID（值 = 服务端返回的 sessionId）
  currentSessionId: string | null
  // 会话历史
  sessions: Map<string, AgentSessionState>
  // 输入框内容
  inputText: string
  // 是否等待响应
  isLoading: boolean
  // 历史面板是否展开
  showHistoryPanel: boolean
  toggleHistoryPanel: () => void

  // ===== 智能体列表 =====
  agents: AiAgentConfigDTO[]
  currentAgentId: string | null
  fetchAgents: () => Promise<void>
  setCurrentAgentId: (id: string) => void

  // ===== 会话管理 =====
  // 创建服务端会话并关联到当前会话
  createServerSession: (
    agentId: string,
    executionTarget?: { type: ExecutionTargetType; reference: string } | null,
  ) => Promise<string>
  // 从服务端加载当前用户的历史会话摘要
  loadHistorySessions: () => Promise<void>
  // 选择会话并按需加载消息、恢复 ADK 上下文
  selectSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  setExecutionTarget: (
    sessionId: string,
    executionTarget: { type: ExecutionTargetType; reference: string } | null,
  ) => Promise<void>
  historyLoading: boolean
  historyError: string | null
  // 设置当前会话
  setCurrentSession: (id: string | null) => void
  // 添加消息
  addMessage: (sessionId: string, message: AgentMessage) => void
  // 更新消息（用于流式追加）
  updateMessage: (sessionId: string, messageId: string, content: string) => void
  // 更新消息的 ReAct 步骤
  updateMessageSteps: (sessionId: string, messageId: string, steps: ReActStep[]) => void
  // 更新消息的任务拆解
  updateMessageTaskBreakdown: (sessionId: string, messageId: string, breakdown: import('../api/agent').TaskBreakdownDTO) => void
  // 更新子任务状态
  updateSubTaskStatus: (sessionId: string, messageId: string, subTaskIndex: number, status: string, result?: string) => void
  // 更新文件变更摘要
  updateMessageChangeSummary: (sessionId: string, messageId: string, summary: import('../api/agent').ChangeSummary) => void
  // ── 多消息流管理 ──
  // 添加工具调用消息
  addToolCallMessage: (sessionId: string, groupId: string, toolCallId: string, toolName: string, toolParams: string) => string
  // 更新工具消息状态（tool_result 返回时）
  updateToolMessageStatus: (sessionId: string, messageId: string, status: 'in_progress' | 'success' | 'failure', toolResult?: string) => void
  // 添加/更新 AI 文本消息（同一 groupId 只有一条 messageType=text 的消息，onText 时更新）
  upsertTextMessage: (sessionId: string, groupId: string, content: string) => string
  // 添加汇总消息
  addSummaryMessage: (sessionId: string, groupId: string, changeSummary?: ChangeSummary) => void
  // 添加思考消息
  addThinkingMessage: (sessionId: string, groupId: string, content: string) => string
  // 替换同组最后一条 thinking 消息的内容（用于更新占位消息）
  replaceLastThinkingMessage: (sessionId: string, groupId: string, content: string) => void
  // 移除同组所有 thinking 消息（收到 text 时清理占位）
  removeThinkingMessages: (sessionId: string, groupId: string) => void
  // 添加错误消息
  addErrorMessage: (sessionId: string, groupId: string, content: string) => void
  // 添加不属于模型回复、也不属于错误的会话状态提示
  addNoticeMessage: (sessionId: string, groupId: string, content: string) => void
  // 将同组所有 in_progress 工具消息标记为 failure，并保留实际原因
  markGroupInProgressAsFailure: (sessionId: string, groupId: string, reason?: string) => void

  // 后端修订成功后，将当前会话无感切换到新 ID，并截断目标消息及后续内容
  applySessionRevision: (sourceSessionId: string, revisedSessionId: string, messageId: string) => void
  // 设置输入框内容
  setInputText: (text: string) => void
  // 设置加载状态
  setLoading: (loading: boolean) => void
  clearMessages: (sessionId: string) => void
  // 新建对话（点击新建时调用此方法）
  newConversation: (agentId: string) => Promise<void>
}

function mapPersistedMessages(messages: agentApi.ChatHistoryMessageDTO[]): AgentMessage[] {
  const mapped: AgentMessage[] = []
  let currentGroupId = ''
  let legacyUserIndex = 0

  for (const message of messages) {
    const content = message.content ?? ''
    if (message.role === 'user') {
      legacyUserIndex += 1
      currentGroupId = message.turnId ? `turn_${message.turnId}` : `legacy_turn_${legacyUserIndex}`
      mapped.push({
        id: `db_${message.id}`,
        role: 'user',
        content,
        editableContent: content,
        timestamp: message.createdAt ?? Date.now(),
        messageType: 'text',
        groupId: currentGroupId,
      })
      continue
    }

    if (!currentGroupId) {
      currentGroupId = message.turnId ? `turn_${message.turnId}` : `legacy_turn_orphan_${message.id}`
    }

    if (message.role === 'tool') {
      mapped.push({
        id: `db_${message.id}`,
        role: 'assistant',
        content: content || (message.toolName ? `调用 ${message.toolName}` : '工具执行结果'),
        timestamp: message.createdAt ?? Date.now(),
        messageType: 'tool_call',
        groupId: currentGroupId,
        toolName: message.toolName ?? undefined,
        toolCallId: message.toolCallId ?? undefined,
        toolResult: content,
        status: 'success',
      })
      continue
    }

    mapped.push({
      id: `db_${message.id}`,
      role: message.role === 'system' ? 'system' : 'assistant',
      content,
      timestamp: message.createdAt ?? Date.now(),
      messageType: 'text',
      groupId: currentGroupId,
    })
  }

  return mapped
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  currentSessionId: null,
  sessions: new Map(),
  inputText: '',
  isLoading: false,
  historyLoading: false,
  historyError: null,
  showHistoryPanel: false,
  toggleHistoryPanel: () => set((s) => ({ showHistoryPanel: !s.showHistoryPanel })),

  agents: [],
  currentAgentId: null,

  fetchAgents: async () => {
    const list = await agentApi.queryAgentList()
    set({ agents: list })
    // 自动选中第一个
    if (list.length > 0 && !get().currentAgentId) {
      set({ currentAgentId: list[0].agentId })
    }
  },

  setCurrentAgentId: (id) => set({ currentAgentId: id }),

  loadHistorySessions: async () => {
    const stateBefore = get()
    if (stateBefore.historyLoading) return
    set({ historyLoading: true, historyError: null })
    try {
      const summaries = await agentApi.listSessions()
      const currentId = get().currentSessionId
      set((state) => {
        const sessions = new Map(state.sessions)
        for (const summary of summaries) {
          const existing = sessions.get(summary.sessionId)
          sessions.set(summary.sessionId, {
            id: summary.sessionId,
            name: summary.title?.trim() || existing?.name || '历史会话',
            agentId: summary.agentId,
            messages: existing?.messages ?? [],
            createdAt: summary.createdAt ?? existing?.createdAt ?? Date.now(),
            updatedAt: summary.updatedAt ?? existing?.updatedAt ?? Date.now(),
            messageCount: summary.messageCount ?? existing?.messageCount ?? 0,
            executionTargetType: summary.executionTargetType ?? null,
            executionTargetRef: summary.executionTargetRef ?? null,
            messagesLoaded: existing?.messagesLoaded ?? false,
            messagesLoading: false,
            resumeLoaded: existing?.resumeLoaded ?? false,
            resumeLoading: false,
            loadError: existing?.loadError ?? null,
          })
        }
        return { sessions, historyLoading: false }
      })

      // 首次启动自动展示最近一条；之后的会话在历史面板点击时懒加载。
      const selectedId = currentId || summaries[0]?.sessionId
      if (selectedId && !get().currentSessionId) {
        await get().selectSession(selectedId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ historyLoading: false, historyError: message })
    }
  },

  selectSession: async (sessionId) => {
    const session = get().sessions.get(sessionId)
    if (!session) return
    set({ currentSessionId: sessionId, historyError: null })
    if ((session.messagesLoaded && session.resumeLoaded) || session.messagesLoading || session.resumeLoading) return

    const needsMessages = !session.messagesLoaded
    const needsResume = !session.resumeLoaded

    set((state) => {
      const sessions = new Map(state.sessions)
      const current = sessions.get(sessionId)
      if (current) sessions.set(sessionId, {
        ...current,
        messagesLoading: needsMessages,
        resumeLoading: needsResume,
        loadError: null,
      })
      return { sessions }
    })
    try {
      if (needsMessages) {
        const messages = await agentApi.getSessionMessages(sessionId)
        set((state) => {
          const sessions = new Map(state.sessions)
          const current = sessions.get(sessionId)
          if (current) {
            sessions.set(sessionId, {
              ...current,
              messages: mapPersistedMessages(messages),
              messageCount: messages.length,
              messagesLoaded: true,
              messagesLoading: false,
            })
          }
          return { sessions }
        })
      }

      if (needsResume) {
        try {
          await agentApi.resumeSession(sessionId)
          set((state) => {
            const sessions = new Map(state.sessions)
            const current = sessions.get(sessionId)
            if (current) sessions.set(sessionId, {
              ...current,
              resumeLoaded: true,
              resumeLoading: false,
              loadError: null,
            })
            return { sessions, historyError: null }
          })
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          const message = get().sessions.get(sessionId)?.messagesLoaded
            ? `历史消息已加载，但会话恢复失败：${reason}`
            : `会话恢复失败：${reason}`
          set((state) => {
            const sessions = new Map(state.sessions)
            const current = sessions.get(sessionId)
            if (current) sessions.set(sessionId, { ...current, resumeLoading: false, loadError: message })
            return { sessions, historyError: message }
          })
        }
      } else {
        set((state) => {
          const sessions = new Map(state.sessions)
          const current = sessions.get(sessionId)
          if (current) sessions.set(sessionId, { ...current, loadError: null })
          return { sessions }
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => {
        const sessions = new Map(state.sessions)
        const current = sessions.get(sessionId)
        if (current) sessions.set(sessionId, { ...current, messagesLoading: false, resumeLoading: false, loadError: `历史消息加载失败：${message}` })
        return { sessions, historyError: `历史消息加载失败：${message}` }
      })
    }
  },

  deleteSession: async (sessionId) => {
    if (get().isLoading && get().currentSessionId === sessionId) {
      const error = new Error('Agent 仍在运行，请先停止后再删除')
      set({ historyError: error.message })
      throw error
    }
    try {
      await agentApi.deleteSession(sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ historyError: message })
      throw error
    }
    const wasCurrent = get().currentSessionId === sessionId
    const nextSessions = Array.from(get().sessions.values())
      .filter(session => session.id !== sessionId && (session.messageCount > 0 || session.messages.length > 0))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    set((state) => {
      const sessions = new Map(state.sessions)
      sessions.delete(sessionId)
      return {
        sessions,
        currentSessionId: wasCurrent ? (nextSessions[0]?.id ?? null) : state.currentSessionId,
        historyError: null,
      }
    })
    if (wasCurrent && nextSessions[0]) {
      await get().selectSession(nextSessions[0].id)
    }
  },

  setExecutionTarget: async (sessionId, executionTarget) => {
    const saved = await agentApi.updateExecutionTarget(sessionId, executionTarget)
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        sessions.set(sessionId, {
          ...session,
          executionTargetType: saved.type,
          executionTargetRef: saved.reference,
          updatedAt: Date.now(),
        })
      }
      return { sessions, historyError: null }
    })
  },

  createServerSession: async (agentId, executionTarget = null) => {
    const serverSessionId = await agentApi.createSession(agentId, 'default', executionTarget)
    if (!serverSessionId) throw new Error('创建会话失败')
    // 新建会话时清除工具进度条残留状态
    toolProgressStore.clear()
    const state = get()
    const newSession = {
      id: serverSessionId,
      agentId,
      name: `会话 ${state.sessions.size + 1}`,
      messages: [] as AgentMessage[],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      executionTargetType: executionTarget?.type ?? null,
      executionTargetRef: executionTarget?.reference ?? null,
      messagesLoaded: true,
      messagesLoading: false,
      resumeLoaded: true,
      resumeLoading: false,
      loadError: null,
    }
    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.set(serverSessionId, newSession)
      return { sessions, currentSessionId: serverSessionId }
    })
    return serverSessionId
  },

  setCurrentSession: (id) => set({ currentSessionId: id }),

  addMessage: (sessionId, message) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        sessions.set(sessionId, {
          ...session,
          messages: [...session.messages, message],
        })
      }
      return { sessions }
    }),

  updateMessage: (sessionId, messageId, content) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        const messages = session.messages.map((m) =>
          m.id === messageId ? { ...m, content } : m
        )
        sessions.set(sessionId, { ...session, messages })
      }
      return { sessions }
    }),

  updateMessageSteps: (sessionId, messageId, steps) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        const messages = session.messages.map((m) =>
          m.id === messageId ? { ...m, steps: [...steps] } : m
        )
        sessions.set(sessionId, { ...session, messages })
      } else {
        console.warn('[updateMessageSteps] session not found: sessionId=', sessionId)
      }
      return { sessions }
    }),

  updateMessageTaskBreakdown: (sessionId, messageId, breakdown) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        const messages = session.messages.map((m) =>
          m.id === messageId ? { ...m, taskBreakdown: breakdown } : m
        )
        sessions.set(sessionId, { ...session, messages })
      }
      return { sessions }
    }),

  updateSubTaskStatus: (sessionId, messageId, subTaskIndex, status, result) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        const messages = session.messages.map((m) => {
          if (m.id !== messageId || !m.taskBreakdown) return m
          const updatedBreakdown = {
            ...m.taskBreakdown,
            subTasks: m.taskBreakdown.subTasks.map((st) => {
              if (st.index !== subTaskIndex) return st
              return { ...st, status: status as any, result: result ?? st.result }
            }),
          }
          return { ...m, taskBreakdown: updatedBreakdown }
        })
        sessions.set(sessionId, { ...session, messages })
      }
      return { sessions }
    }),

  updateMessageChangeSummary: (sessionId, messageId, summary) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        const messages = session.messages.map((m) =>
          m.id === messageId ? { ...m, changeSummary: summary } : m
        )
        sessions.set(sessionId, { ...session, messages })
      }
      return { sessions }
    }),

  setInputText: (text) => set({ inputText: text }),

  // ══════════════════════════════════════════════════════════
  //  多消息流实现
  // ══════════════════════════════════════════════════════════

  addToolCallMessage: (sessionId, groupId, toolCallId, toolName, toolParams) => {
    // 使用自增计数器避免 key 重复（Date.now() 在同一毫秒内可能重复）
    const _tcSeq = ((globalThis as any).__toolCallSeq = ((globalThis as any).__toolCallSeq || 0) + 1)
    const msgId = `tool_${toolCallId}_${Date.now()}_${_tcSeq}`
    const msg: AgentMessage = {
      id: msgId,
      role: 'assistant',
      content: toolParams ? `调用 ${toolName}: ${toolParams}` : `调用 ${toolName}`,
      timestamp: Date.now(),
      messageType: 'tool_call',
      groupId,
      toolName,
      toolCallId,
      toolParams,
      status: 'in_progress',
    }
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        sessions.set(sessionId, { ...session, messages: [...session.messages, msg] })
      }
      return { sessions }
    })
    return msgId
  },

  updateToolMessageStatus: (sessionId, messageId, status, toolResult) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        const messages = session.messages.map((m) =>
          m.id === messageId
            ? { ...m, status, toolResult: toolResult ?? m.toolResult, content: toolResult ?? m.content }
            : m
        )
        sessions.set(sessionId, { ...session, messages })
      }
      return { sessions }
    }),

  upsertTextMessage: (sessionId, groupId, content) => {
    const state = get()
    const session = state.sessions.get(sessionId)
    if (!session) return ''
    // 查找同 groupId 下已有的 assistant text 消息（排除用户消息）
    const existing = session.messages.find(m => m.groupId === groupId && m.messageType === 'text' && m.role === 'assistant')
    if (existing) {
      // 更新
      set((s) => {
        const sessions = new Map(s.sessions)
        const sess = sessions.get(sessionId)
        if (sess) {
          const messages = sess.messages.map(m =>
            m.id === existing.id ? { ...m, content } : m
          )
          sessions.set(sessionId, { ...sess, messages })
        }
        return { sessions }
      })
      return existing.id
    } else {
      // 新增
      const msgId = `text_${Date.now()}`
      const msg: AgentMessage = {
        id: msgId,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        messageType: 'text',
        groupId,
      }
      set((s) => {
        const sessions = new Map(s.sessions)
        const sess = sessions.get(sessionId)
        if (sess) {
          sessions.set(sessionId, { ...sess, messages: [...sess.messages, msg] })
        }
        return { sessions }
      })
      return msgId
    }
  },

  addSummaryMessage: (sessionId, groupId, changeSummary) => {
    const msgId = `summary_${Date.now()}`
    const msg: AgentMessage = {
      id: msgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      messageType: 'summary',
      groupId,
      changeSummary,
    }
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        sessions.set(sessionId, { ...session, messages: [...session.messages, msg] })
      }
      return { sessions }
    })
  },

  addThinkingMessage: (sessionId, groupId, content) => {
    const msgId = `think_${Date.now()}`
    const msg: AgentMessage = {
      id: msgId,
      role: 'assistant',
      content,
      timestamp: Date.now(),
      messageType: 'thinking',
      groupId,
    }
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        sessions.set(sessionId, { ...session, messages: [...session.messages, msg] })
      }
      return { sessions }
    })
    return msgId
  },

  replaceLastThinkingMessage: (sessionId, groupId, content) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (!session) return {}
      // 找到同组最后一条 thinking 消息并替换内容
      const messages = [...session.messages]
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].groupId === groupId && messages[i].messageType === 'thinking') {
          messages[i] = { ...messages[i], content }
          break
        }
      }
      sessions.set(sessionId, { ...session, messages })
      return { sessions }
    }),

  removeThinkingMessages: (sessionId, groupId) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (!session) return {}
      const messages = session.messages.filter(
        m => !(m.groupId === groupId && m.messageType === 'thinking')
      )
      sessions.set(sessionId, { ...session, messages })
      return { sessions }
    }),

  addErrorMessage: (sessionId, groupId, content) => {
    const msgId = `error_${Date.now()}`
    const msg: AgentMessage = {
      id: msgId,
      role: 'assistant',
      content,
      timestamp: Date.now(),
      messageType: 'error',
      groupId,
    }
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        sessions.set(sessionId, { ...session, messages: [...session.messages, msg] })
      }
      return { sessions }
    })
  },

  addNoticeMessage: (sessionId, groupId, content) => {
    const msg: AgentMessage = {
      id: `notice_${Date.now()}`,
      role: 'system',
      content,
      timestamp: Date.now(),
      messageType: 'notice',
      groupId,
    }
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        sessions.set(sessionId, { ...session, messages: [...session.messages, msg] })
      }
      return { sessions }
    })
  },

  markGroupInProgressAsFailure: (sessionId, groupId, reason = '用户取消') =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        const messages = session.messages.map((m) =>
          m.groupId === groupId && m.messageType === 'tool_call' && m.status === 'in_progress'
            ? { ...m, status: 'failure' as const, content: reason }
            : m
        )
        sessions.set(sessionId, { ...session, messages })
      }
      return { sessions }
    }),

  applySessionRevision: (sourceSessionId, revisedSessionId, messageId) =>
    set((state) => {
      const session = state.sessions.get(sourceSessionId)
      if (!session) return {}
      const msgIndex = session.messages.findIndex(m => m.id === messageId)
      if (msgIndex < 0) return {}
      const revisedSession = {
        ...session,
        id: revisedSessionId,
        messages: session.messages.slice(0, msgIndex),
      }
      const sessions = new Map<string, typeof revisedSession>()
      state.sessions.forEach((value, key) => {
        if (key === sourceSessionId) sessions.set(revisedSessionId, revisedSession)
        else sessions.set(key, value)
      })
      toolProgressStore.clear()
      return {
        sessions,
        currentSessionId: state.currentSessionId === sourceSessionId
          ? revisedSessionId
          : state.currentSessionId,
      }
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  clearMessages: (sessionId: string) => {
    // 清除消息时同步清除工具进度条残留
    toolProgressStore.clear()
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (!session) return {}
      sessions.set(sessionId, { ...session, messages: [] })
      return { sessions }
    })
  },

  newConversation: async (agentId) => {
    // A fresh chat must not silently retain the old project's authority or a
    // remote file browser from the previous conversation. Create first so a
    // failed server request leaves the user's current workspace untouched.
    await get().createServerSession(agentId, null)
    useFileExplorerStore.getState().clearBrowserContext()
    useLocalFileStore.getState().closeFolder()
  },
}))
