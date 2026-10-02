import { beforeEach, describe, expect, it } from 'vitest'
import { canSafelyRevertAiPatch, useAiPatchStore } from './aiPatchStore'

describe('aiPatchStore', () => {
  beforeEach(() => {
    useAiPatchStore.setState({ previews: [] })
  })

  it('permits a revert when an empty pre-change snapshot was actually captured', () => {
    useAiPatchStore.getState().upsertPreview({
      target: 'local',
      path: 'D:/project/new-file.ts',
      toolName: 'createLocalFile',
      hasBeforeContent: true,
      beforeContent: '',
      afterContent: 'export {}\n',
    })

    const preview = useAiPatchStore.getState().previews[0]
    expect(preview.beforeContent).toBe('')
    expect(canSafelyRevertAiPatch(preview)).toBe(true)
  })

  it('rejects a revert when only the changed content was observed', () => {
    useAiPatchStore.getState().upsertPreview({
      target: 'remote',
      connectionId: 'prod-1',
      path: '/srv/app/config.ts',
      toolName: 'writeFile',
      hasBeforeContent: false,
      beforeContent: '',
      afterContent: 'export const enabled = true\n',
    })

    const preview = useAiPatchStore.getState().previews[0]
    expect(canSafelyRevertAiPatch(preview)).toBe(false)
  })
})
