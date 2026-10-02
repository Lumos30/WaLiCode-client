import { beforeEach, describe, expect, it } from 'vitest'
import { useOutputStore } from './outputStore'

describe('outputStore', () => {
  beforeEach(() => {
    useOutputStore.setState({ entries: [] })
  })

  it('marks running entries as unconfirmed instead of reporting success', () => {
    useOutputStore.getState().addEntry({
      sessionId: 'tool-1', command: 'npm test', status: 'running', stdout: 'starting', stderr: '', exitCode: null, durationMs: null,
    })
    useOutputStore.getState().addEntry({
      sessionId: 'tool-2', command: 'npm run build', status: 'success', stdout: '', stderr: '', exitCode: 0, durationMs: 20,
    })

    useOutputStore.getState().markRunningEntriesAsUnconfirmed()

    const [unconfirmed, completed] = useOutputStore.getState().entries
    expect(unconfirmed).toMatchObject({ status: 'failed', stderr: '流已结束，但未收到工具完成结果' })
    expect(completed).toMatchObject({ status: 'success', exitCode: 0 })
  })
})
