import { useEffect, useMemo, useState } from 'react'
import { useAgentStore } from '../stores/agentStore'
import { useHarnessStore } from '../stores/harnessStore'
import { useThemeStore } from '../stores/themeStore'
import type { HarnessEvidenceDTO, HarnessPlanStepStatus, HarnessRunEventDTO, HarnessRunStatus } from '../api/agent'

const STATUS_LABEL: Record<HarnessRunStatus, string> = {
  PLANNING: '规划中',
  RUNNING: '执行中',
  WAITING_CONFIRMATION: '等待确认',
  VERIFYING: '验证中',
  SUCCEEDED: '已成功',
  FAILED: '失败',
  CANCELLED: '已停止',
  INTERRUPTED: '被重启中断',
}

function stateColor(status: HarnessRunStatus, colors: ReturnType<typeof useThemeStore.getState>['colors']) {
  if (status === 'SUCCEEDED') return colors.green
  if (status === 'FAILED') return colors.red
  if (status === 'CANCELLED' || status === 'INTERRUPTED') return colors.textDim
  if (status === 'WAITING_CONFIRMATION') return colors.yellow
  return colors.accent
}

const PLAN_STATUS_LABEL: Record<HarnessPlanStepStatus, string> = {
  PENDING: '待执行', RUNNING: '执行中', VERIFYING: '验证中', SUCCEEDED: '已验证',
  RETRYABLE_FAILURE: '可重试', NEEDS_REPLAN: '需重规划', NEEDS_USER_INPUT: '等待用户',
  FAILED: '失败', CANCELLED: '已取消',
}

function planStateColor(status: HarnessPlanStepStatus, colors: ReturnType<typeof useThemeStore.getState>['colors']) {
  if (status === 'SUCCEEDED') return colors.green
  if (status === 'RETRYABLE_FAILURE' || status === 'NEEDS_REPLAN' || status === 'FAILED') return colors.red
  if (status === 'NEEDS_USER_INPUT') return colors.yellow
  return status === 'PENDING' ? colors.textDim : colors.accent
}

const CONTEXT_SOURCE_LABEL: Record<string, string> = {
  SYSTEM_RULES: '系统规则', USER_TASK: '当前任务', PLAN: '计划', EXECUTION_TARGET: '执行目标',
  PROJECT_CONTEXT: '项目', REPOSITORY_CONTEXT: '仓库检索', LONG_TERM_MEMORY: '长期记忆',
  RECENT_STEP: '最近步骤', TOOL_RESULT: '工具结果', VALIDATION: '验证结果', CONVERSATION_HISTORY: '会话历史',
}

const REASON_LABEL: Record<string, string> = {
  permission_confirmation_required: '需要权限确认', permission_rejected: '权限被拒绝',
  route_changed: '执行目标已变更', resource_limit: '资源配额已达上限',
  context_assembled: '上下文已装配', tool_call_completed: '工具调用已完成',
  step_verified: '步骤已验证', step_validation_failed: '验证未通过',
}

function evidenceLabel(event: HarnessRunEventDTO) {
  const evidence = event.evidence
  if (!evidence) return event.toStatus ? STATUS_LABEL[event.toStatus] : '运行事件'
  if (evidence.kind === 'CONTEXT') {
    const budget = Number.isFinite(evidence.used) && Number.isFinite(evidence.budget)
      ? `上下文 ${evidence.used}/${evidence.budget}` : '上下文已装配'
    const sources = Object.entries(evidence.sourceCounts || {})
      .map(([source, count]) => `${CONTEXT_SOURCE_LABEL[source] || '来源'} ${count}`).join(' · ')
    return sources ? `${budget} · ${sources}` : budget
  }
  if (evidence.kind === 'TOOL') {
    const outcome = evidence.status === 'SUCCEEDED' ? '完成' : evidence.status === 'FAILED' ? '失败' : evidence.status
    return evidence.durationMs != null ? `${evidence.title} · ${outcome} · ${evidence.durationMs}ms` : `${evidence.title} · ${outcome}`
  }
  const reason = evidence.reasonCode ? REASON_LABEL[evidence.reasonCode] || '受控状态变更' : ''
  return reason ? `${evidence.title} · ${reason}` : (evidence.title || '运行事件')
}

function evidenceTitle(evidence?: HarnessEvidenceDTO | null) {
  if (!evidence) return '只展示服务端白名单化证据；不会展示原始工具参数、命令、文件路径、输出或提示词。'
  const details = [
    evidence.category ? `类别：${evidence.category}` : null,
    evidence.outputChars != null ? `输出长度：${evidence.outputChars}` : null,
    evidence.mutating ? '受控变更：是' : null,
    evidence.errorCode ? `错误码：${evidence.errorCode}` : null,
  ].filter(Boolean)
  return details.length > 0 ? details.join('；') : '只展示服务端白名单化证据；不会展示原始工具参数、命令、文件路径、输出或提示词。'
}

export function HarnessRunStatusBar() {
  const colors = useThemeStore(state => state.colors)
  const sessionId = useAgentStore(state => state.currentSessionId)
  const {
    tasksBySession, runsByTask, eventsByRun, planStepsByTask, liveRunBySession,
    continuationTaskBySession, loadingSessionId, error, loadTasks, loadTimeline, selectTaskContinuation,
  } = useHarnessStore()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setExpanded(false)
    if (sessionId) void loadTasks(sessionId)
  }, [sessionId, loadTasks])

  const live = sessionId ? liveRunBySession.get(sessionId) : undefined
  const task = useMemo(() => {
    if (!sessionId) return undefined
    const tasks = tasksBySession.get(sessionId) || []
    return (live ? tasks.find(item => item.taskId === live.taskId) : undefined) || tasks[0]
  }, [sessionId, tasksBySession, live])
  const taskId = live?.taskId || task?.taskId
  const runId = live?.runId || task?.currentRunId
  const status = live?.status || task?.status
  const runs = taskId ? runsByTask.get(taskId) || [] : []
  const activeRun = runId ? runs.find(run => run.runId === runId) : runs[runs.length - 1]
  const events = runId ? eventsByRun.get(runId) || [] : []
  const planSteps = taskId ? planStepsByTask.get(taskId) || [] : []
  const continuationSelected = sessionId ? continuationTaskBySession.get(sessionId) === taskId : false
  const runIsTerminal = !!status && ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(status)
  const canContinue = runIsTerminal && planSteps.some(step =>
    step.status === 'PENDING' || step.status === 'RETRYABLE_FAILURE')

  useEffect(() => {
    if (expanded && taskId) void loadTimeline(taskId, runId)
  }, [expanded, taskId, runId, live?.updatedAt, loadTimeline])

  if (!sessionId || (!status && loadingSessionId !== sessionId && !error)) return null

  return (
    <div style={{ borderBottom: `1px solid ${colors.border}`, backgroundColor: colors.bgSecondary }}>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
        onClick={() => taskId && setExpanded(value => !value)}
        disabled={!taskId}
        title={taskId ? '展开查看 Harness 运行时间线' : undefined}
      >
        <span
          className={status && !['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(status) ? 'animate-pulse' : ''}
          style={{ color: status ? stateColor(status, colors) : colors.textDim }}
        >●</span>
        <span className="text-[11px] font-medium" style={{ color: colors.textSecondary }}>Harness</span>
        <span className="text-[11px]" style={{ color: status ? stateColor(status, colors) : colors.textDim }}>
          {status ? STATUS_LABEL[status] : loadingSessionId === sessionId ? '加载中' : '状态不可用'}
        </span>
        {activeRun && <span className="text-[10px]" style={{ color: colors.textDim }}>第 {activeRun.attemptNo} 次运行</span>}
        {taskId && <code className="ml-auto text-[9px]" style={{ color: colors.textDim }}>{taskId.slice(0, 13)}…</code>}
        {taskId && <span className="text-[10px]" style={{ color: colors.textDim }}>{expanded ? '▴' : '▾'}</span>}
      </button>
      {expanded && taskId && (
        <div className="px-3 pb-2 space-y-1" style={{ color: colors.textSecondary }}>
          <div className="text-[10px] truncate" title={task?.goalSummary || task?.title || ''}>
            {task?.title || task?.goalSummary || '当前任务'}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {events.length === 0 && (
              <span className="text-[9px]" style={{ color: colors.textDim }}>正在加载运行事件…</span>
            )}
            {events.map(event => {
              if (event.evidence?.kind === 'CONTEXT') {
                return (
                  <span
                    key={event.eventId}
                    className="text-[9px] rounded px-1.5 py-0.5"
                    style={{ color: colors.textDim, border: `1px solid ${colors.border}` }}
                    title={evidenceTitle(event.evidence)}
                  >
                    {evidenceLabel(event)}
                  </span>
                )
              }
              if (event.evidence?.kind === 'TOOL') {
                return (
                  <span
                    key={event.eventId}
                    className="text-[9px] rounded px-1.5 py-0.5"
                    style={{ color: colors.textDim, border: `1px solid ${colors.border}` }}
                    title={evidenceTitle(event.evidence)}
                  >
                    {evidenceLabel(event)}
                  </span>
                )
              }
              return event.evidence && (
                <span
                  key={event.eventId}
                  className="text-[9px] rounded px-1.5 py-0.5"
                  style={{
                    color: event.toStatus ? stateColor(event.toStatus, colors) : colors.textDim,
                    border: `1px solid ${event.toStatus ? stateColor(event.toStatus, colors) : colors.border}55`,
                  }}
                  title={evidenceTitle(event.evidence)}
                >
                  {evidenceLabel(event)}
                </span>
              )
            })}
          </div>
          {planSteps.length > 0 && (
            <div className="space-y-1 pt-1" aria-label="Harness 受控计划">
              <div className="text-[9px]" style={{ color: colors.textDim }}>受控计划（每次运行只认领一个步骤）</div>
              {planSteps.map(step => (
                <div key={step.stepId} className="flex items-start gap-1 text-[10px]">
                  <span style={{ color: planStateColor(step.status, colors) }}>●</span>
                  <span className="min-w-0 flex-1 truncate" title={step.objective || step.title}>
                    {step.ordinal}. {step.title}
                  </span>
                  <span style={{ color: planStateColor(step.status, colors) }}>{PLAN_STATUS_LABEL[step.status]}</span>
                  <span style={{ color: colors.textDim }}>{step.attemptCount}/{step.maxAttempts}</span>
                </div>
              ))}
            </div>
          )}
          {canContinue && taskId && sessionId && (
            <button
              type="button"
              className="text-[10px] rounded px-2 py-1 transition-opacity hover:opacity-80"
              style={{ color: colors.accent, border: `1px solid ${colors.accent}66` }}
              onClick={() => selectTaskContinuation(sessionId, taskId)}
              title="只会让下一条消息继续此 Task；未选择时，新消息会创建新 Task。"
            >
              {continuationSelected ? '已选择继续：发送下一条消息' : '继续当前步骤'}
            </button>
          )}
          {error && <div className="text-[9px]" style={{ color: colors.red }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
