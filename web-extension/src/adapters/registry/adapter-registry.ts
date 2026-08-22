/* eslint-disable @typescript-eslint/unbound-method -- DOM and controller methods are captured and invoked with explicit receivers. */

import { genericAdapter } from '../generic'
import {
  createMediaCapabilities,
  type FullscreenMode,
  type MediaCapabilities,
  type MediaSnapshot,
  type VisualState
} from '../../domain/media'
import type { CaptureArtifact, CaptureOptions } from '../../domain/capture'
import type { MediaDownloadPreparation } from '../../domain/download'
import type {
  AdapterRuntimeDiagnostic,
  AdapterFailureStage,
  AdapterTeardown,
  DiagnosableMediaAdapter,
  MediaAdapter,
  MediaControllerChange,
  MediaControllerContext,
  MediaControllerListener,
  ObservableMediaController,
  SiteAdapterAction,
  SiteAdapterDefinition,
  SiteAdapterDisablePolicy,
  SiteAdapterFeature,
  SiteAdapterPageAction
} from '../../domain/adapter'

export interface SiteAdapterHookContext {
  readonly target: HTMLMediaElement
  readonly document: Document
  readonly querySelector: (selector: string) => Element | null
}

export interface SiteAdapterHooks {
  readonly onAttach?: (context: SiteAdapterHookContext) => void
  readonly onDetach?: (context: SiteAdapterHookContext) => void
  readonly actions?: Partial<
    Readonly<
      Record<SiteAdapterAction, (context: SiteAdapterHookContext) => boolean | Promise<boolean>>
    >
  >
  readonly seekTo?: (context: SiteAdapterHookContext, seconds: number) => boolean | Promise<boolean>
  readonly toggleFullscreen?: (
    context: SiteAdapterHookContext,
    mode: FullscreenMode
  ) => boolean | Promise<boolean>
  readonly setPlaybackRate?: (
    context: SiteAdapterHookContext,
    value: number
  ) => boolean | Promise<boolean>
}

export interface AdapterRegistryOptions {
  readonly definitions: readonly SiteAdapterDefinition[]
  readonly disablePolicy?: SiteAdapterDisablePolicy
  readonly fallback?: MediaAdapter<HTMLMediaElement>
  readonly hooks?: Readonly<Record<string, SiteAdapterHooks>>
  readonly url?: () => string
}

const MAX_FAILURE_COUNT = 1_000_000
const MAX_ADAPTER_DEFINITIONS = 32
const MAX_SELECTED_MEDIA_COUNT = 128
const MAX_SELECTOR_ANCESTOR_DEPTH = 8
const SITE_ADAPTER_FEATURES = new Set<SiteAdapterFeature>([
  'playback',
  'seek',
  'playback-rate',
  'fullscreen-native',
  'fullscreen-web',
  'next',
  'autoplay'
])

interface AdapterHealth {
  failureCount: number
  lastFailureStage: AdapterFailureStage | null
}

const documentQuerySelectorMethod =
  typeof Document === 'undefined' ? null : Document.prototype.querySelector
const elementQuerySelectorMethod =
  typeof Element === 'undefined' ? null : Element.prototype.querySelector
const clickMethod = typeof HTMLElement === 'undefined' ? null : HTMLElement.prototype.click

function validateIdentifier(value: string, field: string): void {
  if (value.trim() !== value || value.length < 1 || value.length > 128) {
    throw new TypeError(`Invalid site adapter ${field}`)
  }
}

function validateDefinitions(definitions: readonly SiteAdapterDefinition[]): void {
  if (definitions.length > MAX_ADAPTER_DEFINITIONS) {
    throw new TypeError('Too many site adapter definitions')
  }
  const ids = new Set<string>()
  for (const definition of definitions) {
    validateIdentifier(definition.id, 'id')
    validateIdentifier(definition.version, 'version')
    validateIdentifier(definition.owner, 'owner')
    if (ids.has(definition.id)) throw new TypeError(`Duplicate site adapter id: ${definition.id}`)
    ids.add(definition.id)
    if (!Number.isSafeInteger(definition.priority)) {
      throw new TypeError(`Invalid priority for site adapter ${definition.id}`)
    }
    if (definition.tier !== 1 && definition.tier !== 2) {
      throw new TypeError(`Invalid tier for site adapter ${definition.id}`)
    }
    if (definition.supportLevel !== 'preview' && definition.supportLevel !== 'best-effort') {
      throw new TypeError(`Invalid support level for site adapter ${definition.id}`)
    }
    if (!/^\d+\.\d+\.\d+$/.test(definition.version)) {
      throw new TypeError(`Invalid version for site adapter ${definition.id}`)
    }
    const verifiedAt = Date.parse(`${definition.lastVerified}T00:00:00.000Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(definition.lastVerified) ||
      !Number.isFinite(verifiedAt) ||
      new Date(verifiedAt).toISOString().slice(0, 10) !== definition.lastVerified
    ) {
      throw new TypeError(`Invalid verification date for site adapter ${definition.id}`)
    }
    if (!/^[a-z0-9][a-z0-9-]{0,126}\.html$/.test(definition.fixture)) {
      throw new TypeError(`Invalid fixture for site adapter ${definition.id}`)
    }
    if (definition.matches.length < 1 || definition.matches.length > 16) {
      throw new TypeError(`Invalid match rules for site adapter ${definition.id}`)
    }
    for (const match of definition.matches) {
      if (
        match.hostname.trim() !== match.hostname ||
        match.hostname.length < 1 ||
        match.hostname.length > 253 ||
        /[\s/:]/.test(match.hostname)
      ) {
        throw new TypeError(`Invalid hostname for site adapter ${definition.id}`)
      }
      if (
        match.path !== undefined &&
        (match.path.length < 1 || match.path.length > 512 || !match.path.startsWith('/'))
      ) {
        throw new TypeError(`Invalid path for site adapter ${definition.id}`)
      }
      if (match.includeSubdomains !== undefined && typeof match.includeSubdomains !== 'boolean') {
        throw new TypeError(`Invalid subdomain policy for site adapter ${definition.id}`)
      }
    }
    if (
      definition.features.length < 1 ||
      definition.features.length > SITE_ADAPTER_FEATURES.size ||
      new Set(definition.features).size !== definition.features.length ||
      definition.features.some((feature) => !SITE_ADAPTER_FEATURES.has(feature))
    ) {
      throw new TypeError(`Invalid features for site adapter ${definition.id}`)
    }
    const selectorGroups: readonly (readonly string[] | undefined)[] = [
      definition.selectors.play,
      definition.selectors.pause,
      definition.selectors.seekForward,
      definition.selectors.seekBackward,
      definition.selectors.playbackRate,
      definition.selectors.fullscreenNative,
      definition.selectors.fullscreenWeb,
      definition.selectors.next,
      definition.selectors.autoplay
    ]
    for (const selectors of selectorGroups) {
      if (selectors === undefined || selectors.length > 8) {
        if (selectors !== undefined) {
          throw new TypeError(`Too many selectors for site adapter ${definition.id}`)
        }
        continue
      }
      for (const selector of selectors) {
        if (selector.trim() !== selector || selector.length < 1 || selector.length > 256) {
          throw new TypeError(`Invalid selector for site adapter ${definition.id}`)
        }
      }
    }
  }
}

function validateDisablePolicy(
  definitions: readonly SiteAdapterDefinition[],
  policy: SiteAdapterDisablePolicy
): void {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]))
  for (const [id, versions] of Object.entries(policy.adapterVersions ?? {})) {
    const definition = byId.get(id)
    if (definition === undefined || versions.some((version) => version !== definition.version)) {
      throw new TypeError(`Invalid version rollback policy for site adapter ${id}`)
    }
  }
  for (const [id, features] of Object.entries(policy.features ?? {})) {
    const definition = byId.get(id)
    if (
      definition === undefined ||
      features.some((feature) => !definition.features.includes(feature))
    ) {
      throw new TypeError(`Invalid feature rollback policy for site adapter ${id}`)
    }
  }
}

function matchesHostname(hostname: string, expected: string, includeSubdomains: boolean): boolean {
  const normalized = expected.toLowerCase()
  return hostname === normalized || (includeSubdomains && hostname.endsWith(`.${normalized}`))
}

function matchesDefinition(definition: SiteAdapterDefinition, url: URL): boolean {
  const hostname = url.hostname.toLowerCase()
  return definition.matches.some((match) => {
    if (!matchesHostname(hostname, match.hostname, match.includeSubdomains ?? false)) return false
    return match.path === undefined || url.pathname.startsWith(match.path)
  })
}

function freezeDiagnostic(value: AdapterRuntimeDiagnostic): AdapterRuntimeDiagnostic {
  return Object.freeze({ ...value, disabledFeatures: Object.freeze([...value.disabledFeatures]) })
}

function freezeDefinition(definition: SiteAdapterDefinition): SiteAdapterDefinition {
  const selectors: SiteAdapterDefinition['selectors'] = Object.freeze({
    ...(definition.selectors.play === undefined
      ? {}
      : { play: Object.freeze([...definition.selectors.play]) }),
    ...(definition.selectors.pause === undefined
      ? {}
      : { pause: Object.freeze([...definition.selectors.pause]) }),
    ...(definition.selectors.seekForward === undefined
      ? {}
      : { seekForward: Object.freeze([...definition.selectors.seekForward]) }),
    ...(definition.selectors.seekBackward === undefined
      ? {}
      : { seekBackward: Object.freeze([...definition.selectors.seekBackward]) }),
    ...(definition.selectors.playbackRate === undefined
      ? {}
      : { playbackRate: Object.freeze([...definition.selectors.playbackRate]) }),
    ...(definition.selectors.fullscreenNative === undefined
      ? {}
      : { fullscreenNative: Object.freeze([...definition.selectors.fullscreenNative]) }),
    ...(definition.selectors.fullscreenWeb === undefined
      ? {}
      : { fullscreenWeb: Object.freeze([...definition.selectors.fullscreenWeb]) }),
    ...(definition.selectors.next === undefined
      ? {}
      : { next: Object.freeze([...definition.selectors.next]) }),
    ...(definition.selectors.autoplay === undefined
      ? {}
      : { autoplay: Object.freeze([...definition.selectors.autoplay]) })
  })

  return Object.freeze({
    ...definition,
    matches: Object.freeze(definition.matches.map((match) => Object.freeze({ ...match }))),
    features: Object.freeze([...definition.features]),
    selectors
  })
}

function freezeDisablePolicy(policy: SiteAdapterDisablePolicy): SiteAdapterDisablePolicy {
  const adapterVersions =
    policy.adapterVersions === undefined
      ? undefined
      : Object.freeze(
          Object.fromEntries(
            Object.entries(policy.adapterVersions).map(([id, versions]) => [
              id,
              Object.freeze([...versions])
            ])
          )
        )
  const features =
    policy.features === undefined
      ? undefined
      : Object.freeze(
          Object.fromEntries(
            Object.entries(policy.features).map(([id, entries]) => [
              id,
              Object.freeze([...entries])
            ])
          )
        )
  return Object.freeze({
    ...(adapterVersions === undefined ? {} : { adapterVersions }),
    ...(features === undefined ? {} : { features })
  })
}

function freezeHooks(
  definitions: readonly SiteAdapterDefinition[],
  hooks: Readonly<Record<string, SiteAdapterHooks>>
): Readonly<Record<string, SiteAdapterHooks>> {
  const knownIds = new Set(definitions.map((definition) => definition.id))
  return Object.freeze(
    Object.fromEntries(
      Object.entries(hooks).map(([id, entry]) => {
        if (!knownIds.has(id)) throw new TypeError(`Unknown site adapter hooks: ${id}`)
        const { actions, ...rest } = entry
        return [
          id,
          Object.freeze({
            ...rest,
            ...(actions === undefined ? {} : { actions: Object.freeze({ ...actions }) })
          })
        ]
      })
    )
  )
}

export class MediaAdapterRegistry implements DiagnosableMediaAdapter<HTMLMediaElement> {
  readonly id = 'site-registry'
  readonly priority = 1_000

  private readonly definitions: readonly SiteAdapterDefinition[]
  private readonly fallback: MediaAdapter<HTMLMediaElement>
  private readonly disablePolicy: SiteAdapterDisablePolicy
  private readonly hooks: Readonly<Record<string, SiteAdapterHooks>>
  private readonly url: () => string
  private readonly selectedCounts = new Map<string, number>()
  private readonly health = new Map<string, AdapterHealth>()

  constructor(options: AdapterRegistryOptions) {
    validateDefinitions(options.definitions)
    this.definitions = Object.freeze(
      options.definitions
        .map(freezeDefinition)
        .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    )
    this.fallback = options.fallback ?? genericAdapter
    validateDisablePolicy(this.definitions, options.disablePolicy ?? {})
    this.disablePolicy = freezeDisablePolicy(options.disablePolicy ?? {})
    this.hooks = freezeHooks(this.definitions, options.hooks ?? {})
    this.url = options.url ?? (() => globalThis.location?.href ?? 'about:blank')
  }

  supports(target: unknown): target is HTMLMediaElement {
    try {
      return this.fallback.supports(target)
    } catch {
      return false
    }
  }

  createController(
    target: HTMLMediaElement,
    context: MediaControllerContext
  ): ObservableMediaController {
    const fallback = this.fallback.createController(target, context)
    return new SiteMediaController(this, fallback, target)
  }

  getDiagnostics(): readonly AdapterRuntimeDiagnostic[] {
    const url = this.currentUrl()
    if (url === null) return Object.freeze([])
    return Object.freeze(
      this.definitions
        .filter((definition) => matchesDefinition(definition, url))
        .map((definition) => {
          const disabled = this.isVersionDisabled(definition)
          const failureCount = this.health.get(definition.id)?.failureCount ?? 0
          const selectedCount = this.selectedCounts.get(definition.id) ?? 0
          const selectedMediaCount = Math.min(MAX_SELECTED_MEDIA_COUNT, selectedCount)
          const selected = selectedCount > 0
          return freezeDiagnostic({
            id: definition.id,
            version: definition.version,
            tier: definition.tier,
            supportLevel: definition.supportLevel,
            status: disabled
              ? 'disabled'
              : failureCount > 0
                ? 'degraded'
                : selected
                  ? 'selected'
                  : 'available',
            selected,
            selectedMediaCount,
            failureCount,
            lastFailureStage: this.health.get(definition.id)?.lastFailureStage ?? null,
            disabledFeatures: this.disabledFeatures(definition)
          })
        })
    )
  }

  executePageAction(
    action: SiteAdapterPageAction,
    document: Document
  ): Readonly<{ declared: boolean; handled: boolean; adapterId: string | null }> {
    const definition = this.select()
    const feature: SiteAdapterFeature = action
    const selectors = definition?.selectors[action]
    const declared =
      definition !== null &&
      this.featureEnabled(definition, feature) &&
      selectors !== undefined &&
      selectors.length > 0
    if (
      !declared ||
      definition === null ||
      selectors === undefined ||
      documentQuerySelectorMethod === null ||
      clickMethod === null
    ) {
      return { declared, handled: false, adapterId: definition?.id ?? null }
    }

    for (const selector of selectors) {
      let element: Element | null
      try {
        element = documentQuerySelectorMethod.call(document, selector)
      } catch {
        this.recordFailure(definition.id, 'selector')
        continue
      }
      if (element === null) continue
      try {
        clickMethod.call(element as HTMLElement)
        return { declared: true, handled: true, adapterId: definition.id }
      } catch {
        this.recordFailure(definition.id, 'action')
      }
    }
    return { declared: true, handled: false, adapterId: definition.id }
  }

  select(excluded: ReadonlySet<string> = new Set()): SiteAdapterDefinition | null {
    const url = this.currentUrl()
    if (url === null) return null
    for (const definition of this.definitions) {
      if (
        excluded.has(definition.id) ||
        this.isVersionDisabled(definition) ||
        !matchesDefinition(definition, url)
      ) {
        continue
      }
      return definition
    }
    return null
  }

  hookFor(id: string): SiteAdapterHooks | undefined {
    return this.hooks[id]
  }

  featureEnabled(definition: SiteAdapterDefinition, feature: SiteAdapterFeature): boolean {
    return (
      definition.features.includes(feature) && !this.disabledFeatures(definition).includes(feature)
    )
  }

  activate(id: string): void {
    this.selectedCounts.set(id, (this.selectedCounts.get(id) ?? 0) + 1)
  }

  deactivate(id: string): void {
    const current = this.selectedCounts.get(id) ?? 0
    if (current <= 1) this.selectedCounts.delete(id)
    else this.selectedCounts.set(id, current - 1)
  }

  recordFailure(id: string, stage: AdapterFailureStage): void {
    const health = this.health.get(id) ?? { failureCount: 0, lastFailureStage: null }
    health.failureCount = Math.min(MAX_FAILURE_COUNT, health.failureCount + 1)
    health.lastFailureStage = stage
    this.health.set(id, health)
  }

  private currentUrl(): URL | null {
    try {
      return new URL(this.url())
    } catch {
      return null
    }
  }

  private isVersionDisabled(definition: SiteAdapterDefinition): boolean {
    return (
      this.disablePolicy.adapterVersions?.[definition.id]?.includes(definition.version) ?? false
    )
  }

  private disabledFeatures(definition: SiteAdapterDefinition): readonly SiteAdapterFeature[] {
    const allowed = new Set<SiteAdapterFeature>(definition.features)
    return Object.freeze(
      [...new Set(this.disablePolicy.features?.[definition.id] ?? [])].filter((feature) =>
        allowed.has(feature)
      )
    )
  }
}

class SiteMediaController implements ObservableMediaController {
  readonly mediaId

  private active: SiteAdapterDefinition | null = null
  private readonly attachFailures = new Set<string>()
  private disposed = false

  constructor(
    private readonly registry: MediaAdapterRegistry,
    private readonly fallback: ObservableMediaController,
    private readonly target: HTMLMediaElement
  ) {
    this.mediaId = fallback.mediaId
    this.syncAdapter()
  }

  get capabilities(): MediaCapabilities {
    this.assertActive()
    return this.mapCapabilities(this.fallback.capabilities)
  }

  getSnapshot(): MediaSnapshot {
    this.assertActive()
    this.syncAdapter()
    const snapshot = this.fallback.getSnapshot()
    return Object.freeze({
      ...snapshot,
      capabilities: this.mapCapabilities(snapshot.capabilities),
      adapterId: this.active?.id ?? snapshot.adapterId
    })
  }

  async play(): Promise<void> {
    if (!(await this.invokeAction('play'))) await this.fallback.play()
  }

  async pause(): Promise<void> {
    if (!(await this.invokeAction('pause'))) await this.fallback.pause()
  }

  async seekTo(seconds: number): Promise<void> {
    this.assertActive()
    this.syncAdapter()
    const definition = this.active
    if (definition !== null && this.registry.featureEnabled(definition, 'seek')) {
      const hook = this.registry.hookFor(definition.id)?.seekTo
      if (hook !== undefined) {
        try {
          if (await hook(this.hookContext(), seconds)) return
        } catch (error) {
          this.registry.recordFailure(definition.id, 'action')
          throw error
        }
      }
    }
    await this.fallback.seekTo(seconds)
  }

  async setPlaybackRate(value: number): Promise<void> {
    this.assertActive()
    this.syncAdapter()
    const definition = this.active
    if (definition !== null && this.registry.featureEnabled(definition, 'playback-rate')) {
      const hook = this.registry.hookFor(definition.id)?.setPlaybackRate
      if (hook !== undefined) {
        try {
          if (await hook(this.hookContext(), value)) return
        } catch (error) {
          this.registry.recordFailure(definition.id, 'action')
          throw error
        }
      }
    }
    await this.fallback.setPlaybackRate(value)
  }

  setVolume(value: number): Promise<void> {
    return this.fallback.setVolume(value)
  }

  setGain(value: number): Promise<void> {
    const operation = this.fallback.setGain
    return operation === undefined
      ? Promise.reject(new Error('Audio gain is unavailable'))
      : operation.call(this.fallback, value)
  }

  setMuted(value: boolean): Promise<void> {
    return this.fallback.setMuted(value)
  }

  setVisualState(state: VisualState): Promise<void> {
    const operation = this.fallback.setVisualState
    return operation === undefined
      ? Promise.reject(new Error('Visual state is unavailable'))
      : operation.call(this.fallback, state)
  }

  async toggleFullscreen(mode: FullscreenMode): Promise<void> {
    this.assertActive()
    this.syncAdapter()
    const definition = this.active
    if (definition !== null) {
      const feature: SiteAdapterFeature = mode === 'native' ? 'fullscreen-native' : 'fullscreen-web'
      if (this.registry.featureEnabled(definition, feature)) {
        const context = this.hookContext()
        const hook = this.registry.hookFor(definition.id)?.toggleFullscreen
        if (hook !== undefined) {
          try {
            if (await hook(context, mode)) return
          } catch {
            this.registry.recordFailure(definition.id, 'action')
          }
        }
        const selectors =
          mode === 'native'
            ? definition.selectors.fullscreenNative
            : definition.selectors.fullscreenWeb
        if (this.clickFirst(definition, selectors)) return
      }
    }
    const operation = this.fallback.toggleFullscreen
    if (operation === undefined) throw new Error('Fullscreen is unavailable')
    await operation.call(this.fallback, mode)
  }

  togglePictureInPicture(): Promise<void> {
    const operation = this.fallback.togglePictureInPicture
    return operation === undefined
      ? Promise.reject(new Error('Picture-in-picture is unavailable'))
      : operation.call(this.fallback)
  }

  captureFrame(options: CaptureOptions): Promise<CaptureArtifact> {
    const operation = this.fallback.captureFrame
    return operation === undefined
      ? Promise.reject(new Error('Capture is unavailable'))
      : operation.call(this.fallback, options)
  }

  prepareDownload(intentId: string): Promise<MediaDownloadPreparation> {
    const operation = this.fallback.prepareDownload
    return operation === undefined
      ? Promise.reject(new Error('Experimental media download is unavailable'))
      : operation.call(this.fallback, intentId)
  }

  cancelDownload(): boolean {
    const operation = this.fallback.cancelDownload
    return operation === undefined ? false : operation.call(this.fallback)
  }

  async playNext(): Promise<void> {
    if (!(await this.invokeAction('next'))) throw new Error('Next media is unavailable')
  }

  subscribe(listener: MediaControllerListener): AdapterTeardown {
    this.assertActive()
    return this.fallback.subscribe((change) => {
      let mapped: MediaControllerChange
      try {
        mapped = { ...change, snapshot: this.getSnapshot() }
      } catch {
        mapped = change
      }
      listener(mapped)
    })
  }

  teardown(): void {
    if (this.disposed) return
    this.disposed = true
    this.detachActive()
    this.fallback.teardown()
  }

  private async invokeAction(action: SiteAdapterAction): Promise<boolean> {
    this.assertActive()
    this.syncAdapter()
    const definition = this.active
    const feature: SiteAdapterFeature = action === 'next' ? 'next' : 'playback'
    if (definition === null || !this.registry.featureEnabled(definition, feature)) return false
    const hook = this.registry.hookFor(definition.id)?.actions?.[action]
    if (hook !== undefined) {
      try {
        if (await hook(this.hookContext())) return true
      } catch {
        this.registry.recordFailure(definition.id, 'action')
      }
    }
    const selectors =
      action === 'play'
        ? definition.selectors.play
        : action === 'pause'
          ? definition.selectors.pause
          : definition.selectors.next
    return this.clickFirst(definition, selectors)
  }

  private clickFirst(
    definition: SiteAdapterDefinition,
    selectors: readonly string[] | undefined
  ): boolean {
    if (selectors === undefined || documentQuerySelectorMethod === null || clickMethod === null)
      return false
    for (const selector of selectors) {
      let element: Element | null
      try {
        element = this.querySelector(selector)
      } catch {
        this.registry.recordFailure(definition.id, 'selector')
        continue
      }
      if (element === null) continue
      try {
        clickMethod.call(element as HTMLElement)
        return true
      } catch {
        this.registry.recordFailure(definition.id, 'action')
      }
    }
    return false
  }

  private syncAdapter(): void {
    const next = this.registry.select(this.attachFailures)
    if (next?.id === this.active?.id) return
    this.detachActive()
    let candidate = next
    while (candidate !== null) {
      const onAttach = this.registry.hookFor(candidate.id)?.onAttach
      if (onAttach !== undefined) {
        try {
          onAttach(this.hookContext())
        } catch {
          this.registry.recordFailure(candidate.id, 'attach')
          this.attachFailures.add(candidate.id)
          candidate = this.registry.select(this.attachFailures)
          continue
        }
      }
      this.active = candidate
      this.registry.activate(candidate.id)
      return
    }
  }

  private detachActive(): void {
    if (this.active === null) return
    const current = this.active
    this.active = null
    this.registry.deactivate(current.id)
    try {
      this.registry.hookFor(current.id)?.onDetach?.(this.hookContext())
    } catch {
      this.registry.recordFailure(current.id, 'detach')
    }
  }

  private mapCapabilities(base: MediaCapabilities): MediaCapabilities {
    this.syncAdapter()
    const definition = this.active
    if (definition === null) return base
    const playback = this.registry.featureEnabled(definition, 'playback')
    const seek = this.registry.featureEnabled(definition, 'seek')
    const playbackRate = this.registry.featureEnabled(definition, 'playback-rate')
    const fullscreenNative = this.registry.featureEnabled(definition, 'fullscreen-native')
    const fullscreenWeb = this.registry.featureEnabled(definition, 'fullscreen-web')
    const next = this.registry.featureEnabled(definition, 'next')
    return createMediaCapabilities({
      ...base,
      playback: base.playback || playback,
      seek: base.seek || seek,
      playbackRate: base.playbackRate || playbackRate,
      fullscreenNative: (base.fullscreenNative ?? false) || fullscreenNative,
      fullscreenWeb: (base.fullscreenWeb ?? false) || fullscreenWeb,
      fullscreen: base.fullscreen || fullscreenNative || fullscreenWeb,
      next: (base.next ?? false) || next
    })
  }

  private hookContext(): SiteAdapterHookContext {
    return {
      target: this.target,
      document: this.target.ownerDocument,
      querySelector: (selector) => this.querySelector(selector)
    }
  }

  private querySelector(selector: string): Element | null {
    if (documentQuerySelectorMethod === null) return null
    if (elementQuerySelectorMethod !== null) {
      let root = this.target.parentElement
      let depth = 0
      while (root !== null && depth < MAX_SELECTOR_ANCESTOR_DEPTH) {
        const local = elementQuerySelectorMethod.call(root, selector)
        if (local !== null) return local
        root = root.parentElement
        depth += 1
      }
    }
    return documentQuerySelectorMethod.call(this.target.ownerDocument, selector)
  }

  private assertActive(): void {
    if (this.disposed) throw new Error(`Media controller ${String(this.mediaId)} is disposed`)
  }
}
