/* eslint-disable @typescript-eslint/unbound-method -- Lifecycle DOM intrinsics are captured and invoked with explicit receivers. */

import {
  selectActivePlayer,
  type ActivePlayerCandidate,
  type AdapterTeardown,
  type MediaAdapter,
  type MediaController,
  type MediaControllerChange,
  type ObservableMediaController
} from '../../domain/adapter'
import type { MediaCapabilities, MediaId, MediaSnapshot } from '../../domain/media'
import { createMediaId, visualStateEquals, type MediaControllerResolver } from '../../domain/media'
import { scanMediaTree, type MediaDiscoveryRoot } from './media-tree-scan'

export const MEDIA_ELEMENT_ID_ATTRIBUTE = 'data-h5player-webext-media-id' as const
export const MEDIA_PRESENTATION_REFRESH_INTERVAL_MS = 1_000

export interface MediaDiscoveryUpdate {
  readonly revision: number
  readonly current: readonly MediaSnapshot[]
  readonly active: MediaSnapshot | null
  readonly added: readonly MediaSnapshot[]
  readonly updated: readonly MediaSnapshot[]
  readonly removed: readonly MediaId[]
}

export type MediaDiscoveryListener = (update: MediaDiscoveryUpdate) => void

export interface MediaDiscoveryService extends MediaControllerResolver {
  start(): AdapterTeardown
  /**
   * Rescans the full reachable tree. Call this after attachShadow() on an already-connected host,
   * because browsers do not expose shadow-root attachment through MutationObserver.
   */
  refresh(): void
  current(): readonly MediaSnapshot[]
  active(): MediaSnapshot | null
  controllerFor(mediaId: MediaId): MediaController | undefined
  subscribe(listener: MediaDiscoveryListener): AdapterTeardown
  /** Read-only lifecycle counters for local churn diagnostics. */
  diagnostics(): MediaDiscoveryDiagnostics
  teardown(): void
}

export type MediaDiscoveryDiagnostics = Readonly<{
  mediaRecords: number
  mutationObservers: number
  resizeObserver: boolean
  intersectionObserver: boolean
  presentationRefreshTimer: boolean
  pendingControllerChanges: number
  reconcileQueued: boolean
  controllerFlushQueued: boolean
}>

export interface DomMediaDiscoveryOptions {
  readonly root: MediaDiscoveryRoot
  readonly adapter: MediaAdapter<HTMLMediaElement>
  readonly frameId?: number
  readonly now?: () => number
  readonly schedule?: (callback: () => void) => void
  readonly createMediaId?: (frameId: number, sequence: number) => MediaId
  /**
   * Rechecks computed presentation metrics when a frame owns multiple media
   * instances. CSS/Web Animations can change opacity without mutating the DOM.
   * Set to zero only in deterministic tests that explicitly drive refresh().
   */
  readonly presentationRefreshIntervalMs?: number
  /**
   * Binds a discovered native media instance to the page-main control
   * authority. The discovery service owns the returned teardown and releases
   * it before disposing the controller or forgetting the element.
   */
  readonly bindMediaAuthority?: (element: HTMLMediaElement, mediaId: MediaId) => AdapterTeardown
}

interface MediaIdentity {
  readonly id: MediaId
  readonly discoveryOrder: number
}

interface MediaRecord extends MediaIdentity {
  readonly element: HTMLMediaElement
  readonly controller: ObservableMediaController
  readonly unsubscribeController: AdapterTeardown
  readonly releaseMediaAuthority: AdapterTeardown
  snapshot: MediaSnapshot
  lastInteractionAt: number | null
}

const addEventListenerMethod =
  typeof EventTarget === 'undefined' ? null : EventTarget.prototype.addEventListener
const removeEventListenerMethod =
  typeof EventTarget === 'undefined' ? null : EventTarget.prototype.removeEventListener
const containsMethod = typeof Node === 'undefined' ? null : Node.prototype.contains

function addLifecycleListener(
  target: EventTarget,
  type: string,
  listener: EventListener,
  capture: boolean
): void {
  if (addEventListenerMethod !== null) {
    try {
      addEventListenerMethod.call(target, type, listener, capture)
      return
    } catch {
      // Some DOM emulators expose per-realm EventTarget internals; use the target realm fallback.
    }
  }
  target.addEventListener(type, listener, capture)
}

function removeLifecycleListener(
  target: EventTarget,
  type: string,
  listener: EventListener,
  capture: boolean
): void {
  if (removeEventListenerMethod !== null) {
    try {
      removeEventListenerMethod.call(target, type, listener, capture)
      return
    } catch {
      // Keep teardown effective for per-realm EventTarget implementations.
    }
  }
  target.removeEventListener(type, listener, capture)
}

function scheduleMicrotask(callback: () => void): void {
  void Promise.resolve().then(callback)
}

function defaultMediaId(frameId: number, sequence: number): MediaId {
  return `media-${frameId}-${sequence}`
}

function sameCapabilities(left: MediaCapabilities, right: MediaCapabilities): boolean {
  return (
    left.playback === right.playback &&
    left.seek === right.seek &&
    left.playbackRate === right.playbackRate &&
    left.volume === right.volume &&
    left.mute === right.mute &&
    (left.visual ?? false) === (right.visual ?? false) &&
    left.fullscreen === right.fullscreen &&
    (left.fullscreenNative ?? false) === (right.fullscreenNative ?? false) &&
    (left.fullscreenWeb ?? false) === (right.fullscreenWeb ?? false) &&
    left.pictureInPicture === right.pictureInPicture &&
    left.capture === right.capture &&
    left.downloadExperimental === right.downloadExperimental
  )
}

function sameSnapshot(left: MediaSnapshot, right: MediaSnapshot): boolean {
  const visualEqual =
    left.visual === undefined || right.visual === undefined
      ? left.visual === right.visual
      : visualStateEquals(left.visual, right.visual)
  const presentationEqual =
    left.presentation?.fullscreen === right.presentation?.fullscreen &&
    left.presentation?.pictureInPicture === right.presentation?.pictureInPicture
  return (
    left.id === right.id &&
    left.frameId === right.frameId &&
    left.sourceKey === right.sourceKey &&
    left.kind === right.kind &&
    left.state === right.state &&
    left.adapterId === right.adapterId &&
    left.metrics.width === right.metrics.width &&
    left.metrics.height === right.metrics.height &&
    left.metrics.duration === right.metrics.duration &&
    left.metrics.currentTime === right.metrics.currentTime &&
    left.metrics.volume === right.metrics.volume &&
    left.metrics.playbackRate === right.metrics.playbackRate &&
    left.metrics.muted === right.metrics.muted &&
    (left.metrics.opacity ?? 1) === (right.metrics.opacity ?? 1) &&
    left.metrics.visible === right.metrics.visible &&
    sameCapabilities(left.capabilities, right.capabilities) &&
    visualEqual &&
    presentationEqual
  )
}

function rootDocument(root: MediaDiscoveryRoot): Document {
  const document = root.ownerDocument
  return document ?? root
}

function focusedElement(document: Document): Element | null {
  let active = document.activeElement
  while (active !== null) {
    const shadowActive = active.shadowRoot?.activeElement ?? null
    if (shadowActive === null) break
    active = shadowActive
  }
  return active
}

function mediaIsFocused(element: HTMLMediaElement): boolean {
  const active = focusedElement(element.ownerDocument)
  if (active === element) return true
  if (active === null || containsMethod === null) return false
  try {
    return containsMethod.call(element, active)
  } catch {
    return element.contains(active)
  }
}

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values])
}

export class DomMediaDiscoveryService implements MediaDiscoveryService {
  private readonly root: MediaDiscoveryRoot
  private readonly adapter: MediaAdapter<HTMLMediaElement>
  private readonly frameId: number
  private readonly now: () => number
  private readonly schedule: (callback: () => void) => void
  private readonly createMediaId: (frameId: number, sequence: number) => MediaId
  private readonly presentationRefreshIntervalMs: number
  private readonly bindMediaAuthority: NonNullable<DomMediaDiscoveryOptions['bindMediaAuthority']>
  private readonly identityByElement = new WeakMap<HTMLMediaElement, MediaIdentity>()
  private readonly records = new Map<MediaId, MediaRecord>()
  private readonly allocatedIds = new Set<MediaId>()
  private readonly listeners = new Set<MediaDiscoveryListener>()
  private readonly mutationObservers = new Map<MediaDiscoveryRoot, MutationObserver>()
  private readonly pendingControllerChanges = new Map<MediaId, MediaControllerChange>()
  private resizeObserver: ResizeObserver | null = null
  private intersectionObserver: IntersectionObserver | null = null
  private presentationRefreshTimer: number | null = null
  private currentSnapshots: readonly MediaSnapshot[] = Object.freeze([])
  private activeMediaId: MediaId | null = null
  private revision = 0
  private sequence = 0
  private started = false
  private disposed = false
  private reconcileQueued = false
  private controllerFlushQueued = false
  private generation = 0

  constructor(options: DomMediaDiscoveryOptions) {
    this.root = options.root
    this.adapter = options.adapter
    this.frameId =
      options.frameId !== undefined && Number.isInteger(options.frameId) && options.frameId >= 0
        ? options.frameId
        : 0
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? scheduleMicrotask
    this.createMediaId = options.createMediaId ?? defaultMediaId
    this.presentationRefreshIntervalMs =
      options.presentationRefreshIntervalMs === undefined ||
      !Number.isFinite(options.presentationRefreshIntervalMs)
        ? MEDIA_PRESENTATION_REFRESH_INTERVAL_MS
        : Math.max(0, Math.floor(options.presentationRefreshIntervalMs))
    this.bindMediaAuthority = options.bindMediaAuthority ?? (() => () => undefined)
  }

  start(): AdapterTeardown {
    if (this.disposed) throw new Error('Media discovery service is disposed')
    if (!this.started) {
      this.started = true
      this.installMeasurementObservers()
      this.installDocumentObservers()
      this.reconcile(true)
    }
    return () => this.teardown()
  }

  refresh(): void {
    if (!this.started || this.disposed) return
    this.reconcile(false)
  }

  current(): readonly MediaSnapshot[] {
    return this.currentSnapshots
  }

  active(): MediaSnapshot | null {
    if (this.activeMediaId === null) return null
    return this.records.get(this.activeMediaId)?.snapshot ?? null
  }

  controllerFor(mediaId: MediaId): MediaController | undefined {
    return this.records.get(mediaId)?.controller
  }

  resolve(mediaId: MediaId): MediaController | undefined {
    return this.controllerFor(mediaId)
  }

  subscribe(listener: MediaDiscoveryListener): AdapterTeardown {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    this.notifyListener(listener, this.createUpdate([], [], []))
    return () => this.listeners.delete(listener)
  }

  diagnostics(): MediaDiscoveryDiagnostics {
    return Object.freeze({
      mediaRecords: this.records.size,
      mutationObservers: this.mutationObservers.size,
      resizeObserver: this.resizeObserver !== null,
      intersectionObserver: this.intersectionObserver !== null,
      presentationRefreshTimer: this.presentationRefreshTimer !== null,
      pendingControllerChanges: this.pendingControllerChanges.size,
      reconcileQueued: this.reconcileQueued,
      controllerFlushQueued: this.controllerFlushQueued
    })
  }

  teardown(): void {
    if (this.disposed) return
    this.disposed = true
    this.started = false
    this.generation += 1
    this.reconcileQueued = false
    this.controllerFlushQueued = false
    this.pendingControllerChanges.clear()

    for (const observer of this.mutationObservers.values()) observer.disconnect()
    this.mutationObservers.clear()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.intersectionObserver?.disconnect()
    this.intersectionObserver = null
    this.clearPresentationRefreshTimer()
    this.removeDocumentObservers()

    for (const record of this.records.values()) this.disposeRecord(record)
    this.records.clear()
    this.listeners.clear()
    this.currentSnapshots = Object.freeze([])
    this.activeMediaId = null
  }

  private reconcile(force: boolean): void {
    if (!this.started || this.disposed) return
    const scan = scanMediaTree(this.root)
    this.syncMutationObservers(scan.roots)
    const discovered = new Set(scan.media)
    const added: MediaSnapshot[] = []
    const updated: MediaSnapshot[] = []
    const removed: MediaId[] = []

    for (const record of [...this.records.values()]) {
      if (discovered.has(record.element)) continue
      removed.push(record.id)
      this.records.delete(record.id)
      this.disposeRecord(record)
    }

    for (const element of scan.media) {
      if (!this.adapter.supports(element)) continue
      const identity = this.identityFor(element)
      const existing = this.records.get(identity.id)
      if (existing === undefined) {
        const record = this.createRecord(element, identity)
        if (record === null) continue
        this.records.set(record.id, record)
        added.push(record.snapshot)
        this.resizeObserver?.observe(element)
        this.intersectionObserver?.observe(element)
        continue
      }
      if (existing.element !== element) continue
      const snapshot = existing.controller.getSnapshot()
      if (!sameSnapshot(existing.snapshot, snapshot)) {
        existing.snapshot = snapshot
        updated.push(snapshot)
      }
    }

    this.syncPresentationRefreshTimer()
    this.commit(added, updated, removed, force)
  }

  private createRecord(element: HTMLMediaElement, identity: MediaIdentity): MediaRecord | null {
    let controller: ObservableMediaController
    try {
      element.setAttribute(MEDIA_ELEMENT_ID_ATTRIBUTE, identity.id)
      controller = this.adapter.createController(element, {
        mediaId: identity.id,
        frameId: this.frameId,
        now: this.now,
        schedule: this.schedule
      })
    } catch {
      return null
    }

    const releaseMediaAuthority = (() => {
      try {
        return this.bindMediaAuthority(element, identity.id)
      } catch {
        return () => undefined
      }
    })()

    let snapshot: MediaSnapshot
    try {
      snapshot = controller.getSnapshot()
    } catch {
      releaseMediaAuthority()
      controller.teardown()
      return null
    }

    const record = {
      ...identity,
      element,
      controller,
      snapshot,
      lastInteractionAt: null,
      releaseMediaAuthority,
      unsubscribeController: () => undefined
    } satisfies MediaRecord
    const unsubscribeController = controller.subscribe((change) => {
      this.handleControllerChange(identity.id, controller, change)
    })
    return { ...record, unsubscribeController }
  }

  private disposeRecord(record: MediaRecord): void {
    this.resizeObserver?.unobserve(record.element)
    this.intersectionObserver?.unobserve(record.element)
    record.unsubscribeController()
    record.releaseMediaAuthority()
    record.controller.teardown()
    if (record.element.getAttribute(MEDIA_ELEMENT_ID_ATTRIBUTE) === record.id) {
      record.element.removeAttribute(MEDIA_ELEMENT_ID_ATTRIBUTE)
    }
    this.pendingControllerChanges.delete(record.id)
  }

  private identityFor(element: HTMLMediaElement): MediaIdentity {
    const existing = this.identityByElement.get(element)
    if (existing !== undefined) return existing
    this.sequence += 1
    const id = this.allocateMediaId(this.sequence)
    const identity: MediaIdentity = {
      id,
      discoveryOrder: this.sequence
    }
    this.identityByElement.set(element, identity)
    this.allocatedIds.add(id)
    return identity
  }

  private allocateMediaId(sequence: number): MediaId {
    let requested: unknown
    try {
      requested = this.createMediaId(this.frameId, sequence)
    } catch {
      requested = null
    }
    const parsed = createMediaId(requested)
    if (parsed.ok && !this.allocatedIds.has(parsed.value)) return parsed.value

    let suffix = 0
    while (true) {
      const candidate = defaultMediaId(this.frameId, sequence) + (suffix === 0 ? '' : `-${suffix}`)
      const fallback = createMediaId(candidate)
      if (fallback.ok && !this.allocatedIds.has(fallback.value)) return fallback.value
      suffix += 1
    }
  }

  private handleControllerChange(
    mediaId: MediaId,
    controller: ObservableMediaController,
    change: MediaControllerChange
  ): void {
    if (!this.started || this.disposed) return
    const record = this.records.get(mediaId)
    if (record?.controller !== controller) return
    if (change.reason === 'interaction') record.lastInteractionAt = change.observedAt
    this.pendingControllerChanges.set(mediaId, change)
    this.queueControllerFlush()
  }

  private queueControllerFlush(): void {
    if (this.controllerFlushQueued || this.disposed) return
    this.controllerFlushQueued = true
    const generation = this.generation
    this.schedule(() => {
      if (this.disposed || generation !== this.generation) return
      this.controllerFlushQueued = false
      const updated: MediaSnapshot[] = []
      for (const [mediaId, change] of this.pendingControllerChanges) {
        const record = this.records.get(mediaId)
        if (record === undefined) continue
        if (!sameSnapshot(record.snapshot, change.snapshot)) {
          record.snapshot = change.snapshot
          updated.push(change.snapshot)
        }
      }
      this.pendingControllerChanges.clear()
      this.commit([], updated, [], false)
    })
  }

  private queueReconcile(): void {
    if (this.reconcileQueued || this.disposed) return
    this.reconcileQueued = true
    const generation = this.generation
    this.schedule(() => {
      if (this.disposed || generation !== this.generation) return
      this.reconcileQueued = false
      this.reconcile(false)
    })
  }

  private queueSnapshotRefresh(targets?: readonly Element[]): void {
    if (!this.started || this.disposed) return
    const records =
      targets === undefined
        ? [...this.records.values()]
        : targets
            .map((target) => {
              if (!this.adapter.supports(target)) return undefined
              const identity = this.identityByElement.get(target)
              return identity === undefined ? undefined : this.records.get(identity.id)
            })
            .filter((record): record is MediaRecord => record !== undefined)
    for (const record of new Set(records)) {
      this.pendingControllerChanges.set(record.id, {
        snapshot: record.controller.getSnapshot(),
        reason: 'state',
        observedAt: this.now()
      })
    }
    this.queueControllerFlush()
  }

  private commit(
    added: readonly MediaSnapshot[],
    updated: readonly MediaSnapshot[],
    removed: readonly MediaId[],
    force: boolean
  ): void {
    const previousActiveId = this.activeMediaId
    const candidates: ActivePlayerCandidate[] = [...this.records.values()].map((record) => ({
      snapshot: record.snapshot,
      focused: mediaIsFocused(record.element),
      lastInteractionAt: record.lastInteractionAt,
      discoveryOrder: record.discoveryOrder
    }))
    this.activeMediaId =
      selectActivePlayer(candidates, {
        now: this.now(),
        currentMediaId: previousActiveId
      })?.snapshot.id ?? null
    this.currentSnapshots = freezeArray(
      [...this.records.values()]
        .sort((left, right) => left.discoveryOrder - right.discoveryOrder)
        .map((record) => record.snapshot)
    )

    const activeChanged = previousActiveId !== this.activeMediaId
    if (
      !force &&
      added.length === 0 &&
      updated.length === 0 &&
      removed.length === 0 &&
      !activeChanged
    ) {
      return
    }
    this.revision += 1
    const update = this.createUpdate(added, updated, removed)
    for (const listener of [...this.listeners]) this.notifyListener(listener, update)
  }

  private createUpdate(
    added: readonly MediaSnapshot[],
    updated: readonly MediaSnapshot[],
    removed: readonly MediaId[]
  ): MediaDiscoveryUpdate {
    return {
      revision: this.revision,
      current: this.currentSnapshots,
      active: this.active(),
      added: freezeArray(added),
      updated: freezeArray(updated),
      removed: freezeArray(removed)
    }
  }

  private notifyListener(listener: MediaDiscoveryListener, update: MediaDiscoveryUpdate): void {
    try {
      listener(update)
    } catch {
      // Discovery subscribers are isolated from observer and controller lifecycles.
    }
  }

  private syncMutationObservers(roots: ReadonlySet<MediaDiscoveryRoot>): void {
    for (const [root, observer] of this.mutationObservers) {
      if (roots.has(root)) continue
      observer.disconnect()
      this.mutationObservers.delete(root)
    }

    const view = rootDocument(this.root).defaultView
    const MutationObserverConstructor = view?.MutationObserver ?? globalThis.MutationObserver
    for (const root of roots) {
      if (this.mutationObservers.has(root)) continue
      const observer = new MutationObserverConstructor((records) => {
        if (records.some((record) => record.type === 'childList')) {
          this.queueReconcile()
        } else {
          this.queueSnapshotRefresh()
        }
      })
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'controls', 'height', 'hidden', 'style', 'width']
      })
      this.mutationObservers.set(root, observer)
    }
  }

  private installMeasurementObservers(): void {
    const view = rootDocument(this.root).defaultView
    if (view?.ResizeObserver !== undefined) {
      this.resizeObserver = new view.ResizeObserver((entries) => {
        this.queueSnapshotRefresh(entries.map((entry) => entry.target))
      })
    }
    if (view?.IntersectionObserver !== undefined) {
      this.intersectionObserver = new view.IntersectionObserver((entries) => {
        this.queueSnapshotRefresh(entries.map((entry) => entry.target))
      })
    }
  }

  private syncPresentationRefreshTimer(): void {
    const shouldRefresh =
      this.started &&
      !this.disposed &&
      this.presentationRefreshIntervalMs > 0 &&
      this.records.size > 1
    if (!shouldRefresh) {
      this.clearPresentationRefreshTimer()
      return
    }
    if (this.presentationRefreshTimer !== null) return
    const view = rootDocument(this.root).defaultView
    if (view === null) return
    this.presentationRefreshTimer = view.setInterval(() => {
      if (rootDocument(this.root).visibilityState === 'hidden') return
      this.queueSnapshotRefresh()
    }, this.presentationRefreshIntervalMs)
  }

  private clearPresentationRefreshTimer(): void {
    if (this.presentationRefreshTimer === null) return
    rootDocument(this.root).defaultView?.clearInterval(this.presentationRefreshTimer)
    this.presentationRefreshTimer = null
  }

  private readonly handleDocumentChange: EventListener = () => {
    this.queueSnapshotRefresh()
  }

  private installDocumentObservers(): void {
    const document = rootDocument(this.root)
    addLifecycleListener(document, 'scroll', this.handleDocumentChange, true)
    addLifecycleListener(document, 'visibilitychange', this.handleDocumentChange, true)
    if (document.defaultView !== null) {
      addLifecycleListener(document.defaultView, 'resize', this.handleDocumentChange, true)
    }
  }

  private removeDocumentObservers(): void {
    const document = rootDocument(this.root)
    removeLifecycleListener(document, 'scroll', this.handleDocumentChange, true)
    removeLifecycleListener(document, 'visibilitychange', this.handleDocumentChange, true)
    if (document.defaultView !== null) {
      removeLifecycleListener(document.defaultView, 'resize', this.handleDocumentChange, true)
    }
  }
}

export function createDomMediaDiscoveryService(
  options: DomMediaDiscoveryOptions
): DomMediaDiscoveryService {
  const service = new DomMediaDiscoveryService(options)
  service.start()
  return service
}
