/**
 * 输出面板状态管理 — AI 命令执行历史
 */
import { create } from 'zustand'

export type OutputStatus = 'running' | 'success' | 'failed' | 'backgrounded'

export interface OutputEntry {
  id: string
  sessionId: string
  command: string
  status: OutputStatus
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number | null
  timestamp: number
}

interface OutputState {
  entries: OutputEntry[]
  addEntry: (entry: Omit<OutputEntry, 'id' | 'timestamp'>) => string
  updateEntry: (sessionId: string, patch: Partial<OutputEntry>) => void
  /** Mark commands without a terminal tool result as failed when their stream closes. */
  markRunningEntriesAsUnconfirmed: () => void
  removeEntry: (id: string) => void
  clearEntries: () => void
}

export const useOutputStore = create<OutputState>((set) => ({
  entries: [],

  addEntry: (entry) => {
    const id = `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const fullEntry: OutputEntry = {
      ...entry,
      id,
      timestamp: Date.now(),
    }
    set((state) => ({
      entries: [...state.entries, fullEntry],
    }))
    return id
  },

  updateEntry: (sessionId, patch) => {
    set((state) => ({
      entries: state.entries.map((e) =>
        e.sessionId === sessionId ? { ...e, ...patch } : e
      ),
    }))
  },

  markRunningEntriesAsUnconfirmed: () => {
    const reason = '流已结束，但未收到工具完成结果'
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.status === 'running'
          ? {
              ...entry,
              status: 'failed' as const,
              stderr: entry.stderr ? `${entry.stderr}\n${reason}` : reason,
            }
          : entry,
      ),
    }))
  },

  removeEntry: (id) => {
    set((state) => ({
      entries: state.entries.filter((e) => e.id !== id),
    }))
  },

  clearEntries: () => set({ entries: [] }),
}))
