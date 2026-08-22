import type { SiteAdapterPageActionResponse } from '../adapter'
import type { MediaPageState } from '../media'
import type { MediaId, MediaSnapshot } from '../../domain/media'

const DEFAULT_RETRY_BUDGET = 10
const DEFAULT_RETRY_DELAY_MS = 200
const DEFAULT_OBSERVATION_TIMEOUT_MS = 1_000

type TimerHandle = ReturnType<typeof globalThis.setTimeout>

export type AutoplayCommandPort = Readonly<{
  start(mediaId: MediaId): Promise<SiteAdapterPageActionResponse>
}>

export type AutoplayCoordinatorOptions = Readonly<{
  commands: AutoplayCommandPort
  isDocumentVisible?: () => boolean
  schedule?: (callback: () => void, delayMs: number) => TimerHandle
  cancel?: (handle: TimerHandle) => void
  retryBudget?: number
  retryDelayMs?: number
  observationTimeoutMs?: number
}>

type AutoplayAttempt = {
  mediaId: MediaId
  generation: string
  attempts: number
  settled: boolean
  running: boolean
  timer: TimerHandle | null
  lastCurrentTime: number
  awaitingObservation: boolean
  lastActionRevision: number | null
  lastActionUpdatedAt: number | null
}

function sourceGeneration(snapshot: MediaSnapshot): string {
  const duration =
    snapshot.metrics.duration === null ? 'unknown' : String(Math.round(snapshot.metrics.duration))
  return String(snapshot.id) + ':' + String(snapshot.sourceKey ?? 'source-unknown') + ':' + duration
}

function activeSnapshot(page: MediaPageState): MediaSnapshot | null {
  if (page.activeMediaId === null) return null
  return page.media.find((snapshot) => snapshot.id === page.activeMediaId) ?? null
}

/**
 * Reproduces Legacy's bounded, visibility-aware adapter page-start attempts.
 * Generic media.play is deliberately outside this coordinator: only a site
 * adapter that explicitly declares an autoplay page action may act.
 */
export class AutoplayCoordinator {
  private readonly isDocumentVisible: () => boolean
  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle
  private readonly cancel: (handle: TimerHandle) => void
  private readonly retryBudget: number
  private readonly retryDelayMs: number
  private readonly observationTimeoutMs: number
  private readonly attempts = new Map<MediaId, AutoplayAttempt>()
  private latestPage: MediaPageState | null = null
  private enabled = false
  private disposed = false

  constructor(private readonly options: AutoplayCoordinatorOptions) {
    this.isDocumentVisible = options.isDocumentVisible ?? (() => true)
    this.schedule =
      options.schedule ??
      ((callback, delayMs) => globalThis.setTimeout(callback, Math.max(0, delayMs)))
    this.cancel = options.cancel ?? ((handle) => globalThis.clearTimeout(handle))
    this.retryBudget = Math.max(
      1,
      Math.min(20, Math.floor(options.retryBudget ?? DEFAULT_RETRY_BUDGET))
    )
    this.retryDelayMs = Math.max(
      50,
      Math.min(2_000, Math.floor(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS))
    )
    this.observationTimeoutMs = Math.max(
      this.retryDelayMs,
      Math.min(5_000, Math.floor(options.observationTimeoutMs ?? DEFAULT_OBSERVATION_TIMEOUT_MS))
    )
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed) return
    this.enabled = enabled
    if (!enabled) {
      this.clearAttempts()
      return
    }
    if (this.latestPage !== null) this.observe(this.latestPage)
  }

  setDocumentVisible(visible: boolean): void {
    if (this.disposed || !this.enabled || !visible) return
    if (this.latestPage !== null) this.observe(this.latestPage)
  }

  observe(page: MediaPageState): void {
    if (this.disposed) return
    this.latestPage = page
    const current = activeSnapshot(page)
    for (const [mediaId, attempt] of this.attempts) {
      if (current?.id !== mediaId) this.cancelAttempt(attempt)
    }
    if (!this.enabled || !this.isDocumentVisible() || current === null) return
    if (page.frameId !== 0 || current.frameId !== 0) {
      this.clearAttempts()
      return
    }

    let attempt = this.attempts.get(current.id)
    const generation = sourceGeneration(current)
    if (
      attempt === undefined ||
      attempt.generation !== generation ||
      current.metrics.currentTime + 2 < attempt.lastCurrentTime
    ) {
      if (attempt !== undefined) this.cancelAttempt(attempt)
      attempt = {
        mediaId: current.id,
        generation,
        attempts: 0,
        settled: false,
        running: false,
        timer: null,
        lastCurrentTime: current.metrics.currentTime,
        awaitingObservation: false,
        lastActionRevision: null,
        lastActionUpdatedAt: null
      }
      this.attempts.set(current.id, attempt)
    } else {
      attempt.lastCurrentTime = current.metrics.currentTime
    }

    if (attempt.awaitingObservation && this.hasFreshObservation(attempt, page, current)) {
      attempt.awaitingObservation = false
      this.clearTimer(attempt)
    }

    if (current.state === 'active') {
      attempt.settled = true
      attempt.awaitingObservation = false
      this.clearTimer(attempt)
      return
    }
    if (
      current.state !== 'paused' ||
      !current.metrics.visible ||
      !current.capabilities.playback ||
      attempt.settled ||
      attempt.awaitingObservation ||
      attempt.attempts >= this.retryBudget
    ) {
      return
    }
    this.scheduleAttempt(attempt, attempt.attempts === 0 ? 0 : this.retryDelayMs)
  }

  reset(): void {
    if (this.disposed) return
    this.latestPage = null
    this.clearAttempts()
  }

  teardown(): void {
    if (this.disposed) return
    this.disposed = true
    this.latestPage = null
    this.clearAttempts()
  }

  private scheduleAttempt(attempt: AutoplayAttempt, delayMs: number): void {
    if (attempt.timer !== null || attempt.running || attempt.settled) return
    attempt.timer = this.schedule(() => {
      attempt.timer = null
      void this.runAttempt(attempt)
    }, delayMs)
  }

  private async runAttempt(attempt: AutoplayAttempt): Promise<void> {
    if (this.disposed || !this.enabled || !this.isDocumentVisible() || attempt.settled) return
    const page = this.latestPage
    const current = page === null ? null : activeSnapshot(page)
    if (
      current === null ||
      page?.frameId !== 0 ||
      current.id !== attempt.mediaId ||
      sourceGeneration(current) !== attempt.generation ||
      current.state !== 'paused' ||
      current.frameId !== 0 ||
      !current.metrics.visible ||
      !current.capabilities.playback
    ) {
      return
    }
    attempt.running = true
    attempt.attempts += 1
    attempt.lastCurrentTime = current.metrics.currentTime
    attempt.awaitingObservation = true
    attempt.lastActionRevision = page.revision
    attempt.lastActionUpdatedAt = current.updatedAt
    let handled = false
    try {
      const response = await this.options.commands.start(attempt.mediaId)
      if (!response.declared) {
        attempt.settled = true
        attempt.awaitingObservation = false
        this.clearTimer(attempt)
        return
      }
      handled = response.handled
    } catch {
      // Site page-action failures are retried within the bounded budget and
      // never surfaced as unhandled rejections.
    } finally {
      attempt.running = false
    }

    if (attempt.settled) return

    if (handled) {
      /*
       * A DOM click is not proof that the media started. Wait for a fresh
       * media observation before retrying; blindly clicking a toggle-style
       * play button again can pause a player that started asynchronously.
       * If no observation arrives within the bounded window, stop safely.
       */
      if (attempt.awaitingObservation) {
        this.scheduleObservationTimeout(attempt)
      } else if (attempt.attempts < this.retryBudget) {
        this.scheduleAttempt(attempt, this.retryDelayMs)
      }
      return
    }

    attempt.awaitingObservation = false
    if (
      !this.disposed &&
      this.enabled &&
      this.isDocumentVisible() &&
      !attempt.settled &&
      attempt.attempts < this.retryBudget
    ) {
      this.scheduleAttempt(attempt, this.retryDelayMs)
    }
  }

  private scheduleObservationTimeout(attempt: AutoplayAttempt): void {
    if (attempt.timer !== null || attempt.settled || !attempt.awaitingObservation) return
    attempt.timer = this.schedule(() => {
      attempt.timer = null
      if (attempt.awaitingObservation) {
        attempt.awaitingObservation = false
        attempt.settled = true
      }
    }, this.observationTimeoutMs)
  }

  private hasFreshObservation(
    attempt: AutoplayAttempt,
    page: MediaPageState,
    current: MediaSnapshot
  ): boolean {
    return (
      (attempt.lastActionRevision !== null && page.revision > attempt.lastActionRevision) ||
      (attempt.lastActionUpdatedAt !== null && current.updatedAt > attempt.lastActionUpdatedAt)
    )
  }

  private clearTimer(attempt: AutoplayAttempt): void {
    if (attempt.timer === null) return
    this.cancel(attempt.timer)
    attempt.timer = null
  }

  private cancelAttempt(attempt: AutoplayAttempt): void {
    this.clearTimer(attempt)
    this.attempts.delete(attempt.mediaId)
  }

  private clearAttempts(): void {
    for (const attempt of this.attempts.values()) this.clearTimer(attempt)
    this.attempts.clear()
  }
}
