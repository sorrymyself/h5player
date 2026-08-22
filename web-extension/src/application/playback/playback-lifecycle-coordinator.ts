import type { MediaCommandResultResponse, MediaPageState } from '../media'
import type { MediaId, MediaSnapshot } from '../../domain/media'
import {
  mediaPlaybackPolicyStateSchema,
  playbackEligibleMedia,
  resolvePlaybackRatePolicy,
  type MediaPlaybackPolicyState,
  type PlaybackRateIntent,
  type PlaybackRatePolicyInput,
  type PlaybackRateScope,
  type ResolvedPlaybackRatePolicy
} from '../../domain/playback'
import { roundMediaValue } from '../../domain/media'

const DEFAULT_RETRY_BUDGET = 3

export type PlaybackPolicySettings = Readonly<{
  globalDefault: number
  siteDefault?: number | undefined
  protectAgainstSiteReset: boolean
}>

export type PlaybackRateWriteScope = Extract<PlaybackRateScope, 'site' | 'page' | 'media'>

export type PlaybackLifecycleCommandPort = Readonly<{
  setPlaybackRate(
    mediaId: MediaId,
    value: number,
    reason: 'lifecycle' | 'user'
  ): Promise<MediaCommandResultResponse>
}>

export type PlaybackLifecycleUpdate = Readonly<{
  page: MediaPageState
  policies: Readonly<Record<string, MediaPlaybackPolicyState>>
}>

export type PlaybackLifecycleCoordinatorOptions = Readonly<{
  commands: PlaybackLifecycleCommandPort
  now?: () => number
  retryBudget?: number
  onChanged?: (update: PlaybackLifecycleUpdate) => void
}>

type InternalMediaState = {
  readonly mediaId: MediaId
  generation: number
  sourceKey: string | undefined
  duration: number | null
  lastCurrentTime: number
  lastUpdatedAt: number
  lastAppliedKey: string | null
  attemptsForKey: number
  policyState: MediaPlaybackPolicyState
}

function ratesEqual(left: number, right: number): boolean {
  return roundMediaValue(left, 2) === roundMediaValue(right, 2)
}

function policyKey(policy: ResolvedPlaybackRatePolicy, generation: number): string {
  return `${generation}:${policy.value}:${policy.scope}:${policy.protectAgainstSiteReset}`
}

function policyInput(
  settings: PlaybackPolicySettings,
  snapshot: MediaSnapshot,
  pageIntent: PlaybackRateIntent | null,
  mediaIntent: PlaybackRateIntent | null
): PlaybackRatePolicyInput {
  return {
    globalDefault: settings.globalDefault,
    siteDefault: settings.siteDefault,
    pageIntent,
    mediaIntent,
    protectAgainstSiteReset: settings.protectAgainstSiteReset,
    capabilityAvailable: snapshot.capabilities.playbackRate
  }
}

export class PlaybackLifecycleCoordinator {
  private settings: PlaybackPolicySettings = {
    globalDefault: 1,
    siteDefault: undefined,
    protectAgainstSiteReset: false
  }
  private pageIntent: PlaybackRateIntent | null = null
  private readonly mediaIntents = new Map<MediaId, PlaybackRateIntent>()
  private readonly mediaStates = new Map<MediaId, InternalMediaState>()
  private latestPage: MediaPageState | null = null
  private disposed = false
  private operationEpoch = 0
  private reconcileTail: Promise<void> = Promise.resolve()
  private readonly now: () => number
  private readonly retryBudget: number

  constructor(private readonly options: PlaybackLifecycleCoordinatorOptions) {
    this.now = options.now ?? Date.now
    this.retryBudget = Math.max(1, Math.floor(options.retryBudget ?? DEFAULT_RETRY_BUDGET))
  }

  updateSettings(settings: PlaybackPolicySettings): Promise<void> {
    this.settings = settings
    return this.reconcileLatest()
  }

  setIntent(
    mediaId: MediaId,
    value: number,
    scope: PlaybackRateWriteScope,
    observedPage?: MediaPageState
  ): Promise<void> {
    this.stageIntent(mediaId, value, scope, observedPage)
    return this.reconcileLatest()
  }

  /**
   * Records a user policy before a media command finishes. A frame can be
   * destroyed while a command is in flight; keeping the intent separate from
   * reconciliation lets the next media instance inherit it without issuing
   * another write to the stale element.
   */
  stageIntent(
    mediaId: MediaId,
    value: number,
    scope: PlaybackRateWriteScope,
    observedPage?: MediaPageState
  ): void {
    if (observedPage !== undefined) this.latestPage = observedPage
    const intent = { value, updatedAt: Math.max(0, this.now()) }
    if (scope === 'media') this.mediaIntents.set(mediaId, intent)
    else if (scope === 'page') {
      this.pageIntent = intent
      this.mediaIntents.clear()
    } else {
      this.settings = { ...this.settings, siteDefault: value }
      this.pageIntent = null
      this.mediaIntents.clear()
    }
  }

  clearPageIntent(): Promise<void> {
    this.pageIntent = null
    return this.reconcileLatest()
  }

  clearMediaIntent(mediaId: MediaId): Promise<void> {
    this.mediaIntents.delete(mediaId)
    return this.reconcileLatest()
  }

  observe(page: MediaPageState): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.latestPage = page
    this.reconcileTail = this.reconcileTail.then(() => this.reconcile(page))
    return this.reconcileTail
  }

  policyFor(snapshot: MediaSnapshot): ResolvedPlaybackRatePolicy {
    return resolvePlaybackRatePolicy(
      policyInput(
        this.settings,
        snapshot,
        this.pageIntent,
        this.mediaIntents.get(snapshot.id) ?? null
      )
    )
  }

  snapshot(): Readonly<Record<string, MediaPlaybackPolicyState>> {
    return Object.fromEntries(
      [...this.mediaStates.entries()].map(([mediaId, state]) => [mediaId, state.policyState])
    )
  }

  reset(): void {
    if (this.disposed) return
    this.operationEpoch += 1
    this.latestPage = null
    this.pageIntent = null
    this.mediaIntents.clear()
    this.mediaStates.clear()
  }

  teardown(): void {
    this.operationEpoch += 1
    this.disposed = true
    this.latestPage = null
    this.pageIntent = null
    this.mediaIntents.clear()
    this.mediaStates.clear()
  }

  private reconcileLatest(): Promise<void> {
    return this.latestPage === null ? Promise.resolve() : this.observe(this.latestPage)
  }

  private async reconcile(page: MediaPageState): Promise<void> {
    if (this.disposed) return
    const currentIds = new Set(page.media.map((snapshot) => snapshot.id))
    for (const mediaId of [...this.mediaStates.keys()]) {
      if (currentIds.has(mediaId)) continue
      this.mediaStates.delete(mediaId)
      this.mediaIntents.delete(mediaId)
    }

    const eligibleMedia = playbackEligibleMedia(page.media, page.activeMediaId)
    const eligibleIds = new Set(eligibleMedia.map((snapshot) => snapshot.id))
    for (const mediaId of [...this.mediaStates.keys()]) {
      if (!currentIds.has(mediaId) || eligibleIds.has(mediaId)) continue
      this.mediaStates.delete(mediaId)
    }

    for (const snapshot of eligibleMedia) {
      await this.reconcileMedia(snapshot)
    }
    if (!this.disposed && this.latestPage === page) {
      this.options.onChanged?.({ page, policies: this.snapshot() })
    }
  }

  private async reconcileMedia(snapshot: MediaSnapshot): Promise<void> {
    const policy = this.policyFor(snapshot)
    const internal = this.stateFor(snapshot, policy)
    const key = policyKey(policy, internal.generation)

    if (!policy.supported) {
      internal.policyState = this.toPolicyState(snapshot, policy, internal, {
        applicationStatus: 'unsupported',
        degradationReason: 'CAPABILITY_UNAVAILABLE'
      })
      return
    }

    if (ratesEqual(snapshot.metrics.playbackRate, policy.value)) {
      if (internal.lastAppliedKey !== key) {
        internal.lastAppliedKey = key
        internal.attemptsForKey = 0
      }
      internal.policyState = this.toPolicyState(snapshot, policy, internal, {
        applicationStatus: 'applied',
        lastAppliedAt: Math.max(0, this.now()),
        lastObservedExternalRate: null,
        degradationReason: null
      })
      return
    }

    const isExternalReset = internal.lastAppliedKey === key
    const shouldRetrySiteInheritance = policy.source === 'site-rule'
    if (isExternalReset && !policy.protectAgainstSiteReset && !shouldRetrySiteInheritance) {
      internal.policyState = this.toPolicyState(snapshot, policy, internal, {
        applicationStatus: 'blocked',
        lastObservedExternalRate: snapshot.metrics.playbackRate,
        degradationReason: null
      })
      return
    }

    if (internal.lastAppliedKey !== key) {
      internal.lastAppliedKey = key
      internal.attemptsForKey = 0
    }
    if (internal.attemptsForKey >= this.retryBudget) {
      internal.policyState = this.toPolicyState(snapshot, policy, internal, {
        applicationStatus: 'blocked',
        lastObservedExternalRate: snapshot.metrics.playbackRate,
        degradationReason: 'RETRY_BUDGET_EXHAUSTED'
      })
      return
    }

    internal.attemptsForKey += 1
    const operationEpoch = this.operationEpoch
    internal.policyState = this.toPolicyState(snapshot, policy, internal, {
      applicationStatus: 'pending',
      lastObservedExternalRate: isExternalReset ? snapshot.metrics.playbackRate : null,
      degradationReason: null
    })
    try {
      const response = await this.options.commands.setPlaybackRate(
        snapshot.id,
        policy.value,
        'lifecycle'
      )
      if (!this.acceptsResult(snapshot.id, internal, key, operationEpoch)) return
      if (!response.result.ok) {
        internal.policyState = this.toPolicyState(snapshot, policy, internal, {
          applicationStatus:
            response.result.error.code === 'CAPABILITY_UNAVAILABLE' ? 'unsupported' : 'failed',
          degradationReason:
            response.result.error.code === 'CAPABILITY_UNAVAILABLE'
              ? 'CAPABILITY_UNAVAILABLE'
              : null
        })
        return
      }
      const applied = response.result.value.snapshot
      internal.policyState = this.toPolicyState(applied, policy, internal, {
        applicationStatus: ratesEqual(applied.metrics.playbackRate, policy.value)
          ? 'applied'
          : 'failed',
        lastAppliedAt: Math.max(0, this.now()),
        degradationReason: null
      })
    } catch {
      if (!this.acceptsResult(snapshot.id, internal, key, operationEpoch)) return
      internal.policyState = this.toPolicyState(snapshot, policy, internal, {
        applicationStatus: 'failed',
        degradationReason: null
      })
    }
  }

  private stateFor(
    snapshot: MediaSnapshot,
    policy: ResolvedPlaybackRatePolicy
  ): InternalMediaState {
    const existing = this.mediaStates.get(snapshot.id)
    if (existing === undefined) {
      const created: InternalMediaState = {
        mediaId: snapshot.id,
        generation: 0,
        sourceKey: snapshot.sourceKey,
        duration: snapshot.metrics.duration,
        lastCurrentTime: snapshot.metrics.currentTime,
        lastUpdatedAt: snapshot.updatedAt,
        lastAppliedKey: null,
        attemptsForKey: 0,
        policyState: this.toPolicyState(
          snapshot,
          policy,
          {
            generation: 0,
            attemptsForKey: 0,
            policyState: null as never
          },
          { applicationStatus: 'pending' }
        )
      }
      this.mediaStates.set(snapshot.id, created)
      return created
    }

    const durationChanged =
      existing.duration === null || snapshot.metrics.duration === null
        ? existing.duration !== snapshot.metrics.duration
        : !ratesEqual(existing.duration, snapshot.metrics.duration)
    const lifecycleRestarted = snapshot.updatedAt < existing.lastUpdatedAt
    const sourceChanged = existing.sourceKey !== snapshot.sourceKey
    const replayed = existing.lastCurrentTime > 1 && snapshot.metrics.currentTime <= 0.25
    if (sourceChanged || durationChanged || lifecycleRestarted || replayed) {
      existing.generation += 1
      existing.lastAppliedKey = null
      existing.attemptsForKey = 0
    }
    existing.sourceKey = snapshot.sourceKey
    existing.duration = snapshot.metrics.duration
    existing.lastCurrentTime = snapshot.metrics.currentTime
    existing.lastUpdatedAt = snapshot.updatedAt
    return existing
  }

  private acceptsResult(
    mediaId: MediaId,
    internal: InternalMediaState,
    key: string,
    operationEpoch: number
  ): boolean {
    if (
      this.disposed ||
      operationEpoch !== this.operationEpoch ||
      this.mediaStates.get(mediaId) !== internal ||
      internal.lastAppliedKey !== key
    ) {
      return false
    }
    const latest = this.latestPage
    if (latest === null) return false
    const snapshot = latest.media.find((item) => item.id === mediaId)
    return (
      snapshot !== undefined &&
      playbackEligibleMedia(latest.media, latest.activeMediaId).some((item) => item.id === mediaId)
    )
  }

  private toPolicyState(
    snapshot: MediaSnapshot,
    policy: ResolvedPlaybackRatePolicy,
    internal: Pick<InternalMediaState, 'attemptsForKey' | 'generation' | 'policyState'>,
    overrides: Partial<MediaPlaybackPolicyState>
  ): MediaPlaybackPolicyState {
    return mediaPlaybackPolicyStateSchema.parse({
      mediaId: snapshot.id,
      intendedRate: policy.value,
      actualRate: snapshot.metrics.playbackRate,
      scope: policy.scope,
      source: policy.source,
      protectAgainstSiteReset: policy.protectAgainstSiteReset,
      applicationStatus: 'pending',
      lastAppliedAt: internal.policyState?.lastAppliedAt ?? null,
      lastObservedExternalRate: internal.policyState?.lastObservedExternalRate ?? null,
      attemptCount: internal.attemptsForKey,
      generation: internal.generation,
      degradationReason: null,
      ...overrides
    })
  }
}
