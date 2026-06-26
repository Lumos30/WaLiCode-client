/**
 * 智能体 API
 */
import { get, post, getBaseUrl } from './request'
import { toolProgressStore } from '../components/ToolProgressBar'
import { chatConfig } from '../config/chat'
import { invoke } from '@tauri-apps/api/core'

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

/** 当前工程上下文 */
export interface ProjectContextDTO {
  /** 工程名称（文件夹名），如 "ai-mcp-gateway" */
  name: string
  /** 工程根路径（绝对路径），如 "/Users/xxx/coding/ai-mcp-gateway" */
  rootPath: string
}

/** 对话请求 */
export interface ChatRequestDTO {
  agentId: string
  userId: string
  sessionId: string
  message: string
  terminalSessionId?: string | null

  /** 当前工程上下文（可选，由前端本地文件树注入） */
  projectContext?: ProjectContextDTO | null
}

/** 后端 ReAct 事件（ReActEventDTO） */
export interface ReActEvent {
  event:
    | 'text'
    | 'tool_call'
    | 'tool_result'
    | 'round_end'
    | 'done'
    | 'error'
    | 'warning'
    | 'heartbeat'
    | 'tool_progress'
    | 'task_breakdown'
    | 'task_progress'
    | 'sub_agent_call'
    | 'sub_agent_result'
    | 'permission_confirm'
    | 'tool_output'
    | 'round_start'
    | 'status'
    | 'execute_local_command'
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
  // ── 新增事件字段 ──
  /** 权限确认信息 (event=permission_confirm) */
  permission?: PermissionConfirmData
  /** 工具实时输出片段 (event=tool_output) */
  outputChunk?: string
  /** 状态更新消息 (event=status) */
  statusMessage?: string
  /** 本地指令 ID (event=execute_local_command) */
  cmdId?: string
  /** 本地命令 (event=execute_local_command) */
  command?: string
  /** 工作目录 (event=execute_local_command) */
  cwd?: string
  /** 超时时间毫秒 (event=execute_local_command) */
  timeoutMs?: number
}

/** 权限确认事件数据 */
export interface PermissionConfirmData {
  confirmId: string
  toolName: string
  toolArgs: string
  riskLevel: 'DENY' | 'CONFIRM' | 'ALLOW'
  reason: string
  timeoutMs: number
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
  toolCallId?: string
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
export interface InlineImageData {
  /** base64 编码数据（不含 data:image/xxx;base64, 前缀） */
  data: string
  /** MIME 类型，如 image/png、image/jpeg */
  mimeType: string
}

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
  projectContext?: ProjectContextDTO | null,
  // ── 新增回调 ──
  onPermissionConfirm?: (data: PermissionConfirmData) => void,
  onToolOutput?: (toolCallId: string, outputChunk: string) => void,
  onStatus?: (message: string) => void,
  onWarning?: (message: string) => void,
  onRoundStart?: (roundIndex: number) => void,
  onReconnect?: (attempt: number, maxAttempts: number) => void,
  onHeartbeat?: () => void,
  // ── 多模态支持 ──
  inlineDatas?: InlineImageData[],
): () => void {
  const baseUrl = getBaseUrl()
  const url = `${baseUrl}/api/v1/chat_stream`

  const controller = new AbortController()
  const cfg = chatConfig

  // 工具调用 → 步骤索引映射
  const toolStepMap = new Map<string, number>()
  // 工具调用 ID → 工具名映射（tool_result 时补回 toolName）
  const toolNameMap = new Map<string, string>()
  // 工具名 → 最近 args 映射（tool_progress 完成时补回 args）
  const toolProgressArgsMap = new Map<string, string>()
  let stepCounter = 0
  let lastFullText = ''
  let retryCount = 0
  // 流中途断开重连参数
  let streamReconnectCount = 0
  let isStreamStarted = false // 是否已开始接收流数据
  let isAborted = false // 用户主动取消
  let doneCalled = false // 防止 onDone 重复调用
  // 单次请求超时定时器
  let requestTimer: ReturnType<typeof setTimeout> | null = null

  function clearRequestTimer() {
    if (requestTimer) {
      clearTimeout(requestTimer)
      requestTimer = null
    }
  }

  function doFetch() {
    // 请求级超时：超过 cfg.requestTimeout 则中止本次请求并重试
    clearRequestTimer()
    const perRequestController = new AbortController()
    const combinedSignal = AbortSignal.any([controller.signal, perRequestController.signal])
    requestTimer = setTimeout(() => {
      console.warn(`[SSE] request timeout after ${cfg.requestTimeout}ms`)
      perRequestController.abort()
    }, cfg.requestTimeout)

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, userId, sessionId, message, terminalSessionId, projectContext, inlineDatas }),
      signal: combinedSignal,
    })
    .then((res) => {
      clearRequestTimer()
      if (!res.ok) {
        // 5xx 错误时重试
        if (res.status >= 500 && retryCount < cfg.maxRetries) {
          retryCount++
          console.warn(`[SSE] HTTP ${res.status}, retrying ${retryCount}/${cfg.maxRetries}...`)
          onReconnect?.(retryCount, cfg.maxRetries)
          setTimeout(doFetch, cfg.retryBaseDelay * retryCount)
          return
        }
        onError(`HTTP ${res.status}: ${res.statusText}`)
        return
      }

      // Phase 2: SSE 重连成功后，检查断线期间缓存的结果
      if (streamReconnectCount > 0 || retryCount > 0) {
        console.log('[SSE] 重连成功，检查断线期间缓存的结果...')
        fetch(`${getBaseUrl()}/api/v1/tool_result/pending_all`)
          .then(r => r.json())
          .then(data => {
            if (data.code === '0000' && data.data && Object.keys(data.data).length > 0) {
              console.log(`[SSE] 发现 ${Object.keys(data.data).length} 个断线期间缓存的结果`)
            }
          })
          .catch(err => console.warn('[SSE] 检查缓存结果失败:', err.message))
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
            // SSE stream ended normally
            if (!doneCalled) {
              doneCalled = true
              onDone(lastFullText)
            }
            return
          }
          buffer += decoder.decode(value, { stream: true })

          // 标记流已开始
          isStreamStarted = true

          // 按换行分割，解析 JSON 事件（后端直接发 JSON 行，无 data: 前缀）
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            // SSE message received

            try {
              const event: ReActEvent = JSON.parse(trimmed)
              // 忽略心跳保活事件
              if (event.event === 'heartbeat') {
                // SSE heartbeat received
                onHeartbeat?.()
                continue
              }
              isStreamStarted = true
              processEvent(event)
            } catch {
              // 非 JSON 行，忽略（可能是 HTTP chunk 边界）
            }
          }
          read()
        }).catch((err) => {
          if (err.name === 'AbortError' || isAborted) {
            // 用户主动取消，不重连
            return
          }
          // 流中途断开（网络错误/服务器关闭）
          if (isStreamStarted && streamReconnectCount < cfg.maxStreamReconnects) {
            streamReconnectCount++
            console.warn(`[SSE] stream interrupted, reconnecting ${streamReconnectCount}/${cfg.maxStreamReconnects}...`, err.message)
            onReconnect?.(streamReconnectCount, cfg.maxStreamReconnects)
            setTimeout(() => {
              if (!isAborted) doFetch()
            }, cfg.streamReconnectBaseDelay * streamReconnectCount)
          } else if (lastFullText) {
            // 已达重连上限，但有累积内容 → 交付已有内容 + 标记中断
            console.warn('[SSE] reconnect exhausted, delivering partial content')
            // 先通知中断（让前端显示恢复卡片），再交付部分内容
            onError('SSE 连接中断，部分内容可能不完整')
            if (!doneCalled) {
              doneCalled = true
              onDone(lastFullText)
            }
          } else {
            onError(err.message)
          }
        })
      }

      function processEvent(event: ReActEvent) {
        // Phase 2: 全事件类型日志（调试用）
        console.debug(`[SSE] event=${event.event}, cmdId=${event.cmdId || '-'}, toolName=${event.toolName || '-'}`)

        switch (event.event) {
          case 'text': {
            // 文本流 → 更新累积文本
            const fullText = event.fullText || event.content || ''
            lastFullText = fullText
            // SSE text chunk received
            onText(fullText)
            break
          }

          case 'tool_call': {
            // 工具调用 → 新建步骤
            stepCounter++
            const idx = stepCounter
            const toolName = event.toolName || 'unknown'
            const toolArgs = event.args || ''
            if (event.toolCallId) {
              toolStepMap.set(event.toolCallId, idx)
              toolNameMap.set(event.toolCallId, toolName)
            }
            onStep({
              stepType: 'tool_call',
              stepIndex: idx,
              toolName,
              toolParams: toolArgs,
              content: toolArgs ? `调用 ${toolName}: ${toolArgs}` : `调用 ${toolName}`,
              status: 'in_progress',
            })
            break
          }

          case 'tool_result': {
            // 工具结果 → 更新已有步骤
            const toolCallId = event.toolCallId || ''
            const existingIdx = toolStepMap.get(toolCallId)
            // 从映射补回 toolName（tool_result 事件本身不携带 toolName）
            const resolvedToolName = toolNameMap.get(toolCallId) || ''
            if (existingIdx !== undefined) {
              onStep({
                stepType: 'tool_call',
                stepIndex: existingIdx,
                toolName: resolvedToolName,
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
                toolName: resolvedToolName,
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
              // 保存 args 供完成事件使用
              const tn = event.toolName || 'unknown'
              if (event.args) toolProgressArgsMap.set(tn, event.args)
              // 工具开始执行
              stepCounter++
              // 更新 ToolProgressBar store
              toolProgressStore.set({
                toolCallId: `${tn}-${stepCounter}`,
                toolName: tn,
                status: 'running',
              })
              onStep({
                stepType: 'tool_call',
                stepIndex: stepCounter,
                toolName: tn,
                toolParams: event.args || '',
                content: `正在执行 ${tn}: ${event.args || ''}`,
                status: 'in_progress',
              })
            } else {
              // 工具执行完成（success/error）→ 补回 args 作为 toolParams
              const tn = event.toolName || 'unknown'
              const savedArgs = toolProgressArgsMap.get(tn) || ''
              // 更新 ToolProgressBar store
              toolProgressStore.update(`${tn}-${stepCounter}`, {
                status: event.status === 'success' ? 'success' : 'failure',
                detail: event.summary,
              })
              // 延迟移除进度条
              setTimeout(() => toolProgressStore.remove(`${tn}-${stepCounter}`), 2000)
              onStep({
                stepType: 'tool_call',
                stepIndex: stepCounter,
                toolName: tn,
                toolParams: savedArgs,
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
                // assistantContent 不存在于 ReActResultDTO，直接取 content
                finalContent = result.content || ''
              } catch (e) {
                console.warn('[SSE done] Failed to parse result JSON:', e)
                finalContent = ''
              }
            }
            // 如果解析失败或 content 为空，回退到 lastFullText
            if (!finalContent && lastFullText) {
              finalContent = lastFullText
            }
            // 传递文件变更摘要
            if (event.changeSummary) {
              onChangeSummary?.(event.changeSummary)
            }
            // 触发 onDone 回调，确保 loading 状态被清除
            // 后端可能不关闭 SSE 连接（缺少 emitter.complete()），
            // 所以不能依赖 reader.read() done 信号来触发 onDone
            if (!doneCalled) {
              doneCalled = true
              onDone(finalContent)
            }
            break
          }

          case 'error': {
            // 错误事件：同时通知 onStep（渲染到对话中）和 onError（触发 ErrorRecoveryCard）
            const errorMsg = event.content || '未知错误'
            onStep({
              stepType: 'result',
              stepIndex: ++stepCounter,
              error: errorMsg,
              status: 'failure',
            })
            // 触发错误恢复卡片
            onError(errorMsg)
            break
          }

          case 'warning': {
            // 警告（非致命）
            onWarning?.(event.content || '')
            break
          }

          case 'permission_confirm': {
            // 权限确认请求 → 推入 permissionStore
            if (event.permission && onPermissionConfirm) {
              onPermissionConfirm(event.permission)
            }
            break
          }

          case 'tool_output': {
            // 工具实时输出片段
            if (event.toolCallId && event.outputChunk) {
              onToolOutput?.(event.toolCallId, event.outputChunk)
            }
            break
          }

          case 'status': {
            // 状态更新（上下文压缩/降级/重连等）
            if (event.statusMessage) {
              onStatus?.(event.statusMessage)
            }
            break
          }

          case 'round_start': {
            // 新轮次开始
            if (event.content) {
              onRoundStart?.(parseInt(event.content, 10) || 1)
            }
            break
          }

          case 'execute_local_command': {
            // SSE 收到指令 → 直接执行 → POST 回传结果
            // GET /tool_result/pending 仅用于 SSE 断线重连后补取错过的指令
            const cmdId = event.cmdId || ''
            const command = event.command || ''
            const cwd = event.cwd || undefined
            const cmdTimeoutMs = event.timeoutMs || 60000

            if (!cmdId || !command) {
              console.warn('[SSE] execute_local_command missing cmdId or command', event)
              break
            }

            console.log(`[SSE] 收到本地指令: cmdId=${cmdId}, command=${command}`)

            // 异步执行本地命令并回传结果
            ;(async () => {
              const startTime = Date.now()
              try {
                // 调用 Tauri 本地命令执行
                const result = await invoke<{ success: boolean; stdout: string; stderr: string; exit_code: number }>(
                  'execute_shell_cmd',
                  {
                    command,
                    cwd,
                    timeoutMs: cmdTimeoutMs,
                    autoBackground: false,
                  }
                )

                const durationMs = Date.now() - startTime
                const output = (result.stdout || '') + (result.stderr ? `\n${result.stderr}` : '')

                console.log(`[SSE] 本地指令执行完成: cmdId=${cmdId}, exitCode=${result.exit_code}, durationMs=${durationMs}`)

                // 回传结果给 Server
                const baseUrl = getBaseUrl()
                await fetch(`${baseUrl}/api/v1/tool_result`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    cmdId,
                    sessionId,
                    status: result.success ? 'SUCCESS' : 'ERROR',
                    output,
                    exitCode: result.exit_code,
                    durationMs,
                    success: result.success,
                  }),
                })
              } catch (err: any) {
                const durationMs = Date.now() - startTime
                console.error(`[SSE] 本地指令执行失败: cmdId=${cmdId}`, err)

                // 回传错误结果
                try {
                  const baseUrl = getBaseUrl()
                  await fetch(`${baseUrl}/api/v1/tool_result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      cmdId,
                      sessionId,
                      status: 'ERROR',
                      error: err?.message || '本地命令执行失败',
                      durationMs,
                      success: false,
                    }),
                  })
                } catch (postErr) {
                  console.error(`[SSE] 回传指令结果失败: cmdId=${cmdId}`, postErr)
                }
              }
            })()
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
      clearRequestTimer()
      if (err.name !== 'AbortError' || !isAborted) {
        // 网络错误 / 超时重试
        if (retryCount < cfg.maxRetries) {
          retryCount++
          console.warn(`[SSE] Network/timeout error, retrying ${retryCount}/${cfg.maxRetries}...`, err.message)
          onReconnect?.(retryCount, cfg.maxRetries)
          setTimeout(doFetch, cfg.retryBaseDelay * retryCount)
          return
        }
        onError(err.message)
      }
    })
  }

  doFetch()

  return () => {
    isAborted = true
    clearRequestTimer()
    controller.abort()
  }
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
