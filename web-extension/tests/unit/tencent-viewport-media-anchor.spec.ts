import { afterEach, describe, expect, it, vi } from 'vitest'
import { findTencentViewportMediaSurface } from '../../src/infrastructure/dom'

const TENCENT_FRAME_URL =
  'https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/fake-video-element-iframe.html'

function rect(x: number, y: number, width: number, height: number): DOMRect {
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

function frame(
  src: string,
  frameRect: DOMRect,
  parent: Element | ShadowRoot = document.body
): HTMLIFrameElement {
  const element = document.createElement('iframe')
  element.getBoundingClientRect = vi.fn(() => frameRect)
  parent.append(element)
  Object.defineProperty(element, 'src', { configurable: true, value: src })
  return element
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('Tencent viewport media anchor', () => {
  it('selects the visible fake-video frame matching the routed media dimensions', () => {
    frame('https://example.com/unrelated.html', rect(0, 0, 1_280, 720))
    frame(TENCENT_FRAME_URL, rect(20, 20, 320, 180))
    const playerHost = document.createElement('div')
    const playerShadow = playerHost.attachShadow({ mode: 'open' })
    document.body.append(playerHost)
    const playbackSurface = frame(
      `${TENCENT_FRAME_URL}?player=content`,
      rect(52, 84, 946, 532),
      playerShadow
    )

    const selected = findTencentViewportMediaSurface(document, {
      expectedWidth: 946,
      expectedHeight: 532
    })

    expect(selected?.element).toBe(playbackSurface)
    expect(selected?.rect).toMatchObject({ x: 52, y: 84, width: 946, height: 532 })
  })

  it('ignores zero-sized and fully offscreen fake-video frames', () => {
    frame(TENCENT_FRAME_URL, rect(0, 0, 0, 0))
    frame(`${TENCENT_FRAME_URL}?offscreen=1`, rect(window.innerWidth + 10, 10, 946, 532))

    expect(
      findTencentViewportMediaSurface(document, {
        expectedWidth: 946,
        expectedHeight: 532
      })
    ).toBeNull()
  })

  it('returns null when Tencent remote media has no matching playback surface yet', () => {
    frame('https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/other.html', rect(52, 84, 946, 532))

    expect(
      findTencentViewportMediaSurface(document, {
        expectedWidth: 946,
        expectedHeight: 532
      })
    ).toBeNull()
  })
})
