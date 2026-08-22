import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTencentViewportMediaController,
  TencentViewportMediaController,
  type TencentPlaybackRateAuthorityPort
} from '../../src/adapters/sites/tencent-viewport-media-controller'
import { MediaControlAuthority } from '../../src/runtime/page-main/media-control-authority'

const TENCENT_PAGE_URL = 'https://v.qq.com/x/cover/example/video.html'
const TENCENT_FRAME_URL =
  'https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/fake-video-element-iframe.html'

function controllerHarness(authority: TencentPlaybackRateAuthorityPort | null = null) {
  const fakeVideo = document.createElement('fake-video') as HTMLElement & { playbackRate: number }
  let playbackRate = 1
  const setPlaybackRate = vi.fn((value: number) => {
    playbackRate = value
  })
  Object.defineProperty(fakeVideo, 'playbackRate', {
    configurable: true,
    get: () => playbackRate,
    set: setPlaybackRate
  })
  document.body.append(fakeVideo)
  const currentWindow = {
    location: { href: TENCENT_FRAME_URL },
    innerWidth: 946,
    innerHeight: 532,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  } as unknown as Window
  const currentDocument = {
    referrer: TENCENT_PAGE_URL,
    querySelector: document.querySelector.bind(document),
    querySelectorAll: document.querySelectorAll.bind(document)
  } as unknown as Document
  const controller = new TencentViewportMediaController(
    currentWindow,
    currentDocument,
    {
      mediaId: 'media-13-tencent-viewport',
      frameId: 13,
      now: () => 100
    },
    authority
  )
  return { controller, currentDocument, currentWindow, fakeVideo, setPlaybackRate }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('Tencent viewport media controller', () => {
  it('keeps a stable visible rate-only media session without a DOM media element', async () => {
    const { controller, fakeVideo, setPlaybackRate } = controllerHarness()
    const updates: number[] = []
    controller.subscribe((change) => updates.push(change.snapshot.metrics.playbackRate))

    expect(controller.getSnapshot()).toMatchObject({
      id: 'media-13-tencent-viewport',
      frameId: 13,
      kind: 'video',
      state: 'active',
      metrics: { width: 946, height: 532, playbackRate: 1, visible: true },
      capabilities: { playbackRate: true, playback: false },
      adapterId: 'tencent-video'
    })

    await expect(controller.setPlaybackRate(1.5)).resolves.toBeUndefined()
    expect(setPlaybackRate).toHaveBeenCalledWith(1.5)
    expect(fakeVideo.playbackRate).toBe(1.5)
    expect(controller.getSnapshot().metrics.playbackRate).toBe(1.5)
    expect(updates).toEqual([1.5])
  })

  it('stops exposing a routable viewport proxy when the fake-video target disappears', () => {
    const { controller, fakeVideo } = controllerHarness()
    expect(controller.getSnapshot().metrics.visible).toBe(true)

    fakeVideo.remove()

    expect(controller.getSnapshot()).toMatchObject({
      state: 'removed',
      metrics: { currentTime: 0, duration: null, visible: false }
    })
  })

  it('keeps a connected paused fake-video routable before playback starts', () => {
    const { controller, fakeVideo } = controllerHarness()
    Object.defineProperties(fakeVideo, {
      paused: { configurable: true, value: true },
      currentTime: { configurable: true, value: 0 },
      duration: { configurable: true, value: 360 }
    })

    expect(controller.getSnapshot()).toMatchObject({
      state: 'paused',
      metrics: { currentTime: 0, duration: 360, visible: true }
    })
  })

  it('creates the virtual controller only for an approved Tencent fake-video frame', () => {
    const { currentDocument, currentWindow } = controllerHarness()
    expect(
      createTencentViewportMediaController(currentWindow, currentDocument, 13, () => 1)
    ).toBeInstanceOf(TencentViewportMediaController)
    expect(
      createTencentViewportMediaController(
        { ...currentWindow, location: { href: 'https://example.com/frame.html' } } as Window,
        currentDocument,
        13,
        () => 1
      )
    ).toBeNull()
    expect(
      createTencentViewportMediaController(
        currentWindow,
        { referrer: 'https://example.com/watch' } as Document,
        13,
        () => 1
      )
    ).toBeNull()
    expect(
      createTencentViewportMediaController(
        currentWindow,
        { ...currentDocument, referrer: '' },
        13,
        () => 1,
        null,
        TENCENT_PAGE_URL
      )
    ).toBeInstanceOf(TencentViewportMediaController)
  })

  it('rebinds authority to the active replacement fake-video instance', async () => {
    const releases = [vi.fn(), vi.fn()]
    let attachIndex = 0
    const authority: TencentPlaybackRateAuthorityPort = {
      attachCustomPlaybackRate: vi.fn(() => releases[attachIndex++] ?? (() => undefined)),
      writeCustomPlaybackRate: vi.fn<TencentPlaybackRateAuthorityPort['writeCustomPlaybackRate']>(
        (target, _mediaId, value) => {
          const mediaTarget = target as HTMLElement & { playbackRate: number }
          mediaTarget.playbackRate = value
          return true
        }
      )
    }
    const { controller, fakeVideo } = controllerHarness(authority)
    controller.getSnapshot()

    const replacement = document.createElement('fake-video') as HTMLElement & {
      playbackRate: number
    }
    let replacementRate = 1
    Object.defineProperties(replacement, {
      playbackRate: {
        configurable: true,
        get: () => replacementRate,
        set: (value: number) => {
          replacementRate = value
        }
      },
      paused: { configurable: true, value: false },
      currentTime: { configurable: true, value: 12 },
      readyState: { configurable: true, value: 4 },
      duration: { configurable: true, value: 120 }
    })
    document.body.append(replacement)

    expect(controller.getSnapshot()).toMatchObject({
      state: 'active',
      metrics: { playbackRate: 1, currentTime: 12, duration: 120, visible: true }
    })
    expect(releases[0]).toHaveBeenCalledOnce()
    await controller.setPlaybackRate(1.75)

    expect(authority.writeCustomPlaybackRate).toHaveBeenCalledWith(
      replacement,
      'media-13-tencent-viewport',
      1.75
    )
    expect(fakeVideo.playbackRate).toBe(1)
    expect(replacement.playbackRate).toBe(1.75)
    controller.teardown()
    expect(releases[1]).toHaveBeenCalledOnce()
  })

  it('inherits recorded playback rate when getSnapshot rebinds a replacement fake-video', async () => {
    const authority = new MediaControlAuthority(window, document, () => 100)
    expect(authority.install()).toBe(true)
    authority.configure({ playbackRate: true, volume: false, currentTime: false })
    const writePlaybackRate = vi.spyOn(authority, 'writeCustomPlaybackRate')
    const { controller, fakeVideo } = controllerHarness(authority)
    const setPlaybackRate = vi.spyOn(controller, 'setPlaybackRate')

    try {
      await controller.setPlaybackRate(1.75)
      authority.recordCommand(
        {
          type: 'media.set-rate',
          mediaId: 'media-13-tencent-viewport',
          value: 1.75
        },
        controller.getSnapshot()
      )

      const replacement = document.createElement('fake-video') as HTMLElement & {
        playbackRate: number
      }
      let replacementRate = 1
      Object.defineProperty(replacement, 'playbackRate', {
        configurable: true,
        get: () => replacementRate,
        set: (value: number) => {
          replacementRate = value
        }
      })
      fakeVideo.replaceWith(replacement)

      expect(controller.getSnapshot().metrics.playbackRate).toBe(1.75)
      expect(setPlaybackRate).toHaveBeenCalledOnce()
      expect(writePlaybackRate).toHaveBeenCalledOnce()
      expect(replacement.playbackRate).toBe(1.75)

      fakeVideo.playbackRate = 1
      expect(fakeVideo.playbackRate).toBe(1)

      replacement.playbackRate = 1
      replacement.playbackRate = 1
      expect(replacement.playbackRate).toBe(1.75)
      expect(authority.diagnostics()[0]).toMatchObject({
        mediaId: 'media-13-tencent-viewport',
        blockedWrites: { playbackRate: 2 }
      })
    } finally {
      controller.teardown()
      authority.teardown()
    }
  })

  it('preserves recorded rate across a removed-target snapshot before replacement appears', async () => {
    const authority = new MediaControlAuthority(window, document, () => 100)
    expect(authority.install()).toBe(true)
    authority.configure({ playbackRate: true, volume: false, currentTime: false })
    const writePlaybackRate = vi.spyOn(authority, 'writeCustomPlaybackRate')
    const { controller, fakeVideo } = controllerHarness(authority)

    try {
      await controller.setPlaybackRate(1.5)
      authority.recordCommand(
        {
          type: 'media.set-rate',
          mediaId: 'media-13-tencent-viewport',
          value: 1.5
        },
        controller.getSnapshot()
      )

      fakeVideo.remove()
      expect(controller.getSnapshot()).toMatchObject({
        state: 'removed',
        metrics: { playbackRate: 1.5, visible: false }
      })

      const replacement = document.createElement('fake-video') as HTMLElement & {
        playbackRate: number
      }
      let replacementRate = 1
      Object.defineProperty(replacement, 'playbackRate', {
        configurable: true,
        get: () => replacementRate,
        set: (value: number) => {
          replacementRate = value
        }
      })
      document.body.append(replacement)

      expect(controller.getSnapshot()).toMatchObject({
        state: 'active',
        metrics: { playbackRate: 1.5, visible: true }
      })
      expect(replacement.playbackRate).toBe(1.5)
      expect(writePlaybackRate).toHaveBeenCalledOnce()
    } finally {
      controller.teardown()
      authority.teardown()
    }
  })

  it('rejects adapter success when the actual custom-element value did not change', async () => {
    const authority: TencentPlaybackRateAuthorityPort = {
      attachCustomPlaybackRate: () => () => undefined,
      writeCustomPlaybackRate: () => true
    }
    const { controller } = controllerHarness(authority)

    await expect(controller.setPlaybackRate(1.5)).rejects.toThrow(
      'Tencent viewport playback-rate confirmation failed'
    )
  })
})
