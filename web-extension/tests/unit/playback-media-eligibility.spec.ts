import { describe, expect, it } from 'vitest'
import { classifyPlaybackMedia, playbackEligibleMedia } from '../../src/domain/playback'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'

function media(
  id: string,
  overrides: Omit<Partial<MediaSnapshot>, 'metrics'> & {
    metrics?: Partial<MediaSnapshot['metrics']>
  } = {}
): MediaSnapshot {
  const metrics = {
    width: 640,
    height: 360,
    duration: 120,
    currentTime: 0,
    volume: 1,
    playbackRate: 1,
    muted: false,
    visible: true,
    ...overrides.metrics
  } satisfies MediaSnapshot['metrics']
  const { metrics: omittedMetrics, ...snapshotOverrides } = overrides
  void omittedMetrics
  return {
    id,
    frameId: 0,
    kind: 'video',
    state: 'paused',
    metrics,
    capabilities: createMediaCapabilities({ playbackRate: true }),
    adapterId: 'generic',
    updatedAt: 1,
    ...snapshotOverrides
  }
}

describe('playback media eligibility', () => {
  it('keeps explicit active media eligible while excluding background media by default', () => {
    const activeAudio = media('audio-active', {
      kind: 'audio',
      metrics: { width: 300, height: 54, visible: true }
    })
    expect(classifyPlaybackMedia(activeAudio, activeAudio.id)).toEqual({
      eligible: true,
      reason: 'active'
    })
    expect(classifyPlaybackMedia(media('hidden', { metrics: { visible: false } }), null)).toEqual({
      eligible: false,
      reason: 'hidden'
    })
    expect(
      classifyPlaybackMedia(
        media('tiny', { metrics: { width: 120, height: 60, visible: true } }),
        null
      )
    ).toEqual({ eligible: false, reason: 'small-video' })
    expect(classifyPlaybackMedia(media('audio', { kind: 'audio' }), null)).toEqual({
      eligible: false,
      reason: 'background-audio'
    })
    expect(classifyPlaybackMedia(media('preview', { metrics: { opacity: 0.25 } }), null)).toEqual({
      eligible: false,
      reason: 'background-media'
    })
    expect(
      classifyPlaybackMedia(
        media('stale-active-preview', { metrics: { opacity: 0.25 } }),
        'stale-active-preview'
      )
    ).toEqual({ eligible: false, reason: 'background-media' })
  })

  it('returns visible content videos plus the active media in discovery order', () => {
    const items = [
      media('content'),
      media('hidden', { metrics: { visible: false } }),
      media('audio', { kind: 'audio' }),
      media('active-small', { metrics: { width: 80, height: 45, visible: true } })
    ]
    expect(playbackEligibleMedia(items, 'active-small').map((item) => item.id)).toEqual([
      'content',
      'active-small'
    ])
  })
})
