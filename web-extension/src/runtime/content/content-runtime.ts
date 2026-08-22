import {
  emptyPayloadSchema,
  settingsSnapshotResponseSchema,
  systemPingResponseSchema
} from '../../application/settings/contracts'
import {
  HotkeyController,
  type HotkeyRemoteMediaPort,
  type HotkeyRemoteState
} from '../../application/hotkeys'
import {
  crossTabMediaEventSchema,
  crossTabEventPayloadSchema,
  crossTabPublishResponseSchema,
  mediaExecutePayloadSchema,
  mediaGetStatePayloadSchema,
  mediaPageStateSchema,
  mediaCommandResultResponseSchema,
  experimentalEnsureMainResponseSchema,
  hasRoutableActiveMedia,
  activeMediaForState,
  pictureInPictureControlStateSchema,
  pictureInPictureOwnerSnapshotSchema,
  pictureInPicturePresencePayloadSchema
} from '../../application/media'
import type {
  CrossTabMediaEvent,
  PictureInPictureControlState,
  PictureInPictureOwnerLease
} from '../../application/media'
import type { MediaCommandResultResponse } from '../../application/media'
import {
  progressDeleteResponseSchema,
  progressReadResponseSchema,
  progressRestoreToggleResponseSchema,
  progressSaveResponseSchema
} from '../../application/progress'
import { ReplayGuard } from '../../infrastructure/messaging/replay-guard'
import {
  RuntimeRequestClient,
  RuntimeRequestError
} from '../../infrastructure/messaging/request-client'
import { systemClock, systemScheduler } from '../../infrastructure/time/system-time'
import { createSessionId, createSessionNonce } from '../../shared/ids'
import { createRequestId } from '../../shared/ids'
import {
  createTabError,
  createTabSuccess,
  parseTabRequest,
  type TabRequestEnvelope
} from '../../shared/tab-protocol'
import { PageBridge, PageBridgeError } from './page-bridge'
import type {
  ExperimentalMediaPolicy,
  MediaAuthorityPolicy
} from '../../infrastructure/messaging/page-media-protocol'
import { DomHotkeyEventSource } from '../../infrastructure/dom'
import { resolveSettings } from '../../domain/settings'
import type { GlobalSettings } from '../../domain/settings'
import { createProgressIdentity } from '../../domain/progress'
import type { MediaPageState } from '../../application/media'
import type { MediaCommand } from '../../domain/command'
import type { CaptureArtifact } from '../../domain/capture'
import type { MediaDownloadArtifact, MediaDownloadEvent } from '../../domain/download'
import { clampPlaybackRate, roundMediaValue, type MediaId } from '../../domain/media'
import type { Teardown } from '../../application/ports/browser'
import {
  AutoplayCoordinator,
  PlaybackLifecycleCoordinator,
  playbackSiteIntentResponseSchema,
  type PlaybackRateWriteScope
} from '../../application/playback'
import {
  createMediaFeedbackEvent,
  createPlaybackPolicyFeedbackEvent,
  createRestoreProgressFeedbackEvent,
  type MediaCommandSource,
  type MediaFeedbackEvent
} from '../../application/feedback'
import type { MediaPlaybackPolicyState } from '../../domain/playback'
import { tencentVideoSiteOriginForUrl } from '../../shared/viewport-media-surface'
import {
  siteRuntimeStateResponseSchema,
  sitePageUiVisibilityPayloadSchema,
  sitePageUiVisibilityResponseSchema,
  siteTemporaryDisablePayloadSchema,
  siteTemporaryDisableResponseSchema,
  frameRuntimeReportResponseSchema,
  type SitePageUiVisibilityResponse
} from '../../application/site/contracts'

type ContentRuntimeOptions = {
  window: Window
  document: Document
  siteOrigin?: string
  extensionId: string
  transport: ConstructorParameters<typeof RuntimeRequestClient>[1]
  injectPageMain: () => Promise<void>
  subscribeSettings?: (listener: () => void) => Teardown
  onMediaStateChanged?: (state: MediaPageState, settings: GlobalSettings) => void
  onRuntimeStateChanged?: (state: ContentRuntimeSnapshot) => void
  onCrossTabEvent?: (event: CrossTabMediaEvent) => void
  onFeedback?: (event: MediaFeedbackEvent) => void
  onCaptureArtifact?: (artifact: CaptureArtifact) => void
  onMediaDownloadArtifacts?: (
    artifacts: readonly MediaDownloadArtifact[]
  ) => boolean | void | Promise<boolean | void>
  onMediaDownloadFailure?: (event: Extract<MediaDownloadEvent, { type: 'failed' }>) => void
  getAnchoredMediaCount?: () => number
  subscribeRuntimeReconnect?: (sessionId: string, listener: () => void) => Teardown
  pageUi?: Readonly<{
    getState(): { readonly hidden: boolean; readonly hiddenMediaCount: number }
    setHidden(hidden: boolean): { readonly hidden: boolean; readonly hiddenMediaCount: number }
  }>
}

export type ContentMessageSender = {
  readonly id?: string
}

export type ContentRuntimeSnapshot = Readonly<{
  readonly ready: boolean
  readonly mediaReady: boolean
  readonly siteEnabled: boolean
  readonly temporaryDisabled: boolean
  readonly pageUiHidden: boolean
  readonly hiddenMediaCount: number
  readonly settings: GlobalSettings
  readonly mediaState: MediaPageState | null
  readonly playbackPolicies: Readonly<Record<string, MediaPlaybackPolicyState>>
}>

export type ContentRuntimeHandle = {
  readonly handleTabMessage: (rawMessage: unknown, sender: ContentMessageSender) => Promise<unknown>
  readonly getMediaState: () => Promise<MediaPageState>
  readonly executeMediaCommand: (
    command: MediaCommand,
    options?: Readonly<{
      source?: MediaCommandSource
      playbackRateScope?: PlaybackRateWriteScope
    }>
  ) => Promise<MediaCommandResultResponse>
  readonly setPageUiHidden: (hidden: boolean) => Promise<SitePageUiVisibilityResponse>
  readonly cancelMediaDownload: (mediaId: MediaId) => Promise<boolean>
  readonly reportFrameState: () => void
  readonly teardown: () => void
}

const DISABLED_MEDIA_AUTHORITY_POLICY: MediaAuthorityPolicy = Object.freeze({
  playbackRate: false,
  volume: false,
  currentTime: false
})

const DISABLED_EXPERIMENTAL_MEDIA_POLICY: ExperimentalMediaPolicy = Object.freeze({
  mediaDownload: false
})

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms))

type StagedPlaybackRateIntent = Readonly<{
  value: number
  scope: PlaybackRateWriteScope
}>

type PendingMediaDownloadIntent = Readonly<{
  mediaId: MediaId
  command: Extract<MediaCommand, { type: 'media.download' }>
  source: MediaCommandSource
  timeoutHandle: ReturnType<typeof globalThis.setTimeout>
}>

function playbackRateIntentValue(
  command: MediaCommand,
  state: MediaPageState | null
): number | null {
  if (command.type === 'media.set-rate') {
    return roundMediaValue(clampPlaybackRate(command.value), 1)
  }
  if (command.type !== 'media.adjust-rate') return null
  const snapshot = state?.media.find((media) => media.id === command.mediaId)
  if (snapshot === undefined) return null
  return roundMediaValue(clampPlaybackRate(snapshot.metrics.playbackRate + command.delta), 1)
}

function playbackRatesEqual(left: number, right: number): boolean {
  return roundMediaValue(left, 2) === roundMediaValue(right, 2)
}

function responseReachedPlaybackRateIntent(
  response: MediaCommandResultResponse,
  intent: StagedPlaybackRateIntent
): boolean {
  return (
    response.result.ok &&
    playbackRatesEqual(response.result.value.snapshot.metrics.playbackRate, intent.value)
  )
}

function playbackRatePostconditionFailure(
  command: MediaCommand,
  response: MediaCommandResultResponse,
  intent: StagedPlaybackRateIntent
): MediaCommandResultResponse {
  const active = activeMediaForState(response.state)
  return mediaCommandResultResponseSchema.parse({
    result: {
      ok: false,
      error: {
        code: 'COMMAND_EXECUTION_FAILED',
        messageKey: 'command.error.executionFailed',
        context: {
          commandType: command.type,
          mediaId: command.mediaId,
          phase: 'routed-playback-rate-postcondition',
          expectedRate: intent.value,
          actualRate: active?.metrics.playbackRate ?? null
        }
      }
    },
    state: response.state
  })
}

function mediaDownloadMessageKey(code: string): string {
  return code === 'DOWNLOAD_BLOCKED'
    ? 'download.error.blocked'
    : code === 'DOWNLOAD_TOO_LARGE'
      ? 'download.error.tooLarge'
      : code === 'DOWNLOAD_UNAVAILABLE'
        ? 'download.error.unavailable'
        : code === 'DOWNLOAD_CANCELLED'
          ? 'download.error.cancelled'
          : 'download.error.failed'
}

function mediaDownloadFailureResponse(
  mediaId: MediaId,
  state: MediaPageState,
  code: string,
  phase: string
): MediaCommandResultResponse {
  return mediaCommandResultResponseSchema.parse({
    result: {
      ok: false,
      error: {
        code,
        messageKey: mediaDownloadMessageKey(code),
        context: { mediaId, phase }
      }
    },
    state
  })
}

function bridgeFailure(request: TabRequestEnvelope, error: unknown): unknown {
  if (error instanceof PageBridgeError) {
    const unavailable =
      error.code === 'BRIDGE_UNAVAILABLE' ||
      error.code === 'PAGE_RUNTIME_UNAVAILABLE' ||
      error.code === 'REQUEST_TIMEOUT'
    return createTabError(
      request,
      unavailable ? 'PAGE_RUNTIME_UNAVAILABLE' : 'INTERNAL_ERROR',
      unavailable ? 'media.error.runtime-unavailable' : 'media.error.internal',
      unavailable
    )
  }
  return createTabError(request, 'INTERNAL_ERROR', 'media.error.internal')
}

export async function startContentRuntime(
  options: ContentRuntimeOptions
): Promise<ContentRuntimeHandle> {
  const root = options.document.documentElement
  if (!root) {
    return {
      handleTabMessage: () => Promise.resolve(null),
      getMediaState: () =>
        Promise.reject(
          new PageBridgeError('PAGE_RUNTIME_UNAVAILABLE', 'Content runtime unavailable')
        ),
      executeMediaCommand: () =>
        Promise.reject(
          new PageBridgeError('PAGE_RUNTIME_UNAVAILABLE', 'Content runtime unavailable')
        ),
      setPageUiHidden: (hidden) => Promise.resolve({ hidden, hiddenMediaCount: 0 }),
      cancelMediaDownload: () => Promise.resolve(false),
      reportFrameState: () => undefined,
      teardown: () => undefined
    }
  }

  const sessionId = createSessionId()
  const nonce = createSessionNonce()
  let settingsOrigin = options.siteOrigin ?? options.window.location.origin
  const runtime = new RuntimeRequestClient('content', options.transport, systemScheduler, {
    sessionId
  })
  let tabId: number | null = null
  let frameId = 0
  let downloadEventSubscription: Teardown | null = null

  root.dataset['h5playerWebextContent'] = 'ready'
  try {
    const ping = await runtime.request('system.ping', {}, systemPingResponseSchema)
    tabId = ping.tabId ?? null
    frameId = ping.frameId ?? 0
    settingsOrigin = ping.siteOrigin ?? settingsOrigin
    root.dataset['h5playerWebextBackground'] = 'ready'
  } catch {
    root.dataset['h5playerWebextBackground'] = 'failed'
  }
  const isTopFrame = frameId === 0 && options.window.top === options.window

  const bridge = new PageBridge({
    window: options.window,
    session: { sessionId, nonce, origin: options.window.location.origin },
    replayGuard: new ReplayGuard(systemClock),
    scheduler: systemScheduler,
    injectPageMain: options.injectPageMain
  })

  let experimentalMainAvailable = false
  const ensureExperimentalMain = async (): Promise<boolean> => {
    if (experimentalMainAvailable) return true
    try {
      const response = await runtime.request(
        'experimental.ensure-main',
        {},
        experimentalEnsureMainResponseSchema
      )
      experimentalMainAvailable = response.allowed && response.injected
      return experimentalMainAvailable
    } catch {
      return false
    }
  }

  await ensureExperimentalMain()

  const bridgeReady = await bridge.start()
  root.dataset['h5playerWebextBridge'] = bridgeReady ? 'ready' : 'failed'
  let mediaReady = false
  if (bridgeReady) {
    try {
      mediaReady = await bridge.configure(frameId, settingsOrigin)
      bridge.ping()
    } catch {
      mediaReady = false
    }
  }
  root.dataset['h5playerWebextMedia'] = mediaReady ? 'ready' : 'failed'
  downloadEventSubscription = bridge.subscribeDownloadEvents(handleMediaDownloadEvent)

  const tabReplayGuard = new ReplayGuard(systemClock)
  let temporaryDisabled = false
  // Frame-state responses can arrive after a newer explicit page command. A
  // local revision prevents an older report response from revoking a freshly
  // restored runtime (and similarly protects page-UI visibility updates).
  let frameStateRevision = 0
  let latestTemporaryDisableIssuedAt = -1
  let latestTemporaryDisableRevision = -1
  let pageUiHidden = options.pageUi?.getState().hidden ?? false
  let siteEnabled = false
  let latestMediaState: MediaPageState | null = null
  let latestLocalMediaState: MediaPageState | null = null
  let latestHotkeyMediaState: MediaPageState | null = null
  const runtimeReady = (): boolean => mediaReady && siteEnabled && !temporaryDisabled
  let playbackPolicies: Readonly<Record<string, MediaPlaybackPolicyState>> = {}
  let appliedAuthorityPolicy = DISABLED_MEDIA_AUTHORITY_POLICY
  let appliedExperimentalPolicy = DISABLED_EXPERIMENTAL_MEDIA_POLICY
  let progressRefreshPending = false
  const policyFeedbackStates = new Map<MediaId, MediaPlaybackPolicyState>()
  let pipPresence: Readonly<{ mediaId: MediaId; active: boolean }> | null = null
  let pipPresenceLastSentAt = 0
  let pipPresenceQueue: Promise<void> = Promise.resolve()
  let pipPresenceHeartbeat: ReturnType<typeof globalThis.setInterval> | null = null
  let pipRemoteState: Readonly<{
    owner: PictureInPictureOwnerLease
    generation: number
    state: MediaPageState
  }> | null = null
  let effectiveSettings: GlobalSettings = {
    enabled: false,
    ui: { overlayEnabled: false, theme: 'system', locale: 'zh-CN' },
    hotkeys: { enabled: false, scope: 'page', bindings: {} },
    media: { defaultPlaybackRate: 1, defaultVolume: 1, restoreProgress: false },
    download: { enabled: true },
    policies: {
      protectPlaybackRate: false,
      protectCurrentTime: false,
      protectVolume: false,
      allowExperimental: false,
      allowAcousticGain: false,
      allowMouseLongPress: false,
      mouseLongPressMs: 600,
      allowAutoplay: false
    },
    diagnostics: { localLogLevel: 'error', retainProgressDays: 0 }
  }
  const restoredProgressKeys = new Set<string>()
  const progressSaveAt = new Map<string, number>()
  let progressRefreshQueued = false
  let lastObservedMediaState: MediaPageState | null = null
  let stateSubscription: Teardown | null = null
  const pendingMediaDownloads = new Map<string, PendingMediaDownloadIntent>()
  let hotkeyTarget: 'local' | 'routed-frame' = 'local'
  const hotkeySource = new DomHotkeyEventSource(options.window, options.document)
  const playback = new PlaybackLifecycleCoordinator({
    commands: {
      setPlaybackRate: (mediaId, value) => executePlaybackLifecycleRate(mediaId, value)
    },
    onChanged: (update) => {
      for (const policy of Object.values(update.policies)) {
        const event = createPlaybackPolicyFeedbackEvent({
          state: policy,
          previousState: policyFeedbackStates.get(policy.mediaId) ?? null,
          now: Date.now()
        })
        policyFeedbackStates.set(policy.mediaId, policy)
        if (event !== null) options.onFeedback?.(event)
      }
      for (const mediaId of [...policyFeedbackStates.keys()]) {
        if (update.policies[mediaId] === undefined) policyFeedbackStates.delete(mediaId)
      }
      playbackPolicies = update.policies
      notifyRuntimeState()
    }
  })
  const autoplay = new AutoplayCoordinator({
    commands: {
      start: () => bridge.executePageAction('autoplay')
    },
    isDocumentVisible: () => options.document.visibilityState !== 'hidden'
  })

  function pictureInPictureMedia(
    state: MediaPageState | null
  ): MediaPageState['media'][number] | null {
    if (state === null) return null
    const active = activeMediaForState(state)
    if (active?.presentation?.pictureInPicture === true) return active
    return state.media.find((media) => media.presentation?.pictureInPicture === true) ?? null
  }

  function clearPipRemoteState(): void {
    pipRemoteState = null
  }

  function clearCachedMediaState(): void {
    latestMediaState = null
    latestLocalMediaState = null
    latestHotkeyMediaState = null
    lastObservedMediaState = null
    clearPipRemoteState()
  }

  function usablePipRemoteState(
    value: PictureInPictureControlState | null
  ): HotkeyRemoteState | null {
    if (value === null || value.owner === null || value.state === null || tabId === null) {
      clearPipRemoteState()
      return null
    }
    const owner = value.owner
    if (owner.tabId === tabId && owner.frameId === frameId) {
      clearPipRemoteState()
      return null
    }
    if (Date.now() >= owner.expiresAt) {
      clearPipRemoteState()
      return null
    }
    const active = activeMediaForState(value.state)
    if (active === null || active.id !== owner.mediaId) {
      clearPipRemoteState()
      return null
    }
    pipRemoteState = Object.freeze({
      owner,
      generation: owner.generation,
      state: value.state
    })
    return Object.freeze({ generation: owner.generation, state: value.state })
  }

  async function refreshPipRemoteState(): Promise<HotkeyRemoteState | null> {
    if (!siteEnabled || temporaryDisabled || tabId === null) {
      clearPipRemoteState()
      return null
    }
    try {
      const value = await runtime.request(
        'media.picture-in-picture.get-state',
        {},
        pictureInPictureControlStateSchema
      )
      return usablePipRemoteState(value)
    } catch {
      clearPipRemoteState()
      return null
    }
  }

  function peekPipRemoteState(): HotkeyRemoteState | null {
    const cached = pipRemoteState
    if (
      cached === null ||
      tabId === null ||
      (cached.owner.tabId === tabId && cached.owner.frameId === frameId) ||
      Date.now() >= cached.owner.expiresAt
    ) {
      clearPipRemoteState()
      return null
    }
    return Object.freeze({ generation: cached.generation, state: cached.state })
  }

  async function executePipRemoteCommand(
    command: MediaCommand,
    generation: number
  ): Promise<MediaCommandResultResponse> {
    const cached = peekPipRemoteState()
    if (cached === null || cached.generation !== generation) {
      throw new RuntimeRequestError(
        'TARGET_UNAVAILABLE',
        true,
        'The picture-in-picture owner lease is no longer valid'
      )
    }
    const response = await runtime.request(
      'media.picture-in-picture.execute',
      { command, generation },
      mediaCommandResultResponseSchema
    )
    const owner = pipRemoteState?.owner
    if (owner !== undefined && owner.generation === generation) {
      pipRemoteState = Object.freeze({ owner, generation, state: response.state })
    }
    options.onFeedback?.(
      createMediaFeedbackEvent({
        command,
        response,
        source: 'shortcut',
        now: Date.now()
      })
    )
    return response
  }

  async function syncPipPresence(force = false): Promise<void> {
    const media = runtimeReady() ? pictureInPictureMedia(latestLocalMediaState) : null
    const desired = media === null ? null : { mediaId: media.id, active: true as const }
    const previous = pipPresence
    if (
      !force &&
      ((desired === null && previous === null) ||
        (desired !== null &&
          previous?.active === true &&
          previous.mediaId === desired.mediaId &&
          Date.now() - pipPresenceLastSentAt < 1_200))
    ) {
      return
    }
    if (desired === null && previous === null) return
    const payload =
      desired === null && previous !== null
        ? pictureInPicturePresencePayloadSchema.parse({
            state: 'inactive',
            mediaId: previous.mediaId,
            observedAt: Date.now()
          })
        : pictureInPicturePresencePayloadSchema.parse({
            state: 'active',
            mediaId: desired?.mediaId,
            observedAt: Date.now()
          })
    try {
      await runtime.request(
        'media.picture-in-picture.presence',
        payload,
        pictureInPictureOwnerSnapshotSchema
      )
      pipPresence = desired
      pipPresenceLastSentAt = Date.now()
      if (desired !== null) {
        if (pipPresenceHeartbeat === null) {
          pipPresenceHeartbeat = globalThis.setInterval(() => {
            enqueuePipPresenceSync()
          }, 1_500)
        }
      } else if (pipPresenceHeartbeat !== null) {
        globalThis.clearInterval(pipPresenceHeartbeat)
        pipPresenceHeartbeat = null
      }
    } catch {
      // A terminating or restarting background worker will be retried by the
      // next state notification/heartbeat; it must never block media control.
    }
  }

  async function releasePipPresence(): Promise<void> {
    const previous = pipPresence
    if (previous === null || tabId === null) return
    try {
      await runtime.request(
        'media.picture-in-picture.presence',
        pictureInPicturePresencePayloadSchema.parse({
          state: 'inactive',
          mediaId: previous.mediaId,
          observedAt: Date.now()
        }),
        pictureInPictureOwnerSnapshotSchema
      )
      pipPresence = null
      pipPresenceLastSentAt = 0
    } catch {
      // The owner lease is bounded in the background and will expire safely.
    }
  }

  function enqueuePipPresenceSync(force = false): void {
    pipPresenceQueue = pipPresenceQueue.then(() => syncPipPresence(force)).catch(() => undefined)
  }

  const remoteHotkeyCommands = new Set([
    'media.toggle-play',
    'media.seek-backward-5',
    'media.seek-forward-5',
    'media.seek-backward-30',
    'media.seek-forward-30',
    'media.volume-down',
    'media.volume-up',
    'media.volume-down-20',
    'media.volume-up-20',
    'media.gain-down',
    'media.gain-up',
    'media.rate-down',
    'media.rate-up',
    'media.rate-1',
    'media.rate-2',
    'media.rate-3',
    'media.rate-4',
    'media.rate-reset',
    'media.toggle-mute',
    'media.picture-in-picture',
    'media.step-frame-forward',
    'media.step-frame-backward'
  ])
  const remoteHotkeyMedia: HotkeyRemoteMediaPort = {
    getState: refreshPipRemoteState,
    peekState: peekPipRemoteState,
    execute: executePipRemoteCommand,
    supportsCommand: (commandId) => remoteHotkeyCommands.has(commandId)
  }

  const getHotkeyMediaState = async (): Promise<MediaPageState> => {
    const localState = await bridge.getMediaState()
    if (routedTencentProxyEnabled()) {
      const globalState = await requestTencentMediaState()
      const active = globalState === null ? null : activeMediaForState(globalState)
      if (globalState !== null && active !== null) {
        hotkeyTarget = active.frameId === frameId ? 'local' : 'routed-frame'
        latestHotkeyMediaState = globalState
        return globalState
      }
    }
    if (hasRoutableActiveMedia(localState)) {
      hotkeyTarget = 'local'
      latestHotkeyMediaState = localState
      return localState
    }
    try {
      const routedState = await runtime.request('media.get-state', {}, mediaPageStateSchema)
      if (hasRoutableActiveMedia(routedState)) {
        hotkeyTarget = 'routed-frame'
        latestHotkeyMediaState = routedState
        return routedState
      }
    } catch {
      // A local empty state remains authoritative when no sibling frame is routable.
    }
    hotkeyTarget = 'local'
    latestHotkeyMediaState = localState
    return localState
  }
  const executeHotkeyCommand = async (
    command: MediaCommand
  ): Promise<MediaCommandResultResponse> => {
    if (hotkeyTarget !== 'routed-frame') {
      return executeMediaCommand(command, { source: 'shortcut' })
    }
    hotkeyTarget = 'local'
    const response = await executeRoutedMediaCommand(command, { source: 'shortcut' })
    consumeCaptureArtifact(response)
    return response
  }
  const hotkeys = new HotkeyController(
    hotkeySource,
    {
      getState: getHotkeyMediaState,
      peekState: () =>
        latestMediaState !== null && hasRoutableActiveMedia(latestMediaState)
          ? latestMediaState
          : latestHotkeyMediaState,
      execute: executeHotkeyCommand,
      toggleSiteRestoreProgress,
      remote: remoteHotkeyMedia
    },
    {
      ...effectiveSettings
    }
  )
  let settingsTeardown: Teardown | null = null
  let runtimeReconnectTeardown: Teardown | null = null
  let refreshSettings: () => Promise<void> = () => Promise.resolve()
  let settingsRefresh: Promise<void> | null = null
  let runtimeRecovery: Promise<void> | null = null
  let runtimeRecoveryPending = false
  let lastFrameReport = ''
  let frameReportHeartbeat: ReturnType<typeof globalThis.setInterval> | null = null
  let routedMediaRefreshHeartbeat: ReturnType<typeof globalThis.setInterval> | null = null
  let hotkeyStateRefreshHeartbeat: ReturnType<typeof globalThis.setInterval> | null = null

  const routedTencentProxyEnabled = (): boolean =>
    isTopFrame && tencentVideoSiteOriginForUrl(settingsOrigin) !== null

  const requestTencentMediaState = async (): Promise<MediaPageState | null> => {
    if (!routedTencentProxyEnabled()) return null
    try {
      const state = await runtime.request('media.get-state', {}, mediaPageStateSchema)
      return hasRoutableActiveMedia(state) ? state : null
    } catch {
      return null
    }
  }

  const routedTencentMediaState = async (): Promise<MediaPageState | null> => {
    const state = await requestTencentMediaState()
    const active = state === null ? null : activeMediaForState(state)
    return state !== null && active !== null && active.frameId !== frameId ? state : null
  }

  async function applyMediaAuthorityPolicy(policy: MediaAuthorityPolicy): Promise<boolean> {
    if (
      !mediaReady ||
      (policy.playbackRate === appliedAuthorityPolicy.playbackRate &&
        policy.volume === appliedAuthorityPolicy.volume &&
        policy.currentTime === appliedAuthorityPolicy.currentTime)
    )
      return true
    try {
      const accepted = await bridge.configureAuthority(policy)
      if (accepted) appliedAuthorityPolicy = policy
      return accepted
    } catch {
      return false
    }
  }

  async function applyExperimentalMediaPolicy(policy: ExperimentalMediaPolicy): Promise<boolean> {
    if (!mediaReady || policy.mediaDownload === appliedExperimentalPolicy.mediaDownload) {
      return true
    }
    try {
      if (policy.mediaDownload) {
        if (!(await ensureExperimentalMain())) return false
        if (!(await bridge.configure(frameId, settingsOrigin, true))) return false
      }
      const accepted = await bridge.configureExperimental(policy)
      if (accepted) appliedExperimentalPolicy = policy
      return accepted
    } catch {
      return false
    }
  }

  function applyPageUiHidden(hidden: boolean): SitePageUiVisibilityResponse {
    const result = options.pageUi?.setHidden(hidden) ?? {
      hidden,
      hiddenMediaCount: 0
    }
    pageUiHidden = result.hidden
    notifyRuntimeState()
    return sitePageUiVisibilityResponseSchema.parse(result)
  }

  function createFrameReport(): {
    readonly ready: boolean
    readonly mediaCount: number
    readonly activeMedia: boolean
    readonly anchoredMediaCount: number
    readonly pageUiHidden: boolean
    readonly temporaryDisabled: boolean
  } {
    const localState = latestLocalMediaState
    return {
      ready: runtimeReady(),
      mediaCount: latestLocalMediaState?.media.length ?? 0,
      activeMedia: localState !== null && hasRoutableActiveMedia(localState),
      anchoredMediaCount: Math.max(0, options.getAnchoredMediaCount?.() ?? 0),
      pageUiHidden,
      temporaryDisabled
    }
  }

  function applyFrameRuntimeState(state: {
    readonly stateKnown: boolean
    readonly pageUiHidden: boolean
    readonly temporaryDisabled: boolean
  }): void {
    if (!state.stateKnown) return
    const stateChanged =
      pageUiHidden !== state.pageUiHidden || temporaryDisabled !== state.temporaryDisabled
    if (stateChanged) frameStateRevision += 1
    if (pageUiHidden !== state.pageUiHidden) applyPageUiHidden(state.pageUiHidden)
    if (temporaryDisabled === state.temporaryDisabled) return
    temporaryDisabled = state.temporaryDisabled
    if (temporaryDisabled) {
      void applyMediaAuthorityPolicy(DISABLED_MEDIA_AUTHORITY_POLICY)
      void applyExperimentalMediaPolicy(DISABLED_EXPERIMENTAL_MEDIA_POLICY)
      autoplay.setEnabled(false)
      hotkeys.stop()
      playback.reset()
      playbackPolicies = {}
      policyFeedbackStates.clear()
      clearCachedMediaState()
      notifyRuntimeState()
      return
    }
    void refreshSettings()
  }

  function reportFrameState(force = false): void {
    void sendFrameState(force, false)
  }

  async function sendFrameState(force = false, retryUntilAccepted = false): Promise<void> {
    const attempts = retryUntilAccepted ? 10 : 1
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const topology = createFrameReport()
      const reportKey = JSON.stringify(topology)
      if (!force && reportKey === lastFrameReport) return
      lastFrameReport = reportKey
      const requestRevision = frameStateRevision
      try {
        const accepted = await runtime.request(
          'site.report-frame-state',
          { ...topology, updatedAt: Date.now() },
          frameRuntimeReportResponseSchema
        )
        // A newer explicit state command won while this report was in flight.
        // Its response reflects the old tab state and must not roll the frame
        // back into a disabled or hidden state.
        if (requestRevision !== frameStateRevision) return
        applyFrameRuntimeState(accepted)
        if (!retryUntilAccepted || accepted.accepted || attempt + 1 >= attempts) return
        await delay(50)
        continue
      } catch {
        if (attempt + 1 >= attempts) return
        await delay(50)
      }
    }
  }

  function notifyRuntimeState(): void {
    const snapshot: ContentRuntimeSnapshot = {
      ready: runtimeReady(),
      mediaReady,
      siteEnabled,
      temporaryDisabled,
      pageUiHidden,
      hiddenMediaCount: options.pageUi?.getState().hiddenMediaCount ?? 0,
      settings: effectiveSettings,
      mediaState: latestMediaState,
      playbackPolicies
    }
    options.onRuntimeStateChanged?.(snapshot)
    enqueuePipPresenceSync()
    reportFrameState()
  }

  function recordMediaResponse(response: MediaCommandResultResponse, local = false): void {
    latestMediaState = response.state
    if (local) latestLocalMediaState = response.state
    lastObservedMediaState = response.state
    options.onMediaStateChanged?.(response.state, effectiveSettings)
  }

  function emitCommandFeedback(
    command: MediaCommand,
    response: MediaCommandResultResponse,
    source?: MediaCommandSource
  ): void {
    if (source === 'lifecycle') return
    options.onFeedback?.(
      createMediaFeedbackEvent({
        command,
        response,
        source: source ?? 'overlay',
        now: Date.now()
      })
    )
  }

  function progressInput(): {
    readonly pageUrl: string
    readonly mediaKey: string
  } | null {
    const pageUrl = options.window.location.href
    const identity = createProgressIdentity({
      pageUrl
    })
    if (!identity.ok) return null
    return {
      pageUrl,
      mediaKey: identity.value.mediaKey
    }
  }

  async function publishCrossTab(
    kind: 'playback-started' | 'playback-paused' | 'progress-saved',
    snapshot: MediaPageState['media'][number]
  ): Promise<void> {
    const identity = progressInput()
    if (!identity) return
    try {
      await runtime.request(
        'media.cross-tab.publish',
        {
          kind,
          mediaKey: identity.mediaKey,
          observedAt: Math.max(0, snapshot.updatedAt)
        },
        crossTabPublishResponseSchema
      )
    } catch {
      // Cross-tab delivery is advisory; local media control remains authoritative.
    }
  }

  async function restoreProgress(state: MediaPageState): Promise<void> {
    if (
      !effectiveSettings.media.restoreProgress ||
      effectiveSettings.diagnostics.retainProgressDays <= 0
    ) {
      return
    }
    const active = state.media.find((snapshot) => snapshot.id === state.activeMediaId)
    if (!active || active.metrics.currentTime > 3) return
    const identity = progressInput()
    if (!identity || restoredProgressKeys.has(identity.mediaKey)) return
    restoredProgressKeys.add(identity.mediaKey)
    try {
      const result = await runtime.request(
        'progress.read',
        { pageUrl: identity.pageUrl },
        progressReadResponseSchema
      )
      if (result.privacyBlocked || result.record === null) return
      const position = result.record.positionSeconds
      const duration = active.metrics.duration
      if (position <= 3 || (duration !== null && position >= duration - 5)) return
      const command: MediaCommand = {
        type: 'media.seek',
        mediaId: active.id,
        deltaSeconds: position - active.metrics.currentTime
      }
      const response =
        active.frameId !== frameId && routedTencentProxyEnabled()
          ? await runtime.request('media.execute', { command }, mediaCommandResultResponseSchema)
          : await bridge.executeMediaCommand(command)
      if (!response.result.ok) restoredProgressKeys.delete(identity.mediaKey)
    } catch {
      restoredProgressKeys.delete(identity.mediaKey)
      // Progress restoration must never block media startup.
    }
  }

  async function toggleSiteRestoreProgress(mediaId: MediaId): Promise<void> {
    try {
      const result = await runtime.request(
        'progress.toggle-restore',
        {},
        progressRestoreToggleResponseSchema
      )
      if (result.origin !== settingsOrigin) throw new TypeError('Unexpected site settings origin')
      effectiveSettings = resolveSettings(result.settings.data, settingsOrigin)
      hotkeys.update({
        ...effectiveSettings,
        enabled: effectiveSettings.enabled && !temporaryDisabled
      })
      options.onFeedback?.(
        createRestoreProgressFeedbackEvent({ mediaId, enabled: result.enabled, now: Date.now() })
      )
      notifyRuntimeState()

      if (!result.enabled) return
      const identity = progressInput()
      if (identity !== null) restoredProgressKeys.delete(identity.mediaKey)
      const state = latestMediaState ?? (mediaReady ? await getHotkeyMediaState() : null)
      if (state !== null) await restoreProgress(state)
    } catch {
      options.onFeedback?.(
        createRestoreProgressFeedbackEvent({ mediaId, failed: true, now: Date.now() })
      )
    }
  }

  async function saveProgress(
    snapshot: MediaPageState['media'][number],
    force = false
  ): Promise<void> {
    if (
      !effectiveSettings.media.restoreProgress ||
      effectiveSettings.diagnostics.retainProgressDays <= 0
    ) {
      return
    }
    const identity = progressInput()
    if (!identity) return
    const duration = snapshot.metrics.duration
    if (duration !== null && snapshot.metrics.currentTime >= duration - 5) {
      try {
        await runtime.request(
          'progress.delete',
          { pageUrl: identity.pageUrl },
          progressDeleteResponseSchema
        )
      } catch {
        // Progress is best-effort and must not change command success semantics.
      }
      return
    }
    if (snapshot.metrics.currentTime <= 3) return
    const now = Math.max(0, snapshot.updatedAt)
    const lastSaved = progressSaveAt.get(identity.mediaKey) ?? 0
    if (!force && now - lastSaved < 5_000) return
    progressSaveAt.set(identity.mediaKey, now)
    try {
      const result = await runtime.request(
        'progress.save',
        {
          pageUrl: identity.pageUrl,
          positionSeconds: snapshot.metrics.currentTime,
          durationSeconds: duration
        },
        progressSaveResponseSchema
      )
      if (result.saved) await publishCrossTab('progress-saved', snapshot)
    } catch {
      // Progress is best-effort and must not change command success semantics.
    }
  }

  async function refreshMediaStateFromPage(queueIfBusy = false): Promise<void> {
    if (!mediaReady || temporaryDisabled || !siteEnabled) return
    if (progressRefreshQueued) {
      if (queueIfBusy) progressRefreshPending = true
      return
    }
    progressRefreshQueued = true
    try {
      do {
        progressRefreshPending = false
        try {
          const localState = await bridge.getMediaState()
          latestLocalMediaState = localState
          const routedState = await routedTencentMediaState()
          const state = routedState ?? localState
          latestMediaState = state
          await playback.observe(state)
          autoplay.observe(state)
          await restoreProgress(state)
          const active = state.media.find((snapshot) => snapshot.id === state.activeMediaId)
          const previousActive = lastObservedMediaState?.media.find(
            (snapshot) => snapshot.id === active?.id
          )
          if (active && (active.state === 'active' || active.state === 'paused')) {
            const justPaused = active.state === 'paused' && previousActive?.state !== 'paused'
            await saveProgress(active, justPaused)
          }
          lastObservedMediaState = state
          options.onMediaStateChanged?.(state, effectiveSettings)
          notifyRuntimeState()
        } catch {
          // State notifications can arrive while a page runtime is restarting.
        }
      } while (progressRefreshPending && mediaReady && !temporaryDisabled && siteEnabled)
    } finally {
      progressRefreshQueued = false
    }
  }

  async function executePlaybackLifecycleRate(
    mediaId: MediaId,
    value: number
  ): Promise<MediaCommandResultResponse> {
    const command = { type: 'media.set-rate' as const, mediaId, value }
    const target = latestMediaState?.media.find((media) => media.id === mediaId)
    if (target !== undefined && target.frameId !== frameId && routedTencentProxyEnabled()) {
      return executeRoutedMediaCommand(command, { source: 'lifecycle' })
    }
    return executeBridgeMediaCommand(command)
  }

  async function executeBridgeMediaCommand(command: MediaCommand) {
    const response = await bridge.executeMediaCommand(command)
    if (response.result.ok) {
      const snapshot = response.result.value.snapshot
      if (command.type === 'media.play') await publishCrossTab('playback-started', snapshot)
      if (command.type === 'media.pause') {
        await publishCrossTab('playback-paused', snapshot)
        await saveProgress(snapshot, true)
      }
      if (command.type === 'media.seek' || command.type === 'media.set-rate') {
        await saveProgress(snapshot)
      }
    }
    recordMediaResponse(response, true)
    notifyRuntimeState()
    return response
  }

  async function stageRoutedPlaybackRateIntent(
    command: MediaCommand,
    commandOptions: Readonly<{
      source?: MediaCommandSource
      playbackRateScope?: PlaybackRateWriteScope
    }>
  ): Promise<StagedPlaybackRateIntent | null> {
    if (commandOptions.source === 'lifecycle') return null
    const value = playbackRateIntentValue(command, latestMediaState)
    if (value === null) return null

    const requestedScope = commandOptions.playbackRateScope ?? 'site'
    let appliedScope = requestedScope
    if (requestedScope === 'site') {
      try {
        await runtime.request(
          'playback.set-site-intent',
          {
            value,
            protectAgainstSiteReset: effectiveSettings.policies.protectPlaybackRate
          },
          playbackSiteIntentResponseSchema
        )
      } catch {
        // Preserve the user's choice for this document if durable site storage
        // is temporarily unavailable while a player replaces its frame.
        appliedScope = 'page'
      }
    }
    playback.stageIntent(command.mediaId, value, appliedScope, latestMediaState ?? undefined)
    return { value, scope: appliedScope }
  }

  async function waitForStagedPlaybackRateIntent(
    command: MediaCommand,
    intent: StagedPlaybackRateIntent
  ): Promise<Readonly<{ command: MediaCommand; response: MediaCommandResultResponse }> | null> {
    if (intent.scope === 'media' || !routedTencentProxyEnabled()) return null

    const deadline = Date.now() + 12_000
    while (Date.now() < deadline) {
      const state = await requestTencentMediaState()
      const active = state === null ? null : activeMediaForState(state)
      if (state !== null && active !== null) {
        latestMediaState = state
        lastObservedMediaState = state
        try {
          await playback.observe(state)
        } catch {
          // The coordinator preserves the staged policy and will retry on the
          // next state observation; a transient frame teardown is expected.
        }
        const appliedState = latestMediaState ?? state
        const applied = activeMediaForState(appliedState)
        if (applied !== null && playbackRatesEqual(applied.metrics.playbackRate, intent.value)) {
          const recoveredCommand: MediaCommand = { ...command, mediaId: applied.id }
          return {
            command: recoveredCommand,
            response: {
              result: {
                ok: true,
                value: {
                  commandType: command.type,
                  mediaId: applied.id,
                  changed: true,
                  snapshot: applied
                }
              },
              state: appliedState
            }
          }
        }
      }
      await delay(150)
    }
    return null
  }

  async function executeRoutedMediaCommand(
    command: MediaCommand,
    commandOptions: Readonly<{
      source?: MediaCommandSource
      playbackRateScope?: PlaybackRateWriteScope
    }> = {}
  ): Promise<MediaCommandResultResponse> {
    const send = (targetCommand: MediaCommand): Promise<MediaCommandResultResponse> =>
      runtime.request(
        'media.execute',
        {
          command: targetCommand,
          ...(commandOptions.playbackRateScope === undefined
            ? {}
            : { playbackRateScope: commandOptions.playbackRateScope })
        },
        mediaCommandResultResponseSchema
      )

    const stagedIntent = await stageRoutedPlaybackRateIntent(command, commandOptions)
    let executedCommand = command
    let response: MediaCommandResultResponse | null = null
    let transportError: unknown = null
    try {
      response = await send(executedCommand)
    } catch (error) {
      transportError = error
    }
    if (
      response !== null &&
      !response.result.ok &&
      response.result.error.code === 'MEDIA_NOT_FOUND' &&
      routedTencentProxyEnabled()
    ) {
      const recoveryDeadline = Date.now() + 2_500
      do {
        const globalState = await requestTencentMediaState()
        const active = globalState === null ? null : activeMediaForState(globalState)
        if (globalState !== null && active !== null) {
          latestMediaState = globalState
          lastObservedMediaState = globalState
          executedCommand = { ...command, mediaId: active.id }
          if (active.frameId === frameId) {
            return executeLocalMediaCommand(executedCommand, commandOptions)
          }
          try {
            response = await send(executedCommand)
            transportError = null
          } catch (error) {
            transportError = error
            response = null
          }
          if (
            response !== null &&
            (response.result.ok || response.result.error.code !== 'MEDIA_NOT_FOUND')
          ) {
            break
          }
        }
        if (Date.now() >= recoveryDeadline) break
        await delay(100)
      } while (Date.now() < recoveryDeadline)
    }

    const shouldAwaitStagedIntent =
      stagedIntent !== null &&
      stagedIntent.scope !== 'media' &&
      (response === null ||
        (response.result.ok && !responseReachedPlaybackRateIntent(response, stagedIntent)) ||
        (!response.result.ok &&
          (response.result.error.code === 'MEDIA_NOT_FOUND' ||
            response.result.error.code === 'MEDIA_UNAVAILABLE' ||
            response.result.error.code === 'COMMAND_EXECUTION_FAILED')) ||
        (transportError instanceof RuntimeRequestError &&
          transportError.retryable &&
          ['TARGET_UNAVAILABLE', 'TRANSPORT_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(
            transportError.code
          )))
    if (shouldAwaitStagedIntent) {
      const recovered = await waitForStagedPlaybackRateIntent(command, stagedIntent)
      if (recovered !== null) {
        executedCommand = recovered.command
        response = recovered.response
        transportError = null
      }
    }

    if (response === null) {
      if (transportError instanceof Error) throw transportError
      throw new RuntimeRequestError(
        'TARGET_UNAVAILABLE',
        true,
        'No content frame accepted the command'
      )
    }
    if (
      stagedIntent !== null &&
      stagedIntent.scope !== 'media' &&
      response.result.ok &&
      !responseReachedPlaybackRateIntent(response, stagedIntent)
    ) {
      response = playbackRatePostconditionFailure(executedCommand, response, stagedIntent)
    }
    recordMediaResponse(response)
    emitCommandFeedback(executedCommand, response, commandOptions.source)
    notifyRuntimeState()
    return response
  }

  async function executeLocalMediaCommand(
    command: MediaCommand,
    commandOptions: Readonly<{
      source?: MediaCommandSource
      playbackRateScope?: PlaybackRateWriteScope
    }> = {}
  ) {
    const source = commandOptions.source ?? 'overlay'
    const response = await executeBridgeMediaCommand(command)
    if (
      response.result.ok &&
      (command.type === 'media.set-rate' || command.type === 'media.adjust-rate')
    ) {
      const scope = commandOptions.playbackRateScope ?? 'site'
      let appliedScope = scope
      if (scope === 'site') {
        try {
          await runtime.request(
            'playback.set-site-intent',
            {
              value: response.result.value.snapshot.metrics.playbackRate,
              protectAgainstSiteReset: effectiveSettings.policies.protectPlaybackRate
            },
            playbackSiteIntentResponseSchema
          )
        } catch {
          // The media command remains successful; fall back to the current page session.
          appliedScope = 'page'
        }
      }
      await playback.setIntent(
        command.mediaId,
        response.result.value.snapshot.metrics.playbackRate,
        appliedScope,
        response.state
      )
    }
    emitCommandFeedback(command, response, source)
    return response
  }

  async function executeTopLevelPageAction(
    command: MediaCommand,
    commandOptions: Readonly<{
      source?: MediaCommandSource
      playbackRateScope?: PlaybackRateWriteScope
    }> = {}
  ): Promise<MediaCommandResultResponse | null> {
    if (command.type !== 'media.play-next' || !isTopFrame) {
      return null
    }

    let state = latestMediaState ?? latestLocalMediaState
    let snapshot =
      state?.media.find((media) => media.id === command.mediaId) ??
      (state === null ? null : activeMediaForState(state))
    if (state === null || snapshot === null) {
      state = (await requestTencentMediaState()) ?? (await bridge.getMediaState())
      snapshot =
        state.media.find((media) => media.id === command.mediaId) ?? activeMediaForState(state)
    }
    if (snapshot === null) return null

    const action = await bridge.executePageAction('next')
    if (!action.handled) return null
    const response: MediaCommandResultResponse = {
      result: {
        ok: true,
        value: {
          commandType: command.type,
          mediaId: snapshot.id,
          changed: true,
          snapshot
        }
      },
      state
    }
    latestMediaState = state
    lastObservedMediaState = state
    emitCommandFeedback({ ...command, mediaId: snapshot.id }, response, commandOptions.source)
    notifyRuntimeState()
    return response
  }

  async function executeMediaCommand(
    command: MediaCommand,
    commandOptions: Readonly<{
      source?: MediaCommandSource
      playbackRateScope?: PlaybackRateWriteScope
    }> = {}
  ): Promise<MediaCommandResultResponse> {
    const optionalCapabilityFailure = blockedOptionalCapability(command)
    if (optionalCapabilityFailure !== null) return optionalCapabilityFailure
    const experimentalDownloadFailure = blockedExperimentalDownload(command)
    if (experimentalDownloadFailure !== null) return experimentalDownloadFailure
    const pageActionResponse = await executeTopLevelPageAction(command, commandOptions)
    if (pageActionResponse !== null) return pageActionResponse
    const target = latestMediaState?.media.find((media) => media.id === command.mediaId)
    const response =
      target !== undefined && target.frameId !== frameId && routedTencentProxyEnabled()
        ? await executeRoutedMediaCommand(command, commandOptions)
        : command.type === 'media.download'
          ? await executeExperimentalDownload(command, commandOptions)
          : await executeLocalMediaCommand(command, commandOptions)
    consumeCaptureArtifact(response)
    return response
  }

  function blockedOptionalCapability(command: MediaCommand): MediaCommandResultResponse | null {
    const requiresAudioGain =
      command.type === 'media.set-gain' || command.type === 'media.adjust-gain'
    if (!requiresAudioGain || effectiveSettings.policies.allowAcousticGain === true) return null
    const state = latestMediaState ?? latestLocalMediaState
    if (state === null) {
      throw new PageBridgeError('PAGE_RUNTIME_UNAVAILABLE', 'Content runtime unavailable')
    }
    return mediaCommandResultResponseSchema.parse({
      result: {
        ok: false,
        error: {
          code: 'CAPABILITY_UNAVAILABLE',
          messageKey: 'command.error.capabilityUnavailable',
          context: {
            mediaId: command.mediaId,
            capability: 'audioGain',
            phase: 'content-policy'
          }
        }
      },
      state
    })
  }

  function blockedExperimentalDownload(command: MediaCommand): MediaCommandResultResponse | null {
    if (
      command.type !== 'media.download' ||
      (effectiveSettings.policies.allowExperimental && effectiveSettings.download.enabled)
    ) {
      return null
    }
    const state = latestMediaState ?? latestLocalMediaState
    if (state === null) {
      throw new PageBridgeError('PAGE_RUNTIME_UNAVAILABLE', 'Content runtime unavailable')
    }
    return mediaCommandResultResponseSchema.parse({
      result: {
        ok: false,
        error: {
          code: 'DOWNLOAD_BLOCKED',
          messageKey: 'download.error.blocked',
          context: { mediaId: command.mediaId, phase: 'content-policy' }
        }
      },
      state
    })
  }

  function consumeCaptureArtifact(response: MediaCommandResultResponse): void {
    if (!response.result.ok || response.result.value.artifact === undefined) return
    try {
      options.onCaptureArtifact?.(response.result.value.artifact)
    } catch {
      // Capture remains successful even when the browser rejects the local download effect.
    }
  }

  function clearPendingMediaDownload(intentId: string): PendingMediaDownloadIntent | null {
    const pending = pendingMediaDownloads.get(intentId) ?? null
    if (pending === null) return null
    globalThis.clearTimeout(pending.timeoutHandle)
    pendingMediaDownloads.delete(intentId)
    return pending
  }

  async function deliverMediaDownloadArtifacts(
    artifacts: readonly MediaDownloadArtifact[]
  ): Promise<boolean> {
    return (await options.onMediaDownloadArtifacts?.(artifacts)) !== false
  }

  function reportPendingDownloadFailure(
    pending: PendingMediaDownloadIntent,
    event: Extract<MediaDownloadEvent, { type: 'failed' }>
  ): void {
    const state = latestLocalMediaState ?? latestMediaState
    if (state !== null) {
      const response = mediaDownloadFailureResponse(
        pending.mediaId,
        state,
        event.code,
        'content-download-sink'
      )
      options.onFeedback?.(
        createMediaFeedbackEvent({
          command: pending.command,
          response,
          source: pending.source,
          now: Date.now()
        })
      )
    }
    options.onMediaDownloadFailure?.(event)
  }

  function handleMediaDownloadEvent(event: MediaDownloadEvent): void {
    const intentId = event.type === 'ready' ? event.preparation.intentId : event.intentId
    const pending = clearPendingMediaDownload(intentId)
    if (pending === null) return
    if (event.type === 'ready') {
      void deliverMediaDownloadArtifacts(event.preparation.artifacts)
        .then((delivered) => {
          if (delivered) return
          reportPendingDownloadFailure(pending, {
            type: 'failed',
            intentId,
            code: 'DOWNLOAD_CANCELLED',
            message: 'Media download was cancelled by the user'
          })
        })
        .catch(() => {
          reportPendingDownloadFailure(pending, {
            type: 'failed',
            intentId,
            code: 'DOWNLOAD_FAILED',
            message: 'The browser could not save the prepared media'
          })
        })
      return
    }
    reportPendingDownloadFailure(pending, event)
  }

  async function executeExperimentalDownload(
    command: Extract<MediaCommand, { type: 'media.download' }>,
    commandOptions: Readonly<{ source?: MediaCommandSource }> = {}
  ): Promise<MediaCommandResultResponse> {
    let state = latestLocalMediaState ?? latestMediaState
    if (state === null || !state.media.some((media) => media.id === command.mediaId)) {
      state = await bridge.getMediaState()
    }
    const snapshot = state.media.find((media) => media.id === command.mediaId)
    if (snapshot === undefined) {
      return mediaDownloadFailureResponse(
        command.mediaId,
        state,
        'DOWNLOAD_UNAVAILABLE',
        'content-download'
      )
    }

    if (!(await ensureExperimentalMain())) {
      return mediaDownloadFailureResponse(
        command.mediaId,
        state,
        'DOWNLOAD_BLOCKED',
        'content-download'
      )
    }
    if (!(await bridge.configure(frameId, settingsOrigin, true))) {
      return mediaDownloadFailureResponse(
        command.mediaId,
        state,
        'DOWNLOAD_UNAVAILABLE',
        'content-download'
      )
    }

    const intentId = createRequestId()
    const timeoutHandle = globalThis.setTimeout(() => {
      const pending = clearPendingMediaDownload(intentId)
      if (pending !== null) {
        reportPendingDownloadFailure(pending, {
          type: 'failed',
          intentId,
          code: 'DOWNLOAD_FAILED',
          message: 'Media download intent expired before the stream completed'
        })
      }
    }, 65 * 60_000)
    pendingMediaDownloads.set(intentId, {
      mediaId: command.mediaId,
      command,
      source: commandOptions.source ?? 'overlay',
      timeoutHandle
    })

    let response: MediaCommandResultResponse
    try {
      const preparation = await bridge.prepareDownload(command.mediaId, intentId)
      if (preparation.intentId !== intentId) {
        throw new PageBridgeError('INVALID_RESPONSE', 'Media download intent mismatch')
      }
      if (preparation.disposition === 'started') {
        const pending = clearPendingMediaDownload(intentId)
        if (pending !== null) {
          void deliverMediaDownloadArtifacts(preparation.artifacts)
            .then((delivered) => {
              if (delivered) return
              reportPendingDownloadFailure(pending, {
                type: 'failed',
                intentId,
                code: 'DOWNLOAD_CANCELLED',
                message: 'Media download was cancelled by the user'
              })
            })
            .catch(() => {
              reportPendingDownloadFailure(pending, {
                type: 'failed',
                intentId,
                code: 'DOWNLOAD_FAILED',
                message: 'The browser could not save the prepared media'
              })
            })
        }
      }
      const latestState = await bridge.getMediaState().catch(() => state)
      const latestSnapshot =
        latestState.media.find((media) => media.id === command.mediaId) ?? snapshot
      response = mediaCommandResultResponseSchema.parse({
        result: {
          ok: true,
          value: {
            commandType: command.type,
            mediaId: command.mediaId,
            changed: preparation.disposition === 'started',
            snapshot: latestSnapshot
          }
        },
        state: latestState
      })
    } catch (error) {
      clearPendingMediaDownload(intentId)
      const code =
        error instanceof RuntimeRequestError && error.code === 'PERMISSION_DENIED'
          ? 'DOWNLOAD_BLOCKED'
          : error instanceof PageBridgeError &&
              (error.code === 'BRIDGE_UNAVAILABLE' ||
                error.code === 'PAGE_RUNTIME_UNAVAILABLE' ||
                error.code === 'REQUEST_TIMEOUT')
            ? 'DOWNLOAD_UNAVAILABLE'
            : 'DOWNLOAD_FAILED'
      response = mediaDownloadFailureResponse(command.mediaId, state, code, 'content-download')
    }

    recordMediaResponse(response, true)
    emitCommandFeedback(command, response, commandOptions.source)
    notifyRuntimeState()
    return response
  }

  async function cancelMediaDownload(mediaId: MediaId): Promise<boolean> {
    if (!runtimeReady()) return false
    try {
      return await bridge.cancelDownload(mediaId)
    } catch {
      return false
    }
  }

  refreshSettings = (): Promise<void> => {
    if (settingsRefresh !== null) return settingsRefresh
    settingsRefresh = (async () => {
      try {
        const snapshot = await runtime.request('settings.get', {}, settingsSnapshotResponseSchema)
        const currentSettings = resolveSettings(snapshot.settings.data, settingsOrigin)
        effectiveSettings = currentSettings
        const siteOverride = snapshot.settings.data.sites[settingsOrigin]
        siteEnabled = currentSettings.enabled
        await applyMediaAuthorityPolicy(
          siteEnabled && !temporaryDisabled
            ? Object.freeze({
                playbackRate: currentSettings.policies.protectPlaybackRate,
                volume: currentSettings.policies.protectVolume,
                currentTime: currentSettings.policies.protectCurrentTime
              })
            : DISABLED_MEDIA_AUTHORITY_POLICY
        )
        await applyExperimentalMediaPolicy(
          Object.freeze({
            mediaDownload:
              siteEnabled &&
              !temporaryDisabled &&
              currentSettings.policies.allowExperimental &&
              currentSettings.download.enabled
          })
        )
        autoplay.setEnabled(
          currentSettings.policies.allowAutoplay === true &&
            siteEnabled &&
            !temporaryDisabled &&
            isTopFrame
        )
        hotkeys.update({
          ...currentSettings,
          enabled: currentSettings.enabled && !temporaryDisabled
        })
        if (!siteEnabled || temporaryDisabled) {
          hotkeys.stop()
          autoplay.setEnabled(false)
          playback.reset()
          playbackPolicies = {}
          policyFeedbackStates.clear()
          clearCachedMediaState()
          notifyRuntimeState()
          return
        }
        await playback.updateSettings({
          globalDefault: snapshot.settings.data.global.media.defaultPlaybackRate,
          siteDefault: siteOverride?.media?.defaultPlaybackRate,
          protectAgainstSiteReset: currentSettings.policies.protectPlaybackRate
        })
        // Prime only the hotkey routing snapshot before subscribing to key events.
        // Running the full lifecycle refresh here would apply playback policy and
        // progress side effects earlier than existing consumers expect.
        let initialHotkeyState: MediaPageState | undefined
        if (mediaReady) {
          try {
            initialHotkeyState = await getHotkeyMediaState()
          } catch {
            // A settling or replaced frame will be recovered by the normal refresh.
          }
        }
        if (mediaReady) {
          hotkeys.start(initialHotkeyState)
        } else hotkeys.stop()
        notifyRuntimeState()
        if (mediaReady) void refreshMediaStateFromPage()
      } catch {
        siteEnabled = false
        autoplay.setEnabled(false)
        await applyMediaAuthorityPolicy(DISABLED_MEDIA_AUTHORITY_POLICY)
        await applyExperimentalMediaPolicy(DISABLED_EXPERIMENTAL_MEDIA_POLICY)
        clearCachedMediaState()
        hotkeys.stop()
        notifyRuntimeState()
      }
    })().finally(() => {
      settingsRefresh = null
    })
    return settingsRefresh
  }

  function recoverRuntimeConnection(): Promise<void> {
    if (runtimeRecovery !== null) {
      runtimeRecoveryPending = true
      return runtimeRecovery
    }
    const refreshAlreadyInProgress = settingsRefresh
    runtimeRecovery = (async () => {
      if (refreshAlreadyInProgress !== null) await refreshAlreadyInProgress
      do {
        runtimeRecoveryPending = false
        appliedExperimentalPolicy = DISABLED_EXPERIMENTAL_MEDIA_POLICY
        await refreshSettings()
        await refreshMediaStateFromPage()
        await sendFrameState(true, true)
      } while (runtimeRecoveryPending)
    })().finally(() => {
      runtimeRecovery = null
    })
    return runtimeRecovery
  }

  await refreshSettings()
  void refreshPipRemoteState()
  const handleVisibilityChange = (): void => {
    autoplay.setDocumentVisible(options.document.visibilityState !== 'hidden')
  }
  options.document.addEventListener('visibilitychange', handleVisibilityChange, true)
  settingsTeardown =
    options.subscribeSettings?.(() => {
      void refreshSettings()
    }) ?? null
  runtimeReconnectTeardown =
    options.subscribeRuntimeReconnect?.(sessionId, () => {
      void recoverRuntimeConnection()
    }) ?? null
  frameReportHeartbeat = globalThis.setInterval(() => reportFrameState(true), 10_000)
  if (routedTencentProxyEnabled()) {
    routedMediaRefreshHeartbeat = globalThis.setInterval(() => {
      void refreshMediaStateFromPage(true)
    }, 1_000)
  }
  if (isTopFrame) {
    hotkeyStateRefreshHeartbeat = globalThis.setInterval(() => {
      if (latestLocalMediaState === null || !hasRoutableActiveMedia(latestLocalMediaState)) {
        hotkeys.refresh()
      }
    }, 1_000)
  }
  if (mediaReady) {
    stateSubscription = bridge.subscribeMediaStateChanged(() => {
      void refreshMediaStateFromPage(true)
    })
    void refreshMediaStateFromPage()
  }

  const handleTabMessage = async (
    rawMessage: unknown,
    sender: ContentMessageSender
  ): Promise<unknown> => {
    const request = parseTabRequest(rawMessage)
    if (!request) return null
    if (sender.id !== options.extensionId) {
      return createTabError(request, 'UNAUTHORIZED_SOURCE', 'protocol.error.unauthorized-source')
    }
    if (!tabReplayGuard.accept(`background:${sessionId}`, request.requestId)) {
      return createTabError(request, 'REPLAY_DETECTED', 'protocol.error.replay-detected')
    }
    try {
      if (request.type === 'media.picture-in-picture.owner-changed') {
        const payload = pictureInPictureOwnerSnapshotSchema.safeParse(request.payload)
        if (!payload.success) {
          return createTabError(request, 'INVALID_PAYLOAD', 'protocol.error.invalid-payload')
        }
        clearPipRemoteState()
        if (
          payload.data.owner !== null &&
          (tabId === null ||
            payload.data.owner.tabId !== tabId ||
            payload.data.owner.frameId !== frameId)
        ) {
          void refreshPipRemoteState()
        }
        hotkeys.refresh()
        return createTabSuccess(request, { accepted: true })
      }
      if (request.type === 'media.cross-tab.event') {
        const payload = crossTabEventPayloadSchema.safeParse(request.payload)
        if (!payload.success) {
          return createTabError(request, 'INVALID_PAYLOAD', 'protocol.error.invalid-payload')
        }
        const event = crossTabMediaEventSchema.parse(payload.data.event)
        options.onCrossTabEvent?.(event)
        return createTabSuccess(request, { accepted: true })
      }
      if (request.type === 'site.get-state') {
        const ready = runtimeReady()
        const state = ready ? await bridge.getMediaState() : null
        const response = siteRuntimeStateResponseSchema.parse({
          ready,
          temporaryDisabled,
          pageUiHidden,
          hiddenMediaCount: options.pageUi?.getState().hiddenMediaCount ?? 0,
          mediaCount: state?.media.length ?? 0,
          activeMedia: state?.activeMediaId !== null && state?.activeMediaId !== undefined,
          adapters: state?.adapters ?? [],
          activePlaybackPolicy:
            state?.activeMediaId === null || state?.activeMediaId === undefined
              ? null
              : (playbackPolicies[state.activeMediaId] ?? null)
        })
        return createTabSuccess(request, response)
      }
      if (request.type === 'site.refresh-frame-state') {
        if (!emptyPayloadSchema.safeParse(request.payload).success) {
          return createTabError(request, 'INVALID_PAYLOAD', 'protocol.error.invalid-payload')
        }
        await sendFrameState(true, true)
        return createTabSuccess(request, { accepted: true })
      }
      if (request.type === 'site.set-temporary-disabled') {
        const payload = siteTemporaryDisablePayloadSchema.safeParse(request.payload)
        if (!payload.success) {
          return createTabError(request, 'INVALID_PAYLOAD', 'protocol.error.invalid-payload')
        }
        const commandIssuedAt = payload.data.commandIssuedAt
        const commandRevision = payload.data.commandRevision
        if (
          commandIssuedAt !== undefined &&
          commandRevision !== undefined &&
          (commandIssuedAt < latestTemporaryDisableIssuedAt ||
            (commandIssuedAt === latestTemporaryDisableIssuedAt &&
              commandRevision < latestTemporaryDisableRevision))
        ) {
          return createTabSuccess(
            request,
            siteTemporaryDisableResponseSchema.parse({ disabled: temporaryDisabled })
          )
        }
        if (commandIssuedAt !== undefined && commandRevision !== undefined) {
          latestTemporaryDisableIssuedAt = commandIssuedAt
          latestTemporaryDisableRevision = commandRevision
        }
        frameStateRevision += 1
        temporaryDisabled = payload.data.disabled
        if (temporaryDisabled) {
          await applyMediaAuthorityPolicy(DISABLED_MEDIA_AUTHORITY_POLICY)
          await applyExperimentalMediaPolicy(DISABLED_EXPERIMENTAL_MEDIA_POLICY)
          autoplay.setEnabled(false)
          hotkeys.stop()
          playback.reset()
          playbackPolicies = {}
          policyFeedbackStates.clear()
          clearCachedMediaState()
        } else {
          await refreshSettings()
          // Re-enable keeps the page runtime alive, but temporary disable
          // intentionally clears the cached media state. Hydrate it again so
          // overlays and routed controls can remount without waiting for a
          // future media event.
          await refreshMediaStateFromPage()
        }
        notifyRuntimeState()
        return createTabSuccess(
          request,
          siteTemporaryDisableResponseSchema.parse({ disabled: temporaryDisabled })
        )
      }
      if (request.type === 'site.set-page-ui-hidden') {
        const payload = sitePageUiVisibilityPayloadSchema.safeParse(request.payload)
        if (!payload.success) {
          return createTabError(request, 'INVALID_PAYLOAD', 'protocol.error.invalid-payload')
        }
        return createTabSuccess(request, applyPageUiHidden(payload.data.hidden))
      }
      if (request.type === 'site.permission-revoked') {
        temporaryDisabled = true
        autoplay.setEnabled(false)
        await applyMediaAuthorityPolicy(DISABLED_MEDIA_AUTHORITY_POLICY)
        await applyExperimentalMediaPolicy(DISABLED_EXPERIMENTAL_MEDIA_POLICY)
        hotkeys.stop()
        mediaReady = false
        stateSubscription?.()
        stateSubscription = null
        playback.teardown()
        bridge.stop()
        appliedExperimentalPolicy = DISABLED_EXPERIMENTAL_MEDIA_POLICY
        clearCachedMediaState()
        notifyRuntimeState()
        return createTabSuccess(request, { disabled: true })
      }
      if (!runtimeReady()) {
        return createTabError(
          request,
          'PAGE_RUNTIME_UNAVAILABLE',
          'media.error.runtime-unavailable',
          true
        )
      }
      if (request.type === 'media.get-state') {
        if (!mediaGetStatePayloadSchema.safeParse(request.payload).success) {
          return createTabError(request, 'INVALID_PAYLOAD', 'protocol.error.invalid-payload')
        }
        return createTabSuccess(request, mediaPageStateSchema.parse(await bridge.getMediaState()))
      }

      const payload = mediaExecutePayloadSchema.safeParse(request.payload)
      if (!payload.success) {
        return createTabError(request, 'INVALID_PAYLOAD', 'protocol.error.invalid-payload')
      }
      const commandOptions = {
        source: 'popup' as const,
        ...(payload.data.playbackRateScope === undefined
          ? {}
          : { playbackRateScope: payload.data.playbackRateScope })
      }
      const response =
        blockedOptionalCapability(payload.data.command) ??
        blockedExperimentalDownload(payload.data.command) ??
        (await executeTopLevelPageAction(payload.data.command, commandOptions)) ??
        (payload.data.command.type === 'media.download'
          ? await executeExperimentalDownload(payload.data.command, commandOptions)
          : await executeLocalMediaCommand(payload.data.command, commandOptions))
      return createTabSuccess(request, mediaCommandResultResponseSchema.parse(response))
    } catch (error) {
      return bridgeFailure(request, error)
    }
  }

  return {
    handleTabMessage,
    getMediaState: async () => {
      if (!runtimeReady()) {
        throw new PageBridgeError('PAGE_RUNTIME_UNAVAILABLE', 'Content runtime unavailable')
      }
      return latestMediaState ?? (await bridge.getMediaState())
    },
    executeMediaCommand: async (command, commandOptions) => {
      if (!runtimeReady()) {
        throw new PageBridgeError('PAGE_RUNTIME_UNAVAILABLE', 'Content runtime unavailable')
      }
      return executeMediaCommand(command, commandOptions)
    },
    setPageUiHidden: async (hidden) => {
      const result = await runtime.request(
        'site.set-page-ui-hidden',
        { hidden },
        sitePageUiVisibilityResponseSchema
      )
      return applyPageUiHidden(result.hidden)
    },
    cancelMediaDownload,
    reportFrameState: () => reportFrameState(),
    teardown: () => {
      pipPresenceQueue = pipPresenceQueue.then(() => releasePipPresence()).catch(() => undefined)
      if (pipPresenceHeartbeat !== null) {
        globalThis.clearInterval(pipPresenceHeartbeat)
        pipPresenceHeartbeat = null
      }
      try {
        settingsTeardown?.()
      } catch {
        // Browser-owned listener APIs may already be invalidated during extension reload.
      }
      settingsTeardown = null
      try {
        runtimeReconnectTeardown?.()
      } catch {
        // The lifetime port may already have been destroyed with the old context.
      }
      runtimeReconnectTeardown = null
      if (frameReportHeartbeat !== null) globalThis.clearInterval(frameReportHeartbeat)
      frameReportHeartbeat = null
      if (routedMediaRefreshHeartbeat !== null) {
        globalThis.clearInterval(routedMediaRefreshHeartbeat)
      }
      routedMediaRefreshHeartbeat = null
      if (hotkeyStateRefreshHeartbeat !== null) {
        globalThis.clearInterval(hotkeyStateRefreshHeartbeat)
      }
      hotkeyStateRefreshHeartbeat = null
      stateSubscription?.()
      stateSubscription = null
      downloadEventSubscription?.()
      downloadEventSubscription = null
      for (const intentId of [...pendingMediaDownloads.keys()]) {
        clearPendingMediaDownload(intentId)
      }
      hotkeys.stop()
      options.document.removeEventListener('visibilitychange', handleVisibilityChange, true)
      autoplay.teardown()
      playback.teardown()
      void runtime
        .request(
          'site.report-frame-state',
          {
            ready: false,
            mediaCount: 0,
            activeMedia: false,
            anchoredMediaCount: 0,
            pageUiHidden,
            temporaryDisabled,
            updatedAt: Date.now()
          },
          frameRuntimeReportResponseSchema
        )
        .catch(() => undefined)
      bridge.stop()
    }
  }
}
