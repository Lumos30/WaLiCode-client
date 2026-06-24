// SSH 连接信息（前端本地模型）
export interface SSHConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  authType: number       // 1-密码, 2-私钥
  status: number         // 0-未连接, 1-已连接, 2-连接中, 3-连接失败
  createdAt: number
  updatedAt: number
}

import type { ReActStep, ChangeSummary, TaskBreakdownDTO } from '../api/agent'

/** 消息子类型（多消息流架构） */
export type AgentMessageType =
  | 'text'         // AI 文本回复（Markdown）
  | 'tool_call'    // 工具调用（可折叠卡片）
  | 'tool_result'  // 工具执行结果
  | 'thinking'     // 思考/进度提示
  | 'summary'      // 最终汇总（含 changeSummary）
  | 'error'        // 错误消息

// Agent 会话消息
export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number

  // ── 多消息流字段 ──
  /** 消息子类型 */
  messageType: AgentMessageType
  /** 同一次对话回合的分组 ID（用户消息 + AI 多条回复共享同一 groupId） */
  groupId: string

  // ── 工具相关（messageType=tool_call/tool_result 时有值） ──
  /** 工具名称 */
  toolName?: string
  /** 工具调用 ID（关联 tool_call 和 tool_result） */
  toolCallId?: string
  /** 工具参数 */
  toolParams?: string
  /** 工具执行结果 */
  toolResult?: string
  /** 工具执行状态 */
  status?: 'in_progress' | 'success' | 'failure'

  // ── 兼容旧字段（逐步废弃） ──
  /** @deprecated 多消息流模式下不再使用 */
  steps?: ReActStep[]
  /** 任务拆解方案 */
  taskBreakdown?: TaskBreakdownDTO
  /** 文件变更摘要（done 事件中携带） */
  changeSummary?: ChangeSummary
}

// Agent 会话
export interface AgentSession {
  id: string
  name: string
  connectionId?: string
  messages: AgentMessage[]
  createdAt: number
}

// 服务器状态
export interface ServerStatus {
  connected: boolean
  url: string
  version?: string
}

// ===== SSH 连接状态枚举 =====
export const ConnectionStatus = {
  DISCONNECTED: 0,
  CONNECTED: 1,
  CONNECTING: 2,
  FAILED: 3,
} as const

export const AuthType = {
  PASSWORD: 1,
  PRIVATE_KEY: 2,
} as const
