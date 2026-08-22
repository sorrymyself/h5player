import type {
  AdapterTeardown,
  MediaControllerChange,
  MediaControllerContext,
  MediaControllerListener,
  ObservableMediaController
} from '../../domain/adapter'
import {
  clampPlaybackRate,
  createMediaCapabilities,
  type MediaCapabilities,
  type MediaId,
  type MediaSnapshot
} from '../../domain/media'
import {
  viewportMediaSiteOriginForFrame,
  viewportMediaSurfaceKindForUrl
} from '../../shared/viewport-media-surface'
import {
  findTencentFakeVideoElement,
  readTencentFakeVideoPlaybackRate,
  requestTencentVideoPlaybackRate,
  type TencentFakeVideoElement
} from './tencent-video-hooks'

const TENCENT_VIEWPORT_MEDIA_ID_SUFFIX = 'tencent-viewport'

export type TencentPlaybackRateAuthorityPort = Readonly<{
  attachCustomPlaybackRate(target: object, mediaId: MediaId): AdapterTeardown
  writeCustomPlaybackRate(target: object, mediaId: MediaId, value: number): boolean
}>

function normalizedTimestamp(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function viewportDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function unsupportedOperation(operation: string): Promise<never> {
  return Promise.reject(new Error(`Tencent viewport media does not support ${operation}`))
}

/**
 * Tencent's WASM player exposes a custom <fake-video> element instead of HTMLMediaElement.
 * Keep a stable viewport controller for the iframe and write through that real custom element.
 */
export class TencentViewportMediaController implements ObservableMediaController {
  readonly mediaId: MediaId
  readonly capabilities: MediaCapabilities = Object.freeze(
    createMediaCapabilities({ playbackRate: true })
  )

  private playbackRate = 1
  private readonly listeners = new Set<MediaControllerListener>()
  private disposed = false

  constructor(
    private readonly currentWindow: Window,
    private readonly currentDocument: Document,
    context: MediaControllerContext,
    private readonly authority: TencentPlaybackRateAuthorityPort | null = null,
    private readonly siteOrigin: string | undefined = undefined
  ) {
    this.mediaId = context.mediaId
    this.frameId = context.frameId
    this.now = context.now
  }

  getSnapshot(): MediaSnapshot {
    this.assertActive()
    const width = viewportDimension(this.currentWindow.innerWidth)
    const height = viewportDimension(this.currentWindow.innerHeight)
    const target = this.bindCurrentFakeVideo()
    const observedRate = readTencentFakeVideoPlaybackRate(this.currentDocument)
    if (observedRate !== null) {
      this.playbackRate = clampPlaybackRate(observedRate)
    }
    const connected = target?.isConnected === true
    const currentTime = Math.max(0, readFiniteFakeVideoProperty(target, 'currentTime', 0))
    const durationValue = readFiniteFakeVideoProperty(target, 'duration', Number.NaN)
    const paused = readBooleanFakeVideoProperty(target, 'paused', false)
    return Object.freeze({
      id: this.mediaId,
      frameId: this.frameId,
      kind: 'video',
      state: !connected ? 'removed' : paused ? 'paused' : 'active',
      metrics: Object.freeze({
        width,
        height,
        duration: Number.isFinite(durationValue) && durationValue >= 0 ? durationValue : null,
        currentTime,
        volume: 1,
        playbackRate: this.playbackRate,
        muted: false,
        visible: connected && width > 0 && height > 0
      }),
      capabilities: this.capabilities,
      adapterId: 'tencent-video',
      updatedAt: normalizedTimestamp(this.now())
    })
  }

  async setPlaybackRate(value: number): Promise<void> {
    this.assertActive()
    const normalized = clampPlaybackRate(value)
    this.bindCurrentFakeVideo()
    const current = readTencentFakeVideoPlaybackRate(this.currentDocument)
    if (current !== null) this.playbackRate = clampPlaybackRate(current)
    if (normalized === this.playbackRate) return
    const accepted = await requestTencentVideoPlaybackRate({
      currentWindow: this.currentWindow,
      currentDocument: this.currentDocument,
      frameUrl: this.currentWindow.location.href,
      referrer: this.currentDocument.referrer,
      siteOrigin: this.siteOrigin,
      value: normalized,
      ...(this.authority === null
        ? {}
        : {
            writePlaybackRate: (target: TencentFakeVideoElement) =>
              this.writeThroughAuthority(target, normalized)
          })
    })
    if (!accepted) throw new Error('Tencent viewport playback-rate control unavailable')
    const confirmed = readTencentFakeVideoPlaybackRate(this.currentDocument)
    if (confirmed === null || Math.abs(confirmed - normalized) >= 0.001) {
      throw new Error('Tencent viewport playback-rate confirmation failed')
    }
    this.playbackRate = clampPlaybackRate(confirmed)
    this.notify('interaction')
  }

  play(): Promise<void> {
    return unsupportedOperation('playback')
  }

  pause(): Promise<void> {
    return unsupportedOperation('pause')
  }

  seekTo(): Promise<void> {
    return unsupportedOperation('seeking')
  }

  setVolume(): Promise<void> {
    return unsupportedOperation('volume')
  }

  setMuted(): Promise<void> {
    return unsupportedOperation('mute')
  }

  subscribe(listener: MediaControllerListener): AdapterTeardown {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  teardown(): void {
    if (this.disposed) return
    this.disposed = true
    this.releaseFakeVideoAuthority()
    this.releaseFakeVideoAuthority = () => undefined
    this.boundFakeVideo = null
    this.listeners.clear()
  }

  private readonly frameId: number
  private readonly now: () => number
  private boundFakeVideo: TencentFakeVideoElement | null = null
  private releaseFakeVideoAuthority: AdapterTeardown = () => undefined

  private assertActive(): void {
    if (this.disposed) throw new Error('Tencent viewport media controller is disposed')
  }

  private notify(reason: MediaControllerChange['reason']): void {
    const snapshot = this.getSnapshot()
    const change: MediaControllerChange = {
      snapshot,
      reason,
      observedAt: snapshot.updatedAt
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(change)
      } catch {
        // A state observer must not break the media command lifecycle.
      }
    }
  }

  private bindCurrentFakeVideo(): TencentFakeVideoElement | null {
    const target = this.findCurrentFakeVideo()
    if (target === null) {
      // Tencent can remove the old facade one task before inserting its
      // replacement. Keep the old binding during that transition so the
      // stable media session's intent remains available for the next target.
      return null
    }
    if (target === this.boundFakeVideo) return target

    const releasePreviousAuthority = this.releaseFakeVideoAuthority
    // Keep the old binding alive until the replacement is attached. The
    // authority uses the stable media id to transfer the recorded intent and
    // synchronously reconcile the new custom element before this method
    // exposes its snapshot.
    this.boundFakeVideo = target
    this.releaseFakeVideoAuthority = () => undefined
    if (target !== null && this.authority !== null) {
      this.releaseFakeVideoAuthority = this.authority.attachCustomPlaybackRate(target, this.mediaId)
    }
    releasePreviousAuthority()
    return target
  }

  private findCurrentFakeVideo(): TencentFakeVideoElement | null {
    return findTencentFakeVideoElement(this.currentDocument)
  }

  private writeThroughAuthority(target: TencentFakeVideoElement, value: number): boolean {
    this.bindCurrentFakeVideo()
    if (this.authority === null) {
      try {
        target.playbackRate = value
        return Math.abs(target.playbackRate - value) < 0.001
      } catch {
        return false
      }
    }
    return this.authority.writeCustomPlaybackRate(target, this.mediaId, value)
  }
}

function readFiniteFakeVideoProperty(
  target: TencentFakeVideoElement | null,
  property: 'currentTime' | 'duration',
  fallback: number
): number {
  if (target === null) return fallback
  try {
    const value: unknown = Reflect.get(target, property)
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

function readBooleanFakeVideoProperty(
  target: TencentFakeVideoElement | null,
  property: 'paused',
  fallback: boolean
): boolean {
  if (target === null) return fallback
  try {
    const value: unknown = Reflect.get(target, property)
    return typeof value === 'boolean' ? value : fallback
  } catch {
    return fallback
  }
}

export function createTencentViewportMediaController(
  currentWindow: Window,
  currentDocument: Document,
  frameId: number,
  now: () => number = Date.now,
  authority: TencentPlaybackRateAuthorityPort | null = null,
  siteOrigin: string | undefined = undefined
): TencentViewportMediaController | null {
  const frameUrl = currentWindow.location.href
  if (
    viewportMediaSurfaceKindForUrl(frameUrl) !== 'tencent-video-fake-element-frame' ||
    viewportMediaSiteOriginForFrame(frameUrl, siteOrigin ?? currentDocument.referrer) === null
  ) {
    return null
  }
  return new TencentViewportMediaController(
    currentWindow,
    currentDocument,
    {
      mediaId: `media-${frameId}-${TENCENT_VIEWPORT_MEDIA_ID_SUFFIX}`,
      frameId,
      now
    },
    authority,
    siteOrigin
  )
}
