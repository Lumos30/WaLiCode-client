import { create } from 'zustand'
import type { AgentMessage } from '../types'
import * as agentApi from '../api/agent'
import type { AiAgentConfigDTO, ReActStep } from '../api/agent'

interface AgentStore {
  // 当前会话 ID（值 = 服务端返回的 sessionId）
  currentSessionId: string | null
  // 会话历史
  sessions: Map<string, { id: string; name: string; agentId: string; messages: AgentMessage[]; createdAt: number }>
  // 输入框内容
  inputText: string
  // 是否等待响应
  isLoading: boolean

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
  // 设置输入框内容
  setInputText: (text: string) => void
  // 设置加载状态
  setLoading: (loading: boolean) => void
  // 新建对话（点击新建时调用此方法）
  newConversation: (agentId: string) => Promise<void>
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  currentSessionId: null,
  sessions: new Map(),
  inputText: '',
  isLoading: false,

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
      }
      return { sessions }
    }),

  setInputText: (text) => set({ inputText: text }),

  setLoading: (loading) => set({ isLoading: loading }),

  newConversation: async (agentId) => {
    await get().createServerSession(agentId)
  },
}))
