/**
 * 智能体 API
 */
import { get, post, getBaseUrl } from './request'

export interface AiAgentConfigDTO {
  agentId: string
  agentName: string
  agentDesc: string
}

/** 创建会话请求 */
export interface CreateSessionRequestDTO {
  agentId: string
  userId: string
}

/** 创建会话响应 */
export interface CreateSessionResponseDTO {
  sessionId: string
}

/** 对话请求 */
export interface ChatRequestDTO {
  agentId: string
  userId: string
  sessionId: string
  message: string
  terminalSessionId?: string | null
}

/** 后端 ReAct 事件（ReActEventDTO） */
export interface ReActEvent {
  event: 'text' | 'tool_call' | 'tool_result' | 'round_end' | 'done' | 'error' | 'heartbeat' | 'tool_progress' | 'task_breakdown' | 'task_progress' | 'sub_agent_call' | 'sub_agent_result'
  content?: string
  toolCallId?: string
  toolName?: string
  status?: string
  fullText?: string
  args?: string
  summary?: string
  timestamp?: number
  stepInfo?: {
    currentStep: number
    maxSteps: number
    shouldContinue: boolean
    totalToolCalls: number
  }
  taskBreakdown?: TaskBreakdownDTO
  taskProgress?: {
    subTaskIndex: number
    subTaskTitle: string
    status: string
    totalSubTasks: number
    completedSubTasks: number
  }
  subAgent?: SubAgentInfo
  changeSummary?: ChangeSummary
}

/** 子代理调用信息 */
export interface SubAgentInfo {
  agentName: string
  task: string
  status: 'running' | 'success' | 'error'
  result?: string
  durationMs?: number
}

/** 文件变更摘要 */
export interface ChangeSummary {
  description?: string
  topic?: string
  created: ChangeFile[]
  modified: ChangeFile[]
  deleted: ChangeFile[]
}

/** 单个文件变更 */
export interface ChangeFile {
  path: string
  kind: 'create' | 'modify' | 'delete'
  addedLines?: number
  removedLines?: number
}

/** 任务拆解 DTO */
export interface TaskBreakdownDTO {
  originalRequest: string
  subTasks: TaskSubTask[]
  needConfirmation: boolean
  summary: string
}

/** 子任务 */
export interface TaskSubTask {
  index: number
  title: string
  description: string
  expectedTools: string
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'skipped'
  result?: string
}

/** 前端 ReAct 步骤（用于 UI 渲染） */
export interface ReActStep {
  stepType: 'thinking' | 'tool_call' | 'result'
  stepIndex: number
  content?: string
  toolName?: string
  toolParams?: string
  toolResult?: string
  status: 'in_progress' | 'success' | 'failure'
  error?: string
}

/** 查询智能体列表 */
export async function queryAgentList(): Promise<AiAgentConfigDTO[]> {
  const res = await get<AiAgentConfigDTO[]>('/api/v1/query_ai_agent_config_list')
  if (res.code === '0000' && res.data) {
    return res.data
  }
  console.error('[agentApi] queryAgentList failed:', res.info)
  return []
}

/** 创建会话 */
export async function createSession(agentId: string, userId: string = 'default'): Promise<string | null> {
  const res = await post<CreateSessionResponseDTO>('/api/v1/create_session', {
    agentId,
    userId,
  })
  if (res.code === '0000' && res.data?.sessionId) {
    return res.data.sessionId
  }
  console.error('[agentApi] createSession failed:', res.info)
  return null
}

/**
 * ReAct 流式对话（SSE）
 *
 * 对接后端 ReActEventDTO 格式，事件为纯 JSON 行（无 data: 前缀）
 *
 * 事件类型：
 * - text:         文本流（content=片段, fullText=累积）
 * - tool_call:    工具调用开始（toolName, toolCallId）
 * - tool_result:  工具执行结果（toolCallId, content）
 * - round_end:    一轮结束（stepInfo）
 * - done:         全部完成（content=最终结果 JSON）
 * - error:        错误
 */
export function reactChatStream(
  agentId: string,
  userId: string,
  sessionId: string,
  message: string,
  onStep: (step: ReActStep) => void,
  onText: (fullText: string) => void,
  onDone: (finalContent: string) => void,
  onError: (err: string) => void,
  terminalSessionId?: string | null,
  onTaskBreakdown?: (breakdown: TaskBreakdownDTO) => void,
  onTaskProgress?: (progress: { subTaskIndex: number; subTaskTitle: string; status: string; totalSubTasks: number; completedSubTasks: number }) => void,
  onSubAgent?: (info: SubAgentInfo) => void,
  onChangeSummary?: (summary: ChangeSummary) => void,
): () => void {
  const baseUrl = getBaseUrl()
  const url = `${baseUrl}/api/v1/chat_stream`

  const controller = new AbortController()

  // 工具调用 → 步骤索引映射
  const toolStepMap = new Map<string, number>()
  let stepCounter = 0
  let lastFullText = ''
  let retryCount = 0
  const MAX_RETRIES = 2
  const RETRY_DELAY = 1000

  function doFetch() {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, userId, sessionId, message, terminalSessionId }),
      signal: controller.signal,
    })
    .then((res) => {
      if (!res.ok) {
        // 5xx 错误时重试
        if (res.status >= 500 && retryCount < MAX_RETRIES) {
          retryCount++
          console.warn(`[SSE] HTTP ${res.status}, retrying ${retryCount}/${MAX_RETRIES}...`)
          setTimeout(doFetch, RETRY_DELAY * retryCount)
          return
        }
        onError(`HTTP ${res.status}: ${res.statusText}`)
        return
      }
      const reader = res.body!.getReader()
      if (!reader) {
        onError('No response body')
        return
      }
      const decoder = new TextDecoder()
      let buffer = ''

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) {
            console.log('[SSE stream done], lastFullText=', lastFullText)
            onDone(lastFullText)
            return
          }
          buffer += decoder.decode(value, { stream: true })

          // 按换行分割，解析 JSON 事件（后端直接发 JSON 行，无 data: 前缀）
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            console.log('[SSE recv]', trimmed.substring(0, 200))

            try {
              const event: ReActEvent = JSON.parse(trimmed)
              // 忽略心跳保活事件
              if (event.event === 'heartbeat') {
                console.log('[SSE heartbeat]')
                continue
              }
              processEvent(event)
            } catch {
              // 非 JSON 行，忽略（可能是 HTTP chunk 边界）
            }
          }
          read()
        }).catch((err) => {
          if (err.name !== 'AbortError') {
            // 如果已有累积内容，说明是流中途断开（可能是后端处理完但连接关闭）
// 不显示错误，直接用已有内容触发 onDone
            if (lastFullText) {
              console.warn('[SSE stream ended with partial content]', err.message)
              onDone(lastFullText)
            } else {
              onError(err.message)
            }
          }
        })
      }

      function processEvent(event: ReActEvent) {
        switch (event.event) {
          case 'text': {
            // 文本流 → 更新累积文本
            const fullText = event.fullText || event.content || ''
            lastFullText = fullText
            console.log('[SSE text]', fullText.substring(0, 100))
            onText(fullText)
            break
          }

          case 'tool_call': {
            // 工具调用 → 新建步骤
            stepCounter++
            const idx = stepCounter
            if (event.toolCallId) {
              toolStepMap.set(event.toolCallId, idx)
            }
            onStep({
              stepType: 'tool_call',
              stepIndex: idx,
              toolName: event.toolName || 'unknown',
              content: `调用 ${event.toolName || 'unknown'}`,
              status: 'in_progress',
            })
            break
          }

          case 'tool_result': {
            // 工具结果 → 更新已有步骤
            const toolCallId = event.toolCallId || ''
            const existingIdx = toolStepMap.get(toolCallId)
            if (existingIdx !== undefined) {
              onStep({
                stepType: 'tool_call',
                stepIndex: existingIdx,
                toolName: '', // 已在 tool_call 中显示
                toolResult: event.content || '',
                status: event.status === 'error' ? 'failure' : 'success',
                error: event.status === 'error' ? event.content : undefined,
              })
            } else {
              // 未找到对应 tool_call（ADK 自动执行场景），新建步骤
              stepCounter++
              onStep({
                stepType: 'tool_call',
                stepIndex: stepCounter,
                toolResult: event.content || '',
                status: event.status === 'error' ? 'failure' : 'success',
                error: event.status === 'error' ? event.content : undefined,
              })
            }
            break
          }

          case 'tool_progress': {
            // 工具执行实时进度 → 新建/更新步骤
            if (event.status === 'executing') {
              // 工具开始执行
              stepCounter++
              onStep({
                stepType: 'tool_call',
                stepIndex: stepCounter,
                toolName: event.toolName || 'unknown',
                toolParams: event.args || '',
                content: `正在执行 ${event.toolName || 'unknown'}: ${event.args || ''}`,
                status: 'in_progress',
              })
            } else {
              // 工具执行完成（success/error）
              onStep({
                stepType: 'tool_call',
                stepIndex: stepCounter,
                toolName: event.toolName || 'unknown',
                toolResult: event.summary || '',
                status: event.status === 'success' ? 'success' : 'failure',
              })
            }
            break
          }

          case 'round_end': {
            // 轮次结束 → 发送 thinking 步骤（显示进度）
            const info = event.stepInfo
            if (info) {
              stepCounter++
              onStep({
                stepType: 'thinking',
                stepIndex: stepCounter,
                content: `步骤 ${info.currentStep}/${info.maxSteps} · 工具调用 ${info.totalToolCalls} 次`,
                status: info.shouldContinue ? 'in_progress' : 'success',
              })
            }
            break
          }

          case 'done': {
            // 完成 → 尝试解析最终结果
            let finalContent = ''
            if (event.content) {
              try {
                const result = JSON.parse(event.content)
                finalContent = result.assistantContent || result.content || event.content
              } catch {
                finalContent = event.content
              }
            }
            console.log('[SSE done] finalContent=', finalContent.substring(0, 200))
            // result 步骤始终携带最终 content，用于渲染
            const resultStep: ReActStep = {
              stepType: 'result',
              stepIndex: ++stepCounter,
              status: 'success',
            }
            if (finalContent) {
              resultStep.content = finalContent
              // 如果之前没有收到 text 事件（如纯工具调用场景），补充更新
              if (!lastFullText) {
                lastFullText = finalContent
                onText(finalContent)
              }
            }
            onStep(resultStep)
            // 传递文件变更摘要
            if (event.changeSummary) {
              onChangeSummary?.(event.changeSummary)
            }
            break
          }

          case 'error': {
            // 错误
            onStep({
              stepType: 'result',
              stepIndex: ++stepCounter,
              error: event.content || '未知错误',
              status: 'failure',
            })
            break
          }

          case 'task_breakdown': {
            // 任务拆解提案
            if (event.taskBreakdown && onTaskBreakdown) {
              onTaskBreakdown(event.taskBreakdown)
            }
            break
          }

          case 'task_progress': {
            // 子任务进度
            if (event.taskProgress && onTaskProgress) {
              onTaskProgress(event.taskProgress)
            }
            break
          }

          case 'sub_agent_call': {
            // 子代理调用开始
            if (event.subAgent && onSubAgent) {
              onSubAgent(event.subAgent)
            }
            // 同时作为 tool_call 步骤显示（用 🤖 前缀区分子代理）
            stepCounter++
            const subIdx = stepCounter
            onStep({
              stepType: 'tool_call',
              stepIndex: subIdx,
              toolName: `🤖 ${event.subAgent?.agentName || 'sub-agent'}`,
              content: `委派子代理 ${event.subAgent?.agentName || ''}: ${event.subAgent?.task || ''}`,
              status: 'in_progress',
            })
            break
          }

          case 'sub_agent_result': {
            // 子代理执行完成
            if (event.subAgent && onSubAgent) {
              onSubAgent(event.subAgent)
            }
            // 更新最近的子代理步骤状态
            onStep({
              stepType: 'tool_call',
              stepIndex: stepCounter,
              toolResult: event.subAgent?.result || '',
              status: event.subAgent?.status === 'error' ? 'failure' : 'success',
            })
            break
          }
        }
      }

      read()
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        // 网络错误重试
        if (retryCount < MAX_RETRIES) {
          retryCount++
          console.warn(`[SSE] Network error, retrying ${retryCount}/${MAX_RETRIES}...`, err.message)
          setTimeout(doFetch, RETRY_DELAY * retryCount)
          return
        }
        onError(err.message)
      }
    })
  }

  doFetch()

  return () => controller.abort()
}

/**
 * 非流式对话（兼容旧接口）
 */
export function chatStream(
  agentId: string,
  userId: string,
  sessionId: string,
  message: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  terminalSessionId?: string | null,
): () => void {
  // 降级到 reactChatStream
  return reactChatStream(
    agentId, userId, sessionId, message,
    () => {}, // ignore steps
    onChunk, // text → onChunk
    () => onDone(),
    onError,
    terminalSessionId,
  )
}
