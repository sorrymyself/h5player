import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExperimentalMediaDownloadManager } from '../../src/adapters/generic'
import { MediaDownloadFailure } from '../../src/domain/download'
import { mediaDownloadEventSchema } from '../../src/domain/download'

const originalMediaSource = Object.getOwnPropertyDescriptor(window, 'MediaSource')
const originalSourceBuffer = Object.getOwnPropertyDescriptor(window, 'SourceBuffer')
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const originalAnchorClick = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'click')
const originalFetch = Object.getOwnPropertyDescriptor(window, 'fetch')

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

function installFakes(): void {
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
    value: vi.fn(() => `blob:test-${++sequence}`)
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn()
  })
}

function restoreProperty(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor === undefined) Reflect.deleteProperty(target, key)
  else Object.defineProperty(target, key, descriptor)
}

function connectedVideo(source: string): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'currentSrc', { configurable: true, value: source })
  document.body.append(video)
  return video
}

function setCurrentSource(element: HTMLMediaElement, source: string): void {
  Object.defineProperty(element, 'currentSrc', { configurable: true, value: source })
}

function setDuration(element: HTMLMediaElement, duration: number): void {
  Object.defineProperty(element, 'duration', { configurable: true, value: duration })
}

afterEach(() => {
  vi.useRealTimers()
  restoreProperty(HTMLAnchorElement.prototype, 'click', originalAnchorClick)
  restoreProperty(window, 'MediaSource', originalMediaSource)
  restoreProperty(window, 'SourceBuffer', originalSourceBuffer)
  restoreProperty(URL, 'createObjectURL', originalCreateObjectUrl)
  restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  restoreProperty(window, 'fetch', originalFetch)
  document.body.replaceChildren()
  document.title = ''
  vi.restoreAllMocks()
})

describe('ExperimentalMediaDownloadManager', () => {
  it('keeps native methods untouched until enabled and restores them immediately when disabled', () => {
    installFakes()
    const nativeCreate: unknown = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')?.value
    const nativeAppend: unknown = Object.getOwnPropertyDescriptor(
      FakeSourceBuffer.prototype,
      'appendBuffer'
    )?.value
    const manager = new ExperimentalMediaDownloadManager(window, document)

    expect(manager.install()).toBe(false)
    expect(Object.getOwnPropertyDescriptor(URL, 'createObjectURL')?.value).toBe(nativeCreate)
    expect(Object.getOwnPropertyDescriptor(FakeSourceBuffer.prototype, 'appendBuffer')?.value).toBe(
      nativeAppend
    )

    manager.configure(true)
    expect(manager.isEnabled()).toBe(true)
    expect(Object.getOwnPropertyDescriptor(URL, 'createObjectURL')?.value).not.toBe(nativeCreate)
    expect(
      Object.getOwnPropertyDescriptor(FakeSourceBuffer.prototype, 'appendBuffer')?.value
    ).not.toBe(nativeAppend)

    manager.configure(false)
    expect(manager.isEnabled()).toBe(false)
    expect(Object.getOwnPropertyDescriptor(URL, 'createObjectURL')?.value).toBe(nativeCreate)
    expect(Object.getOwnPropertyDescriptor(FakeSourceBuffer.prototype, 'appendBuffer')?.value).toBe(
      nativeAppend
    )
  })

  it('prepares a same-origin artifact without clicking an anchor in MAIN world', async () => {
    installFakes()
    const manager = new ExperimentalMediaDownloadManager(window, document)
    manager.configure(true)
    const video = connectedVideo(`${window.location.origin}/video.mp4`)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await expect(manager.prepareDownload(video, 'download-intent-0000001')).resolves.toMatchObject({
      disposition: 'started',
      artifacts: [{ kind: 'same-origin', url: `${window.location.origin}/video.mp4` }]
    })
    expect(click).not.toHaveBeenCalled()
    manager.teardown()
  })

  it('keeps cross-origin preparation fetch-free until isolated content consumes the artifact', async () => {
    installFakes()
    const manager = new ExperimentalMediaDownloadManager(window, document)
    manager.configure(true)
    const video = connectedVideo('https://cdn.example/video.mp4')
    setDuration(video, 60)
    const fetchMedia = vi.fn()
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMedia
    })

    await expect(manager.prepareDownload(video, 'download-intent-0000002')).resolves.toMatchObject({
      disposition: 'started',
      artifacts: [{ kind: 'cross-origin', url: 'https://cdn.example/video.mp4' }]
    })
    expect(fetchMedia).not.toHaveBeenCalled()
    manager.teardown()
  })

  it('rejects long cross-origin direct media without preparing an artifact', async () => {
    installFakes()
    const manager = new ExperimentalMediaDownloadManager(window, document)
    manager.configure(true)
    const video = connectedVideo('https://cdn.example/video.mp4')
    setDuration(video, 600)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    expect(manager.canDownload(video)).toBe(false)
    await expect(manager.prepareDownload(video, 'download-intent-0000004')).rejects.toMatchObject({
      code: 'DOWNLOAD_UNAVAILABLE'
    })
    expect(click).not.toHaveBeenCalled()

    manager.teardown()
  })

  it('emits a one-shot ready event for a queued preparation', async () => {
    installFakes()
    const manager = new ExperimentalMediaDownloadManager(window, document, {
      maxBufferBytes: 4,
      maxPageBytes: 8,
      maxChunks: 4
    })
    manager.configure(true)
    const mediaSource = new FakeMediaSource() as unknown as MediaSource
    const objectUrl = URL.createObjectURL(mediaSource)
    const video = connectedVideo(objectUrl)
    mediaSource.addSourceBuffer('video/mp4').appendBuffer(new Uint8Array([1, 2]))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const events: unknown[] = []
    manager.subscribe((event) => events.push(event))

    await expect(manager.prepareDownload(video, 'download-intent-0000003')).resolves.toMatchObject({
      disposition: 'queued'
    })
    mediaSource.endOfStream()
    expect(events).toHaveLength(1)
    const event = mediaDownloadEventSchema.parse(events[0])
    expect(event.type).toBe('ready')
    if (event.type === 'ready') {
      expect(event.preparation.intentId).toBe('download-intent-0000003')
    }
    expect(click).not.toHaveBeenCalled()
    manager.teardown()
  })

  it('cancels a queued preparation and emits a typed cancellation event', async () => {
    installFakes()
    const manager = new ExperimentalMediaDownloadManager(window, document)
    manager.configure(true)
    const mediaSource = new FakeMediaSource() as unknown as MediaSource
    const objectUrl = URL.createObjectURL(mediaSource)
    const video = connectedVideo(objectUrl)
    mediaSource.addSourceBuffer('video/mp4').appendBuffer(new Uint8Array([1, 2]))
    const events: unknown[] = []
    manager.subscribe((event) => events.push(event))

    await expect(manager.prepareDownload(video, 'download-intent-0000014')).resolves.toMatchObject({
      disposition: 'queued'
    })
    expect(manager.cancelDownload(video)).toBe(true)
    expect(manager.cancelDownload(video)).toBe(false)
    expect(events).toHaveLength(1)
    expect(mediaDownloadEventSchema.parse(events[0])).toMatchObject({
      type: 'failed',
      intentId: 'download-intent-0000014',
      code: 'DOWNLOAD_CANCELLED'
    })

    mediaSource.endOfStream()
    expect(events).toHaveLength(1)
    manager.teardown()
  })

  it('discards pre-enable and previous-generation streams instead of preparing incomplete tails', async () => {
    installFakes()
    const manager = new ExperimentalMediaDownloadManager(window, document)
    const preEnableSource = new FakeMediaSource() as unknown as MediaSource
    const preEnableUrl = URL.createObjectURL(preEnableSource)
    const preEnableBuffer = preEnableSource.addSourceBuffer('video/mp4')
    preEnableBuffer.appendBuffer(new Uint8Array([1, 2]))
    const video = connectedVideo(preEnableUrl)

    manager.configure(true)
    preEnableBuffer.appendBuffer(new Uint8Array([3, 4]))
    expect(manager.canDownload(video)).toBe(false)
    await expect(manager.prepareDownload(video, 'download-intent-0000006')).rejects.toMatchObject({
      code: 'DOWNLOAD_UNAVAILABLE'
    })

    const enabledSource = new FakeMediaSource() as unknown as MediaSource
    const enabledUrl = URL.createObjectURL(enabledSource)
    const enabledBuffer = enabledSource.addSourceBuffer('video/mp4')
    enabledBuffer.appendBuffer(new Uint8Array([1, 2]))
    setCurrentSource(video, enabledUrl)
    expect(manager.canDownload(video)).toBe(true)

    manager.configure(false)
    manager.configure(true)
    enabledBuffer.appendBuffer(new Uint8Array([3, 4]))
    expect(manager.canDownload(video)).toBe(false)
    await expect(manager.prepareDownload(video, 'download-intent-0000007')).rejects.toMatchObject({
      code: 'DOWNLOAD_UNAVAILABLE'
    })
    manager.teardown()
  })

  it('releases captured records when an object URL is revoked or the media changes source', async () => {
    installFakes()
    const manager = new ExperimentalMediaDownloadManager(window, document)
    manager.configure(true)
    const firstSource = new FakeMediaSource() as unknown as MediaSource
    const firstUrl = URL.createObjectURL(firstSource)
    const firstVideo = connectedVideo(firstUrl)
    firstSource.addSourceBuffer('video/mp4').appendBuffer(new Uint8Array([1]))
    expect(manager.canDownload(firstVideo)).toBe(true)

    URL.revokeObjectURL(firstUrl)
    expect(manager.canDownload(firstVideo)).toBe(false)
    await expect(
      manager.prepareDownload(firstVideo, 'download-intent-0000008')
    ).rejects.toMatchObject({
      code: 'DOWNLOAD_UNAVAILABLE'
    })

    const secondSource = new FakeMediaSource() as unknown as MediaSource
    const secondUrl = URL.createObjectURL(secondSource)
    const secondVideo = connectedVideo(secondUrl)
    secondSource.addSourceBuffer('video/mp4').appendBuffer(new Uint8Array([2]))
    expect(manager.canDownload(secondVideo)).toBe(true)
    setCurrentSource(secondVideo, `${window.location.origin}/replacement.mp4`)
    expect(manager.canDownload(secondVideo)).toBe(true)

    const staleVideo = connectedVideo(secondUrl)
    expect(manager.canDownload(staleVideo)).toBe(false)
    await expect(
      manager.prepareDownload(staleVideo, 'download-intent-0000009')
    ).rejects.toMatchObject({
      code: 'DOWNLOAD_UNAVAILABLE'
    })
    manager.teardown()
  })

  it('does not auto-download a MediaSource that ends with a network or decode error', async () => {
    installFakes()
    const manager = new ExperimentalMediaDownloadManager(window, document)
    manager.configure(true)
    const mediaSource = new FakeMediaSource() as unknown as MediaSource
    const objectUrl = URL.createObjectURL(mediaSource)
    const video = connectedVideo(objectUrl)
    mediaSource.addSourceBuffer('video/mp4').appendBuffer(new Uint8Array([1, 2]))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const events: unknown[] = []
    manager.subscribe((event) => events.push(event))

    await expect(manager.prepareDownload(video, 'download-intent-0000010')).resolves.toMatchObject({
      disposition: 'queued'
    })
    mediaSource.endOfStream('network')
    expect(click).not.toHaveBeenCalled()
    const event = events
      .map((item) => mediaDownloadEventSchema.safeParse(item))
      .find((result) => result.success && result.data.type === 'failed')?.data
    expect(event).toMatchObject({ intentId: 'download-intent-0000010', code: 'DOWNLOAD_FAILED' })
    manager.teardown()
  })

  it('expires a queued live stream and releases its captured bytes', async () => {
    vi.useFakeTimers()
    installFakes()
    const manager = new ExperimentalMediaDownloadManager(window, document, {
      maxBufferBytes: 4,
      maxPageBytes: 4,
      maxChunks: 4,
      pendingTimeoutMs: 10
    })
    manager.configure(true)
    const mediaSource = new FakeMediaSource() as unknown as MediaSource
    const objectUrl = URL.createObjectURL(mediaSource)
    const video = connectedVideo(objectUrl)
    mediaSource.addSourceBuffer('video/mp4').appendBuffer(new Uint8Array([1, 2, 3, 4]))
    const events: unknown[] = []
    manager.subscribe((event) => events.push(event))

    await expect(manager.prepareDownload(video, 'download-intent-0000011')).resolves.toMatchObject({
      disposition: 'queued'
    })
    vi.advanceTimersByTime(11)
    const event = events
      .map((item) => mediaDownloadEventSchema.safeParse(item))
      .find((result) => result.success && result.data.type === 'failed')?.data
    expect(event).toMatchObject({ intentId: 'download-intent-0000011', code: 'DOWNLOAD_FAILED' })

    const replacement = new FakeMediaSource() as unknown as MediaSource
    const replacementUrl = URL.createObjectURL(replacement)
    const replacementVideo = connectedVideo(replacementUrl)
    replacement.addSourceBuffer('video/mp4').appendBuffer(new Uint8Array([5, 6, 7, 8]))
    expect(manager.canDownload(replacementVideo)).toBe(true)
    manager.teardown()
  })

  it('rejects a source that exceeds the bounded capture budget', async () => {
    installFakes()
    const manager = new ExperimentalMediaDownloadManager(window, document, {
      maxBufferBytes: 4,
      maxPageBytes: 8,
      maxChunks: 4
    })
    manager.configure(true)
    const mediaSource = new FakeMediaSource() as unknown as MediaSource
    const objectUrl = URL.createObjectURL(mediaSource)
    const video = connectedVideo(objectUrl)
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp4')
    sourceBuffer.appendBuffer(new Uint8Array(5))
    mediaSource.endOfStream()
    await expect(manager.prepareDownload(video, 'download-intent-0000012')).rejects.toBeInstanceOf(
      MediaDownloadFailure
    )
    await expect(manager.prepareDownload(video, 'download-intent-0000013')).rejects.toMatchObject({
      code: 'DOWNLOAD_TOO_LARGE'
    })
    manager.teardown()
  })
})
