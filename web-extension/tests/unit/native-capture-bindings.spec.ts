import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPTURE_MAX_BYTES, CAPTURE_MAX_DIMENSION } from '../../src/domain/capture'

const nativeMedia = vi.hoisted(() => ({
  isVideo: vi.fn(() => true),
  readVideoWidth: vi.fn(() => 2),
  readVideoHeight: vi.fn(() => 2)
}))

let encodedBlob: Blob | null = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
let drawImageImplementation: () => void = () => undefined

class FakeCanvasRenderingContext2D {
  drawImage(): void {
    drawImageImplementation()
  }
}

vi.mock('../../src/adapters/generic/native-media-bindings', () => ({
  nativeMediaBindings: nativeMedia
}))

const originalDescriptors = new Map<object, Map<PropertyKey, PropertyDescriptor | undefined>>()

function definePatched(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor
): void {
  let descriptors = originalDescriptors.get(target)
  if (descriptors === undefined) {
    descriptors = new Map()
    originalDescriptors.set(target, descriptors)
  }
  if (!descriptors.has(property))
    descriptors.set(property, Object.getOwnPropertyDescriptor(target, property))
  Object.defineProperty(target, property, descriptor)
}

function installCanvasFakes(blob: Blob | null = encodedBlob, readyState = 2): void {
  encodedBlob = blob
  drawImageImplementation = () => undefined
  vi.stubGlobal('CanvasRenderingContext2D', FakeCanvasRenderingContext2D)
  definePatched(HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get: () => readyState
  })
  definePatched(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => new FakeCanvasRenderingContext2D()
  })
  definePatched(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    value: (callback: (value: Blob | null) => void) => callback(encodedBlob)
  })
}

async function loadBindings() {
  return (await import('../../src/adapters/generic/native-capture-bindings')).nativeCaptureBindings
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  nativeMedia.isVideo.mockReturnValue(true)
  nativeMedia.readVideoWidth.mockReturnValue(2)
  nativeMedia.readVideoHeight.mockReturnValue(2)
  encodedBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
})

afterEach(() => {
  for (const [target, descriptors] of originalDescriptors) {
    for (const [property, descriptor] of descriptors) {
      if (descriptor === undefined) Reflect.deleteProperty(target, property)
      else Object.defineProperty(target, property, descriptor)
    }
  }
  originalDescriptors.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('native capture bindings', () => {
  it('encodes a decoded frame and reports the encoder actual MIME type', async () => {
    installCanvasFakes()
    const bindings = await loadBindings()

    await expect(
      bindings.captureVideoFrame(document.createElement('video'), {
        mimeType: 'image/jpeg',
        quality: 0.8
      })
    ).resolves.toEqual({
      mimeType: 'image/png',
      width: 2,
      height: 2,
      byteLength: 3,
      dataBase64: 'AQID'
    })
  })

  it('maps a tainted canvas to the bounded blocked error', async () => {
    installCanvasFakes()
    drawImageImplementation = () => {
      throw new DOMException('tainted', 'SecurityError')
    }
    const bindings = await loadBindings()

    await expect(
      bindings.captureVideoFrame(document.createElement('video'), { mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'CAPTURE_BLOCKED' })
  })

  it('rejects undecoded, oversized, empty, and unsupported encoder output', async () => {
    installCanvasFakes(undefined, 1)
    let bindings = await loadBindings()
    await expect(
      bindings.captureVideoFrame(document.createElement('video'), { mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'CAPTURE_NOT_READY' })

    vi.restoreAllMocks()
    vi.resetModules()
    installCanvasFakes()
    nativeMedia.readVideoWidth.mockReturnValue(CAPTURE_MAX_DIMENSION + 1)
    bindings = await loadBindings()
    await expect(
      bindings.captureVideoFrame(document.createElement('video'), { mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'CAPTURE_TOO_LARGE' })

    vi.restoreAllMocks()
    vi.resetModules()
    installCanvasFakes(null)
    nativeMedia.readVideoWidth.mockReturnValue(2)
    bindings = await loadBindings()
    await expect(
      bindings.captureVideoFrame(document.createElement('video'), { mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'CAPTURE_FAILED' })

    vi.restoreAllMocks()
    vi.resetModules()
    installCanvasFakes(new Blob([new Uint8Array([1])], { type: 'application/octet-stream' }))
    bindings = await loadBindings()
    await expect(
      bindings.captureVideoFrame(document.createElement('video'), { mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'CAPTURE_FAILED' })
  })

  it('contains unavailable contexts, non-video input, and oversized encoded blobs', async () => {
    installCanvasFakes()
    definePatched(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => null
    })
    let bindings = await loadBindings()
    await expect(
      bindings.captureVideoFrame(document.createElement('video'), { mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'CAPTURE_FAILED' })

    vi.resetModules()
    definePatched(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => new FakeCanvasRenderingContext2D()
    })
    nativeMedia.isVideo.mockReturnValue(false)
    bindings = await loadBindings()
    await expect(
      bindings.captureVideoFrame(document.createElement('audio'), { mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'CAPTURE_FAILED' })

    vi.resetModules()
    nativeMedia.isVideo.mockReturnValue(true)
    encodedBlob = new Blob([new Uint8Array(CAPTURE_MAX_BYTES + 1)], { type: 'image/png' })
    bindings = await loadBindings()
    await expect(
      bindings.captureVideoFrame(document.createElement('video'), { mimeType: 'image/png' })
    ).rejects.toMatchObject({ code: 'CAPTURE_TOO_LARGE' })
  })
})
