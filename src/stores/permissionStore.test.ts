import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/request', () => ({ post: vi.fn() }))

import { post } from '../api/request'
import type { PermissionConfirmRequest } from './permissionStore'
import { usePermissionStore } from './permissionStore'

const postMock = vi.mocked(post)

function request(ticket: string): PermissionConfirmRequest {
  return {
    ticket,
    sessionId: 'session-1',
    runId: 'run-1',
    toolCallId: 'tool-1',
    toolName: 'local_execute',
    toolArgs: 'dir',
    argsDigest: 'digest-1',
    riskLevel: 'CONFIRM',
    reason: '执行命令',
    timeoutMs: 30_000,
    expiresAt: Date.now() + 30_000,
    arrivedAt: Date.now(),
  }
}

describe('permissionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePermissionStore.getState().clearAll()
  })

  it('keeps a FIFO queue and de-duplicates a repeated one-time ticket', () => {
    const first = request('ticket-1')
    const second = request('ticket-2')

    usePermissionStore.getState().pushConfirmation(first)
    usePermissionStore.getState().pushConfirmation(first)
    usePermissionStore.getState().pushConfirmation(second)

    expect(usePermissionStore.getState().pending.map(item => item.ticket)).toEqual(['ticket-1', 'ticket-2'])
    expect(usePermissionStore.getState().current?.ticket).toBe('ticket-1')
  })

  it('sends the complete bound context and keeps a ticket queued when the server rejects it', async () => {
    const pending = request('ticket-1')
    usePermissionStore.getState().pushConfirmation(pending)
    postMock.mockResolvedValue({ code: '0002', info: '票据已过期', data: null })

    await usePermissionStore.getState().resolveConfirmation(pending, true)

    expect(postMock).toHaveBeenCalledWith('/api/v1/permission/resolve', {
      ticket: 'ticket-1',
      sessionId: 'session-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      toolName: 'local_execute',
      argsDigest: 'digest-1',
      approved: true,
    })
    expect(usePermissionStore.getState().pending).toHaveLength(1)
    expect(usePermissionStore.getState().error).toBe('票据已过期')
  })

  it('re-enables the single confirmation control when the resolve request fails to reach the server', async () => {
    const pending = request('ticket-network-error')
    usePermissionStore.getState().pushConfirmation(pending)
    postMock.mockRejectedValue(new Error('网络连接失败'))

    await usePermissionStore.getState().resolveConfirmation(pending, false)

    expect(usePermissionStore.getState().pending).toHaveLength(1)
    expect(usePermissionStore.getState().resolving).toBe(false)
    expect(usePermissionStore.getState().error).toBe('网络连接失败')
  })
})
