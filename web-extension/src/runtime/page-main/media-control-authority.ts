/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-this-alias -- Native DOM intrinsics are intentionally captured, and wrapper callbacks retain an explicit authority receiver. */

import type { MediaCommand } from '../../domain/command'
import { clampPlaybackRate, type MediaSnapshot } from '../../domain/media'

export type MediaAuthorityProperty = 'playbackRate' | 'volume' | 'muted' | 'currentTime'

export type MediaAuthorityPolicy = Readonly<{
  playbackRate: boolean
  volume: boolean
  currentTime: boolean
}>

export type MediaAuthorityDiagnostic = Readonly<{
  mediaId: string
  generation: number
  protectedProperties: readonly MediaAuthorityProperty[]
  blockedWrites: Readonly<Record<MediaAuthorityProperty, number>>
  lastConflict: Readonly<Partial<Record<MediaAuthorityProperty, number | boolean>>>
  hasSeekLease: boolean
}>

export type MediaAuthorityDiagnostics = Readonly<{
  bindings: number
  protectedBindings: number
  blockedWrites: number
  generation: number
}>

type Accessor<TTarget extends object, TValue> = Readonly<{
  get: ((target: TTarget) => TValue) | null
  set: ((target: TTarget, value: TValue) => void) | null
}>

type SeekLease = {
  target: number
  issuedAt: number
  expiresAt: number
  playbackRate: number
  advancing: boolean
}

type BindingState = {
  readonly mediaId: string
  readonly target: object
  readonly generation: number
  readonly accessors: Readonly<Record<MediaAuthorityProperty, Accessor<object, unknown> | null>>
  readonly customRestore: (() => void) | null
  playbackRateIntent: number | null
  volumeIntent: number | null
  mutedIntent: boolean | null
  seekLease: SeekLease | null
  blockedWrites: Record<MediaAuthorityProperty, number>
  lastConflict: Partial<Record<MediaAuthorityProperty, number | boolean>>
  recoveryTeardown: (() => void) | null
  recoveryQueued: boolean
}

type AuthoritySetter = (this: object, value: unknown) => void

const AUTHORITY_WRAPPER = Symbol.for('h5player.web-extension.media-authority-wrapper.v1')
const DEFAULT_SEEK_LEASE_MS = 1_500
const MAX_BLOCKED_WRITES = 1_000_000

const DEFAULT_POLICY: MediaAuthorityPolicy = Object.freeze({
  playbackRate: false,
  volume: false,
  currentTime: false
})

function findDescriptor(
  prototype: object | null,
  property: PropertyKey
): PropertyDescriptor | null {
  let current = prototype
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property)
    if (descriptor !== undefined) return descriptor
    current = Object.getPrototypeOf(current) as object | null
  }
  return null
}

function captureAccessor<TTarget extends object, TValue>(
  prototype: object | null,
  property: PropertyKey
): Accessor<TTarget, TValue> | null {
  const descriptor = findDescriptor(prototype, property)
  if (descriptor === null) return null
  const getter = descriptor.get as ((this: TTarget) => TValue) | undefined
  const setter = descriptor.set as ((this: TTarget, value: TValue) => void) | undefined
  if (getter === undefined && setter === undefined) return null
  return {
    get: getter === undefined ? null : (target) => getter.call(target),
    set: setter === undefined ? null : (target, value) => setter.call(target, value)
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function valuesEqual(property: MediaAuthorityProperty, left: unknown, right: unknown): boolean {
  if (property === 'muted') return left === right
  if (!finiteNumber(left) || !finiteNumber(right)) return false
  const tolerance = property === 'volume' ? 0.005 : property === 'currentTime' ? 0.35 : 0.001
  return Math.abs(left - right) <= tolerance
}

function emptyBlockedWrites(): Record<MediaAuthorityProperty, number> {
  return { playbackRate: 0, volume: 0, muted: 0, currentTime: 0 }
}

function clonePolicy(policy: MediaAuthorityPolicy): MediaAuthorityPolicy {
  return Object.freeze({
    playbackRate: policy.playbackRate === true,
    volume: policy.volume === true,
    currentTime: policy.currentTime === true
  })
}

function propertyProtected(
  policy: MediaAuthorityPolicy,
  property: MediaAuthorityProperty
): boolean {
  if (property === 'playbackRate') return policy.playbackRate
  if (property === 'volume' || property === 'muted') return policy.volume
  return policy.currentTime
}

function commandProperty(command: MediaCommand): MediaAuthorityProperty | null {
  switch (command.type) {
    case 'media.set-rate':
    case 'media.adjust-rate':
      return 'playbackRate'
    case 'media.set-volume':
    case 'media.adjust-volume':
      return 'volume'
    case 'media.set-muted':
    case 'media.toggle-mute':
      return 'muted'
    case 'media.seek':
      return 'currentTime'
    default:
      return null
  }
}

export class MediaControlAuthority {
  private readonly bindings = new WeakMap<object, BindingState>()
  private readonly bindingsById = new Map<string, BindingState>()
  private readonly originalDescriptors = new Map<MediaAuthorityProperty, PropertyDescriptor>()
  private readonly wrappedSetters = new Map<MediaAuthorityProperty, AuthoritySetter>()
  private readonly currentDocument: Document
  private readonly now: () => number
  private readonly seekLeaseMs: number
  private readonly mediaPrototype: object | null
  private readonly addEventListenerMethod:
    ((target: EventTarget, type: string, listener: EventListener, options?: boolean) => void) | null
  private readonly removeEventListenerMethod:
    ((target: EventTarget, type: string, listener: EventListener, options?: boolean) => void) | null
  private readonly queueMicrotaskMethod: ((callback: () => void) => void) | null
  private readonly nativeAccessors: Readonly<
    Record<MediaAuthorityProperty, Accessor<object, unknown> | null>
  >
  private policy: MediaAuthorityPolicy = DEFAULT_POLICY
  private installed = false
  private disposed = false
  private generation = 0

  constructor(
    currentWindow: Window,
    currentDocument: Document,
    now: () => number = Date.now,
    seekLeaseMs = DEFAULT_SEEK_LEASE_MS
  ) {
    this.currentDocument = currentDocument
    this.now = now
    this.seekLeaseMs = Math.max(1, seekLeaseMs)
    const mediaElementConstructor = (
      currentWindow as Window & {
        readonly HTMLMediaElement?: { readonly prototype: object }
      }
    ).HTMLMediaElement
    this.mediaPrototype = mediaElementConstructor?.prototype ?? null
    const eventTargetPrototype = (
      currentWindow as Window & { readonly EventTarget?: { readonly prototype: EventTarget } }
    ).EventTarget?.prototype
    const addEventListener = eventTargetPrototype?.addEventListener
    const removeEventListener = eventTargetPrototype?.removeEventListener
    this.addEventListenerMethod =
      addEventListener === undefined
        ? null
        : (target, type, listener, options) =>
            addEventListener.call(target, type, listener, options)
    this.removeEventListenerMethod =
      removeEventListener === undefined
        ? null
        : (target, type, listener, options) =>
            removeEventListener.call(target, type, listener, options)
    const queueMicrotask = (
      currentWindow as Window & { readonly queueMicrotask?: (callback: () => void) => void }
    ).queueMicrotask
    this.queueMicrotaskMethod =
      typeof queueMicrotask === 'function' ? queueMicrotask.bind(currentWindow) : null
    this.nativeAccessors = Object.freeze({
      playbackRate: captureAccessor(this.mediaPrototype, 'playbackRate'),
      volume: captureAccessor(this.mediaPrototype, 'volume'),
      muted: captureAccessor(this.mediaPrototype, 'muted'),
      currentTime: captureAccessor(this.mediaPrototype, 'currentTime')
    })
  }

  install(): boolean {
    if (this.disposed || this.installed || this.mediaPrototype === null) return this.installed
    const properties: readonly MediaAuthorityProperty[] = [
      'playbackRate',
      'volume',
      'muted',
      'currentTime'
    ]
    let installedCount = 0
    for (const property of properties) {
      const descriptor = Object.getOwnPropertyDescriptor(this.mediaPrototype, property)
      if (
        descriptor === undefined ||
        descriptor.configurable !== true ||
        typeof descriptor.get !== 'function' ||
        typeof descriptor.set !== 'function'
      ) {
        continue
      }
      if ((descriptor.set as unknown as Record<PropertyKey, unknown>)[AUTHORITY_WRAPPER] === true) {
        continue
      }
      const original = descriptor
      const getter = descriptor.get
      const setter = descriptor.set
      const authority = this
      const wrappedSetter = function (this: object, value: unknown): void {
        const state = authority.bindings.get(this)
        if (state === undefined || !authority.shouldBlock(state, property, value)) {
          setter.call(this, value)
          return
        }
        authority.recordBlocked(state, property, value)
      }
      try {
        Object.defineProperty(wrappedSetter, AUTHORITY_WRAPPER, { value: true })
        Object.defineProperty(this.mediaPrototype, property, {
          ...descriptor,
          get: getter,
          set: wrappedSetter
        })
        this.originalDescriptors.set(property, original)
        this.wrappedSetters.set(property, wrappedSetter)
        installedCount += 1
      } catch {
        // A host can make a native descriptor non-configurable; keep that property transparent.
      }
    }
    this.installed = installedCount > 0
    return this.installed
  }

  configure(policy: MediaAuthorityPolicy): void {
    if (this.disposed) return
    this.policy = clonePolicy(policy)
    for (const state of this.bindingsById.values()) {
      this.reconcileState(state)
    }
  }

  attach(element: HTMLMediaElement, mediaId: string): () => void {
    if (element.ownerDocument !== this.currentDocument) return () => undefined
    return this.attachTarget(element, mediaId, this.nativeAccessors, null)
  }

  /**
   * Binds a site-specific custom element whose playbackRate is not an HTMLMediaElement.
   * The instance accessor is restored only when it is still our wrapper.
   */
  attachCustomPlaybackRate(target: object, mediaId: string): () => void {
    if (this.disposed || target === null || typeof target !== 'object') return () => undefined
    const existing = Object.getOwnPropertyDescriptor(target, 'playbackRate')
    const descriptor =
      existing ?? findDescriptor(Object.getPrototypeOf(target) as object | null, 'playbackRate')
    if (descriptor?.get === undefined || descriptor.set === undefined) return () => undefined
    const getter = descriptor.get as (this: object) => unknown
    const setter = descriptor.set as (this: object, value: unknown) => void
    const accessor: Accessor<object, unknown> = {
      get: (value) => getter.call(value),
      set: (value, next) => setter.call(value, next)
    }
    const restore = (): void => {
      const current = Object.getOwnPropertyDescriptor(target, 'playbackRate')
      if (current?.set !== wrappedSetter) return
      try {
        if (existing === undefined) delete (target as Record<string, unknown>)['playbackRate']
        else Object.defineProperty(target, 'playbackRate', existing)
      } catch {
        // Teardown is best effort for hostile custom elements.
      }
    }
    const authority = this
    const wrappedSetter = function (this: object, value: unknown): void {
      const state = authority.bindings.get(this)
      if (state === undefined || !authority.shouldBlock(state, 'playbackRate', value)) {
        setter.call(this, value)
        return
      }
      authority.recordBlocked(state, 'playbackRate', value)
    }
    try {
      Object.defineProperty(wrappedSetter, AUTHORITY_WRAPPER, { value: true })
      Object.defineProperty(target, 'playbackRate', {
        configurable: true,
        enumerable: descriptor.enumerable ?? false,
        get: getter,
        set: wrappedSetter
      })
    } catch {
      return () => undefined
    }
    return this.attachTarget(
      target,
      mediaId,
      Object.freeze({
        playbackRate: accessor,
        volume: null,
        muted: null,
        currentTime: null
      }),
      restore
    )
  }

  writeCustomPlaybackRate(target: object, mediaId: string, value: number): boolean {
    const state = this.bindingsById.get(mediaId)
    if (state === undefined || state.target !== target) return false
    const accessor = state.accessors.playbackRate
    if (accessor?.set === null || accessor === null) return false
    const normalized = clampPlaybackRate(value)
    const previousIntent = state.playbackRateIntent
    // Arm the new extension intent before invoking the page-owned setter. A
    // player can synchronously write its previous rate from inside that setter;
    // the authority must already recognize that write as a conflicting reset.
    state.playbackRateIntent = normalized
    try {
      accessor.set(target, normalized)
      const applied = valuesEqual('playbackRate', accessor.get?.(target), normalized)
      if (!applied) state.playbackRateIntent = previousIntent
      return applied
    } catch {
      state.playbackRateIntent = previousIntent
      return false
    }
  }

  recordCommand(command: MediaCommand, snapshot: MediaSnapshot): void {
    if (this.disposed) return
    const state = this.bindingsById.get(snapshot.id)
    if (state === undefined) return
    const property = commandProperty(command)
    if (property === null) return
    if (property === 'playbackRate') {
      state.playbackRateIntent = snapshot.metrics.playbackRate
      const lease = state.seekLease
      const observedAt = Math.max(0, this.now())
      if (lease !== null && observedAt < lease.expiresAt) {
        state.seekLease = {
          target: snapshot.metrics.currentTime,
          issuedAt: observedAt,
          expiresAt: lease.expiresAt,
          playbackRate: snapshot.metrics.playbackRate,
          advancing: snapshot.state === 'active'
        }
      }
      return
    }
    if (property === 'volume') {
      state.volumeIntent = snapshot.metrics.volume
      state.mutedIntent = snapshot.metrics.muted
      return
    }
    if (property === 'muted') {
      state.volumeIntent = snapshot.metrics.volume
      state.mutedIntent = snapshot.metrics.muted
      return
    }
    if (property === 'currentTime' && this.policy.currentTime) {
      const issuedAt = Math.max(0, this.now())
      state.seekLease = {
        target: snapshot.metrics.currentTime,
        issuedAt,
        expiresAt: issuedAt + this.seekLeaseMs,
        playbackRate: snapshot.metrics.playbackRate,
        advancing: snapshot.state === 'active'
      }
    }
  }

  diagnostics(): readonly MediaAuthorityDiagnostic[] {
    return Object.freeze(
      [...this.bindingsById.values()].map((state) => {
        const protectedProperties = (
          ['playbackRate', 'volume', 'muted', 'currentTime'] as const
        ).filter((property) => propertyProtected(this.policy, property))
        return Object.freeze({
          mediaId: state.mediaId,
          generation: state.generation,
          protectedProperties: Object.freeze([...protectedProperties]),
          blockedWrites: Object.freeze({ ...state.blockedWrites }),
          lastConflict: Object.freeze({ ...state.lastConflict }),
          hasSeekLease: state.seekLease !== null && state.seekLease.expiresAt > this.now()
        })
      })
    )
  }

  diagnosticsSummary(): MediaAuthorityDiagnostics {
    let blockedWrites = 0
    let protectedBindings = 0
    for (const state of this.bindingsById.values()) {
      blockedWrites += Object.values(state.blockedWrites).reduce((total, count) => total + count, 0)
      if (
        state.playbackRateIntent !== null ||
        state.volumeIntent !== null ||
        state.mutedIntent !== null ||
        state.seekLease !== null
      ) {
        protectedBindings += 1
      }
    }
    return Object.freeze({
      bindings: this.bindingsById.size,
      protectedBindings,
      blockedWrites,
      generation: this.generation
    })
  }

  teardown(): void {
    if (this.disposed) return
    this.disposed = true
    for (const state of [...this.bindingsById.values()]) this.detachState(state)
    this.bindingsById.clear()
    if (this.mediaPrototype !== null) {
      for (const [property, setter] of this.wrappedSetters) {
        const current = Object.getOwnPropertyDescriptor(this.mediaPrototype, property)
        if (current?.set !== setter) continue
        const original = this.originalDescriptors.get(property)
        if (original === undefined) continue
        try {
          Object.defineProperty(this.mediaPrototype, property, original)
        } catch {
          // A hostile page may have replaced or frozen the descriptor.
        }
      }
    }
    this.wrappedSetters.clear()
    this.originalDescriptors.clear()
  }

  private attachTarget(
    target: object,
    mediaId: string,
    accessors: Readonly<Record<MediaAuthorityProperty, Accessor<object, unknown> | null>>,
    customRestore: (() => void) | null
  ): () => void {
    if (this.disposed) return () => undefined
    const previousByTarget = this.bindings.get(target)
    const previousById = this.bindingsById.get(mediaId)
    const inheritedIntent =
      previousById === undefined
        ? null
        : {
            playbackRate: previousById.playbackRateIntent,
            volume: previousById.volumeIntent,
            muted: previousById.mutedIntent,
            seekLease: previousById.seekLease
          }
    if (previousByTarget !== undefined) this.detachState(previousByTarget)
    if (previousById !== undefined && previousById !== previousByTarget) {
      this.detachState(previousById)
    }
    const state: BindingState = {
      mediaId,
      target,
      generation: ++this.generation,
      accessors,
      customRestore,
      playbackRateIntent: inheritedIntent?.playbackRate ?? null,
      volumeIntent: inheritedIntent?.volume ?? null,
      mutedIntent: inheritedIntent?.muted ?? null,
      seekLease: inheritedIntent?.seekLease ?? null,
      blockedWrites: emptyBlockedWrites(),
      lastConflict: {},
      recoveryTeardown: null,
      recoveryQueued: false
    }
    this.bindings.set(target, state)
    this.bindingsById.set(mediaId, state)
    this.installRecoveryListeners(state)
    this.reconcileState(state)
    let released = false
    return () => {
      if (released) return
      released = true
      if (this.bindingsById.get(mediaId) === state) this.detachState(state)
    }
  }

  private detachState(state: BindingState): void {
    state.recoveryTeardown?.()
    state.recoveryTeardown = null
    state.recoveryQueued = false
    state.customRestore?.()
    if (this.bindingsById.get(state.mediaId) === state) this.bindingsById.delete(state.mediaId)
    if (this.bindings.get(state.target) === state) this.bindings.delete(state.target)
  }

  private read(state: BindingState, property: MediaAuthorityProperty): unknown {
    const accessor = state.accessors[property]
    if (accessor?.get === null || accessor === null) return undefined
    try {
      return accessor.get(state.target)
    } catch {
      return undefined
    }
  }

  private shouldBlock(
    state: BindingState,
    property: MediaAuthorityProperty,
    value: unknown
  ): boolean {
    if (this.disposed || !propertyProtected(this.policy, property)) return false
    if (property === 'playbackRate') {
      return (
        state.playbackRateIntent !== null && !valuesEqual(property, value, state.playbackRateIntent)
      )
    }
    if (property === 'volume') {
      return state.volumeIntent !== null && !valuesEqual(property, value, state.volumeIntent)
    }
    if (property === 'muted') {
      return state.mutedIntent !== null && !valuesEqual(property, value, state.mutedIntent)
    }
    const lease = state.seekLease
    if (lease === null || !finiteNumber(value)) return false
    if (this.now() >= lease.expiresAt) {
      state.seekLease = null
      return false
    }
    const elapsed = Math.max(0, this.now() - lease.issuedAt) / 1_000
    const expected = lease.target + (lease.advancing ? elapsed * lease.playbackRate : 0)
    return Math.abs(value - expected) > 0.35
  }

  private recordBlocked(
    state: BindingState,
    property: MediaAuthorityProperty,
    value: unknown
  ): void {
    state.blockedWrites[property] = Math.min(
      MAX_BLOCKED_WRITES,
      (state.blockedWrites[property] ?? 0) + 1
    )
    if (finiteNumber(value) || typeof value === 'boolean') state.lastConflict[property] = value
  }

  private installRecoveryListeners(state: BindingState): void {
    if (this.addEventListenerMethod === null || this.removeEventListenerMethod === null) return
    const target = state.target
    if (typeof target !== 'object' || target === null) return
    const eventTarget = target as EventTarget
    const listener: EventListener = () => this.queueRecovery(state)
    const events = [
      'ratechange',
      'volumechange',
      'seeking',
      'seeked',
      'loadedmetadata',
      'durationchange',
      'canplay',
      'playing'
    ] as const
    for (const event of events) {
      try {
        this.addEventListenerMethod(eventTarget, event, listener, true)
      } catch {
        // A custom element can reject DOM event registration; its accessor
        // wrapper still provides the primary protection path.
      }
    }
    state.recoveryTeardown = () => {
      for (const event of events) {
        try {
          this.removeEventListenerMethod?.(eventTarget, event, listener, true)
        } catch {
          // Best-effort teardown for hostile pages.
        }
      }
    }
  }

  private queueRecovery(state: BindingState): void {
    if (state.recoveryQueued || this.disposed) return
    state.recoveryQueued = true
    const run = (): void => {
      state.recoveryQueued = false
      if (this.disposed || this.bindingsById.get(state.mediaId) !== state) return
      this.reconcileState(state)
    }
    if (this.queueMicrotaskMethod !== null) {
      this.queueMicrotaskMethod(run)
      return
    }
    void Promise.resolve().then(run)
  }

  private reconcileState(state: BindingState): void {
    if (this.disposed || this.bindingsById.get(state.mediaId) !== state) return
    this.reconcileProperty(state, 'playbackRate', state.playbackRateIntent)
    this.reconcileProperty(state, 'volume', state.volumeIntent)
    this.reconcileProperty(state, 'muted', state.mutedIntent)

    const lease = state.seekLease
    if (
      lease !== null &&
      propertyProtected(this.policy, 'currentTime') &&
      this.now() < lease.expiresAt
    ) {
      const elapsed = Math.max(0, this.now() - lease.issuedAt) / 1_000
      const expected = lease.target + (lease.advancing ? elapsed * lease.playbackRate : 0)
      const actual = this.read(state, 'currentTime')
      if (finiteNumber(actual) && Math.abs(actual - expected) > 0.35) {
        this.writeCaptured(state, 'currentTime', expected)
      }
    } else if (lease !== null && this.now() >= lease.expiresAt) {
      state.seekLease = null
    }
  }

  private reconcileProperty(
    state: BindingState,
    property: Exclude<MediaAuthorityProperty, 'currentTime'>,
    intent: number | boolean | null
  ): void {
    if (intent === null || !propertyProtected(this.policy, property)) return
    const actual = this.read(state, property)
    if (valuesEqual(property, actual, intent)) return
    this.writeCaptured(state, property, intent)
  }

  private writeCaptured(
    state: BindingState,
    property: MediaAuthorityProperty,
    value: unknown
  ): void {
    const accessor = state.accessors[property]
    if (accessor?.set === null || accessor === null) return
    try {
      accessor.set(state.target, value)
    } catch {
      if (finiteNumber(value) || typeof value === 'boolean') state.lastConflict[property] = value
    }
  }
}

export function defaultMediaAuthorityPolicy(): MediaAuthorityPolicy {
  return DEFAULT_POLICY
}
