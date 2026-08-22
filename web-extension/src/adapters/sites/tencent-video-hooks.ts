import type { SiteAdapterHookContext, SiteAdapterHooks } from '../registry'
import { nativeMediaBindings } from '../generic/native-media-bindings'
import { viewportMediaSiteOriginForFrame } from '../../shared/viewport-media-surface'

const DEFAULT_TENCENT_RATE_BRIDGE_TIMEOUT_MS = 1_000
const TENCENT_RATE_POLL_INTERVAL_MS = 25

export type TencentFakeVideoElement = HTMLElement & {
  playbackRate: number
}

export type TencentVideoPlaybackRateRequestOptions = Readonly<{
  currentWindow: Window
  currentDocument: Document
  target?: HTMLMediaElement
  frameUrl: string
  referrer: string
  siteOrigin?: string | undefined
  value: number
  timeoutMs?: number
  writePlaybackRate?: (element: TencentFakeVideoElement, value: number) => boolean
}>

function ratesEqual(left: number, right: number): boolean {
  return Number.isFinite(left) && Math.abs(left - right) < 0.001
}

function safeProperty(target: object, property: PropertyKey): unknown {
  try {
    return Reflect.get(target, property)
  } catch {
    return undefined
  }
}

function fakeVideoScore(element: TencentFakeVideoElement): number {
  let score = element.isConnected ? 100 : 0
  const playbackRate = safeProperty(element, 'playbackRate')
  const paused = safeProperty(element, 'paused')
  const currentTime = safeProperty(element, 'currentTime')
  const readyState = safeProperty(element, 'readyState')
  const duration = safeProperty(element, 'duration')

  if (typeof playbackRate === 'number' && Number.isFinite(playbackRate)) score += 10
  if (paused === false) score += 40
  if (typeof currentTime === 'number' && Number.isFinite(currentTime) && currentTime > 0)
    score += 20
  if (typeof readyState === 'number' && Number.isFinite(readyState) && readyState >= 2) score += 10
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) score += 5

  try {
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) score += 80
  } catch {
    // Tencent's custom element may intentionally hide its DOM surface.
  }
  return score
}

export function findTencentFakeVideoElement(document: Document): TencentFakeVideoElement | null {
  const queryAll = Reflect.get(document, 'querySelectorAll') as unknown
  const elements: unknown[] =
    typeof queryAll === 'function'
      ? Array.from(Reflect.apply(queryAll, document, ['fake-video']) as Iterable<unknown>)
      : [document.querySelector('fake-video')]
  let selected: TencentFakeVideoElement | null = null
  let selectedScore = Number.NEGATIVE_INFINITY
  for (const candidate of elements) {
    if (!(candidate instanceof HTMLElement)) continue
    const element = candidate as TencentFakeVideoElement
    const score = fakeVideoScore(element)
    // DOM order is a useful final signal during Tencent segment replacement:
    // the newer custom element is normally appended after the stale facade.
    if (score < selectedScore) continue
    selected = element
    selectedScore = score
  }
  return selected
}

export function readTencentFakeVideoPlaybackRate(document: Document): number | null {
  try {
    const value = findTencentFakeVideoElement(document)?.playbackRate
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function applyFakeVideoPlaybackRate(element: TencentFakeVideoElement, value: number): boolean {
  try {
    element.playbackRate = value
    return ratesEqual(element.playbackRate, value)
  } catch {
    return false
  }
}

function waitForNextRateAttempt(currentWindow: Window): Promise<void> {
  return new Promise((resolve) => {
    currentWindow.setTimeout(resolve, TENCENT_RATE_POLL_INTERVAL_MS)
  })
}

export async function requestTencentVideoPlaybackRate(
  options: TencentVideoPlaybackRateRequestOptions
): Promise<boolean> {
  if (
    viewportMediaSiteOriginForFrame(options.frameUrl, options.siteOrigin ?? options.referrer) ===
    null
  ) {
    return false
  }

  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TENCENT_RATE_BRIDGE_TIMEOUT_MS)
  const deadline = Date.now() + timeoutMs
  do {
    const fakeVideo = findTencentFakeVideoElement(options.currentDocument)
    const applied =
      fakeVideo !== null &&
      (options.writePlaybackRate?.(fakeVideo, options.value) ??
        applyFakeVideoPlaybackRate(fakeVideo, options.value))
    if (applied) {
      if (options.target !== undefined) {
        try {
          nativeMediaBindings.writePlaybackRate(options.target, options.value)
        } catch {
          // The custom element is authoritative; a mirror target may already be detached.
        }
      }
      return true
    }
    if (Date.now() >= deadline) break
    await waitForNextRateAttempt(options.currentWindow)
  } while (Date.now() < deadline)

  throw new Error('Tencent fake-video playback-rate control timed out')
}

export const TENCENT_VIDEO_ADAPTER_HOOKS = Object.freeze({
  setPlaybackRate: async (context: SiteAdapterHookContext, value: number) => {
    const currentWindow = context.document.defaultView
    if (currentWindow === null) return false
    return requestTencentVideoPlaybackRate({
      currentWindow,
      currentDocument: context.document,
      target: context.target,
      frameUrl: context.document.URL,
      referrer: context.document.referrer,
      value
    })
  }
}) satisfies SiteAdapterHooks
