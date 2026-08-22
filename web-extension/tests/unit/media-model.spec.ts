import { describe, expect, it } from 'vitest'
import {
  clampMediaTime,
  clampPlaybackRate,
  createMediaCapabilities,
  createMediaId,
  createMediaSession,
  DEFAULT_MEDIA_CAPABILITIES,
  isControllableMediaState,
  isMediaId,
  isMediaSnapshot,
  mediaSnapshotSchema,
  roundMediaValue,
  serializeMediaSession,
  type MediaSnapshot
} from '../../src/domain/media'

function validSnapshot(): MediaSnapshot {
  return {
    id: 'media:0:1',
    frameId: 0,
    kind: 'video',
    state: 'paused',
    metrics: {
      width: 1_920,
      height: 1_080,
      duration: 120,
      currentTime: 12.5,
      volume: 0.75,
      playbackRate: 1.25,
      muted: false,
      visible: true
    },
    capabilities: createMediaCapabilities({
      playback: true,
      seek: true,
      playbackRate: true,
      volume: true,
      mute: true
    }),
    adapterId: 'generic',
    updatedAt: 1_725_000_000_000
  }
}

describe('media domain model', () => {
  it('creates bounded media identifiers with predictable failures', () => {
    expect(createMediaId('media:0:1')).toEqual({ ok: true, value: 'media:0:1' })
    expect(isMediaId('媒体-1')).toBe(true)

    for (const invalid of ['', ' media', 'media\n1', 'x'.repeat(129), null]) {
      const result = createMediaId(invalid)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: 'INVALID_MEDIA_ID',
          messageKey: 'media.error.invalidId'
        })
      }
    }
  })

  it('defaults capabilities to deny and applies explicit overrides', () => {
    expect(DEFAULT_MEDIA_CAPABILITIES).toEqual({
      playback: false,
      seek: false,
      playbackRate: false,
      volume: false,
      mute: false,
      fullscreen: false,
      pictureInPicture: false,
      capture: false,
      next: false,
      downloadExperimental: false
    })
    expect(createMediaCapabilities({ playback: true, seek: true })).toEqual({
      ...DEFAULT_MEDIA_CAPABILITIES,
      playback: true,
      seek: true
    })
  })

  it('round-trips snapshots through JSON without DOM or function state', () => {
    const snapshot = validSnapshot()
    const serialized = serializeMediaSession(snapshot)
    expect(serialized).toEqual({ ok: true, value: snapshot })

    const roundTrip: unknown = JSON.parse(JSON.stringify(snapshot))
    expect(mediaSnapshotSchema.parse(roundTrip)).toEqual(snapshot)
    expect(isMediaSnapshot(roundTrip)).toBe(true)
    expect(
      isMediaSnapshot({
        ...snapshot,
        element: { play: () => undefined }
      })
    ).toBe(false)
  })

  it('rejects invalid metrics, timestamps, identifiers, and extra data', () => {
    const snapshot = validSnapshot()
    const invalidSnapshots: unknown[] = [
      { ...snapshot, frameId: -1 },
      { ...snapshot, updatedAt: Number.POSITIVE_INFINITY },
      { ...snapshot, adapterId: '' },
      { ...snapshot, metrics: { ...snapshot.metrics, volume: 1.01 } },
      { ...snapshot, metrics: { ...snapshot.metrics, playbackRate: 0 } },
      { ...snapshot, metrics: { ...snapshot.metrics, currentTime: 121 } },
      { ...snapshot, metrics: { ...snapshot.metrics, duration: Number.POSITIVE_INFINITY } },
      { ...snapshot, unexpected: true }
    ]

    for (const invalid of invalidSnapshots) {
      const result = createMediaSession(invalid)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INVALID_MEDIA_SNAPSHOT')
    }
  })

  it('exposes shared media bounds and controllable lifecycle states', () => {
    expect(clampPlaybackRate(-100)).toBe(0.1)
    expect(clampPlaybackRate(100)).toBe(16)
    expect(clampMediaTime(-5, null)).toBe(0)
    expect(clampMediaTime(150, 120)).toBe(120)
    expect(roundMediaValue(1 + 0.1)).toBe(1.1)
    expect(isControllableMediaState('ready')).toBe(true)
    expect(isControllableMediaState('removed')).toBe(false)
  })
})
