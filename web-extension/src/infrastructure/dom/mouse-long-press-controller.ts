import type { MediaId, MediaSnapshot } from '../../domain/media'

export type MouseLongPressTarget = Readonly<{
  mediaId: MediaId
  element: Element
}>

export type MouseLongPressControllerOptions = Readonly<{
  root: Document
  resolveTarget: (event: MouseEvent) => MouseLongPressTarget | null
  getSnapshot: (mediaId: MediaId) => MediaSnapshot | null
  setPlaybackRate: (mediaId: MediaId, value: number) => Promise<boolean>
  setPlaybackState: (mediaId: MediaId, state: 'active' | 'paused') => Promise<boolean>
  delayMs?: number
  bottomExclusionPx?: number
}>

const PLAYBACK_STATE_GUARD_MS = 600
const PLAYBACK_STATE_GUARD_POLL_MS = 50

type ActivePress = {
  target: MouseLongPressTarget
  previousRate: number
  previousState: 'active' | 'paused'
  timer: ReturnType<typeof globalThis.setTimeout> | null
  stateGuardTimer: ReturnType<typeof globalThis.setTimeout> | null
  stateGuardUntil: number
  activated: boolean
  released: boolean
  restoring: boolean
}

const TEMPORARY_RATE = 3
const DEFAULT_DELAY_MS = 600
const DEFAULT_BOTTOM_EXCLUSION_PX = 80

function finiteRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 16
    ? value
    : null
}

/**
 * Implements Legacy's optional left-button long press as a DOM-side gesture.
 * It never owns media discovery or settings; callers update its policy and
 * provide the currently authoritative media snapshot.
 */
export class MouseLongPressController {
  private readonly root: Document
  private readonly resolveTarget: MouseLongPressControllerOptions['resolveTarget']
  private readonly getSnapshot: MouseLongPressControllerOptions['getSnapshot']
  private readonly setPlaybackRate: MouseLongPressControllerOptions['setPlaybackRate']
  private readonly setPlaybackState: MouseLongPressControllerOptions['setPlaybackState']
  private readonly bottomExclusionPx: number
  private delayMs: number
  private enabled = false
  private disposed = false
  private active: ActivePress | null = null
  private suppressClick = false

  constructor(options: MouseLongPressControllerOptions) {
    this.root = options.root
    this.resolveTarget = options.resolveTarget
    this.getSnapshot = options.getSnapshot
    this.setPlaybackRate = options.setPlaybackRate
    this.setPlaybackState = options.setPlaybackState
    this.delayMs = normalizeDelay(options.delayMs ?? DEFAULT_DELAY_MS)
    this.bottomExclusionPx = normalizeBottomExclusion(
      options.bottomExclusionPx ?? DEFAULT_BOTTOM_EXCLUSION_PX
    )
    this.root.addEventListener('mousedown', this.handleMouseDown, true)
    this.root.addEventListener('mouseup', this.handleMouseUp, true)
    this.root.addEventListener('pointerup', this.handleMouseUp, true)
    this.root.addEventListener('click', this.handleClick, true)
    this.root.addEventListener('mouseleave', this.handleMouseLeave, true)
    this.root.defaultView?.addEventListener('blur', this.handleBlur, true)
  }

  update(input: Readonly<{ enabled: boolean; delayMs?: number }>): void {
    if (this.disposed) return
    this.delayMs = normalizeDelay(input.delayMs ?? this.delayMs)
    if (input.enabled) {
      this.enabled = true
      return
    }
    this.enabled = false
    this.cancelPending(true)
  }

  teardown(): void {
    if (this.disposed) return
    this.disposed = true
    this.enabled = false
    this.cancelPending(true)
    this.root.removeEventListener('mousedown', this.handleMouseDown, true)
    this.root.removeEventListener('mouseup', this.handleMouseUp, true)
    this.root.removeEventListener('pointerup', this.handleMouseUp, true)
    this.root.removeEventListener('click', this.handleClick, true)
    this.root.removeEventListener('mouseleave', this.handleMouseLeave, true)
    this.root.defaultView?.removeEventListener('blur', this.handleBlur, true)
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (
      this.disposed ||
      !this.enabled ||
      event.button !== 0 ||
      event.defaultPrevented ||
      this.active !== null
    ) {
      return
    }
    const target = this.resolveTarget(event)
    if (target === null) return
    const rect = safeRect(target.element)
    if (
      rect === null ||
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom ||
      event.clientY > rect.bottom - this.bottomExclusionPx
    ) {
      return
    }
    const snapshot = this.getSnapshot(target.mediaId)
    const previousRate = snapshot?.capabilities.playbackRate
      ? finiteRate(snapshot.metrics.playbackRate)
      : null
    if (
      previousRate === null ||
      snapshot?.kind !== 'video' ||
      (snapshot.state !== 'active' && snapshot.state !== 'paused')
    ) {
      return
    }

    const active: ActivePress = {
      target,
      previousRate,
      previousState: snapshot.state,
      timer: null,
      stateGuardTimer: null,
      stateGuardUntil: 0,
      activated: false,
      released: false,
      restoring: false
    }
    active.timer = globalThis.setTimeout(() => {
      active.timer = null
      void this.activate(active, event)
    }, this.delayMs)
    this.active = active
  }

  private readonly handleMouseUp = (event: MouseEvent): void => {
    const active = this.active
    if (active === null) return
    if (active.released) return
    this.clearTimer(active)
    if (!active.activated) {
      this.active = null
      return
    }
    event.preventDefault()
    event.stopPropagation()
    active.released = true
    void this.restore(active)
  }

  private readonly handleMouseLeave = (event: MouseEvent): void => {
    // The document-level listener receives mouseleave only for the document
    // boundary; treat it like mouseup so a dragged pointer cannot leave 3× on.
    if (event.relatedTarget === null) this.handleMouseUp(event)
  }

  private readonly handleBlur = (): void => {
    const active = this.active
    if (active === null) return
    this.clearTimer(active)
    if (active.activated) {
      active.released = true
      void this.restore(active)
    } else {
      this.active = null
    }
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (!this.suppressClick) return
    this.suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  private async activate(active: ActivePress, sourceEvent: MouseEvent): Promise<void> {
    if (
      this.disposed ||
      !this.enabled ||
      this.active !== active ||
      active.released ||
      !isConnected(active.target.element)
    ) {
      return
    }
    active.activated = true
    this.suppressClick = true
    sourceEvent.preventDefault()
    sourceEvent.stopPropagation()
    const applied = await this.setPlaybackRate(active.target.mediaId, TEMPORARY_RATE).catch(
      () => false
    )
    if (!applied) {
      active.activated = false
      this.suppressClick = false
      if (this.active === active) this.active = null
      return
    }
    if (active.released) await this.restore(active)
  }

  private async restore(active: ActivePress): Promise<void> {
    if (active.restoring || !active.activated) return
    active.restoring = true
    try {
      await this.setPlaybackRate(active.target.mediaId, active.previousRate)
    } finally {
      active.activated = false
      active.restoring = false
      if (active.released) this.startPlaybackStateGuard(active)
      else if (this.active === active) this.active = null
      globalThis.setTimeout(() => {
        this.suppressClick = false
      }, 0)
    }
  }

  private startPlaybackStateGuard(active: ActivePress): void {
    if (this.disposed || this.active !== active || !active.released) return
    this.clearStateGuardTimer(active)
    active.stateGuardUntil = Date.now() + PLAYBACK_STATE_GUARD_MS
    this.schedulePlaybackStateGuard(active)
  }

  private schedulePlaybackStateGuard(active: ActivePress): void {
    if (
      this.disposed ||
      this.active !== active ||
      active.stateGuardUntil <= Date.now() ||
      active.stateGuardTimer !== null
    ) {
      return
    }
    active.stateGuardTimer = globalThis.setTimeout(() => {
      active.stateGuardTimer = null
      void this.checkPlaybackStateGuard(active)
    }, PLAYBACK_STATE_GUARD_POLL_MS)
  }

  private async checkPlaybackStateGuard(active: ActivePress): Promise<void> {
    if (
      this.disposed ||
      this.active !== active ||
      !active.released ||
      active.stateGuardUntil <= Date.now()
    ) {
      this.clearStateGuardTimer(active)
      if (this.active === active) this.active = null
      return
    }
    const snapshot = this.getSnapshot(active.target.mediaId)
    if (snapshot?.state === 'active' || snapshot?.state === 'paused') {
      if (snapshot.state !== active.previousState) {
        await this.setPlaybackState(active.target.mediaId, active.previousState).catch(() => false)
      }
    }
    this.schedulePlaybackStateGuard(active)
  }

  private cancelPending(restore: boolean): void {
    const active = this.active
    if (active === null) return
    this.clearTimer(active)
    this.clearStateGuardTimer(active)
    if (restore && active.activated) {
      active.released = true
      void this.restore(active)
      return
    }
    this.active = null
    this.suppressClick = false
  }

  private clearStateGuardTimer(active: ActivePress): void {
    if (active.stateGuardTimer === null) return
    globalThis.clearTimeout(active.stateGuardTimer)
    active.stateGuardTimer = null
  }

  private clearTimer(active: ActivePress): void {
    if (active.timer === null) return
    globalThis.clearTimeout(active.timer)
    active.timer = null
  }
}

function normalizeDelay(value: number): number {
  return Number.isFinite(value)
    ? Math.min(2_000, Math.max(200, Math.round(value)))
    : DEFAULT_DELAY_MS
}

function normalizeBottomExclusion(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : DEFAULT_BOTTOM_EXCLUSION_PX
}

function safeRect(element: Element): DOMRectReadOnly | null {
  try {
    const rect = element.getBoundingClientRect()
    return Number.isFinite(rect.left) &&
      Number.isFinite(rect.right) &&
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.bottom)
      ? rect
      : null
  } catch {
    return null
  }
}

function isConnected(element: Element): boolean {
  try {
    return element.isConnected
  } catch {
    return false
  }
}
