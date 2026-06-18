import { create } from 'zustand'
import * as sshAgentApi from '../api/sshAgent'

/**
 * SSH 智能体会话绑定 Store
 * 
 * 核心功能：
 * 1. 管理智能体会话与 SSH 终端会话的绑定关系
 * 2. 自动绑定当前激活的 SSH 连接到智能体会话
 * 3. 支持手动添加服务器信息到对话上下文
 * 4. 支持从终端选中内容添加到对话
 */

interface SshAgentBinding {
  /** 智能体会话 ID */
  chatSessionId: string
  /** SSH 终端会话 ID */
  terminalSessionId: string
  /** 连接 ID */
  connectionId: string
  /** 连接名称 */
  connectionName: string
  /** 服务器信息 */
  serverInfo: {
    host: string
    port: number
    username: string
  }
  /** 绑定时间 */
  boundAt: number
}

/** 输入框标签 */
interface InputTag {
  /** 标签 ID */
  id: string
  /** 标签显示文本（预览） */
  label: string
  /** 完整内容 */
  fullContent: string
  /** 标签类型 */
  type: 'terminal-selection' | 'file' | 'custom'
  /** 添加时间 */
  addedAt: number
}

interface SshAgentStore {
  // ===== 绑定状态 =====
  /** 当前激活的绑定 */
  activeBinding: SshAgentBinding | null
  /** 所有绑定记录（按 chatSessionId 索引） */
  bindings: Map<string, SshAgentBinding>
  /** 绑定加载中 */
  isBinding: boolean
  /** 绑定错误信息 */
  bindingError: string | null

  // ===== 输入框标签 =====
  /** 输入框中的标签列表 */
  inputTags: InputTag[]

  // ===== 连接选择器 =====
  /** 是否显示连接选择器 */
  showConnectionSelector: boolean

  // ===== Actions =====
  /** 绑定终端到智能体会话 */
  bindTerminal: (
    chatSessionId: string,
    terminalSessionId: string,
    connectionInfo: {
      connectionId: string
      connectionName: string
      host: string
      port: number
      username: string
    }
  ) => Promise<boolean>

  /** 解绑终端 */
  unbindTerminal: (chatSessionId: string) => Promise<void>

  /** 查询绑定状态 */
  queryBinding: (chatSessionId: string) => Promise<SshAgentBinding | null>

  /** 设置当前激活的绑定 */
  setActiveBinding: (binding: SshAgentBinding | null) => void

  // ===== 输入框标签操作 =====
  /** 添加标签到输入框 */
  addInputTag: (tag: Omit<InputTag, 'id' | 'addedAt'>) => void

  /** 移除指定标签 */
  removeInputTag: (tagId: string) => void

  /** 清空所有标签 */
  clearInputTags: () => void

  /** 获取所有标签的完整内容（用于发送消息） */
  getInputTagsContent: () => string

  // ===== 连接选择器 =====
  /** 显示连接选择器 */
  openConnectionSelector: () => void

  /** 关闭连接选择器 */
  closeConnectionSelector: () => void

  /** 清除绑定错误 */
  clearBindingError: () => void

  /** 获取当前会话的绑定 */
  getBindingByChatSession: (chatSessionId: string) => SshAgentBinding | undefined

  /** 格式化服务器信息为对话上下文 */
  formatServerContext: (binding: SshAgentBinding) => string
}

export const useSshAgentStore = create<SshAgentStore>((set, get) => ({
  // ===== State =====
  activeBinding: null,
  bindings: new Map(),
  isBinding: false,
  bindingError: null,
  inputTags: [],
  showConnectionSelector: false,

  // ===== Actions =====
  bindTerminal: async (chatSessionId, terminalSessionId, connectionInfo) => {
    set({ isBinding: true, bindingError: null })
    try {
      const res = await sshAgentApi.bindTerminal({
        chatSessionId,
        terminalSessionId,
      })

      if (res.code === '0000' && res.data?.bound) {
        const binding: SshAgentBinding = {
          chatSessionId,
          terminalSessionId,
          connectionId: connectionInfo.connectionId,
          connectionName: connectionInfo.connectionName,
          serverInfo: {
            host: connectionInfo.host,
            port: connectionInfo.port,
            username: connectionInfo.username,
          },
          boundAt: Date.now(),
        }

        set((state) => {
          const bindings = new Map(state.bindings)
          bindings.set(chatSessionId, binding)
          return {
            bindings,
            activeBinding: binding,
            isBinding: false,
          }
        })

        return true
      }

      set({
        bindingError: res.info || '绑定失败',
        isBinding: false,
      })
      return false
    } catch (err) {
      set({
        bindingError: err instanceof Error ? err.message : '网络错误',
        isBinding: false,
      })
      return false
    }
  },

  unbindTerminal: async (chatSessionId) => {
    try {
      await sshAgentApi.unbindTerminal(chatSessionId)
      set((state) => {
        const bindings = new Map(state.bindings)
        bindings.delete(chatSessionId)
        return {
          bindings,
          activeBinding:
            state.activeBinding?.chatSessionId === chatSessionId
              ? null
              : state.activeBinding,
        }
      })
    } catch (err) {
      console.error('[sshAgentStore] unbindTerminal failed:', err)
    }
  },

  queryBinding: async (chatSessionId) => {
    try {
      const res = await sshAgentApi.queryBinding(chatSessionId)
      if (res.code === '0000' && res.data?.bound && res.data.terminalSessionId) {
        // 从本地缓存获取完整信息
        const cached = get().bindings.get(chatSessionId)
        if (cached) {
          return cached
        }
      }
      return null
    } catch (err) {
      console.error('[sshAgentStore] queryBinding failed:', err)
      return null
    }
  },

  setActiveBinding: (binding) => set({ activeBinding: binding }),

  // ===== 输入框标签操作 =====
  addInputTag: (tag) => {
    const id = `tag_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const newTag: InputTag = {
      ...tag,
      id,
      addedAt: Date.now(),
    }
    set((state) => ({
      inputTags: [...state.inputTags, newTag],
    }))
  },

  removeInputTag: (tagId) => {
    set((state) => ({
      inputTags: state.inputTags.filter((tag) => tag.id !== tagId),
    }))
  },

  clearInputTags: () => {
    set({ inputTags: [] })
  },

  getInputTagsContent: () => {
    const tags = get().inputTags
    if (tags.length === 0) return ''
    return tags.map((tag) => tag.fullContent).join('\n\n---\n\n')
  },

  openConnectionSelector: () => set({ showConnectionSelector: true }),

  closeConnectionSelector: () => set({ showConnectionSelector: false }),

  clearBindingError: () => set({ bindingError: null }),

  getBindingByChatSession: (chatSessionId) => {
    return get().bindings.get(chatSessionId)
  },

  formatServerContext: (binding) => {
    const { serverInfo, connectionName } = binding
    return `当前服务器：${connectionName} (${serverInfo.username}@${serverInfo.host}:${serverInfo.port})`
  },
}))
