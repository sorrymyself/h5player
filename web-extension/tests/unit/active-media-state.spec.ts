import { describe, expect, it } from 'vitest'
import { activeMediaForState, hasRoutableActiveMedia } from '../../src/application/media'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'

function media(
  id: string,
  overrides: Partial<Pick<MediaSnapshot, 'kind' | 'state'>> & {
    visible?: boolean
  } = {}
): MediaSnapshot {
  return {
    id,
    frameId: 0,
    kind: overrides.kind ?? 'video',
    state: overrides.state ?? 'active',
    metrics: {
      width: 946,
      height: 532,
      duration: 120,
      currentTime: 10,
      volume: 1,
      playbackRate: 1,
      muted: false,
      visible: overrides.visible ?? true
    },
    capabilities: createMediaCapabilities({ playback: true, playbackRate: true }),
    adapterId: 'generic',
    updatedAt: 1
  }
}

describe('active media state', () => {
  it('does not route a hidden auxiliary video as the active playback surface', () => {
    const hidden = media('media-0-1', { visible: false })
    const state = {
      frameId: 0,
      revision: 1,
      activeMediaId: hidden.id,
      media: [hidden],
      observedAt: 1
    }

    expect(activeMediaForState(state)).toBe(hidden)
    expect(hasRoutableActiveMedia(state)).toBe(false)
  })

  it('keeps visible video and active audio routable', () => {
    const video = media('media-0-1')
    const audio = media('media-0-2', { kind: 'audio', visible: false })

    expect(
      hasRoutableActiveMedia({
        frameId: 0,
        revision: 1,
        activeMediaId: video.id,
        media: [video],
        observedAt: 1
      })
    ).toBe(true)
    expect(
      hasRoutableActiveMedia({
        frameId: 0,
        revision: 2,
        activeMediaId: audio.id,
        media: [audio],
        observedAt: 2
      })
    ).toBe(true)
  })
})
