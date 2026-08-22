export const OVERLAY_VIEW_MODEL_VERSION = 1 as const
export const OVERLAY_EVENT_VERSION = 1 as const

export type OverlayLocale = 'zh-CN' | 'en-US'
export type OverlayTheme = 'light' | 'dark'
export type OverlayState = 'loading' | 'empty' | 'ready' | 'error' | 'unsupported'
export type OverlayMediaKind = 'video' | 'audio' | 'custom-video'
export type OverlayPlaybackState = 'playing' | 'paused' | 'buffering' | 'ended'
export type OverlayNoticeTone = 'info' | 'success' | 'warning' | 'danger'

export type OverlayControl =
  | 'playback'
  | 'seek'
  | 'playback-rate'
  | 'volume'
  | 'visual'
  | 'fullscreen'
  | 'picture-in-picture'
  | 'capture'
  | 'download'

export interface OverlayCapabilitiesViewModel {
  readonly playback: boolean
  readonly seek: boolean
  readonly playbackRate: boolean
  readonly volume: boolean
  readonly mute: boolean
  readonly visual: boolean
  readonly fullscreen: boolean
  readonly pictureInPicture: boolean
  readonly capture: boolean
  readonly download: boolean
}

export interface OverlayMediaViewModel {
  readonly id: string
  readonly label: string
  readonly kind: OverlayMediaKind
  readonly playbackState: OverlayPlaybackState
  readonly currentTimeSeconds: number
  readonly durationSeconds: number | null
  readonly playbackRate: number
  readonly volume: number
  readonly muted: boolean
  readonly zoom: number
  readonly fullscreen: boolean
  readonly pictureInPicture: boolean
}

export interface OverlayNoticeViewModel {
  readonly tone: OverlayNoticeTone
  readonly message: string
}

/**
 * Presentation-only state. Every field is JSON-serializable so the eventual
 * content/application adapter can cross execution-context boundaries without
 * leaking browser handles, DOM nodes, callbacks, Sets, or class instances.
 */
export interface OverlayViewModel {
  readonly version: typeof OVERLAY_VIEW_MODEL_VERSION
  readonly open: boolean
  readonly locale: OverlayLocale
  readonly theme: OverlayTheme
  readonly state: OverlayState
  readonly media: OverlayMediaViewModel | null
  readonly capabilities: OverlayCapabilitiesViewModel
  readonly busyControls: readonly OverlayControl[]
  readonly statusDetail: string | null
  readonly notice: OverlayNoticeViewModel | null
}

export type OverlayIntentSource = 'control' | 'shortcut'

export type OverlayIntent =
  | Readonly<{ type: 'overlay.close'; source: 'control' }>
  | Readonly<{ type: 'overlay.dismiss'; source: 'shortcut' }>
  | Readonly<{ type: 'overlay.retry'; source: 'control' }>
  | Readonly<{ type: 'media.play'; mediaId: string; source: OverlayIntentSource }>
  | Readonly<{ type: 'media.pause'; mediaId: string; source: OverlayIntentSource }>
  | Readonly<{
      type: 'media.seek'
      mediaId: string
      deltaSeconds: number
      source: OverlayIntentSource
    }>
  | Readonly<{
      type: 'media.seek-to'
      mediaId: string
      valueSeconds: number
      source: 'control'
    }>
  | Readonly<{
      type: 'media.set-rate'
      mediaId: string
      value: number
      source: 'control'
    }>
  | Readonly<{
      type: 'media.set-volume'
      mediaId: string
      value: number
      source: 'control'
    }>
  | Readonly<{ type: 'media.toggle-mute'; mediaId: string; source: OverlayIntentSource }>
  | Readonly<{
      type: 'visual.adjust-zoom'
      mediaId: string
      delta: number
      source: 'control'
    }>
  | Readonly<{ type: 'visual.reset'; mediaId: string; source: 'control' }>
  | Readonly<{
      type: 'display.toggle-fullscreen'
      mediaId: string
      source: OverlayIntentSource
    }>
  | Readonly<{
      type: 'display.toggle-picture-in-picture'
      mediaId: string
      source: OverlayIntentSource
    }>
  | Readonly<{ type: 'capture.request'; mediaId: string; source: 'control' }>
  | Readonly<{ type: 'download.request'; mediaId: string; source: 'control' }>

/** Versioned, serializable event envelope emitted by the Overlay component. */
export interface OverlayEvent {
  readonly version: typeof OVERLAY_EVENT_VERSION
  readonly intent: OverlayIntent
}

export function createOverlayEvent(intent: OverlayIntent): OverlayEvent {
  return { version: OVERLAY_EVENT_VERSION, intent }
}
