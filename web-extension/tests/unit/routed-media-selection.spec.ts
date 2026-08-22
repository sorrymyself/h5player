import { describe, expect, it } from 'vitest'
import {
  isDefinitiveRoutableMediaState,
  selectRoutableMediaState,
  type MediaPageState
} from '../../src/application/media'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'

function media(id: string, frameId: number, overrides: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    id,
    frameId,
    kind: 'video',
    state: 'active',
    sourceKey: `source-${id}`,
    metrics: {
      width: 946,
      height: 532,
      duration: 360,
      currentTime: 49,
      volume: 1,
      playbackRate: 1,
      muted: false,
      visible: true
    },
    capabilities: createMediaCapabilities({
      playback: true,
      seek: true,
      playbackRate: true,
      volume: true,
      mute: true,
      visual: true
    }),
    adapterId: 'generic',
    updatedAt: 1,
    ...overrides
  }
}

function state(snapshot: MediaSnapshot): MediaPageState {
  return {
    frameId: snapshot.frameId,
    revision: 1,
    activeMediaId: snapshot.id,
    media: [snapshot],
    observedAt: snapshot.updatedAt
  }
}

describe('routed media selection', () => {
  it('keeps Tencent media provisional until sibling frames can be compared', () => {
    const pausedNative = state(
      media('media-0-1', 0, {
        state: 'paused',
        adapterId: 'tencent-video',
        updatedAt: 2
      })
    )
    const viewportProxy = state(
      media('media-17-tencent-viewport', 17, {
        sourceKey: undefined,
        metrics: {
          width: 946,
          height: 532,
          duration: null,
          currentTime: 0,
          volume: 1,
          playbackRate: 1,
          muted: false,
          visible: true
        },
        capabilities: createMediaCapabilities({ playbackRate: true }),
        adapterId: 'tencent-video',
        updatedAt: 3
      })
    )

    expect(isDefinitiveRoutableMediaState(pausedNative)).toBe(false)
    expect(
      isDefinitiveRoutableMediaState(
        state(media('media-0-active', 0, { adapterId: 'tencent-video' }))
      )
    ).toBe(false)
    expect(isDefinitiveRoutableMediaState(viewportProxy)).toBe(false)
    expect(selectRoutableMediaState([pausedNative, viewportProxy])).toBe(viewportProxy)
    expect(selectRoutableMediaState([pausedNative])).toBe(pausedNative)
  })

  it('still treats a strong non-Tencent native player as definitive', () => {
    expect(isDefinitiveRoutableMediaState(state(media('media-0-1', 0)))).toBe(true)
  })

  it('prefers an active Tencent native replacement over a paused viewport facade', () => {
    const activeNative = state(
      media('media-0-1', 0, {
        adapterId: 'tencent-video',
        state: 'active',
        updatedAt: 20
      })
    )
    const pausedViewport = state(
      media('media-14-tencent-viewport', 14, {
        adapterId: 'tencent-video',
        state: 'paused',
        sourceKey: undefined,
        capabilities: createMediaCapabilities({ playbackRate: true }),
        updatedAt: 21
      })
    )

    expect(selectRoutableMediaState([pausedViewport, activeNative])).toBe(activeNative)
  })
})
