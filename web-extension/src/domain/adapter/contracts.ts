import type { MediaController, MediaId, MediaSnapshot } from '../media'

export type { MediaController } from '../media'

export type AdapterTeardown = () => void

export type MediaControllerChangeReason = 'interaction' | 'state'

export interface MediaControllerChange {
  readonly snapshot: MediaSnapshot
  readonly reason: MediaControllerChangeReason
  readonly observedAt: number
}

export type MediaControllerListener = (change: MediaControllerChange) => void

export interface ObservableMediaController extends MediaController {
  subscribe(listener: MediaControllerListener): AdapterTeardown
  teardown(): void
}

export interface MediaControllerContext {
  readonly mediaId: MediaId
  readonly frameId: number
  readonly now: () => number
  readonly schedule?: (callback: () => void) => void
}

export interface MediaAdapter<TTarget = unknown> {
  readonly id: string
  readonly priority: number

  supports(target: unknown): target is TTarget
  createController(target: TTarget, context: MediaControllerContext): ObservableMediaController
}

export type SiteAdapterTier = 1 | 2
export type SiteAdapterSupportLevel = 'preview' | 'best-effort'

export type SiteAdapterFeature =
  | 'playback'
  | 'seek'
  | 'playback-rate'
  | 'fullscreen-native'
  | 'fullscreen-web'
  | 'next'
  | 'autoplay'
export type SiteAdapterAction = 'play' | 'pause' | 'next'
export type SiteAdapterPageAction = 'next' | 'autoplay'

export interface SiteAdapterMatchRule {
  readonly hostname: string
  readonly path?: string
  readonly includeSubdomains?: boolean
}

export interface SiteAdapterSelectorMap {
  readonly play?: readonly string[]
  readonly pause?: readonly string[]
  readonly seekForward?: readonly string[]
  readonly seekBackward?: readonly string[]
  readonly playbackRate?: readonly string[]
  readonly fullscreenNative?: readonly string[]
  readonly fullscreenWeb?: readonly string[]
  readonly next?: readonly string[]
  readonly autoplay?: readonly string[]
}

export interface SiteAdapterDefinition {
  readonly id: string
  readonly version: string
  readonly priority: number
  readonly owner: string
  readonly tier: SiteAdapterTier
  readonly supportLevel: SiteAdapterSupportLevel
  readonly fixture: string
  readonly lastVerified: string
  readonly matches: readonly SiteAdapterMatchRule[]
  readonly features: readonly SiteAdapterFeature[]
  readonly selectors: SiteAdapterSelectorMap
}

export interface SiteAdapterDisablePolicy {
  readonly adapterVersions?: Readonly<Record<string, readonly string[]>>
  readonly features?: Readonly<Record<string, readonly SiteAdapterFeature[]>>
}

export type AdapterRuntimeStatus = 'available' | 'selected' | 'degraded' | 'disabled'
export type AdapterFailureStage = 'attach' | 'detach' | 'selector' | 'action'

export interface AdapterRuntimeDiagnostic {
  readonly id: string
  readonly version: string
  readonly tier: SiteAdapterTier
  readonly supportLevel: SiteAdapterSupportLevel
  readonly status: AdapterRuntimeStatus
  readonly selected: boolean
  readonly selectedMediaCount: number
  readonly failureCount: number
  readonly lastFailureStage: AdapterFailureStage | null
  readonly disabledFeatures: readonly SiteAdapterFeature[]
}

export interface DiagnosableMediaAdapter<TTarget = unknown> extends MediaAdapter<TTarget> {
  getDiagnostics(): readonly AdapterRuntimeDiagnostic[]
}
