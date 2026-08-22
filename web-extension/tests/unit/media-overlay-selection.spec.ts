import { describe, expect, it } from 'vitest'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'
import { selectMediaOverlayOwners, type MediaAnchor } from '../../src/infrastructure/dom'

function snapshot(
  id: string,
  overrides: Omit<Partial<MediaSnapshot>, 'metrics'> & {
    metrics?: Partial<MediaSnapshot['metrics']>
  } = {}
): MediaSnapshot {
  const metrics = {
    width: 960,
    height: 540,
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
    sourceKey: `source-${id}`,
    kind: 'video',
    state: 'paused',
    metrics,
    capabilities: createMediaCapabilities({ playback: true, playbackRate: true }),
    adapterId: 'generic',
    updatedAt: 1,
    ...snapshotOverrides
  }
}

function rect(x: number, y: number, width: number, height: number): DOMRectReadOnly {
  return {
    x,
    y,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({})
  }
}

function anchor(mediaId: string, mediaRect: DOMRectReadOnly): MediaAnchor {
  const element = document.createElement('video')
  document.body.append(element)
  return {
    mediaId,
    element,
    kind: 'video',
    surface: 'element',
    rect: mediaRect,
    placement: 'top-right',
    compact: false
  }
}

describe('media overlay selection', () => {
  it('keeps only the active UI owner for fully overlapped player instances', () => {
    const media = [snapshot('preload'), snapshot('content', { state: 'active' })]
    const sharedRect = rect(48, 76, 962, 541)

    expect([
      ...selectMediaOverlayOwners(media, 'content', [
        anchor('preload', sharedRect),
        anchor('content', sharedRect)
      ])
    ]).toEqual(['content'])
  })

  it('retains the active owner while paused so duplicate preload UI does not reappear', () => {
    const media = [snapshot('preload'), snapshot('content')]
    const sharedRect = rect(0, 0, 1_280, 720)

    expect([
      ...selectMediaOverlayOwners(media, 'content', [
        anchor('preload', sharedRect),
        anchor('content', sharedRect)
      ])
    ]).toEqual(['content'])
  })

  it('keeps independent controls for separate videos and embedded picture-in-picture regions', () => {
    const media = [snapshot('main'), snapshot('secondary'), snapshot('pip')]
    const owners = selectMediaOverlayOwners(media, 'main', [
      anchor('main', rect(0, 0, 1_280, 720)),
      anchor('secondary', rect(0, 360, 640, 360)),
      anchor('pip', rect(920, 500, 320, 180))
    ])

    expect([...owners]).toEqual(['main', 'secondary', 'pip'])
  })

  it('excludes hidden, undersized, and audio media from page overlay ownership', () => {
    const media = [
      snapshot('hidden', { metrics: { visible: false } }),
      snapshot('tiny', { metrics: { width: 120, height: 60 } }),
      snapshot('audio', { kind: 'audio', metrics: { width: 640, height: 360 } })
    ]

    expect([
      ...selectMediaOverlayOwners(media, null, [
        anchor('hidden', rect(0, 0, 960, 540)),
        anchor('tiny', rect(0, 0, 120, 60)),
        anchor('audio', rect(0, 0, 640, 360))
      ])
    ]).toEqual([])
  })

  it('does not mount UI on a translucent background layer even when its active id is stale', () => {
    const sharedRect = rect(0, 0, 1_280, 720)
    const media = [
      snapshot('background', {
        state: 'active',
        metrics: { opacity: 0.25, currentTime: 30 }
      }),
      snapshot('foreground', { metrics: { opacity: 1, currentTime: 10 } })
    ]

    expect([
      ...selectMediaOverlayOwners(media, 'background', [
        anchor('background', sharedRect),
        anchor('foreground', sharedRect)
      ])
    ]).toEqual(['foreground'])
  })

  it('does not retain a host for a media card that is only a sliver inside the viewport', () => {
    const sliver = rect(0, 890, 960, 540)
    expect([
      ...selectMediaOverlayOwners([snapshot('sliver')], 'sliver', [anchor('sliver', sliver)])
    ]).toEqual([])
  })
})
