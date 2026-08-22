import { afterEach, describe, expect, it } from 'vitest'
import {
  canCreateAudioGain,
  canUseAudioGain,
  MediaElementAudioGain
} from '../../src/adapters/generic/audio-gain'

class FakeNode {
  readonly connect = () => undefined
  readonly disconnect = () => undefined
}

class FakeGainNode extends FakeNode {
  readonly gain = { value: 1 }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  readonly destination = {}
  readonly state = 'suspended'
  readonly source = new FakeNode()
  readonly gain = new FakeGainNode()
  resumed = false
  closed = false

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createMediaElementSource(): MediaElementAudioSourceNode {
    return this.source as unknown as MediaElementAudioSourceNode
  }

  createGain(): GainNode {
    return this.gain as unknown as GainNode
  }

  resume(): Promise<void> {
    this.resumed = true
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

const originalAudioContextDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext')

afterEach(() => {
  FakeAudioContext.instances.length = 0
  if (originalAudioContextDescriptor === undefined) {
    Reflect.deleteProperty(window, 'AudioContext')
  } else {
    Object.defineProperty(window, 'AudioContext', originalAudioContextDescriptor)
  }
})

describe('MediaElementAudioGain', () => {
  it('is capability-detectable, lazy at controller boundary, clamps to 6×, and disposes', async () => {
    const currentWindow = window
    Object.defineProperty(currentWindow, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext
    })
    expect(canCreateAudioGain(currentWindow)).toBe(true)
    expect(FakeAudioContext.instances).toHaveLength(0)

    const gain = new MediaElementAudioGain(document.createElement('video'), currentWindow)
    expect(FakeAudioContext.instances).toHaveLength(1)
    gain.setGain(8)
    expect(FakeAudioContext.instances[0]?.gain.gain.value).toBe(6)
    await Promise.resolve()
    expect(FakeAudioContext.instances[0]?.resumed).toBe(true)
    gain.dispose()
    expect(FakeAudioContext.instances[0]?.closed).toBe(true)
  })

  it('fails closed for cross-origin media without explicit CORS mode', () => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext
    })
    const video = document.createElement('video')
    video.src = 'https://cdn.example/video.mp4'
    expect(canUseAudioGain(video, window)).toBe(false)

    video.crossOrigin = 'anonymous'
    expect(canUseAudioGain(video, window)).toBe(true)
  })

  it('allows same-origin and source-less media without requiring a CORS attribute', () => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext
    })
    const sourceLess = document.createElement('audio')
    expect(canUseAudioGain(sourceLess, window)).toBe(true)

    const video = document.createElement('video')
    video.src = `${window.location.origin}/media.mp4`
    expect(canUseAudioGain(video, window)).toBe(true)
  })
})
