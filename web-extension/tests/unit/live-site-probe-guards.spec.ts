import { describe, expect, it, vi } from 'vitest'
import {
  canHostVisibleShadowUi,
  isStaleFrameMessagingError,
  readFrameOrGlobalState,
  shadowProbeStatusForFrameFailure
} from '../e2e/live-site-probe-guards'

describe('live-site probe guards', () => {
  it('skips closed-shadow probing for frames that cannot display UI', () => {
    expect(canHostVisibleShadowUi({ width: 0, height: 0 })).toBe(false)
    expect(canHostVisibleShadowUi({ width: 946, height: 532 })).toBe(true)
  })

  it('classifies stale child-frame messaging failures without matching ordinary errors', () => {
    expect(
      isStaleFrameMessagingError(
        new Error('Error: Could not establish connection. Receiving end does not exist.')
      )
    ).toBe(true)
    expect(isStaleFrameMessagingError(new Error('No frame with id 17 in tab 42'))).toBe(true)
    expect(isStaleFrameMessagingError(new Error('Live media state request failed'))).toBe(false)
  })

  it('falls back to the global route when a selected child frame disappears', async () => {
    const readFrame = vi
      .fn()
      .mockRejectedValue(
        new Error('Error: Could not establish connection. Receiving end does not exist.')
      )
    const readGlobal = vi.fn().mockResolvedValue('top-frame-state')

    await expect(readFrameOrGlobalState(17, readFrame, readGlobal)).resolves.toBe('top-frame-state')
    expect(readFrame).toHaveBeenCalledWith(17)
    expect(readGlobal).toHaveBeenCalledOnce()
  })

  it('does not hide non-transient frame or extension failures', async () => {
    const error = new Error('Extension protocol response was invalid')
    const readFrame = vi.fn().mockRejectedValue(error)
    const readGlobal = vi.fn().mockResolvedValue('unexpected-fallback')

    await expect(readFrameOrGlobalState(17, readFrame, readGlobal)).rejects.toBe(error)
    expect(readGlobal).not.toHaveBeenCalled()
  })

  it('uses the global route directly for the top frame', async () => {
    const readFrame = vi.fn().mockResolvedValue('unexpected-frame-state')
    const readGlobal = vi.fn().mockResolvedValue('top-frame-state')

    await expect(readFrameOrGlobalState(0, readFrame, readGlobal)).resolves.toBe('top-frame-state')
    expect(readFrame).not.toHaveBeenCalled()
  })

  it('marks closed-shadow probing in child frames as probe-limited', () => {
    expect(
      shadowProbeStatusForFrameFailure(new Error('Protocol error: target was detached'), true)
    ).toBe('probe-limited')
    expect(shadowProbeStatusForFrameFailure(new Error('unexpected parser failure'), false)).toBe(
      'unknown'
    )
    expect(
      shadowProbeStatusForFrameFailure(new Error('Target with given id was not found'), false)
    ).toBe('probe-limited')
  })
})
