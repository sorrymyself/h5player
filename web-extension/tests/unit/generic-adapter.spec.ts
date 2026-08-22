import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenericAdapter } from '../../src/adapters/generic'
import {
  DEFAULT_VISUAL_STATE,
  isMediaSnapshot,
  panVisual,
  setVisualFilter,
  setVisualZoom,
  toggleVisualFlip
} from '../../src/domain/media'

const adapter = new GenericAdapter()

function context(mediaId = 'media-0-1') {
  return {
    mediaId,
    frameId: 0,
    now: () => 1_234
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

class FailingAudioContext {
  readonly destination = {}
  readonly state = 'suspended'

  createMediaElementSource(): MediaElementAudioSourceNode {
    throw new Error('cross-origin media cannot be routed')
  }

  createGain(): GainNode {
    return { gain: { value: 1 } } as unknown as GainNode
  }

  resume(): Promise<void> {
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

describe('GenericAdapter', () => {
  it('supports native video and audio elements and rejects unrelated DOM', () => {
    expect(adapter.supports(document.createElement('video'))).toBe(true)
    expect(adapter.supports(document.createElement('audio'))).toBe(true)
    expect(adapter.supports(document.createElement('div'))).toBe(false)
    expect(adapter.supports({ localName: 'video' })).toBe(false)
  })

  it('returns normalized serializable snapshots and explicit capabilities', async () => {
    const video = document.createElement('video')
    video.src = 'https://media.example/private/video.m3u8?token=secret'
    video.setAttribute('width', '640')
    video.setAttribute('height', '360')
    video.style.opacity = '0.25'
    document.body.append(video)
    const controller = adapter.createController(video, context())

    await controller.seekTo(12)
    await controller.setPlaybackRate(100)
    await controller.setVolume(5)
    await controller.setMuted(true)

    const snapshot = controller.getSnapshot()
    expect(snapshot).toMatchObject({
      id: 'media-0-1',
      frameId: 0,
      kind: 'video',
      state: 'paused',
      adapterId: 'generic',
      updatedAt: 1_234,
      metrics: {
        width: 640,
        height: 360,
        duration: null,
        currentTime: 12,
        volume: 1,
        playbackRate: 16,
        muted: true,
        opacity: 0.25,
        visible: true
      }
    })
    expect(snapshot.sourceKey).toMatch(/^source-[a-f0-9]{8}$/)
    expect(snapshot.capabilities).toMatchObject({
      playback: true,
      seek: true,
      playbackRate: true,
      volume: true,
      mute: true,
      visual: true,
      fullscreenWeb: true,
      capture: false,
      downloadExperimental: false
    })
    expect(snapshot.visual).toEqual(DEFAULT_VISUAL_STATE)
    expect(snapshot.presentation).toEqual({
      fullscreen: 'none',
      pictureInPicture: false
    })
    expect(isMediaSnapshot(snapshot)).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('media.example')
    expect(JSON.stringify(snapshot)).not.toContain('secret')
    expect(() => JSON.stringify(snapshot)).not.toThrow()
    controller.teardown()
  })

  it('omits the optional source key when the media has no current source', () => {
    const video = document.createElement('video')
    document.body.append(video)
    const controller = adapter.createController(video, context())

    const snapshot = controller.getSnapshot()
    expect('sourceKey' in snapshot).toBe(false)
    expect('sourceKey' in JSON.parse(JSON.stringify(snapshot))).toBe(false)

    controller.teardown()
  })

  it('keeps element visibility independent from transient document visibility', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const video = document.createElement('video')
    video.setAttribute('width', '640')
    video.setAttribute('height', '360')
    document.body.append(video)
    const controller = adapter.createController(video, context('media-background-tab'))

    expect(controller.getSnapshot().metrics.visible).toBe(true)

    controller.teardown()
    visibility.mockRestore()
  })

  it('keeps a geometrically visible video eligible when a transparent wrapper owns rendering', () => {
    const wrapper = document.createElement('div')
    wrapper.style.opacity = '0'
    const video = document.createElement('video')
    video.setAttribute('width', '640')
    video.setAttribute('height', '360')
    wrapper.append(video)
    document.body.append(wrapper)
    const controller = adapter.createController(video, context('media-transparent-wrapper'))

    expect(controller.getSnapshot().metrics).toMatchObject({
      width: 640,
      height: 360,
      visible: true
    })

    controller.teardown()
  })

  it('still excludes media hidden by an ancestor display rule', () => {
    const wrapper = document.createElement('div')
    wrapper.style.display = 'none'
    const video = document.createElement('video')
    video.setAttribute('width', '640')
    video.setAttribute('height', '360')
    wrapper.append(video)
    document.body.append(wrapper)
    const controller = adapter.createController(video, context('media-hidden-wrapper'))

    expect(controller.getSnapshot().metrics.visible).toBe(false)

    controller.teardown()
  })

  it('downgrades audio gain atomically when the Web Audio graph cannot be created', async () => {
    const originalAudioContext = Object.getOwnPropertyDescriptor(window, 'AudioContext')
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FailingAudioContext
    })
    try {
      const video = document.createElement('video')
      document.body.append(video)
      const controller = adapter.createController(video, context('media-gain-failure'))

      expect(controller.getSnapshot().capabilities.audioGain).toBe(true)
      if (controller.setGain === undefined) throw new Error('audio gain controller port missing')
      await expect(controller.setGain(2)).rejects.toThrow('cross-origin media cannot be routed')
      expect(controller.getSnapshot().capabilities.audioGain).not.toBe(true)
      expect(controller.getSnapshot().metrics.gain).toBeUndefined()
      controller.teardown()
    } finally {
      if (originalAudioContext === undefined) Reflect.deleteProperty(window, 'AudioContext')
      else Object.defineProperty(window, 'AudioContext', originalAudioContext)
    }
  })

  it('does not advertise audio gain for a cross-origin source without CORS mode', () => {
    const video = document.createElement('video')
    video.src = 'https://cdn.example/video.mp4'
    document.body.append(video)
    const controller = adapter.createController(video, context('media-cross-origin-gain'))

    expect(controller.getSnapshot().capabilities.audioGain).not.toBe(true)
    controller.teardown()
  })

  it('advertises a CORS-enabled cross-origin source and still downgrades on graph failure', async () => {
    const originalAudioContext = Object.getOwnPropertyDescriptor(window, 'AudioContext')
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FailingAudioContext
    })
    try {
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.src = 'https://cdn.example/video.mp4'
      document.body.append(video)
      const controller = adapter.createController(video, context('media-cors-gain'))
      expect(controller.getSnapshot().capabilities.audioGain).toBe(true)
      if (controller.setGain === undefined) throw new Error('audio gain controller port missing')
      await expect(controller.setGain(2)).rejects.toThrow('cross-origin media cannot be routed')
      expect(controller.getSnapshot().capabilities.audioGain).not.toBe(true)
      expect(controller.getSnapshot().metrics.gain).toBeUndefined()
      controller.teardown()
    } finally {
      if (originalAudioContext === undefined) Reflect.deleteProperty(window, 'AudioContext')
      else Object.defineProperty(window, 'AudioContext', originalAudioContext)
    }
  })

  it('applies isolated visual styles and restores transform/filter atomically', async () => {
    const first = document.createElement('video')
    const second = document.createElement('video')
    first.style.cssText = 'position: relative; transform: translateX(5px); filter: contrast(0.8);'
    document.body.append(first, second)
    const baseline = first.style.cssText
    const firstController = adapter.createController(first, context('media-visual-first'))
    const secondController = adapter.createController(second, context('media-visual-second'))
    if (firstController.setVisualState === undefined) {
      throw new Error('generic visual controller port missing')
    }

    const modified = setVisualFilter(
      toggleVisualFlip(panVisual(setVisualZoom(DEFAULT_VISUAL_STATE, 1.5), 20, -10), 'horizontal'),
      'brightness',
      1.2
    )
    await firstController.setVisualState(modified)

    expect(first.style.getPropertyValue('transform')).toContain('translateX(5px)')
    expect(first.style.getPropertyValue('transform')).toContain('scale(1.5) translate(20px, -10px)')
    expect(first.style.getPropertyValue('filter')).toContain('contrast(0.8)')
    expect(first.style.getPropertyValue('filter')).toContain('brightness(1.2)')
    expect(firstController.getSnapshot().visual).toEqual(modified)
    expect(second.style.cssText).toBe('')
    expect(secondController.getSnapshot().visual).toEqual(DEFAULT_VISUAL_STATE)

    await firstController.setVisualState(DEFAULT_VISUAL_STATE)
    expect(first.style.cssText).toBe(baseline)
    expect(firstController.getSnapshot().visual).toEqual(DEFAULT_VISUAL_STATE)

    firstController.teardown()
    secondController.teardown()
  })

  it('toggles web fullscreen without losing pre-existing inline styles', async () => {
    const video = document.createElement('video')
    video.style.cssText = 'position: relative; z-index: 3;'
    document.body.append(video)
    const baseline = video.style.cssText
    const controller = adapter.createController(video, context('media-web-fullscreen'))
    if (controller.toggleFullscreen === undefined) {
      throw new Error('generic fullscreen controller port missing')
    }

    expect(controller.capabilities.fullscreenWeb).toBe(true)
    await controller.toggleFullscreen('web')
    expect(controller.getSnapshot().presentation?.fullscreen).toBe('web')
    expect(video.style.getPropertyValue('position')).toBe('fixed')
    expect(video.style.getPropertyValue('z-index')).toBe('2147483647')

    await controller.toggleFullscreen('web')
    expect(controller.getSnapshot().presentation?.fullscreen).toBe('none')
    expect(video.style.cssText).toBe(baseline)
    controller.teardown()
  })

  it('uses captured native methods and accessors despite hostile own-property overrides', async () => {
    const video = document.createElement('video')
    video.setAttribute('width', '640')
    video.setAttribute('height', '360')
    document.body.append(video)
    const hostilePlay = vi.fn(() => Promise.reject(new Error('hostile play')))
    const hostilePause = vi.fn(() => {
      throw new Error('hostile pause')
    })
    const hostileVolumeSet = vi.fn(() => {
      throw new Error('hostile volume')
    })
    const hostileEventMethod = vi.fn(() => {
      throw new Error('hostile event method')
    })
    Object.defineProperties(video, {
      play: { configurable: true, value: hostilePlay },
      pause: { configurable: true, value: hostilePause },
      addEventListener: { configurable: true, value: hostileEventMethod },
      removeEventListener: { configurable: true, value: hostileEventMethod },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ width: 9_999, height: 9_999 })
      },
      volume: {
        configurable: true,
        get: () => 99,
        set: hostileVolumeSet
      },
      paused: { configurable: true, get: () => true }
    })
    const controller = adapter.createController(video, context())
    const unsubscribe = controller.subscribe(() => undefined)

    await expect(controller.play()).resolves.toBeUndefined()
    expect(controller.getSnapshot().state).toBe('active')
    expect(controller.getSnapshot().metrics.width).toBe(640)
    await expect(controller.setVolume(0.4)).resolves.toBeUndefined()
    expect(controller.getSnapshot().metrics.volume).toBe(0.4)
    await expect(controller.pause()).resolves.toBeUndefined()
    expect(controller.getSnapshot().state).toBe('paused')
    expect(hostilePlay).not.toHaveBeenCalled()
    expect(hostilePause).not.toHaveBeenCalled()
    expect(hostileVolumeSet).not.toHaveBeenCalled()
    expect(hostileEventMethod).not.toHaveBeenCalled()
    unsubscribe()
    controller.teardown()
  })

  it('batches controller notifications and cancels queued work during teardown', () => {
    const video = document.createElement('video')
    document.body.append(video)
    const scheduled: Array<() => void> = []
    const controller = adapter.createController(video, {
      ...context(),
      schedule: (callback) => scheduled.push(callback)
    })
    const changes: Array<{ reason: string }> = []
    controller.subscribe((change) => changes.push(change))

    video.dispatchEvent(new Event('volumechange'))
    video.dispatchEvent(new Event('pointerdown'))
    video.dispatchEvent(new Event('timeupdate'))
    expect(scheduled).toHaveLength(1)
    scheduled[0]?.()
    expect(changes).toEqual([expect.objectContaining({ reason: 'interaction' })])

    video.dispatchEvent(new Event('play'))
    expect(scheduled).toHaveLength(2)
    controller.teardown()
    scheduled[1]?.()
    expect(changes).toHaveLength(1)
  })
})
