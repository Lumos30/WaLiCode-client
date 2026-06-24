import { create } from 'zustand'
import type { AgentMessage } from '../types'
import * as agentApi from '../api/agent'
import type { AiAgentConfigDTO, ReActStep, ChangeSummary } from '../api/agent'
import { toolProgressStore } from '../components/ToolProgressBar'

interface AgentStore {
  // 当前会话 ID（值 = 服务端返回的 sessionId）
  currentSessionId: string | null
  // 会话历史
  sessions: Map<string, { id: string; name: string; agentId: string; messages: AgentMessage[]; createdAt: number }>
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
  createServerSession: (agentId: string) => Promise<string>
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
  // 停止时将同组所有 in_progress 工具消息标记为 failure
  markGroupInProgressAsFailure: (sessionId: string, groupId: string) => void

  // 编辑重发：删除从 messageId 开始的所有消息，将内容填入输入框
  editAndRetry: (sessionId: string, messageId: string) => void
  // 设置输入框内容
  setInputText: (text: string) => void
  // 设置加载状态
  setLoading: (loading: boolean) => void
  clearMessages: (sessionId: string) => void
  // 新建对话（点击新建时调用此方法）
  newConversation: (agentId: string) => Promise<void>
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  currentSessionId: null,
  sessions: new Map(),
  inputText: '',
  isLoading: false,
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

  createServerSession: async (agentId) => {
    const serverSessionId = await agentApi.createSession(agentId)
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

  markGroupInProgressAsFailure: (sessionId, groupId) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        const messages = session.messages.map((m) =>
          m.groupId === groupId && m.messageType === 'tool_call' && m.status === 'in_progress'
            ? { ...m, status: 'failure' as const, content: '用户取消' }
            : m
        )
        sessions.set(sessionId, { ...session, messages })
      }
      return { sessions }
    }),

  editAndRetry: (sessionId, messageId) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const session = sessions.get(sessionId)
      if (!session) return {}
      const msgIndex = session.messages.findIndex(m => m.id === messageId)
      if (msgIndex < 0) return {}
      const targetMsg = session.messages[msgIndex]
      // 截断消息列表（保留 msgIndex 之前的消息）
      const truncatedMessages = session.messages.slice(0, msgIndex)
      sessions.set(sessionId, { ...session, messages: truncatedMessages })
      return { sessions, inputText: targetMsg.content }
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
    await get().createServerSession(agentId)
  },
}))
