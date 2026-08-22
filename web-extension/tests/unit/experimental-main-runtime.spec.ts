import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getExperimentalMainRuntime,
  installExperimentalMainRuntime
} from '../../src/runtime/page-main/experimental-main-runtime'

const originalMediaSource = Object.getOwnPropertyDescriptor(window, 'MediaSource')
const originalSourceBuffer = Object.getOwnPropertyDescriptor(window, 'SourceBuffer')
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

class FakeSourceBuffer {
  appendBuffer(data: BufferSource): void {
    void data
  }
}

class FakeMediaSource {
  addSourceBuffer(mimeType: string): SourceBuffer {
    void mimeType
    return new FakeSourceBuffer() as unknown as SourceBuffer
  }

  endOfStream(error?: EndOfStreamError): void {
    void error
  }
}

function restore(target: object, key: string | symbol, descriptor: PropertyDescriptor | undefined) {
  if (descriptor === undefined) Reflect.deleteProperty(target, key)
  else Object.defineProperty(target, key, descriptor)
}

afterEach(() => {
  const runtime = getExperimentalMainRuntime(window)
  runtime?.disable()
  restore(window, 'MediaSource', originalMediaSource)
  restore(window, 'SourceBuffer', originalSourceBuffer)
  restore(URL, 'createObjectURL', originalCreateObjectUrl)
  restore(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  vi.restoreAllMocks()
})

describe('experimental MAIN runtime boundary', () => {
  it('keeps the experimental port out of page-visible Window properties', () => {
    let sequence = 0
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      writable: true,
      value: FakeMediaSource
    })
    Object.defineProperty(window, 'SourceBuffer', {
      configurable: true,
      writable: true,
      value: FakeSourceBuffer
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => `blob:runtime-${++sequence}`)
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn()
    })

    const port = installExperimentalMainRuntime(window, document)
    expect(port.isEnabled()).toBe(true)
    expect(
      Reflect.ownKeys(window).some(
        (key) => typeof key === 'symbol' && String(key).includes('experimental-main-runtime')
      )
    ).toBe(false)
    expect(getExperimentalMainRuntime(window)).toBe(port)

    port.disable()
    expect(port.isEnabled()).toBe(false)
    expect(getExperimentalMainRuntime(window)?.isEnabled()).toBe(false)

    // A fresh extension-owned module call creates a new enabled generation.
    const replacement = installExperimentalMainRuntime(window, document)
    expect(replacement.isEnabled()).toBe(true)
    expect(replacement).not.toBe(port)
  })
})
