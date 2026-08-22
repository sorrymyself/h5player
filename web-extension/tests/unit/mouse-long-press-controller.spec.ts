import { afterEach, describe, expect, it, vi } from 'vitest'
import { MouseLongPressController } from '../../src/infrastructure/dom'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'

function snapshot(state: MediaSnapshot['state'] = 'paused'): MediaSnapshot {
  return {
    id: 'media-0-1',
    frameId: 0,
    kind: 'video',
    state,
    metrics: {
      width: 640,
      height: 360,
      duration: 60,
      currentTime: 0,
      volume: 1,
      playbackRate: 1.5,
      muted: false,
      visible: true
    },
    capabilities: createMediaCapabilities({ playbackRate: true }),
    adapterId: 'generic',
    updatedAt: 1
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('MouseLongPressController', () => {
  it('sets temporary 3× after the threshold and restores the previous rate on release', async () => {
    vi.useFakeTimers()
    const video = document.createElement('video')
    video.getBoundingClientRect = vi.fn(() => ({
      left: 10,
      top: 10,
      right: 650,
      bottom: 370,
      width: 640,
      height: 360,
      x: 10,
      y: 10,
      toJSON: () => ({})
    }))
    document.body.append(video)
    const writes: number[] = []
    const controller = new MouseLongPressController({
      root: document,
      resolveTarget: () => ({ mediaId: 'media-0-1', element: video }),
      getSnapshot: () => snapshot(),
      setPlaybackRate: (_mediaId, value) => {
        writes.push(value)
        return Promise.resolve(true)
      },
      setPlaybackState: () => Promise.resolve(true)
    })
    controller.update({ enabled: true, delayMs: 600 })

    video.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 })
    )
    await vi.advanceTimersByTimeAsync(599)
    expect(writes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toEqual([3])

    video.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 100, clientY: 100 })
    )
    await vi.runAllTimersAsync()
    expect(writes).toEqual([3, 1.5])
    controller.teardown()
  })

  it('does not steal the bottom control-bar area or short clicks', async () => {
    vi.useFakeTimers()
    const video = document.createElement('video')
    video.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }))
    document.body.append(video)
    const writes: number[] = []
    const controller = new MouseLongPressController({
      root: document,
      resolveTarget: () => ({ mediaId: 'media-0-1', element: video }),
      getSnapshot: () => snapshot(),
      setPlaybackRate: (_mediaId, value) => {
        writes.push(value)
        return Promise.resolve(true)
      },
      setPlaybackState: () => Promise.resolve(true)
    })
    controller.update({ enabled: true })

    video.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 350 })
    )
    await vi.advanceTimersByTimeAsync(1_000)
    video.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 100, clientY: 350 })
    )
    expect(writes).toEqual([])

    video.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 })
    )
    await vi.advanceTimersByTimeAsync(100)
    video.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 100, clientY: 100 })
    )
    expect(writes).toEqual([])
    controller.teardown()
  })

  it.each([
    { initial: 'paused' as const, drifted: 'active' as const, expected: 'paused' as const },
    { initial: 'active' as const, drifted: 'paused' as const, expected: 'active' as const }
  ])(
    'restores an initially $initial video when a site changes it to $drifted after release',
    async ({ initial, drifted, expected }) => {
      vi.useFakeTimers()
      const video = document.createElement('video')
      video.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        right: 640,
        bottom: 360,
        width: 640,
        height: 360,
        x: 0,
        y: 0,
        toJSON: () => ({})
      }))
      document.body.append(video)
      let currentState: MediaSnapshot['state'] = initial
      const playbackWrites: Array<'active' | 'paused'> = []
      const controller = new MouseLongPressController({
        root: document,
        resolveTarget: () => ({ mediaId: 'media-0-1', element: video }),
        getSnapshot: () => snapshot(currentState),
        setPlaybackRate: () => Promise.resolve(true),
        setPlaybackState: (_mediaId, state) => {
          playbackWrites.push(state)
          currentState = state
          return Promise.resolve(true)
        }
      })
      controller.update({ enabled: true, delayMs: 600 })

      video.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100
        })
      )
      await vi.advanceTimersByTimeAsync(600)
      video.dispatchEvent(
        new MouseEvent('pointerup', {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100
        })
      )
      globalThis.setTimeout(() => {
        currentState = drifted
      }, 150)

      await vi.advanceTimersByTimeAsync(600)
      expect(playbackWrites).toEqual([expected])
      controller.teardown()
    }
  )
})
