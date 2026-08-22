import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findTencentFakeVideoElement,
  readTencentFakeVideoPlaybackRate,
  requestTencentVideoPlaybackRate
} from '../../src/adapters/sites/tencent-video-hooks'

const TENCENT_PAGE_URL = 'https://v.qq.com/x/cover/example/video.html'
const TENCENT_FRAME_URL =
  'https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/fake-video-element-iframe.html'

type FakeVideoElement = HTMLElement & { playbackRate: number }

function fakeVideoElement(initialRate = 1): {
  element: FakeVideoElement
  setRate: ReturnType<typeof vi.fn<(value: number) => void>>
} {
  const element = document.createElement('fake-video') as FakeVideoElement
  let rate = initialRate
  const setRate = vi.fn((value: number) => {
    rate = value
  })
  Object.defineProperty(element, 'playbackRate', {
    configurable: true,
    get: () => rate,
    set: setRate
  })
  document.body.append(element)
  return { element, setRate }
}

function requestOptions(value: number, timeoutMs = 250) {
  return {
    currentWindow: window,
    currentDocument: document,
    frameUrl: TENCENT_FRAME_URL,
    referrer: TENCENT_PAGE_URL,
    value,
    timeoutMs
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Tencent fake-video playback-rate control', () => {
  it('writes the actual Tencent custom element and mirrors a discovered media target', async () => {
    const { element, setRate } = fakeVideoElement()
    const target = document.createElement('video')
    document.body.append(target)

    await expect(requestTencentVideoPlaybackRate({ ...requestOptions(1.5), target })).resolves.toBe(
      true
    )

    expect(findTencentFakeVideoElement(document)).toBe(element)
    expect(readTencentFakeVideoPlaybackRate(document)).toBe(1.5)
    expect(setRate).toHaveBeenCalledWith(1.5)
    expect(target.playbackRate).toBe(1.5)
  })

  it('retries until the Tencent element enters a state that accepts rate changes', async () => {
    vi.useFakeTimers()
    const element = document.createElement('fake-video') as FakeVideoElement
    let rate = 1
    let attempts = 0
    Object.defineProperty(element, 'playbackRate', {
      configurable: true,
      get: () => rate,
      set: (value: number) => {
        attempts += 1
        if (attempts >= 3) rate = value
      }
    })
    document.body.append(element)

    const pending = requestTencentVideoPlaybackRate(requestOptions(1.75, 500))
    await vi.advanceTimersByTimeAsync(75)

    await expect(pending).resolves.toBe(true)
    expect(attempts).toBe(3)
    expect(rate).toBe(1.75)
  })

  it('rejects when no real Tencent custom element accepts the value before timeout', async () => {
    vi.useFakeTimers()
    const pending = requestTencentVideoPlaybackRate(requestOptions(2, 100))
    const expectation = expect(pending).rejects.toThrow(
      'Tencent fake-video playback-rate control timed out'
    )

    await vi.advanceTimersByTimeAsync(125)
    await expectation
  })

  it('declines untrusted frame and referrer combinations without touching the element', async () => {
    const { setRate } = fakeVideoElement()

    await expect(
      requestTencentVideoPlaybackRate({
        ...requestOptions(1.5),
        frameUrl: 'https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/other.html'
      })
    ).resolves.toBe(false)
    await expect(
      requestTencentVideoPlaybackRate({
        ...requestOptions(1.5),
        referrer: 'https://example.com/watch'
      })
    ).resolves.toBe(false)

    expect(setRate).not.toHaveBeenCalled()
  })

  it('uses the background-resolved site origin when a reloaded frame has no referrer', async () => {
    const { element } = fakeVideoElement()

    await expect(
      requestTencentVideoPlaybackRate({
        ...requestOptions(1.5),
        referrer: '',
        siteOrigin: 'https://v.qq.com'
      })
    ).resolves.toBe(true)

    expect(element.playbackRate).toBe(1.5)
  })

  it('contains hostile playbackRate accessors at the page boundary', () => {
    const element = document.createElement('fake-video') as FakeVideoElement
    Object.defineProperty(element, 'playbackRate', {
      configurable: true,
      get: () => {
        throw new Error('blocked')
      }
    })
    document.body.append(element)

    expect(readTencentFakeVideoPlaybackRate(document)).toBeNull()
  })
})
