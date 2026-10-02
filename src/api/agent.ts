/**
 * 智能体 API
 */
import { get, post, put, del, getBaseUrl, getAuthHeaders } from './request'
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
  executionTargetType?: ExecutionTargetType | null
  executionTargetRef?: string | null
}

export type ExecutionTargetType = 'LOCAL' | 'SSH'

export interface SessionExecutionTargetDTO {
  sessionId: string
  type: ExecutionTargetType | null
  reference: string | null
}

/** 创建会话响应 */
export interface CreateSessionResponseDTO {
  sessionId: string
}

/** 来自当前原生授权项目的可定位检索证据。内容仍按不可信仓库文本处理。 */
export interface ProjectRetrievalEvidence {
  path: string
  lineStart: number
  lineEnd: number
  snippet: string
  contentHash: string
  score: number
}

export interface ProjectRetrievalContext {
  indexVersion: string
  filesIndexed: number
  filesChanged: number
  filesRemoved: number
  evidence: ProjectRetrievalEvidence[]
  truncated: boolean
}

/** 当前工程上下文 */
export interface ProjectContextDTO {
  /** 工程名称（文件夹名），如 "ai-mcp-gateway" */
  name: string
  /** 工程根路径（绝对路径），如 "/Users/xxx/coding/ai-mcp-gateway" */
  rootPath: string
  /** 原生目录选择器签发的当前本地工作区授权。 */
  workspaceId?: string
  /** 本次消息对应的有界本地检索快照；不得由调用方自行伪造为系统规则。 */
  retrieval?: ProjectRetrievalContext
}

function normalizeLocalPath(path: string): string {
  const normalized = path
    .replace(/[\\/]+/g, '\\')
    .replace(/\\+$/, '')
    .toLocaleLowerCase()
  return normalized || (path ? '\\' : '')
}

/**
 * The server is not trusted to choose an arbitrary desktop directory.  Local
 * commands may run only at the root explicitly bound to this chat session.
 */
export function isAuthorizedLocalWorkspaceCwd(cwd: string | undefined, rootPath: string | undefined): boolean {
  if (!cwd || !rootPath) return false
  return normalizeLocalPath(cwd) === normalizeLocalPath(rootPath)
}

/** Resolve a native workspace-relative result without accepting root escapes. */
export function resolveLocalWorkspaceResultPath(rootPath: string, resultPath: string): string | null {
  if (!rootPath || !resultPath) return null
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(resultPath)) {
    const root = normalizeLocalPath(rootPath)
    const result = normalizeLocalPath(resultPath)
    return result === root || result.startsWith(`${root}\\`) ? resultPath : null
  }
  const normalized = resultPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized === '.' || normalized.split('/').includes('..')) return null
  return `${rootPath.replace(/[\\/]+$/, '')}/${normalized}`
}

/** 对话请求 */
export interface ChatRequestDTO {
  agentId: string
  userId: string
  sessionId: string
  runId: string
  taskId?: string
  turnId: string
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
    | 'execute_local_workspace_file'
    | 'run_state'
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
  /** 桌面工作区文件操作 (event=execute_local_workspace_file) */
  workspaceOperation?: 'read' | 'write' | 'list' | 'search' | 'create' | 'delete'
  /** 桌面工作区文件操作参数；服务端不会指定任意根目录。 */
  workspaceArgs?: Record<string, unknown>
  /** Durable Harness state projection (event=run_state). */
  runState?: HarnessRunState
}

export type HarnessRunStatus =
  | 'PLANNING'
  | 'RUNNING'
  | 'WAITING_CONFIRMATION'
  | 'VERIFYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'INTERRUPTED'

export interface HarnessRunState {
  taskId: string
  runId: string
  sessionId: string
  status: HarnessRunStatus
  reason?: string | null
  updatedAt: number
}

export interface HarnessTaskDTO {
  taskId: string
  sessionId: string
  agentId: string
  turnId: string
  title: string | null
  goalSummary: string | null
  executionTargetType: string | null
  executionTargetRef: string | null
  currentRunId: string | null
  status: HarnessRunStatus
  version: number
  createdAt: number | null
  updatedAt: number | null
}

export interface HarnessRunDTO {
  runId: string
  taskId: string
  sessionId: string
  attemptNo: number
  status: HarnessRunStatus
  stopReason: string | null
  errorCode: string | null
  errorSummary: string | null
  version: number
  startedAt: number | null
  completedAt: number | null
  createdAt: number | null
  updatedAt: number | null
}

export interface HarnessEvidenceDTO {
  kind: 'RUN' | 'CONTEXT' | 'PLAN' | 'TOOL'
  title: string
  status: string
  category?: string | null
  reasonCode?: string | null
  referenceId?: string | null
  durationMs?: number | null
  outputChars?: number | null
  used?: number | null
  budget?: number | null
  sourceCounts?: Record<string, number> | null
  mutating?: boolean | null
  errorCode?: string | null
}

export interface HarnessRunEventDTO {
  sequenceId: number
  eventId: string
  taskId: string
  runId: string
  eventType: string
  fromStatus: HarnessRunStatus | null
  toStatus: HarnessRunStatus | null
  evidence: HarnessEvidenceDTO | null
  createdAt: number | null
}

export type HarnessPlanStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'VERIFYING'
  | 'SUCCEEDED'
  | 'RETRYABLE_FAILURE'
  | 'NEEDS_REPLAN'
  | 'NEEDS_USER_INPUT'
  | 'FAILED'
  | 'CANCELLED'

export interface HarnessPlanStepDTO {
  stepId: string
  taskId: string
  ordinal: number
  title: string
  objective: string | null
  riskSummary: string | null
  acceptanceCriteria: string | null
  status: HarnessPlanStepStatus
  attemptCount: number
  maxAttempts: number
  failureKind: string
  failureSummary: string | null
  version: number
  createdAt: number | null
  updatedAt: number | null
}

/** 权限确认事件数据 */
export interface PermissionConfirmData {
  ticket: string
  sessionId: string
  runId: string
  toolCallId: string
  toolName: string
  toolArgs: string
  argsDigest: string
  riskLevel: 'DENY' | 'CONFIRM' | 'ALLOW'
  reason: string
  timeoutMs: number
  expiresAt: number
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
  console.error('[agentApi] queryAgentList failed')
  return []
}

/** 创建会话 */
export async function createSession(
  agentId: string,
  userId: string = 'default',
  executionTarget?: { type: ExecutionTargetType; reference: string } | null,
): Promise<string | null> {
  const res = await post<CreateSessionResponseDTO>('/api/v1/create_session', {
    agentId,
    userId,
    executionTargetType: executionTarget?.type ?? null,
    executionTargetRef: executionTarget?.reference ?? null,
  })
  if (res.code === '0000' && res.data?.sessionId) {
    return res.data.sessionId
  }
  console.error('[agentApi] createSession failed')
  return null
}

export interface ChatSessionSummaryDTO {
  sessionId: string
  agentId: string
  title: string | null
  messageCount: number
  executionTargetType: ExecutionTargetType | null
  executionTargetRef: string | null
  createdAt: number | null
  updatedAt: number | null
}

export interface ChatHistoryMessageDTO {
  id: number
  turnId: string | null
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string | null
  toolName?: string | null
  toolCallId?: string | null
  createdAt: number | null
}

export type AgentMemoryScope = 'SESSION' | 'PROJECT' | 'EXPERIENCE'

export interface AgentMemoryDTO {
  memoryId: string
  scope: AgentMemoryScope
  factText: string
  suggestedScope?: AgentMemoryScope | null
  proposalOrigin?: 'USER_REQUEST' | 'AGENT_PROPOSAL' | 'DETERMINISTIC_TOOL' | null
  candidateConfidence?: number | null
  candidateRationale?: string | null
  autoActivationEligible?: boolean | null
  status: 'PENDING' | 'ACTIVE' | 'STALE' | 'SUPERSEDED' | 'REJECTED' | 'EXPIRED' | 'REVOKED' | 'DELETED'
  verification: 'NONE' | 'USER_CONFIRMED' | 'TOOL_VERIFIED'
  confidence: number
  sourceType: string
  sourceSessionId?: string | null
  sourceTaskId?: string | null
  sourceRunId?: string | null
  sourceEventId?: string | null
  revisionNo: number
  expiresAt?: string | null
  lastVerifiedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  expired?: boolean | null
  usageCount?: number | null
  lastUsedAt?: string | null
  supersedesMemoryIds?: string[] | null
  supersededByMemoryIds?: string[] | null
  evidence?: AgentMemoryEvidenceDTO[] | null
  relations?: AgentMemoryRelationDTO[] | null
}

export interface AgentMemoryEvidenceDTO {
  evidenceId: string
  evidenceType: string
  sourceRunId?: string | null
  sourceSessionId?: string | null
  sourceEventId?: string | null
  evidenceRef?: string | null
  summary?: string | null
  createdAt?: string | null
}

export interface AgentMemoryRelationDTO {
  relationId: string
  fromMemoryId: string
  toMemoryId: string
  relationType: string
  sourceEvidenceId?: string | null
  createdAt?: string | null
}

export interface AgentMemoryCandidateRequestDTO {
  scope: AgentMemoryScope
  sessionId?: string | null
  projectRootPath?: string | null
  factText: string
}

export type AgentMemoryBatchAction = 'CONFIRM' | 'REJECT'

export interface AgentMemoryBatchResultDTO {
  memoryId: string
  succeeded: boolean
  error?: string | null
  memory?: AgentMemoryDTO | null
}

export async function listMemories(): Promise<AgentMemoryDTO[]> {
  const res = await get<AgentMemoryDTO[]>('/api/v1/memory/list')
  if (res.code !== '0000' || !res.data) throw new Error(res.info || '加载记忆失败')
  return res.data
}

export async function proposeMemory(request: AgentMemoryCandidateRequestDTO): Promise<AgentMemoryDTO> {
  const res = await post<AgentMemoryDTO>('/api/v1/memory/candidate', request)
  if (res.code !== '0000' || !res.data) throw new Error(res.info || '创建记忆候选失败')
  return res.data
}

export async function confirmMemory(memoryId: string): Promise<AgentMemoryDTO> {
  const res = await post<AgentMemoryDTO>(`/api/v1/memory/${encodeURIComponent(memoryId)}/confirm`)
  if (res.code !== '0000' || !res.data) throw new Error(res.info || '确认记忆失败')
  return res.data
}

export async function editMemory(memoryId: string, factText: string): Promise<AgentMemoryDTO> {
  const res = await post<AgentMemoryDTO>(`/api/v1/memory/${encodeURIComponent(memoryId)}/edit`, { factText })
  if (res.code !== '0000' || !res.data) throw new Error(res.info || '编辑记忆候选失败')
  return res.data
}

export async function batchMemoryAction(memoryIds: string[], action: AgentMemoryBatchAction): Promise<AgentMemoryBatchResultDTO[]> {
  const res = await post<AgentMemoryBatchResultDTO[]>('/api/v1/memory/batch', { memoryIds, action })
  if (res.code !== '0000' || !res.data) throw new Error(res.info || '批量处理记忆失败')
  return res.data
}

export async function supersedeMemory(memoryId: string, previousMemoryId: string): Promise<void> {
  const res = await post<string>(`/api/v1/memory/${encodeURIComponent(memoryId)}/supersede`, { previousMemoryId })
  if (res.code !== '0000') throw new Error(res.info || '建立替代关系失败')
}

export async function rejectMemory(memoryId: string): Promise<AgentMemoryDTO> {
  const res = await post<AgentMemoryDTO>(`/api/v1/memory/${encodeURIComponent(memoryId)}/reject`)
  if (res.code !== '0000' || !res.data) throw new Error(res.info || '拒绝记忆失败')
  return res.data
}

export async function deleteMemory(memoryId: string): Promise<void> {
  const res = await post<AgentMemoryDTO>(`/api/v1/memory/${encodeURIComponent(memoryId)}/delete`)
  if (res.code !== '0000') throw new Error(res.info || '删除记忆失败')
}

export interface ResumeSessionResponseDTO {
  sessionId: string
  restored: boolean
  replayedMessageCount: number
}

/** 查询当前认证用户的持久化历史会话。 */
export async function listSessions(limit = 100): Promise<ChatSessionSummaryDTO[]> {
  const res = await get<ChatSessionSummaryDTO[]>('/api/v1/session/list', { limit: String(limit) })
  if (res.code !== '0000' || !res.data) {
    throw new Error(res.info || '加载历史会话失败')
  }
  return res.data
}

/** 加载一条历史会话的持久化消息。 */
export async function getSessionMessages(sessionId: string): Promise<ChatHistoryMessageDTO[]> {
  const res = await get<ChatHistoryMessageDTO[]>(`/api/v1/session/${encodeURIComponent(sessionId)}/messages`)
  if (res.code !== '0000' || !res.data) {
    throw new Error(res.info || '加载历史消息失败')
  }
  return res.data
}

export async function listHarnessTasks(sessionId: string, limit = 100): Promise<HarnessTaskDTO[]> {
  const res = await get<HarnessTaskDTO[]>(
    `/api/v1/session/${encodeURIComponent(sessionId)}/tasks`,
    { limit: String(limit) },
  )
  if (res.code !== '0000' || !res.data) throw new Error(res.info || '加载 Harness Task 失败')
  return res.data
}

export async function listHarnessRuns(taskId: string): Promise<HarnessRunDTO[]> {
  const res = await get<HarnessRunDTO[]>(`/api/v1/task/${encodeURIComponent(taskId)}/runs`)
  if (res.code !== '0000' || !res.data) throw new Error(res.info || '加载 Harness Run 失败')
  return res.data
}

export async function listHarnessPlanSteps(taskId: string): Promise<HarnessPlanStepDTO[]> {
  const res = await get<HarnessPlanStepDTO[]>(`/api/v1/task/${encodeURIComponent(taskId)}/plan`)
  if (res.code !== '0000' || !res.data) throw new Error(res.info || '加载 Harness 计划失败')
  return res.data
}

export async function listHarnessRunEvents(runId: string): Promise<HarnessRunEventDTO[]> {
  const res = await get<HarnessRunEventDTO[]>(`/api/v1/run/${encodeURIComponent(runId)}/events`)
  if (res.code !== '0000' || !res.data) throw new Error(res.info || '加载 Harness 事件失败')
  return res.data
}

/** 将历史会话恢复到服务端当前 ADK 内存运行时。 */
export async function resumeSession(sessionId: string): Promise<ResumeSessionResponseDTO> {
  const res = await post<ResumeSessionResponseDTO>('/api/v1/session/resume', { sessionId })
  if (res.code !== '0000' || !res.data?.sessionId) {
    throw new Error(res.info || '恢复历史会话失败')
  }
  return res.data
}

/** 更新并返回服务端校验后的会话级执行目标。 */
export async function updateExecutionTarget(
  sessionId: string,
  target: { type: ExecutionTargetType; reference: string } | null,
): Promise<SessionExecutionTargetDTO> {
  const res = await put<SessionExecutionTargetDTO>(
    `/api/v1/session/${encodeURIComponent(sessionId)}/execution-target`,
    target ? { type: target.type, reference: target.reference } : { type: 'NONE', reference: null },
  )
  if (res.code !== '0000' || !res.data?.sessionId) {
    throw new Error(res.info || '更新执行目标失败')
  }
  return res.data
}

/** 逻辑删除一条历史会话。 */
export async function deleteSession(sessionId: string): Promise<void> {
  const res = await del<boolean>(`/api/v1/session/${encodeURIComponent(sessionId)}`)
  if (res.code !== '0000' || res.data !== true) {
    throw new Error(res.info || '删除历史会话失败')
  }
}

export interface ReviseSessionResponseDTO {
  sessionId: string
  copiedMessageCount: number
}

/** 从指定用户消息之前创建一条内部修订会话。 */
export async function reviseSession(
  sourceSessionId: string,
  turnId: string,
  userMessageIndex: number,
): Promise<ReviseSessionResponseDTO> {
  const res = await post<ReviseSessionResponseDTO>('/api/v1/session/revise', {
    sourceSessionId,
    turnId,
    userMessageIndex,
  })
  if (res.code !== '0000' || !res.data?.sessionId) {
    throw new Error(res.info || '会话修订失败')
  }
  return res.data
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
  // 用户消息与本次全部 Agent 输出共享的稳定回合 ID
  turnId?: string,
  // 重试同一个 Harness Task 时复用；新目标留空
  taskId?: string,
  onRunState?: (state: HarnessRunState) => void,
  // Native workspace file mutations bypass the ordinary server-side tool-step
  // rendering path, so consumers need an explicit, capability-safe refresh hook.
  onLocalWorkspaceMutation?: (operation: 'write' | 'create' | 'delete', path: string) => void,
): () => void {
  const baseUrl = getBaseUrl()
  const url = `${baseUrl}/api/v1/chat_stream`
  const runId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `run_${Date.now()}_${Math.random().toString(36).slice(2)}`

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
  // local process session ID -> server command ID.  Keeping both lets cancellation
  // close the OS process and complete the server-side command lifecycle.
  const activeLocalCommands = new Map<string, string>()
  const activeWorkspaceFileOperations = new Map<string, string>()
  // 单次请求超时定时器
  let requestTimer: ReturnType<typeof setTimeout> | null = null
  // Transport retry must reuse the same evidence snapshot so one run remains reproducible.
  let localRetrieval: ProjectRetrievalContext | undefined
  let retrievalAttempted = false

  function clearRequestTimer() {
    if (requestTimer) {
      clearTimeout(requestTimer)
      requestTimer = null
    }
  }

  async function stopTrackedLocalCommand(sessionId: string) {
    let lastError = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await invoke('kill_stream_shell', { sessionId })
        return
      } catch (err) {
        lastError = String(err)
        if (!lastError.includes('No running process')) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    // 命令可能恰好在取消前自行结束；只有登记仍存在时才报告真实终止失败。
    if (activeLocalCommands.has(sessionId) && !lastError.includes('No running process')) {
      console.error(`[Agent] failed to stop local command ${sessionId}`)
      onError(`Agent 已停止，但有本地命令未能确认终止：${lastError}`)
    }
  }

  async function stopWorkspaceFileOperation(operationId: string) {
    try {
      await invoke<boolean>('cancel_workspace_file_operation', { operationId })
    } catch (error) {
      console.error('[Agent] failed to cancel local workspace file operation:', error instanceof Error ? error.name : 'unknown')
    }
  }

  async function doFetch() {
    if (!retrievalAttempted && projectContext?.workspaceId) {
      retrievalAttempted = true
      onStatus?.('正在索引并检索本地项目…')
      try {
        localRetrieval = await invoke<ProjectRetrievalContext>('retrieve_local_project_context', {
          workspaceId: projectContext.workspaceId,
          query: message,
          maxResults: 8,
        })
        const sourcePreview = localRetrieval.evidence
          .slice(0, 3)
          .map((item) => `${item.path}:${item.lineStart}-${item.lineEnd}`)
          .join('、')
        const overflow = localRetrieval.evidence.length > 3 ? ' 等' : ''
        onStatus?.(
          `本地项目检索完成：${localRetrieval.filesIndexed} 个文件，${localRetrieval.evidence.length} 条证据`
          + (sourcePreview ? `（来源：${sourcePreview}${overflow}）` : ''),
        )
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err || '未知错误')
        console.warn('[Agent] local project retrieval unavailable:', reason)
        onWarning?.(`本地项目检索不可用，本次将不附带仓库证据：${reason}`)
      }
    }
    if (isAborted) return

    // 请求级超时：超过 cfg.requestTimeout 则中止本次请求并重试
    clearRequestTimer()
    const perRequestController = new AbortController()
    const combinedSignal = AbortSignal.any([controller.signal, perRequestController.signal])
    requestTimer = setTimeout(() => {
      console.warn(`[SSE] request timeout after ${cfg.requestTimeout}ms`)
      perRequestController.abort()
    }, cfg.requestTimeout)

    // workspaceId is a native capability and must never be disclosed to the
    // server. Only bounded repository evidence crosses this trust boundary.
    const serverProjectContext = projectContext
      ? { name: projectContext.name, rootPath: projectContext.rootPath, retrieval: localRetrieval }
      : projectContext
    fetch(url, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ agentId, userId, sessionId, runId, taskId, turnId, message, terminalSessionId, projectContext: serverProjectContext, inlineDatas }),
      signal: combinedSignal,
    })
    .then(async (res) => {
      clearRequestTimer()
      // 取消可能发生在 HTTP 响应到达之前；此时绝不能再消费响应中的任何事件。
      if (isAborted) return
      if (!res.ok) {
        // 5xx 错误时重试
        if (res.status >= 500 && retryCount < cfg.maxRetries) {
          retryCount++
          console.warn(`[SSE] HTTP ${res.status}, retrying ${retryCount}/${cfg.maxRetries}...`)
          onReconnect?.(retryCount, cfg.maxRetries)
          setTimeout(doFetch, cfg.retryBaseDelay * retryCount)
          return
        }
        let message = res.statusText
        try {
          const payload = await res.json() as { info?: unknown }
          if (typeof payload.info === 'string' && payload.info) message = payload.info
        } catch {
          // Non-JSON transport failures retain the HTTP status text.
        }
        onError(`HTTP ${res.status}: ${message || '请求失败'}`)
        return
      }

      // Phase 2: SSE 重连成功后，检查断线期间缓存的结果
      if (streamReconnectCount > 0 || retryCount > 0) {
        console.log('[SSE] 重连成功，检查断线期间缓存的结果...')
        fetch(`${getBaseUrl()}/api/v1/tool_result/pending_all?sessionId=${encodeURIComponent(sessionId)}`, { headers: getAuthHeaders() })
          .then(r => r.json())
          .then(data => {
            if (data.code === '0000' && data.data && Object.keys(data.data).length > 0) {
              console.log(`[SSE] 发现 ${Object.keys(data.data).length} 个断线期间缓存的结果`)
            }
          })
          .catch(err => console.warn('[SSE] 检查缓存结果失败:', err instanceof Error ? err.name : 'unknown'))
      }

      const reader = res.body!.getReader()
      if (!reader) {
        onError('No response body')
        return
      }
      const decoder = new TextDecoder()
      let buffer = ''

      function read() {
        if (isAborted) return
        reader.read().then(({ done, value }) => {
          // AbortController 无法保证已经排队的 ReadableStream chunk 不会到达。
          // 在消费前再次检查，避免取消后仍把迟到内容渲染进对话。
          if (isAborted) return
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
            console.warn(`[SSE] stream interrupted, reconnecting ${streamReconnectCount}/${cfg.maxStreamReconnects}...`, err instanceof Error ? err.name : 'unknown')
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
        if (isAborted) return
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

          case 'run_state': {
            if (event.runState) onRunState?.(event.runState)
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
              console.warn('[SSE] execute_local_command missing cmdId or command')
              break
            }

            if (!isAuthorizedLocalWorkspaceCwd(cwd, projectContext?.rootPath)) {
              const baseUrl = getBaseUrl()
              fetch(`${baseUrl}/api/v1/tool_result`, {
                method: 'POST',
                headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                  cmdId,
                  sessionId,
                  status: 'ERROR',
                  error: '本地命令工作目录未绑定到当前会话授权项目，已拒绝执行',
                  durationMs: 0,
                  success: false,
                }),
              }).catch((postErr) => console.error(`[SSE] 回传工作目录拒绝结果失败: cmdId=${cmdId}`, postErr))
              break
            }

            console.log(`[SSE] 收到本地指令: cmdId=${cmdId}, commandLength=${command.length}`)

            // 可变更命令已由服务端 PermissionGuard 生成一次性、参数绑定的票据，
            // 并由 PermissionConfirmModal 处理。这里不得再弹出 window.confirm，
            // 否则用户会看到两套“同意/拒绝”，且第一次确认看起来像没有生效。

            // 异步执行本地命令并回传结果
            ;(async () => {
              const startTime = Date.now()
              const localCommandSessionId = `agent-${runId}-${cmdId}`
              activeLocalCommands.set(localCommandSessionId, cmdId)
              try {
                if (isAborted) {
                  await post('/api/v1/tool_result', {
                    cmdId,
                    sessionId,
                    status: 'CANCELLED',
                    error: 'Agent 运行已停止，未启动本地命令',
                    durationMs: 0,
                    success: false,
                  })
                  return
                }
                // 调用 Tauri 本地命令执行
                const result = await invoke<{ success: boolean; stdout: string; stderr: string; exit_code: number; timed_out?: boolean }>(
                  'execute_shell_cmd',
                  {
                    command,
                    cwd,
                    timeoutMs: cmdTimeoutMs,
                    autoBackground: false,
                    sessionId: localCommandSessionId,
                  }
                )

                const durationMs = Date.now() - startTime
                if (isAborted) {
                  await post('/api/v1/tool_result', {
                    cmdId,
                    sessionId,
                    status: 'CANCELLED',
                    error: 'Agent 运行已停止，本地命令已终止',
                    durationMs,
                    success: false,
                  })
                  return
                }
                const output = (result.stdout || '') + (result.stderr ? `\n${result.stderr}` : '')

                console.log(`[SSE] 本地指令执行完成: cmdId=${cmdId}, exitCode=${result.exit_code}, durationMs=${durationMs}`)

                // 回传结果给 Server
                await post('/api/v1/tool_result', {
                  cmdId,
                  sessionId,
                  status: result.timed_out ? 'TIMEOUT' : (result.success ? 'SUCCESS' : 'ERROR'),
                  output,
                  error: result.timed_out ? '命令执行超时，已终止进程树' : undefined,
                  exitCode: result.exit_code,
                  durationMs,
                  success: result.success,
                })
              } catch (err: any) {
                const durationMs = Date.now() - startTime
                console.error(`[SSE] 本地指令执行失败: cmdId=${cmdId}, errorType=${err instanceof Error ? err.name : 'unknown'}`)

                // 回传错误结果
                try {
                  await post('/api/v1/tool_result', {
                    cmdId,
                    sessionId,
                    status: isAborted ? 'CANCELLED' : 'ERROR',
                    error: isAborted ? 'Agent 运行已停止，本地命令已终止' : (err?.message || '本地命令执行失败'),
                    durationMs,
                    success: false,
                  })
                } catch (postErr) {
                  console.error(`[SSE] 回传指令结果失败: cmdId=${cmdId}, errorType=${postErr instanceof Error ? postErr.name : 'unknown'}`)
                }
              } finally {
                activeLocalCommands.delete(localCommandSessionId)
              }
            })()
            break
          }

          case 'execute_local_workspace_file': {
            const cmdId = event.cmdId || ''
            const cwd = event.cwd || undefined
            const operation = event.workspaceOperation
            const args = event.workspaceArgs || {}
            if (!cmdId || !operation) {
              console.warn('[SSE] execute_local_workspace_file missing cmdId or operation')
              break
            }

            const reject = async (error: string) => {
              await post('/api/v1/tool_result', {
                cmdId, sessionId, status: 'ERROR', error, durationMs: 0, success: false,
              })
            }
            if (!isAuthorizedLocalWorkspaceCwd(cwd, projectContext?.rootPath) || !projectContext?.workspaceId) {
              reject('本地文件操作工作目录未绑定到当前会话授权项目，已拒绝执行')
                .catch((err) => console.error('[SSE] 回传文件操作工作目录拒绝结果失败', err))
              break
            }

            const mutation = operation === 'write' || operation === 'create' || operation === 'delete'
            const path = String(args.filePath || args.dirPath || args.directory || '')
            // 写入、创建、删除必须已经经过同一张服务端一次性权限票据；
            // 不再追加浏览器 confirm，防止与 PermissionConfirmModal 重复确认。

            ;(async () => {
              const startedAt = Date.now()
              const operationId = `agent-file-${runId}-${cmdId}`
              const deadlineMs = startedAt + Math.min(Math.max(event.timeoutMs || 20_000, 1_000), 60_000)
              activeWorkspaceFileOperations.set(operationId, cmdId)
              try {
                if (isAborted) {
                  await post('/api/v1/tool_result', { cmdId, sessionId, status: 'CANCELLED', error: 'Agent 运行已停止，未启动本地文件操作', durationMs: 0, success: false })
                  return
                }
                const result = await invoke<Record<string, unknown>>('execute_workspace_file_operation', {
                  operation, workspaceId: projectContext.workspaceId, args, operationId, deadlineMs,
                })
                if (isAborted) {
                  await post('/api/v1/tool_result', {
                    cmdId, sessionId, status: 'CANCELLED', error: 'Agent 运行已停止，本地文件操作已取消',
                    durationMs: Date.now() - startedAt, success: false,
                  })
                  return
                }
                const success = result.success === true
                if (success && mutation) {
                  const resultPath = typeof result.path === 'string' ? result.path : path
                  try {
                    onLocalWorkspaceMutation?.(operation, resultPath)
                  } catch (refreshError) {
                    console.error('[SSE] local workspace refresh callback failed:', refreshError instanceof Error ? refreshError.name : 'unknown')
                  }
                }
                await post('/api/v1/tool_result', {
                  cmdId, sessionId, status: success ? 'SUCCESS' : 'ERROR',
                  output: JSON.stringify(result), error: success ? undefined : String(result.error || '本地文件操作失败'),
                  exitCode: success ? 0 : 1, durationMs: Date.now() - startedAt, success,
                })
              } catch (err: any) {
                await post('/api/v1/tool_result', {
                  cmdId, sessionId, status: isAborted ? 'CANCELLED' : 'ERROR',
                  error: isAborted
                    ? 'Agent 运行已停止，本地文件操作已取消'
                    : (err instanceof Error ? err.message : String(err || '本地文件操作失败')),
                  durationMs: Date.now() - startedAt, success: false,
                })
              } finally {
                activeWorkspaceFileOperations.delete(operationId)
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
          console.warn(`[SSE] Network/timeout error, retrying ${retryCount}/${cfg.maxRetries}...`, err instanceof Error ? err.name : 'unknown')
          onReconnect?.(retryCount, cfg.maxRetries)
          setTimeout(doFetch, cfg.retryBaseDelay * retryCount)
          return
        }
        onError(err.message)
      }
    })
  }

  void doFetch()

  return () => {
    if (isAborted) return
    isAborted = true
    clearRequestTimer()
    // 使用独立 HTTP 请求通知服务端；它不受下方流式请求 AbortController 影响。
    void post<boolean>('/api/v1/chat_stream/cancel', { runId }).then((response) => {
      if (response.code !== '0000') {
        console.warn(`[Agent] cancel run request failed: code=${response.code}`)
      }
    })
    activeLocalCommands.forEach((_cmdId, sessionId) => {
      void stopTrackedLocalCommand(sessionId)
    })
    activeWorkspaceFileOperations.forEach((_cmdId, operationId) => {
      void stopWorkspaceFileOperation(operationId)
    })
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
