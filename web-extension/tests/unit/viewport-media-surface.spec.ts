import { describe, expect, it } from 'vitest'
import {
  resolveViewportMediaSurface,
  viewportMediaOverlayInsetsForUrl,
  viewportMediaSiteOriginForFrame,
  viewportMediaSurfaceKindForUrl
} from '../../src/shared/viewport-media-surface'

const TENCENT_FRAME_URL =
  'https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/fake-video-element-iframe.html'

describe('viewport media surfaces', () => {
  it('recognizes only the explicit Tencent fake video frame path', () => {
    expect(viewportMediaSurfaceKindForUrl(`${TENCENT_FRAME_URL}?v=1`)).toBe(
      'tencent-video-fake-element-frame'
    )
    expect(
      viewportMediaSurfaceKindForUrl('https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/other.html')
    ).toBeNull()
    expect(
      viewportMediaSurfaceKindForUrl(
        'https://vm.gtimg.cn.evil.invalid/thumbplayer/txv/wasm/1.0.53/fake-video-element-iframe.html'
      )
    ).toBeNull()
    expect(viewportMediaSurfaceKindForUrl(TENCENT_FRAME_URL.replace('https:', 'http:'))).toBeNull()
    expect(viewportMediaSurfaceKindForUrl('not-a-url')).toBeNull()
  })

  it('uses the child-frame viewport only for a zero-sized video element', () => {
    expect(
      resolveViewportMediaSurface({
        url: TENCENT_FRAME_URL,
        mediaKind: 'video',
        elementWidth: 0,
        elementHeight: 0,
        viewportWidth: 946,
        viewportHeight: 532
      })
    ).toEqual({
      kind: 'tencent-video-fake-element-frame',
      width: 946,
      height: 532
    })
  })

  it('reserves a top interaction-safe area inside the Tencent proxy frame', () => {
    expect(viewportMediaOverlayInsetsForUrl(TENCENT_FRAME_URL)).toEqual({
      top: 104,
      right: 8,
      bottom: 8,
      left: 8
    })
    expect(viewportMediaOverlayInsetsForUrl('https://v.qq.com/x/cover/example/video.html')).toEqual(
      {
        top: 104,
        right: 8,
        bottom: 8,
        left: 8
      }
    )
    expect(viewportMediaOverlayInsetsForUrl('https://example.com/player.html')).toBeNull()
    expect(viewportMediaOverlayInsetsForUrl('https://v.qq.com.evil.invalid/player.html')).toBeNull()
  })

  it('rejects unrelated media and invalid geometry', () => {
    const base = {
      url: TENCENT_FRAME_URL,
      mediaKind: 'video' as const,
      elementWidth: 0,
      elementHeight: 0,
      viewportWidth: 946,
      viewportHeight: 532
    }
    expect(resolveViewportMediaSurface({ ...base, mediaKind: 'audio' })).toBeNull()
    expect(resolveViewportMediaSurface({ ...base, elementWidth: 1 })).toBeNull()
    expect(resolveViewportMediaSurface({ ...base, elementHeight: 1 })).toBeNull()
    expect(resolveViewportMediaSurface({ ...base, viewportWidth: 0 })).toBeNull()
    expect(resolveViewportMediaSurface({ ...base, viewportHeight: Number.NaN })).toBeNull()
    expect(
      resolveViewportMediaSurface({ ...base, url: 'https://example.com/player.html' })
    ).toBeNull()
  })

  it('maps only the Tencent proxy frame to an approved top-level video origin', () => {
    expect(
      viewportMediaSiteOriginForFrame(
        TENCENT_FRAME_URL,
        'https://v.qq.com/x/cover/example/video.html?token=secret'
      )
    ).toBe('https://v.qq.com')
    expect(viewportMediaSiteOriginForFrame(TENCENT_FRAME_URL, 'https://sports.qq.com/live')).toBe(
      'https://sports.qq.com'
    )
    expect(
      viewportMediaSiteOriginForFrame(TENCENT_FRAME_URL, 'https://qq.com.evil.invalid/watch')
    ).toBeNull()
    expect(
      viewportMediaSiteOriginForFrame('https://example.com/frame.html', 'https://v.qq.com/watch')
    ).toBeNull()
  })
})
