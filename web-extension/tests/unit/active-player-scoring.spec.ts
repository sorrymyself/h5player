import { describe, expect, it } from 'vitest'
import {
  scoreActivePlayer,
  selectActivePlayer,
  type ActivePlayerCandidate
} from '../../src/domain/adapter'
import type { MediaCapabilities, MediaSnapshot } from '../../src/domain/media'

const capabilities: MediaCapabilities = {
  playback: true,
  seek: true,
  playbackRate: true,
  volume: true,
  mute: true,
  fullscreen: false,
  pictureInPicture: false,
  capture: false,
  downloadExperimental: false
}

function candidate(
  id: string,
  overrides: Partial<{
    visible: boolean
    width: number
    height: number
    duration: number | null
    currentTime: number
    sourceKey: string | undefined
    state: MediaSnapshot['state']
    opacity: number
    focused: boolean
    lastInteractionAt: number | null
    discoveryOrder: number
    kind: MediaSnapshot['kind']
  }> = {}
): ActivePlayerCandidate {
  return {
    snapshot: {
      id,
      frameId: 0,
      ...(overrides.sourceKey === undefined ? {} : { sourceKey: overrides.sourceKey }),
      kind: overrides.kind ?? 'video',
      state: overrides.state ?? 'paused',
      metrics: {
        width: overrides.width ?? 640,
        height: overrides.height ?? 360,
        duration: overrides.duration ?? 120,
        currentTime: overrides.currentTime ?? 10,
        volume: 1,
        playbackRate: 1,
        muted: false,
        opacity: overrides.opacity ?? 1,
        visible: overrides.visible ?? true
      },
      capabilities,
      adapterId: 'generic',
      updatedAt: 1
    },
    focused: overrides.focused ?? false,
    lastInteractionAt: overrides.lastInteractionAt ?? null,
    discoveryOrder: overrides.discoveryOrder ?? 1
  }
}

describe('active player scoring', () => {
  it('scores visibility, focus, recent interaction, playback and size monotonically', () => {
    const now = 20_000
    const baseline = scoreActivePlayer(candidate('baseline'), now)

    expect(scoreActivePlayer(candidate('visible', { visible: false }), now).total).toBeLessThan(
      baseline.total
    )
    expect(scoreActivePlayer(candidate('focused', { focused: true }), now).total).toBeGreaterThan(
      baseline.total
    )
    expect(
      scoreActivePlayer(candidate('recent', { lastInteractionAt: now - 100 }), now).total
    ).toBeGreaterThan(baseline.total)
    expect(scoreActivePlayer(candidate('playing', { state: 'active' }), now).total).toBeGreaterThan(
      baseline.total
    )
    expect(
      scoreActivePlayer(candidate('large', { width: 1920, height: 1080 }), now).area
    ).toBeGreaterThan(scoreActivePlayer(candidate('small', { width: 320, height: 180 }), now).area)
    expect(scoreActivePlayer(candidate('foreground', { opacity: 1 }), now).opacity).toBeGreaterThan(
      scoreActivePlayer(candidate('preview', { opacity: 0.25 }), now).opacity
    )
  })

  it('keeps the current player for exact ties to prevent lifecycle churn', () => {
    const first = candidate('first', { discoveryOrder: 1 })
    const second = candidate('second', { discoveryOrder: 2 })

    expect(
      selectActivePlayer([first, second], { now: 1_000, currentMediaId: 'second' })?.snapshot.id
    ).toBe('second')
  })

  it('selects the real Tencent playback instance over a hidden auxiliary video', () => {
    const realPlayback = candidate('real-playback', {
      visible: true,
      state: 'active',
      sourceKey: 'source-real',
      duration: 479.96,
      currentTime: 25.4,
      discoveryOrder: 2
    })
    const hiddenAuxiliary = candidate('hidden-auxiliary', {
      visible: false,
      state: 'paused',
      duration: null,
      currentTime: 0,
      discoveryOrder: 1
    })

    expect(
      selectActivePlayer([hiddenAuxiliary, realPlayback], {
        now: 1_000,
        currentMediaId: hiddenAuxiliary.snapshot.id
      })?.snapshot.id
    ).toBe(realPlayback.snapshot.id)
  })

  it('prefers an opaque foreground player over a larger translucent preview', () => {
    const preview = candidate('preview', {
      width: 1920,
      height: 1080,
      opacity: 0.25,
      state: 'active',
      discoveryOrder: 1
    })
    const foreground = candidate('foreground', {
      width: 1280,
      height: 720,
      opacity: 1,
      state: 'active',
      discoveryOrder: 2
    })

    expect(selectActivePlayer([preview, foreground], { now: 1_000 })?.snapshot.id).toBe(
      foreground.snapshot.id
    )
  })

  it('never lets a playing, focused, recently interacted background layer displace foreground media', () => {
    const now = 30_000
    const background = candidate('background', {
      width: 1920,
      height: 1080,
      opacity: 0.25,
      state: 'active',
      focused: true,
      lastInteractionAt: now - 1,
      discoveryOrder: 1
    })
    const foreground = candidate('foreground', {
      width: 1280,
      height: 720,
      opacity: 1,
      state: 'paused',
      discoveryOrder: 2
    })

    expect(
      selectActivePlayer([background, foreground], {
        now,
        currentMediaId: background.snapshot.id
      })?.snapshot.id
    ).toBe(foreground.snapshot.id)
  })

  it('keeps best-effort control when every discovered media layer is translucent', () => {
    const playing = candidate('playing', {
      opacity: 0.25,
      state: 'active',
      discoveryOrder: 2
    })
    const paused = candidate('paused', { opacity: 0.1, discoveryOrder: 1 })

    expect(selectActivePlayer([paused, playing], { now: 1_000 })?.snapshot.id).toBe('playing')
  })

  it('uses discovery order and media id as deterministic final tie-breakers', () => {
    const later = candidate('alpha', { discoveryOrder: 2 })
    const earlier = candidate('zulu', { discoveryOrder: 1 })
    expect(selectActivePlayer([later, earlier], { now: 1_000 })?.snapshot.id).toBe('zulu')

    const alpha = candidate('alpha', { discoveryOrder: 1 })
    const zulu = candidate('zulu', { discoveryOrder: 1 })
    expect(selectActivePlayer([zulu, alpha], { now: 1_000 })?.snapshot.id).toBe('alpha')
  })

  it('expires interaction preference and safely normalizes invalid dimensions', () => {
    const now = 100_000
    const expired = candidate('expired', {
      lastInteractionAt: now - 15_000,
      width: Number.NaN,
      height: Number.POSITIVE_INFINITY
    })
    const score = scoreActivePlayer(expired, now)

    expect(score.recentInteraction).toBe(0)
    expect(score.area).toBe(0)
    expect(Number.isFinite(score.total)).toBe(true)
  })
})
