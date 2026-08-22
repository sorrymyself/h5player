import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutoplayCoordinator } from '../../src/application/playback'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'
import type { MediaPageState } from '../../src/application/media'

function media(overrides: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    id: 'media-0-1',
    frameId: 0,
    kind: 'video',
    state: 'paused',
    metrics: {
      width: 640,
      height: 360,
      duration: 60,
      currentTime: 0,
      volume: 1,
      playbackRate: 1,
      muted: false,
      visible: true
    },
    capabilities: createMediaCapabilities({ playback: true, playbackRate: true }),
    adapterId: 'generic',
    updatedAt: 1,
    ...overrides
  }
}

function page(snapshot: MediaSnapshot): MediaPageState {
  return {
    frameId: snapshot.frameId,
    revision: snapshot.updatedAt,
    activeMediaId: snapshot.id,
    media: [snapshot],
    observedAt: snapshot.updatedAt
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AutoplayCoordinator', () => {
  it('does nothing while disabled and retries a rejected play with a bounded budget', async () => {
    vi.useFakeTimers()
    let current = media()
    const start = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')))
      .mockImplementationOnce(() => {
        current = { ...current, state: 'active', updatedAt: 2 }
        return Promise.resolve({ declared: true, handled: true, adapterId: 'bilibili' })
      })
    const coordinator = new AutoplayCoordinator({
      commands: { start },
      retryDelayMs: 200
    })

    coordinator.observe(page(current))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(start).not.toHaveBeenCalled()

    coordinator.setEnabled(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(start).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(start).toHaveBeenCalledTimes(2)

    coordinator.teardown()
  })

  it('does not attempt hidden media and does not replay after a settled user pause', async () => {
    vi.useFakeTimers()
    let visible = false
    let current = media()
    const start = vi.fn(() => {
      current = { ...current, state: 'active', updatedAt: current.updatedAt + 1 }
      return Promise.resolve({ declared: true, handled: true, adapterId: 'bilibili' })
    })
    const coordinator = new AutoplayCoordinator({
      commands: { start },
      isDocumentVisible: () => visible
    })
    coordinator.setEnabled(true)
    coordinator.observe(page(current))
    await vi.advanceTimersByTimeAsync(0)
    expect(start).not.toHaveBeenCalled()

    visible = true
    coordinator.setDocumentVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(start).toHaveBeenCalledOnce()

    coordinator.observe(page(current))

    current = { ...current, state: 'paused', updatedAt: 3 }
    coordinator.observe(page(current))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(start).toHaveBeenCalledOnce()
    coordinator.teardown()
  })

  it('starts a fresh bounded attempt when the source generation changes', async () => {
    vi.useFakeTimers()
    let current = media()
    const start = vi.fn(() => Promise.reject(new Error('policy')))
    const coordinator = new AutoplayCoordinator({
      commands: { start },
      retryBudget: 1
    })
    coordinator.setEnabled(true)
    coordinator.observe(page(current))
    await vi.advanceTimersByTimeAsync(0)
    expect(start).toHaveBeenCalledOnce()

    current = { ...current, sourceKey: 'source-next', updatedAt: 2 }
    coordinator.observe(page(current))
    await vi.advanceTimersByTimeAsync(0)
    expect(start).toHaveBeenCalledTimes(2)
    coordinator.teardown()
  })

  it('settles immediately when the selected site adapter has no autoplay action', async () => {
    vi.useFakeTimers()
    const start = vi.fn(() =>
      Promise.resolve({ declared: false, handled: false, adapterId: 'youtube' })
    )
    const coordinator = new AutoplayCoordinator({
      commands: { start },
      retryBudget: 10,
      retryDelayMs: 200
    })

    coordinator.setEnabled(true)
    coordinator.observe(page(media()))
    await vi.advanceTimersByTimeAsync(5_000)

    expect(start).toHaveBeenCalledOnce()
    coordinator.teardown()
  })

  it('does not invoke a declared page-start action for media outside the visible viewport', async () => {
    vi.useFakeTimers()
    const start = vi.fn(() =>
      Promise.resolve({ declared: true, handled: true, adapterId: 'bilibili' })
    )
    const coordinator = new AutoplayCoordinator({ commands: { start } })

    coordinator.setEnabled(true)
    coordinator.observe(
      page(
        media({
          metrics: {
            ...media().metrics,
            visible: false
          }
        })
      )
    )
    await vi.advanceTimersByTimeAsync(5_000)

    expect(start).not.toHaveBeenCalled()
    coordinator.teardown()
  })

  it('does not invoke a top-level page action for routed or child-frame media', async () => {
    vi.useFakeTimers()
    const start = vi.fn(() =>
      Promise.resolve({ declared: true, handled: true, adapterId: 'bilibili' })
    )
    const coordinator = new AutoplayCoordinator({ commands: { start } })

    coordinator.setEnabled(true)
    coordinator.observe(
      page(
        media({
          frameId: 7
        })
      )
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(start).not.toHaveBeenCalled()

    coordinator.observe({
      ...page(media()),
      frameId: 7
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(start).not.toHaveBeenCalled()
    coordinator.teardown()
  })

  it('does not blindly click a toggle-style start control twice before media state changes', async () => {
    vi.useFakeTimers()
    const start = vi.fn(() =>
      Promise.resolve({ declared: true, handled: true, adapterId: 'bilibili' })
    )
    const coordinator = new AutoplayCoordinator({
      commands: { start },
      observationTimeoutMs: 300
    })

    coordinator.setEnabled(true)
    coordinator.observe(page(media()))
    await vi.advanceTimersByTimeAsync(0)
    expect(start).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(299)
    expect(start).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(start).toHaveBeenCalledOnce()
    coordinator.teardown()
  })

  it('allows a bounded retry only after a fresh paused observation', async () => {
    vi.useFakeTimers()
    let current = media()
    const start = vi.fn(() =>
      Promise.resolve({ declared: true, handled: true, adapterId: 'bilibili' })
    )
    const coordinator = new AutoplayCoordinator({
      commands: { start },
      retryDelayMs: 200,
      observationTimeoutMs: 500
    })

    coordinator.setEnabled(true)
    coordinator.observe(page(current))
    await vi.advanceTimersByTimeAsync(0)
    expect(start).toHaveBeenCalledOnce()

    current = { ...current, updatedAt: 2 }
    coordinator.observe({ ...page(current), revision: 2 })
    await vi.advanceTimersByTimeAsync(199)
    expect(start).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(start).toHaveBeenCalledTimes(2)
    coordinator.teardown()
  })
})
