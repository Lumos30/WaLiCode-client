/**
 * 终端状态管理 — 管理本地终端/SSH 终端的活跃标签
 */
import { create } from 'zustand'
import type { TerminalTabId } from '../components/TerminalTabBar'

interface TerminalState {
  /** 当前活跃的终端标签 */
  activeTerminalTab: TerminalTabId
  /** 本地终端会话 ID */
  localPtySessionId: string | null
  /** SSH 终端会话 ID */
  sshTerminalSessionId: string | null
  /** 底部面板是否可见 */
  terminalVisible: boolean

  setActiveTerminalTab: (tab: TerminalTabId) => void
  setLocalPtySessionId: (id: string | null) => void
  setSshTerminalSessionId: (id: string | null) => void
  setTerminalVisible: (visible: boolean) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  activeTerminalTab: 'local',
  localPtySessionId: null,
  sshTerminalSessionId: null,
  terminalVisible: true,

  setActiveTerminalTab: (tab) => set({ activeTerminalTab: tab }),
  setLocalPtySessionId: (id) => set({ localPtySessionId: id }),
  setSshTerminalSessionId: (id) => set({ sshTerminalSessionId: id }),
  setTerminalVisible: (visible) => set({ terminalVisible: visible }),
}))
