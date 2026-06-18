/**
 * SSH 智能体 API
 * 提供智能体会话与 SSH 终端的绑定能力
 */
import { get, post } from './request'

const BASE = '/api/v1/ssh/agent'

// ===== 类型定义 =====

/** 绑定终端请求 */
export interface BindTerminalPayload {
  chatSessionId: string
  terminalSessionId: string
}

/** 绑定终端响应 */
export interface BindTerminalResponse {
  chatSessionId: string
  terminalSessionId: string
  bound: boolean
}

/** 查询绑定响应 */
export interface QueryBindingResponse {
  chatSessionId: string
  terminalSessionId?: string
  bound: boolean
  message?: string
}

// ===== API 方法 =====

/**
 * 绑定 SSH 终端到智能体会话
 */
export function bindTerminal(payload: BindTerminalPayload) {
  return post<BindTerminalResponse>(`${BASE}/bind_terminal`, payload)
}

/**
 * 解绑 SSH 终端
 */
export function unbindTerminal(chatSessionId: string) {
  return post<void>(`${BASE}/unbind_terminal`, undefined, { chatSessionId })
}

/**
 * 查询会话绑定的终端
 */
export function queryBinding(chatSessionId: string) {
  return get<QueryBindingResponse>(`${BASE}/query_binding`, { chatSessionId })
}
