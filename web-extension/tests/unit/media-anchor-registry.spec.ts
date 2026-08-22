import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isUsableMediaAnchor,
  MEDIA_ANCHOR_ATTRIBUTE,
  mediaAnchorPoint,
  MediaAnchorRegistry
} from '../../src/infrastructure/dom/media-anchor-registry'

function rect(values: Partial<DOMRectReadOnly> = {}): DOMRectReadOnly {
  return {
    x: 100,
    y: 100,
    top: 100,
    left: 100,
    right: 740,
    bottom: 460,
    width: 640,
    height: 360,
    toJSON: () => ({}),
    ...values
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('MediaAnchorRegistry', () => {
  it('maps stable media ids to DOM anchors without duplicates', () => {
    const video = document.createElement('video')
    video.setAttribute(MEDIA_ANCHOR_ATTRIBUTE, 'media-0-1')
    video.getBoundingClientRect = vi.fn(() => rect())
    document.body.append(video)
    const onChanged = vi.fn()
    const registry = new MediaAnchorRegistry({ root: document, onChanged })
    registry.start()
    registry.refresh()

    expect(registry.current()).toHaveLength(1)
    expect(registry.resolve('media-0-1')).toMatchObject({
      mediaId: 'media-0-1',
      element: video,
      kind: 'video',
      compact: false
    })
    expect(onChanged).toHaveBeenCalled()
    registry.teardown()
  })

  it('discovers anchors in open shadow roots and removes detached media', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    const video = document.createElement('video')
    video.setAttribute(MEDIA_ANCHOR_ATTRIBUTE, 'media-0-2')
    video.getBoundingClientRect = vi.fn(() => rect({ width: 240, height: 120 }))
    shadow.append(video)
    document.body.append(host)
    const registry = new MediaAnchorRegistry({ root: document })
    registry.start()
    expect(registry.resolve('media-0-2')).toMatchObject({ compact: true })

    video.remove()
    registry.refresh()
    expect(registry.resolve('media-0-2')).toBeNull()
    registry.teardown()
  })

  it('falls back through safe placements and supports audio compact mode', () => {
    const audio = document.createElement('audio')
    audio.setAttribute(MEDIA_ANCHOR_ATTRIBUTE, 'media-0-3')
    audio.getBoundingClientRect = vi.fn(() => rect({ top: 8, right: window.innerWidth - 4 }))
    document.body.append(audio)
    const registry = new MediaAnchorRegistry({ root: document })
    registry.start()

    expect(registry.resolve('media-0-3')).toMatchObject({
      kind: 'audio',
      compact: true,
      placement: 'top-right'
    })
    registry.teardown()
  })

  it('treats zero-sized and offscreen media as unusable anchors', () => {
    const video = document.createElement('video')
    video.setAttribute(MEDIA_ANCHOR_ATTRIBUTE, 'media-0-4')
    video.getBoundingClientRect = vi.fn(() => rect({ width: 0, height: 0 }))
    document.body.append(video)
    const registry = new MediaAnchorRegistry({ root: document })
    registry.start()
    const zeroSized = registry.resolve('media-0-4')
    expect(zeroSized?.rect).toBeNull()
    if (zeroSized === null) throw new Error('zero-sized anchor missing')
    expect(isUsableMediaAnchor(zeroSized)).toBe(false)

    video.getBoundingClientRect = vi.fn(() =>
      rect({ top: window.innerHeight + 10, bottom: window.innerHeight + 370 })
    )
    registry.refresh()
    const offscreen = registry.resolve('media-0-4')
    if (offscreen === null) throw new Error('offscreen anchor missing')
    expect(isUsableMediaAnchor(offscreen)).toBe(false)
    registry.teardown()
  })

  it('rejects a barely visible feed card while keeping a mostly visible media anchor usable', () => {
    const video = document.createElement('video')
    video.setAttribute(MEDIA_ANCHOR_ATTRIBUTE, 'media-0-5')
    video.getBoundingClientRect = vi.fn(() =>
      rect({ top: window.innerHeight - 12, bottom: window.innerHeight + 348 })
    )
    document.body.append(video)
    const registry = new MediaAnchorRegistry({ root: document })
    registry.start()
    const sliver = registry.resolve('media-0-5')
    if (sliver === null) throw new Error('sliver anchor missing')
    expect(isUsableMediaAnchor(sliver)).toBe(false)

    video.getBoundingClientRect = vi.fn(() =>
      rect({ top: window.innerHeight - 180, bottom: window.innerHeight + 180 })
    )
    registry.refresh()
    const mostlyVisible = registry.resolve('media-0-5')
    if (mostlyVisible === null) throw new Error('mostly visible anchor missing')
    expect(isUsableMediaAnchor(mostlyVisible)).toBe(true)
    registry.teardown()
  })

  it('clamps the anchor point to the visible media edge while scrolling', () => {
    const anchor = {
      rect: rect({ top: -40, bottom: 320, right: 900 }),
      placement: 'top-right' as const
    }

    expect(mediaAnchorPoint(anchor, { innerWidth: 1_000, innerHeight: 800 })).toEqual({
      x: 892,
      y: 8
    })
    expect(
      mediaAnchorPoint(
        { rect: rect({ left: -80, right: 640, bottom: 920 }), placement: 'bottom-left' },
        { innerWidth: 1_000, innerHeight: 800 }
      )
    ).toEqual({ x: 8, y: 792 })
    expect(
      mediaAnchorPoint(
        { rect: rect({ top: 820, bottom: 1_000 }), placement: 'top-right' },
        { innerWidth: 1_000, innerHeight: 800 }
      )
    ).toBeNull()
    expect(
      mediaAnchorPoint(anchor, { innerWidth: 1_000, innerHeight: 800 }, { top: 56, right: 8 })
    ).toEqual({ x: 892, y: 56 })
  })
})
