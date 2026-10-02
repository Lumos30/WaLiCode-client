import { create } from 'zustand'
import * as agentApi from '../api/agent'
import type {
  HarnessRunDTO,
  HarnessRunEventDTO,
  HarnessRunState,
  HarnessTaskDTO,
  HarnessPlanStepDTO,
} from '../api/agent'

interface HarnessStore {
  tasksBySession: Map<string, HarnessTaskDTO[]>
  runsByTask: Map<string, HarnessRunDTO[]>
  eventsByRun: Map<string, HarnessRunEventDTO[]>
  planStepsByTask: Map<string, HarnessPlanStepDTO[]>
  liveRunBySession: Map<string, HarnessRunState>
  continuationTaskBySession: Map<string, string>
  loadingSessionId: string | null
  error: string | null
  applyRunState: (state: HarnessRunState) => void
  loadTasks: (sessionId: string) => Promise<void>
  loadTimeline: (taskId: string, runId?: string | null) => Promise<void>
  selectTaskContinuation: (sessionId: string, taskId: string) => void
  consumeTaskContinuation: (sessionId: string) => string | undefined
}

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  tasksBySession: new Map(),
  runsByTask: new Map(),
  eventsByRun: new Map(),
  planStepsByTask: new Map(),
  liveRunBySession: new Map(),
  continuationTaskBySession: new Map(),
  loadingSessionId: null,
  error: null,

  applyRunState: (runState) => set((state) => {
    const liveRunBySession = new Map(state.liveRunBySession)
    liveRunBySession.set(runState.sessionId, runState)
    const tasksBySession = new Map(state.tasksBySession)
    const tasks = tasksBySession.get(runState.sessionId)
    if (tasks) {
      const next = tasks.map(task => task.taskId === runState.taskId
        ? { ...task, currentRunId: runState.runId, status: runState.status, updatedAt: runState.updatedAt }
        : task)
      tasksBySession.set(runState.sessionId, next)
    }
    return { liveRunBySession, tasksBySession, error: null }
  }),

  loadTasks: async (sessionId) => {
    set({ loadingSessionId: sessionId, error: null })
    try {
      const tasks = await agentApi.listHarnessTasks(sessionId)
      set((state) => {
        const tasksBySession = new Map(state.tasksBySession)
        tasksBySession.set(sessionId, tasks)
        return { tasksBySession, loadingSessionId: null }
      })
    } catch (error) {
      if (get().loadingSessionId === sessionId) {
        set({ loadingSessionId: null, error: error instanceof Error ? error.message : String(error) })
      }
    }
  },

  loadTimeline: async (taskId, preferredRunId) => {
    try {
      const [runs, planSteps] = await Promise.all([
        agentApi.listHarnessRuns(taskId),
        agentApi.listHarnessPlanSteps(taskId),
      ])
      set((state) => {
        const runsByTask = new Map(state.runsByTask)
        const planStepsByTask = new Map(state.planStepsByTask)
        runsByTask.set(taskId, runs)
        planStepsByTask.set(taskId, planSteps)
        return { runsByTask, planStepsByTask, error: null }
      })
      const runId = preferredRunId || runs[runs.length - 1]?.runId
      if (!runId) return
      const events = await agentApi.listHarnessRunEvents(runId)
      set((state) => {
        const eventsByRun = new Map(state.eventsByRun)
        eventsByRun.set(runId, events)
        return { eventsByRun }
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  selectTaskContinuation: (sessionId, taskId) => set((state) => {
    const continuationTaskBySession = new Map(state.continuationTaskBySession)
    continuationTaskBySession.set(sessionId, taskId)
    return { continuationTaskBySession }
  }),

  consumeTaskContinuation: (sessionId) => {
    const taskId = get().continuationTaskBySession.get(sessionId)
    if (!taskId) return undefined
    set((state) => {
      const continuationTaskBySession = new Map(state.continuationTaskBySession)
      continuationTaskBySession.delete(sessionId)
      return { continuationTaskBySession }
    })
    return taskId
  },
}))
