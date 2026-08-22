import { describe, expect, it, vi } from 'vitest'
import {
  PlaybackLifecycleCoordinator,
  type PlaybackLifecycleUpdate
} from '../../src/application/playback'
import type { MediaCommandResultResponse, MediaPageState } from '../../src/application/media'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'

type MediaOverrides = Omit<Partial<MediaSnapshot>, 'metrics' | 'capabilities'> & {
  metrics?: Partial<MediaSnapshot['metrics']>
  capabilities?: Partial<MediaSnapshot['capabilities']>
}

function media(overrides: MediaOverrides = {}): MediaSnapshot {
  const metrics = {
    width: 640,
    height: 360,
    duration: 120,
    currentTime: 10,
    volume: 1,
    playbackRate: 1,
    muted: false,
    visible: true,
    ...overrides.metrics
  }
  const capabilities = createMediaCapabilities({
    playback: true,
    playbackRate: true,
    ...overrides.capabilities
  })
  return {
    id: 'media-0-1',
    frameId: 0,
    kind: 'video',
    state: 'paused',
    adapterId: 'generic',
    updatedAt: 10,
    ...overrides,
    metrics,
    capabilities
  }
}

function page(...mediaItems: MediaSnapshot[]): MediaPageState {
  return {
    frameId: 0,
    revision: 1,
    activeMediaId: mediaItems[0]?.id ?? null,
    media: mediaItems,
    observedAt: Math.max(...mediaItems.map((item) => item.updatedAt), 0)
  }
}

function response(snapshot: MediaSnapshot): MediaCommandResultResponse {
  return {
    result: {
      ok: true,
      value: {
        commandType: 'media.set-rate',
        mediaId: snapshot.id,
        changed: true,
        snapshot
      }
    },
    state: page(snapshot)
  }
}

describe('PlaybackLifecycleCoordinator', () => {
  it('automatically applies policy to newly discovered media and deduplicates equal state', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({ commands: { setPlaybackRate } })
    await coordinator.updateSettings({
      globalDefault: 1.5,
      protectAgainstSiteReset: true
    })

    await coordinator.observe(page(media()))
    await coordinator.observe(page(media({ metrics: { playbackRate: 1.5 }, updatedAt: 11 })))

    expect(setPlaybackRate).toHaveBeenCalledTimes(1)
    expect(setPlaybackRate).toHaveBeenCalledWith('media-0-1', 1.5, 'lifecycle')
    expect(coordinator.snapshot()['media-0-1']).toMatchObject({
      intendedRate: 1.5,
      actualRate: 1.5,
      applicationStatus: 'applied',
      source: 'global-setting'
    })
  })

  it('keeps current-media intent isolated and lets page intent replace media-specific overrides', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    let now = 100
    const coordinator = new PlaybackLifecycleCoordinator({
      commands: { setPlaybackRate },
      now: () => now
    })
    const first = media({ id: 'media-0-1' })
    const second = media({ id: 'media-0-2' })
    await coordinator.observe(page(first, second))

    await coordinator.setIntent(first.id, 2, 'media')
    await coordinator.setIntent(second.id, 3, 'media')
    expect(coordinator.policyFor(first)).toMatchObject({ value: 2, scope: 'media' })
    expect(coordinator.policyFor(second)).toMatchObject({ value: 3, scope: 'media' })

    now += 1
    await coordinator.setIntent(first.id, 1.5, 'page')
    expect(coordinator.policyFor(first)).toMatchObject({ value: 1.5, scope: 'page' })
    expect(coordinator.policyFor(second)).toMatchObject({ value: 1.5, scope: 'page' })
  })

  it('stages a site intent without writing the stale media and applies it to the replacement', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({ commands: { setPlaybackRate } })
    const stale = media({ id: 'media-14-tencent-viewport', metrics: { playbackRate: 1.5 } })
    await coordinator.updateSettings({
      globalDefault: 1,
      siteDefault: 1.5,
      protectAgainstSiteReset: true
    })
    await coordinator.observe(page(stale))
    setPlaybackRate.mockClear()

    coordinator.stageIntent(stale.id, 2, 'site', page(stale))
    expect(setPlaybackRate).not.toHaveBeenCalled()

    const replacement = media({
      id: 'media-0-1',
      frameId: 0,
      metrics: { playbackRate: 1.5 },
      updatedAt: 20
    })
    await coordinator.observe(page(replacement))

    expect(setPlaybackRate).toHaveBeenCalledTimes(1)
    expect(setPlaybackRate).toHaveBeenCalledWith('media-0-1', 2, 'lifecycle')
    expect(coordinator.policyFor(replacement)).toMatchObject({ value: 2, scope: 'site' })
  })

  it('starts a new policy key with a fresh retry budget after an equal observation', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({
      commands: { setPlaybackRate },
      retryBudget: 2
    })
    await coordinator.updateSettings({ globalDefault: 2, protectAgainstSiteReset: true })
    await coordinator.observe(page(media({ metrics: { playbackRate: 1 } })))

    await coordinator.updateSettings({ globalDefault: 1, protectAgainstSiteReset: true })
    await coordinator.observe(page(media({ updatedAt: 20, metrics: { playbackRate: 1 } })))
    await coordinator.observe(page(media({ updatedAt: 21, metrics: { playbackRate: 0.5 } })))

    expect(coordinator.snapshot()['media-0-1']).toMatchObject({
      intendedRate: 1,
      attemptCount: 1
    })
  })

  it('reapplies an external reset only when protection is enabled', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({ commands: { setPlaybackRate } })
    await coordinator.updateSettings({
      globalDefault: 1.5,
      protectAgainstSiteReset: true
    })
    await coordinator.observe(page(media()))
    await coordinator.observe(page(media({ metrics: { playbackRate: 1 }, updatedAt: 20 })))
    expect(setPlaybackRate).toHaveBeenCalledTimes(2)

    await coordinator.updateSettings({
      globalDefault: 1.5,
      protectAgainstSiteReset: false
    })
    setPlaybackRate.mockClear()
    await coordinator.observe(page(media({ metrics: { playbackRate: 1 }, updatedAt: 30 })))
    await coordinator.observe(page(media({ metrics: { playbackRate: 1 }, updatedAt: 31 })))
    expect(setPlaybackRate).not.toHaveBeenCalled()
    expect(coordinator.snapshot()['media-0-1']).toMatchObject({
      applicationStatus: 'blocked',
      lastObservedExternalRate: 1
    })
  })

  it('uses the bounded retry budget to establish a persisted site intent after reload', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({
      commands: { setPlaybackRate },
      retryBudget: 3
    })
    await coordinator.updateSettings({
      globalDefault: 1,
      siteDefault: 1.5,
      protectAgainstSiteReset: false
    })

    await coordinator.observe(page(media({ metrics: { playbackRate: 1 } })))
    await coordinator.observe(page(media({ metrics: { playbackRate: 1 }, updatedAt: 20 })))
    await coordinator.observe(page(media({ metrics: { playbackRate: 1.5 }, updatedAt: 30 })))

    expect(setPlaybackRate).toHaveBeenCalledTimes(2)
    expect(coordinator.snapshot()['media-0-1']).toMatchObject({
      intendedRate: 1.5,
      actualRate: 1.5,
      source: 'site-rule',
      applicationStatus: 'applied',
      attemptCount: 2
    })
  })

  it('uses a bounded retry budget and records unsupported media', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: 1 } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({
      commands: { setPlaybackRate },
      retryBudget: 2
    })
    await coordinator.updateSettings({
      globalDefault: 2,
      protectAgainstSiteReset: true
    })
    for (let index = 0; index < 4; index += 1) {
      await coordinator.observe(page(media({ updatedAt: 10 + index })))
    }
    expect(setPlaybackRate).toHaveBeenCalledTimes(2)
    expect(coordinator.snapshot()['media-0-1']).toMatchObject({
      applicationStatus: 'blocked',
      degradationReason: 'RETRY_BUDGET_EXHAUSTED',
      attemptCount: 2
    })

    await coordinator.observe(
      page(media({ id: 'media-0-2', capabilities: { playbackRate: false } }))
    )
    expect(coordinator.snapshot()['media-0-2']).toMatchObject({
      applicationStatus: 'unsupported',
      degradationReason: 'CAPABILITY_UNAVAILABLE'
    })
  })

  it('does not refresh the external-reset budget when applied and reset observations alternate', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({
      commands: { setPlaybackRate },
      retryBudget: 3
    })
    await coordinator.updateSettings({
      globalDefault: 2,
      protectAgainstSiteReset: true
    })

    for (let index = 0; index < 5; index += 1) {
      await coordinator.observe(
        page(media({ updatedAt: 20 + index * 2, metrics: { playbackRate: 1 } }))
      )
      await coordinator.observe(
        page(media({ updatedAt: 21 + index * 2, metrics: { playbackRate: 2 } }))
      )
    }

    expect(setPlaybackRate).toHaveBeenCalledTimes(3)
    expect(coordinator.snapshot()['media-0-1']).toMatchObject({
      attemptCount: 3,
      generation: 0
    })

    await coordinator.observe(page(media({ updatedAt: 40, metrics: { playbackRate: 1 } })))
    expect(coordinator.snapshot()['media-0-1']).toMatchObject({
      applicationStatus: 'blocked',
      degradationReason: 'RETRY_BUDGET_EXHAUSTED',
      attemptCount: 3
    })
  })

  it('starts a new lifecycle generation once when playback rewinds to the beginning', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({ commands: { setPlaybackRate } })
    await coordinator.updateSettings({
      globalDefault: 1.5,
      protectAgainstSiteReset: true
    })
    await coordinator.observe(
      page(media({ updatedAt: 10, metrics: { currentTime: 48, playbackRate: 1.5 } }))
    )
    await coordinator.observe(
      page(media({ updatedAt: 11, metrics: { currentTime: 0.1, playbackRate: 1 } }))
    )
    await coordinator.observe(
      page(media({ updatedAt: 12, metrics: { currentTime: 0.2, playbackRate: 1.5 } }))
    )

    expect(setPlaybackRate).toHaveBeenCalledTimes(1)
    expect(coordinator.snapshot()['media-0-1']).toMatchObject({ generation: 1 })
  })

  it('starts a new generation when the same media element changes its opaque source key', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({ commands: { setPlaybackRate } })
    await coordinator.updateSettings({
      globalDefault: 1.5,
      protectAgainstSiteReset: true
    })
    await coordinator.observe(
      page(media({ sourceKey: 'source-aaaaaaaa', metrics: { playbackRate: 1.5 } }))
    )
    await coordinator.observe(
      page(
        media({
          sourceKey: 'source-bbbbbbbb',
          updatedAt: 20,
          metrics: { currentTime: 0, playbackRate: 1 }
        })
      )
    )

    expect(setPlaybackRate).toHaveBeenCalledTimes(1)
    expect(coordinator.snapshot()['media-0-1']).toMatchObject({ generation: 1 })
  })

  it('excludes hidden, tiny and background audio media from automatic page-wide policy', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({ commands: { setPlaybackRate } })
    await coordinator.updateSettings({
      globalDefault: 1.75,
      protectAgainstSiteReset: true
    })
    const active = media({ id: 'media-active' })
    const content = media({ id: 'media-content', metrics: { width: 640, height: 360 } })
    const hidden = media({ id: 'media-hidden', metrics: { visible: false } })
    const tiny = media({ id: 'media-tiny', metrics: { width: 120, height: 60 } })
    const audio = media({ id: 'media-audio', kind: 'audio' })
    const state = page(active, content, hidden, tiny, audio)
    await coordinator.observe({ ...state, activeMediaId: active.id })

    const calls = setPlaybackRate.mock.calls as Array<[string, number]>
    expect(calls.map(([mediaId]) => mediaId)).toEqual(['media-active', 'media-content'])
  })

  it('increments lifecycle generation on duration changes and tears down state', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({ commands: { setPlaybackRate } })
    await coordinator.observe(page(media()))
    await coordinator.observe(page(media({ metrics: { duration: 240 }, updatedAt: 20 })))
    expect(coordinator.snapshot()['media-0-1']?.generation).toBe(1)

    coordinator.teardown()
    await coordinator.observe(page(media({ id: 'media-0-2' })))
    expect(coordinator.snapshot()).toEqual({})
  })

  it('starts new generations when duration enters or leaves the unknown state', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({ commands: { setPlaybackRate } })
    await coordinator.observe(page(media({ metrics: { duration: 120 } })))
    await coordinator.observe(page(media({ updatedAt: 20, metrics: { duration: null } })))
    expect(coordinator.snapshot()['media-0-1']?.generation).toBe(1)
    await coordinator.observe(page(media({ updatedAt: 30, metrics: { duration: 120 } })))
    expect(coordinator.snapshot()['media-0-1']?.generation).toBe(2)
  })

  it('drops policy state when a media item becomes ineligible', async () => {
    const setPlaybackRate = vi
      .fn()
      .mockImplementation((mediaId: string, value: number) =>
        Promise.resolve(response(media({ id: mediaId, metrics: { playbackRate: value } })))
      )
    const coordinator = new PlaybackLifecycleCoordinator({ commands: { setPlaybackRate } })
    const audio = media({ id: 'media-audio', kind: 'audio' })
    await coordinator.observe({ ...page(audio), activeMediaId: audio.id })
    expect(coordinator.snapshot()['media-audio']).toBeDefined()

    const video = media({ id: 'media-video' })
    await coordinator.observe({ ...page(audio, video), activeMediaId: video.id })
    expect(coordinator.snapshot()['media-audio']).toBeUndefined()
    expect(coordinator.snapshot()['media-video']).toBeDefined()
  })

  it('ignores a lifecycle command response that resolves after teardown', async () => {
    let resolveCommand: (value: MediaCommandResultResponse) => void = () => undefined
    const setPlaybackRate = vi.fn(
      () =>
        new Promise<MediaCommandResultResponse>((resolve) => {
          resolveCommand = resolve
        })
    )
    const onChanged = vi.fn()
    const coordinator = new PlaybackLifecycleCoordinator({
      commands: { setPlaybackRate },
      onChanged
    })
    await coordinator.updateSettings({ globalDefault: 2, protectAgainstSiteReset: true })
    const observing = coordinator.observe(page(media()))
    await vi.waitFor(() => expect(setPlaybackRate).toHaveBeenCalledOnce())
    coordinator.teardown()
    resolveCommand(response(media({ metrics: { playbackRate: 2 } })))
    await observing

    expect(coordinator.snapshot()).toEqual({})
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('ignores a lifecycle command response after the target media is removed', async () => {
    let resolveCommand: (value: MediaCommandResultResponse) => void = () => undefined
    const setPlaybackRate = vi.fn(
      () =>
        new Promise<MediaCommandResultResponse>((resolve) => {
          resolveCommand = resolve
        })
    )
    const onChanged = vi.fn()
    const coordinator = new PlaybackLifecycleCoordinator({
      commands: { setPlaybackRate },
      onChanged
    })
    await coordinator.updateSettings({ globalDefault: 2, protectAgainstSiteReset: true })
    const observing = coordinator.observe(page(media()))
    await vi.waitFor(() => expect(setPlaybackRate).toHaveBeenCalledOnce())
    const removal = coordinator.observe(page())
    resolveCommand(response(media({ metrics: { playbackRate: 2 } })))
    await observing
    await removal

    expect(coordinator.snapshot()).toEqual({})
    expect(onChanged).toHaveBeenCalledTimes(1)
    const lastUpdate = onChanged.mock.calls.at(-1)?.[0] as PlaybackLifecycleUpdate | undefined
    expect(lastUpdate?.policies).toEqual({})
    expect(lastUpdate?.page.media).toEqual([])
  })
})
