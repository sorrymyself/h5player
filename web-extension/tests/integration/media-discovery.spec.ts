import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenericAdapter } from '../../src/adapters/generic'
import type {
  MediaAdapter,
  MediaControllerContext,
  MediaControllerListener,
  ObservableMediaController
} from '../../src/domain/adapter'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'
import {
  DomMediaDiscoveryService,
  MEDIA_PRESENTATION_REFRESH_INTERVAL_MS,
  type MediaDiscoveryUpdate
} from '../../src/infrastructure/dom'

const services: DomMediaDiscoveryService[] = []

class PresentationController implements ObservableMediaController {
  readonly capabilities = createMediaCapabilities({ playback: true, playbackRate: true })
  private readonly listeners = new Set<MediaControllerListener>()

  constructor(
    private readonly element: HTMLMediaElement,
    private readonly context: MediaControllerContext,
    private readonly opacityFor: (element: HTMLMediaElement) => number
  ) {}

  get mediaId() {
    return this.context.mediaId
  }

  getSnapshot(): MediaSnapshot {
    return {
      id: this.mediaId,
      frameId: this.context.frameId,
      kind: 'video',
      state: 'paused',
      metrics: {
        width: Number(this.element.getAttribute('width') ?? 0),
        height: Number(this.element.getAttribute('height') ?? 0),
        duration: 120,
        currentTime: 0,
        volume: 1,
        playbackRate: 1,
        muted: false,
        opacity: this.opacityFor(this.element),
        visible: true
      },
      capabilities: this.capabilities,
      adapterId: 'presentation-test',
      updatedAt: this.context.now()
    }
  }

  play(): Promise<void> {
    return Promise.resolve()
  }

  pause(): Promise<void> {
    return Promise.resolve()
  }

  seekTo(): Promise<void> {
    return Promise.resolve()
  }

  setPlaybackRate(): Promise<void> {
    return Promise.resolve()
  }

  setVolume(): Promise<void> {
    return Promise.resolve()
  }

  setMuted(): Promise<void> {
    return Promise.resolve()
  }

  subscribe(listener: MediaControllerListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  teardown(): void {
    this.listeners.clear()
  }
}

class PresentationAdapter implements MediaAdapter<HTMLMediaElement> {
  readonly id = 'presentation-test'
  readonly priority = 0

  constructor(private readonly opacityFor: (element: HTMLMediaElement) => number) {}

  supports(target: unknown): target is HTMLMediaElement {
    return target instanceof HTMLMediaElement
  }

  createController(
    target: HTMLMediaElement,
    context: MediaControllerContext
  ): ObservableMediaController {
    return new PresentationController(target, context, this.opacityFor)
  }
}

function createService(
  bindMediaAuthority?: (element: HTMLMediaElement, mediaId: string) => () => void
): DomMediaDiscoveryService {
  const service = new DomMediaDiscoveryService({
    root: document,
    adapter: new GenericAdapter(),
    now: Date.now,
    ...(bindMediaAuthority === undefined ? {} : { bindMediaAuthority })
  })
  services.push(service)
  return service
}

async function waitForCurrent(service: DomMediaDiscoveryService, count: number): Promise<void> {
  await vi.waitFor(() => expect(service.current()).toHaveLength(count))
}

afterEach(() => {
  for (const service of services.splice(0)) service.teardown()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DOM media discovery lifecycle', () => {
  it('batches dynamic video/audio additions and emits serializable snapshots only', async () => {
    const service = createService()
    const updates: MediaDiscoveryUpdate[] = []
    service.subscribe((update) => updates.push(update))
    service.start()

    const video = document.createElement('video')
    video.setAttribute('width', '640')
    video.setAttribute('height', '360')
    const audio = document.createElement('audio')
    audio.setAttribute('width', '300')
    audio.setAttribute('height', '40')
    document.body.append(video, audio)

    await waitForCurrent(service, 2)
    const addition = updates.findLast((update) => update.added.length > 0)
    expect(addition?.added).toHaveLength(2)
    expect(addition?.current.map((snapshot) => snapshot.kind)).toEqual(['video', 'audio'])
    expect(JSON.stringify(addition?.current)).not.toContain('HTMLMediaElement')
    expect(service.active()?.id).toBe(service.current()[0]?.id)
  })

  it('discovers open shadow roots, removes their media, and reuses stable media ids', async () => {
    const service = createService()
    const updates: MediaDiscoveryUpdate[] = []
    service.subscribe((update) => updates.push(update))
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    document.body.append(host)
    service.start()
    expect(service.current()).toHaveLength(0)

    const video = document.createElement('video')
    video.setAttribute('width', '640')
    video.setAttribute('height', '360')
    shadow.append(video)

    await waitForCurrent(service, 1)
    const originalId = service.current()[0]?.id
    expect(originalId).toBeDefined()
    expect(service.controllerFor(originalId ?? '')).toBeDefined()
    expect(service.resolve(originalId ?? '')).toBe(service.controllerFor(originalId ?? ''))

    host.remove()
    await waitForCurrent(service, 0)
    expect(service.controllerFor(originalId ?? '')).toBeUndefined()
    expect(updates.findLast((update) => update.removed.length > 0)?.removed).toContain(originalId)

    document.body.append(host)
    await waitForCurrent(service, 1)
    expect(service.current()[0]?.id).toBe(originalId)
  })

  it('can explicitly refresh an open shadow root attached after its host', () => {
    const service = createService()
    const host = document.createElement('div')
    document.body.append(host)
    service.start()
    expect(service.current()).toHaveLength(0)

    const shadow = host.attachShadow({ mode: 'open' })
    const video = document.createElement('video')
    video.setAttribute('width', '320')
    video.setAttribute('height', '180')
    shadow.append(video)
    service.refresh()

    expect(service.current()).toHaveLength(1)
  })

  it('switches active media after a recent user interaction', async () => {
    const service = createService()
    service.start()
    const large = document.createElement('video')
    large.setAttribute('width', '1280')
    large.setAttribute('height', '720')
    const small = document.createElement('video')
    small.setAttribute('width', '320')
    small.setAttribute('height', '180')
    document.body.append(large, small)
    await waitForCurrent(service, 2)

    const largeId = service.current()[0]?.id
    const smallId = service.current()[1]?.id
    expect(service.active()?.id).toBe(largeId)

    small.dispatchEvent(new Event('pointerdown'))
    await vi.waitFor(() => expect(service.active()?.id).toBe(smallId))
  })

  it('rechecks silent CSS presentation changes and moves active ownership to foreground media', async () => {
    vi.useFakeTimers()
    const preview = document.createElement('video')
    preview.setAttribute('width', '1280')
    preview.setAttribute('height', '720')
    const foreground = document.createElement('video')
    foreground.setAttribute('width', '960')
    foreground.setAttribute('height', '540')
    document.body.append(preview, foreground)

    let previewOpacity = 1
    const service = new DomMediaDiscoveryService({
      root: document,
      adapter: new PresentationAdapter((element) => (element === preview ? previewOpacity : 1)),
      now: Date.now
    })
    services.push(service)
    service.start()

    const previewId = service.current()[0]?.id
    const foregroundId = service.current()[1]?.id
    expect(service.active()?.id).toBe(previewId)

    // CSS/Web Animations may update computed opacity without any DOM mutation.
    previewOpacity = 0.25
    await vi.advanceTimersByTimeAsync(MEDIA_PRESENTATION_REFRESH_INTERVAL_MS)

    expect(service.current().find((media) => media.id === previewId)?.metrics.opacity).toBe(0.25)
    expect(service.active()?.id).toBe(foregroundId)
    vi.useRealTimers()
  })

  it('tears down observers, controllers, listeners, and queued lifecycle work explicitly', async () => {
    const service = createService()
    const updates: MediaDiscoveryUpdate[] = []
    service.subscribe((update) => updates.push(update))
    service.start()
    const video = document.createElement('video')
    video.setAttribute('width', '640')
    video.setAttribute('height', '360')
    document.body.append(video)
    await waitForCurrent(service, 1)
    const updateCount = updates.length

    service.teardown()
    expect(service.current()).toEqual([])
    expect(service.active()).toBeNull()
    document.body.append(document.createElement('audio'))
    await Promise.resolve()
    await Promise.resolve()

    expect(updates).toHaveLength(updateCount)
    expect(service.current()).toEqual([])
  })

  it('owns the authority binding for each discovered media lifecycle', async () => {
    const release = vi.fn()
    const bind = vi.fn(() => release)
    const service = createService(bind)
    service.start()
    const video = document.createElement('video')
    video.setAttribute('width', '640')
    video.setAttribute('height', '360')
    document.body.append(video)

    await waitForCurrent(service, 1)
    expect(bind).toHaveBeenCalledWith(video, service.current()[0]?.id)

    video.remove()
    await waitForCurrent(service, 0)
    expect(release).toHaveBeenCalledOnce()
  })
})
