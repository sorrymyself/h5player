import { describe, expect, it, vi } from 'vitest'
import { createMediaCommandRegistry } from '../../src/application/commands'
import type { CaptureArtifact } from '../../src/domain/capture'
import {
  createMediaCapabilities,
  type MediaController,
  type MediaSnapshot
} from '../../src/domain/media'
import { DEFAULT_VISUAL_STATE, type VisualState } from '../../src/domain/visual'

function snapshot(
  overrides: Partial<Pick<MediaSnapshot, 'state' | 'capabilities' | 'metrics' | 'visual'>> = {}
): MediaSnapshot {
  return {
    id: 'media-0-1',
    frameId: 0,
    kind: 'video',
    state: overrides.state ?? 'active',
    metrics: overrides.metrics ?? {
      width: 1_280,
      height: 720,
      duration: 120,
      currentTime: 30,
      volume: 0.5,
      playbackRate: 1,
      muted: false,
      visible: true
    },
    capabilities:
      overrides.capabilities ??
      createMediaCapabilities({
        playback: true,
        seek: true,
        playbackRate: true,
        visual: true,
        next: true
      }),
    visual: overrides.visual ?? DEFAULT_VISUAL_STATE,
    adapterId: 'fake',
    updatedAt: 1
  }
}

function harness(
  initial: MediaSnapshot = snapshot(),
  options: Readonly<{ applyPlaybackRate?: boolean }> = {}
) {
  let current = initial
  const pause = vi.fn(() => {
    current = { ...current, state: 'paused' }
    return Promise.resolve()
  })
  const seekTo = vi.fn((value: number) => {
    current = { ...current, metrics: { ...current.metrics, currentTime: value } }
    return Promise.resolve()
  })
  const setVisualState = vi.fn((value: VisualState) => {
    current = { ...current, visual: value }
    return Promise.resolve()
  })
  const setGain = vi.fn((value: number) => {
    current = { ...current, metrics: { ...current.metrics, gain: value } }
    return Promise.resolve()
  })
  const playNext = vi.fn(() => Promise.resolve(undefined))
  const capture: CaptureArtifact = {
    mimeType: 'image/png',
    width: 1,
    height: 1,
    byteLength: 3,
    dataBase64: 'AQID'
  }
  const captureFrame = vi.fn(() => Promise.resolve(capture))
  const setPlaybackRate = vi.fn((value: number) => {
    if (options.applyPlaybackRate !== false) {
      current = { ...current, metrics: { ...current.metrics, playbackRate: value } }
    }
    return Promise.resolve()
  })
  const controller: MediaController = {
    mediaId: current.id,
    capabilities: current.capabilities,
    getSnapshot: () => current,
    play: vi.fn(() => Promise.resolve(undefined)),
    pause,
    seekTo,
    setPlaybackRate,
    setVolume: vi.fn(() => Promise.resolve(undefined)),
    setGain,
    setMuted: vi.fn(() => Promise.resolve(undefined)),
    setVisualState,
    playNext,
    captureFrame
  }
  const registry = createMediaCommandRegistry({ resolve: () => controller })
  return {
    registry,
    pause,
    seekTo,
    setVisualState,
    setGain,
    setPlaybackRate,
    playNext,
    captureFrame,
    capture
  }
}

describe('media command handlers', () => {
  it('fails closed when a rate setter reports success but the postcondition is not met', async () => {
    const { registry, setPlaybackRate } = harness(snapshot(), { applyPlaybackRate: false })

    await expect(
      registry.dispatch({ type: 'media.set-rate', mediaId: 'media-0-1', value: 2 })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'COMMAND_EXECUTION_FAILED',
        context: {
          phase: 'playback-rate-postcondition',
          expectedRate: 2,
          actualRate: 1
        }
      }
    })
    expect(setPlaybackRate).toHaveBeenCalledWith(2)
  })

  it('returns the applied rate after a successful setter', async () => {
    const { registry, setPlaybackRate } = harness()

    await expect(
      registry.dispatch({ type: 'media.adjust-rate', mediaId: 'media-0-1', delta: 0.1 })
    ).resolves.toMatchObject({
      ok: true,
      value: { changed: true, snapshot: { metrics: { playbackRate: 1.1 } } }
    })
    expect(setPlaybackRate).toHaveBeenCalledWith(1.1)
  })

  it('steps at the Legacy 30 FPS interval and pauses active media first', async () => {
    const { registry, pause, seekTo } = harness()

    await expect(
      registry.dispatch({ type: 'media.step-frame', mediaId: 'media-0-1', frames: 1 })
    ).resolves.toMatchObject({ ok: true, value: { changed: true } })

    expect(pause).toHaveBeenCalledOnce()
    expect(seekTo).toHaveBeenCalledWith(30 + 1 / 30)
  })

  it('resets transform fields while preserving all active filters', async () => {
    const visual: VisualState = {
      zoom: 2,
      pan: { x: 30, y: -20 },
      rotation: 90,
      flip: { horizontal: true, vertical: true },
      filters: { brightness: 1.2, contrast: 0.8, saturation: 1.4, hue: 20, blur: 3 }
    }
    const { registry, setVisualState } = harness(snapshot({ visual }))

    await registry.dispatch({ type: 'media.reset-transform', mediaId: 'media-0-1' })

    expect(setVisualState).toHaveBeenCalledWith({
      ...DEFAULT_VISUAL_STATE,
      filters: visual.filters
    })
  })

  it('executes next only when advertised and normalizes site-action failures', async () => {
    const available = harness()
    await expect(
      available.registry.dispatch({ type: 'media.play-next', mediaId: 'media-0-1' })
    ).resolves.toMatchObject({ ok: true })
    expect(available.playNext).toHaveBeenCalledOnce()

    const unavailable = harness(
      snapshot({ capabilities: createMediaCapabilities({ playback: true, next: false }) })
    )
    await expect(
      unavailable.registry.dispatch({ type: 'media.play-next', mediaId: 'media-0-1' })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'CAPABILITY_UNAVAILABLE', context: { capability: 'next' } }
    })

    const failed = harness()
    failed.playNext.mockRejectedValueOnce(new Error('site action failed'))
    await expect(
      failed.registry.dispatch({ type: 'media.play-next', mediaId: 'media-0-1' })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'COMMAND_EXECUTION_FAILED', context: { phase: 'next' } }
    })
  })

  it('returns the capture artifact to the caller', async () => {
    const initial = snapshot({
      capabilities: createMediaCapabilities({ playback: true, capture: true })
    })
    const { registry, captureFrame, capture } = harness(initial)

    await expect(
      registry.dispatch({ type: 'media.capture', mediaId: 'media-0-1' })
    ).resolves.toMatchObject({ ok: true, value: { artifact: capture } })
    expect(captureFrame).toHaveBeenCalledWith({ mimeType: 'image/png' })
  })

  it('clamps optional Web Audio gain and requires the explicit capability', async () => {
    const available = harness(
      snapshot({
        capabilities: createMediaCapabilities({ playback: true, audioGain: true }),
        metrics: { ...snapshot().metrics, gain: 1 }
      })
    )
    await expect(
      available.registry.dispatch({ type: 'media.set-gain', mediaId: 'media-0-1', value: 99 })
    ).resolves.toMatchObject({
      ok: true,
      value: { snapshot: { metrics: { gain: 6 } } }
    })
    expect(available.setGain).toHaveBeenCalledWith(6)

    const unavailable = harness()
    await expect(
      unavailable.registry.dispatch({ type: 'media.adjust-gain', mediaId: 'media-0-1', delta: 1 })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'CAPABILITY_UNAVAILABLE', context: { capability: 'audioGain' } }
    })
  })

  it('requires the content download route for experimental downloads', async () => {
    const initial = snapshot({
      capabilities: createMediaCapabilities({ playback: true, downloadExperimental: true })
    })
    const { registry } = harness(initial)

    await expect(
      registry.dispatch({ type: 'media.download', mediaId: 'media-0-1' })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'DOWNLOAD_UNAVAILABLE',
        context: { phase: 'download-route-required' }
      }
    })
  })
})
