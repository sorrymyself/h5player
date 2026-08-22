import type { ContentScriptRegistrationPort, PermissionsPort, TabsPort } from '../ports/browser'
import type { SettingsService } from '../settings/settings-service'
import { resolveSettings, toHostPermissionPattern } from '../../domain/settings'
import { createTabRequest, parseTabResponse, type TabRequestType } from '../../shared/tab-protocol'
import {
  siteRuntimeStateResponseSchema,
  sitePageUiVisibilityResponseSchema,
  siteTemporaryDisableResponseSchema
} from './contracts'
import type {
  SiteContextResponse,
  SiteReconcileResponse,
  SiteRuntimeStateResponse,
  SiteTemporaryDisableResponse
} from './contracts'
import type { FrameRuntimeRegistry } from './frame-runtime-registry'

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function supportedGrantedOrigins(origins: readonly string[]): readonly string[] {
  return origins.filter(
    (origin) =>
      origin === '<all_urls>' || origin.startsWith('http://') || origin.startsWith('https://')
  )
}

const FRAME_RECOVERY_ATTEMPTS = 3
const FRAME_RECOVERY_WAIT_MS = 75
const FRAME_MESSAGE_TIMEOUT_MS = 3_000
const CHILD_CONTROL_BROADCAST_TIMEOUT_MS = 1_500

type TabRuntimeState = Readonly<{
  pageUiHidden: boolean
  temporaryDisabled: boolean
  sessionId: string
}>

export class SiteAccessService {
  private reconciliationQueue: Promise<void> = Promise.resolve()
  private readonly tabControlQueues = new Map<number, Promise<void>>()
  private readonly tabControlRevisions = new Map<number, number>()
  private readonly tabControlFrameIds = new Map<number, Set<number>>()
  private readonly tabRuntimeState = new Map<number, TabRuntimeState>()

  constructor(
    private readonly settings: SettingsService,
    private readonly tabs: TabsPort,
    private readonly permissions: PermissionsPort,
    private readonly registration: ContentScriptRegistrationPort,
    private readonly frames: FrameRuntimeRegistry
  ) {}

  async initialize(): Promise<void> {
    await this.reconcile(false)
    await this.recoverFrameStates()
  }

  async recoverFrameStates(): Promise<void> {
    const tabs = await this.tabs.list()
    await Promise.allSettled(tabs.map((tab) => this.recoverTabFrameState(tab.id)))
  }

  runtimeStateForTab(tabId: number): Readonly<{
    stateKnown: boolean
    pageUiHidden: boolean
    temporaryDisabled: boolean
  }> {
    const state = this.tabRuntimeState.get(tabId)
    if (state === undefined) {
      return {
        stateKnown: false,
        pageUiHidden: false,
        temporaryDisabled: false
      }
    }
    return {
      stateKnown: true,
      pageUiHidden: state.pageUiHidden,
      temporaryDisabled: state.temporaryDisabled
    }
  }

  recordTopFrameRuntimeState(
    tabId: number,
    sessionId: string,
    state: Readonly<{ pageUiHidden: boolean; temporaryDisabled: boolean }>
  ): boolean {
    const current = this.tabRuntimeState.get(tabId)
    // A content session is page-lifetime scoped. Preserve explicit state for
    // reconnects of the same session, but reset tab-local state when a new top
    // document owns frame 0 after navigation or reinjection.
    if (current?.sessionId === sessionId) return false
    this.tabRuntimeState.set(tabId, { ...state, sessionId })
    return state.pageUiHidden || state.temporaryDisabled
  }

  async refreshFrameStates(tabId: number): Promise<void> {
    await Promise.allSettled([
      this.sendMessageWithTimeout(
        tabId,
        createTabRequest('site.refresh-frame-state', {}),
        undefined
      )
    ])
  }

  async injectExperimentalMain(tabId: number, frameId: number): Promise<void> {
    await this.registration.injectExperimentalMain(tabId, frameId)
  }

  private async recoverTabFrameState(tabId: number): Promise<void> {
    for (let attempt = 0; attempt < FRAME_RECOVERY_ATTEMPTS; attempt += 1) {
      const report = this.frames.waitForReport(
        tabId,
        FRAME_RECOVERY_WAIT_MS,
        (_identity, state) => state.ready && state.mediaCount > 0
      )
      await Promise.allSettled([
        this.sendMessageWithTimeout(
          tabId,
          createTabRequest('site.refresh-frame-state', {}),
          undefined
        )
      ])
      if (await report) return
    }
  }

  clearTabRuntimeState(tabId: number): void {
    this.tabRuntimeState.delete(tabId)
    this.tabControlRevisions.delete(tabId)
    this.tabControlFrameIds.delete(tabId)
  }

  reconcile(bootstrapCurrentTab: boolean): Promise<SiteReconcileResponse> {
    const operation = this.reconciliationQueue.then(
      () => this.performReconcile(bootstrapCurrentTab),
      () => this.performReconcile(bootstrapCurrentTab)
    )
    this.reconciliationQueue = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  private async performReconcile(bootstrapCurrentTab: boolean): Promise<SiteReconcileResponse> {
    const granted = supportedGrantedOrigins((await this.permissions.getAll()).origins)
    await this.registration.reconcile(granted)

    let bootstrapped = false
    const active = await this.tabs.getActive()
    // Permission revocation can affect background tabs as well as the active
    // tab. Remove their frame owners before any later broadcast or recovery
    // can address an obsolete content session.
    const tabs = await this.tabs.list()
    await Promise.all(
      tabs
        .filter((tab) => tab.id !== active?.id && tab.url && isWebUrl(tab.url))
        .map(async (tab) => {
          const pattern = toHostPermissionPattern(tab.url as string)
          const allowed =
            pattern.ok && (await this.permissions.contains({ origins: [pattern.value] }))
          if (allowed) return
          await this.registration.teardown(tab.id)
          this.frames.removeTab(tab.id)
          this.clearTabRuntimeState(tab.id)
        })
    )
    if (active?.url && isWebUrl(active.url)) {
      const pattern = toHostPermissionPattern(active.url)
      const allowed = pattern.ok && (await this.permissions.contains({ origins: [pattern.value] }))
      if (allowed) {
        if (bootstrapCurrentTab) {
          await this.registration.bootstrap(active.id)
          bootstrapped = true
        }
      } else {
        await this.registration.teardown(active.id)
        this.frames.removeTab(active.id)
        this.clearTabRuntimeState(active.id)
      }
    }

    return { registeredOrigins: granted.length, bootstrapped }
  }

  async getContext(): Promise<SiteContextResponse> {
    const snapshot = await this.settings.getSnapshot()
    if (!snapshot.ok) throw new Error(snapshot.error.code)
    const active = await this.tabs.getActive()
    if (!active) {
      return {
        tab: null,
        permission: 'unknown',
        enabled: snapshot.value.settings.data.global.enabled,
        temporaryDisabled: false,
        mediaCount: 0,
        activeMedia: false,
        runtime: 'unknown',
        reason: 'no-active-tab'
      }
    }

    if (!active.url) {
      return {
        tab: { id: active.id },
        permission: 'unknown',
        enabled: snapshot.value.settings.data.global.enabled,
        temporaryDisabled: false,
        mediaCount: 0,
        activeMedia: false,
        runtime: 'unknown',
        reason: 'permission-required'
      }
    }

    if (!isWebUrl(active.url)) {
      return {
        tab: { id: active.id, protocol: new URL(active.url).protocol },
        permission: 'restricted',
        enabled: false,
        temporaryDisabled: false,
        mediaCount: 0,
        activeMedia: false,
        runtime: 'unavailable',
        reason: 'restricted-page'
      }
    }

    const url = new URL(active.url)
    const origin = url.origin.toLowerCase()
    const effective = resolveSettings(snapshot.value.settings.data, origin)
    const permissionPattern = toHostPermissionPattern(origin)
    const granted =
      permissionPattern.ok &&
      (await this.permissions.contains({ origins: [permissionPattern.value] }))

    const tab = {
      id: active.id,
      origin,
      hostname: url.hostname.toLowerCase(),
      protocol: url.protocol
    }

    if (!granted) {
      return {
        tab,
        permission: 'missing',
        enabled: effective.enabled,
        temporaryDisabled: false,
        mediaCount: 0,
        activeMedia: false,
        runtime: 'unavailable',
        reason: 'permission-required'
      }
    }
    if (!snapshot.value.settings.data.global.enabled) {
      return {
        tab,
        permission: 'granted',
        enabled: false,
        temporaryDisabled: false,
        mediaCount: 0,
        activeMedia: false,
        runtime: 'disabled',
        reason: 'extension-disabled'
      }
    }
    if (!effective.enabled) {
      return {
        tab,
        permission: 'granted',
        enabled: false,
        temporaryDisabled: false,
        mediaCount: 0,
        activeMedia: false,
        runtime: 'disabled',
        reason: 'site-disabled'
      }
    }

    const runtimeState = await this.readRuntimeState(active.id)
    const frameSummary = this.frames.summarize(active.id)
    if (!runtimeState) {
      if (frameSummary.childFrameMediaCount > 0) {
        return {
          tab,
          permission: 'granted',
          enabled: true,
          temporaryDisabled: false,
          mediaCount: frameSummary.childFrameMediaCount,
          topFrameMediaCount: 0,
          childFrameMediaCount: frameSummary.childFrameMediaCount,
          childFrameCount: frameSummary.childFrameCount,
          anchoredMediaCount: frameSummary.anchoredMediaCount,
          mediaLocation: 'child-frame',
          activeMedia: false,
          activePlaybackPolicy: null,
          runtime: 'ready',
          reason: 'iframe-media'
        }
      }
      return {
        tab,
        permission: 'granted',
        enabled: true,
        temporaryDisabled: false,
        mediaCount: 0,
        activeMedia: false,
        runtime: 'unavailable',
        reason: 'initialization-failed'
      }
    }
    if (runtimeState.temporaryDisabled) {
      return {
        tab,
        permission: 'granted',
        enabled: true,
        temporaryDisabled: true,
        pageUiHidden: runtimeState.pageUiHidden,
        hiddenMediaCount: runtimeState.hiddenMediaCount,
        mediaCount: runtimeState.mediaCount,
        topFrameMediaCount: runtimeState.mediaCount,
        childFrameMediaCount: frameSummary.childFrameMediaCount,
        childFrameCount: frameSummary.childFrameCount,
        anchoredMediaCount: frameSummary.anchoredMediaCount,
        mediaLocation:
          runtimeState.mediaCount > 0
            ? frameSummary.childFrameMediaCount > 0
              ? 'mixed'
              : 'top-frame'
            : frameSummary.childFrameMediaCount > 0
              ? 'child-frame'
              : 'none',
        activeMedia: runtimeState.activeMedia,
        adapters: runtimeState.adapters,
        activePlaybackPolicy: runtimeState.activePlaybackPolicy,
        runtime: 'disabled',
        reason: 'temporarily-disabled'
      }
    }
    const topFrameMediaCount = runtimeState.mediaCount
    const childFrameMediaCount = frameSummary.childFrameMediaCount
    const mediaLocation =
      topFrameMediaCount > 0
        ? childFrameMediaCount > 0
          ? 'mixed'
          : 'top-frame'
        : childFrameMediaCount > 0
          ? 'child-frame'
          : 'none'
    return {
      tab,
      permission: 'granted',
      enabled: true,
      temporaryDisabled: false,
      pageUiHidden: runtimeState.pageUiHidden,
      hiddenMediaCount: runtimeState.hiddenMediaCount,
      mediaCount: topFrameMediaCount + childFrameMediaCount,
      topFrameMediaCount,
      childFrameMediaCount,
      childFrameCount: frameSummary.childFrameCount,
      anchoredMediaCount: frameSummary.anchoredMediaCount,
      mediaLocation,
      activeMedia: runtimeState.activeMedia,
      adapters: runtimeState.adapters,
      activePlaybackPolicy: runtimeState.activePlaybackPolicy,
      runtime: runtimeState.ready ? 'ready' : 'unavailable',
      reason: runtimeState.ready
        ? mediaLocation === 'child-frame'
          ? 'iframe-media'
          : mediaLocation === 'none'
            ? 'no-media'
            : 'none'
        : 'initialization-failed'
    }
  }

  async setTemporaryDisabled(disabled: boolean): Promise<SiteTemporaryDisableResponse> {
    const active = await this.tabs.getActive()
    if (!active) throw new Error('No active tab')
    return this.enqueueTabControl(active.id, () =>
      this.performSetTemporaryDisabled(active.id, disabled)
    )
  }

  private async performSetTemporaryDisabled(
    tabId: number,
    disabled: boolean
  ): Promise<SiteTemporaryDisableResponse> {
    const previousState = this.runtimeStateForTab(tabId)
    const commandPayload = {
      disabled,
      commandIssuedAt: Date.now(),
      commandRevision: this.nextTabControlRevision(tabId)
    }
    this.updateTabRuntimeState(tabId, { temporaryDisabled: disabled })
    const response = await this.sendToFrame(
      tabId,
      0,
      'site.set-temporary-disabled',
      commandPayload,
      siteTemporaryDisableResponseSchema
    )
    if (!response) {
      this.restoreTabRuntimeState(tabId, previousState)
      throw new Error('Site runtime unavailable')
    }
    const childFrameIds = this.childFrameIds(tabId, !disabled)
    if (childFrameIds.length > 0) {
      const known = this.tabControlFrameIds.get(tabId) ?? new Set<number>()
      for (const frameId of childFrameIds) known.add(frameId)
      this.tabControlFrameIds.set(tabId, known)
    }
    this.updateTabRuntimeState(tabId, { temporaryDisabled: response.disabled })
    await this.broadcastToFrames(
      tabId,
      this.controlFrameIds(tabId, !disabled),
      'site.set-temporary-disabled',
      { ...commandPayload, disabled: response.disabled }
    )
    return response
  }

  async setPageUiHidden(hidden: boolean): Promise<{ hidden: boolean; hiddenMediaCount: number }> {
    const active = await this.tabs.getActive()
    if (!active) throw new Error('No active tab')
    return this.setPageUiHiddenForTab(active.id, hidden)
  }

  async setPageUiHiddenForTab(
    tabId: number,
    hidden: boolean
  ): Promise<{ hidden: boolean; hiddenMediaCount: number }> {
    return this.enqueueTabControl(tabId, () => this.performSetPageUiHidden(tabId, hidden))
  }

  private async performSetPageUiHidden(
    tabId: number,
    hidden: boolean
  ): Promise<{ hidden: boolean; hiddenMediaCount: number }> {
    const previousState = this.runtimeStateForTab(tabId)
    this.updateTabRuntimeState(tabId, { pageUiHidden: hidden })
    const response = await this.sendToFrame(
      tabId,
      0,
      'site.set-page-ui-hidden',
      { hidden },
      sitePageUiVisibilityResponseSchema
    )
    if (!response) {
      this.restoreTabRuntimeState(tabId, previousState)
      throw new Error('Site runtime unavailable')
    }
    this.updateTabRuntimeState(tabId, { pageUiHidden: response.hidden })
    await this.broadcastToFrames(tabId, this.childFrameIds(tabId), 'site.set-page-ui-hidden', {
      hidden
    })
    return response
  }

  private enqueueTabControl<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.tabControlQueues.get(tabId) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    const settled = current.then(
      () => undefined,
      () => undefined
    )
    this.tabControlQueues.set(tabId, settled)
    void settled.then(() => {
      if (this.tabControlQueues.get(tabId) === settled) this.tabControlQueues.delete(tabId)
    })
    return current
  }

  private nextTabControlRevision(tabId: number): number {
    const next = (this.tabControlRevisions.get(tabId) ?? 0) + 1
    this.tabControlRevisions.set(tabId, next)
    return next
  }

  private childFrameIds(tabId: number, includeDormant = false): readonly number[] {
    if (includeDormant) {
      return this.frames.frameIds(tabId).filter((frameId) => frameId !== 0)
    }
    // Only live media owners receive page-level control fan-out. Empty or
    // ready=false frame records remain addressable for recovery, but must not
    // receive commands intended for an active media surface.
    return this.frames.mediaFrameIds(tabId).filter((frameId) => frameId !== 0)
  }

  private controlFrameIds(tabId: number, restoring: boolean): readonly number[] {
    const current = this.childFrameIds(tabId, restoring)
    if (!restoring) return current
    const remembered = this.tabControlFrameIds.get(tabId) ?? new Set<number>()
    return [...new Set([...remembered, ...current])].filter((frameId) => frameId !== 0)
  }

  private updateTabRuntimeState(
    tabId: number,
    patch: Partial<Readonly<{ pageUiHidden: boolean; temporaryDisabled: boolean }>>
  ): void {
    const current = this.runtimeStateForTab(tabId)
    this.tabRuntimeState.set(tabId, {
      pageUiHidden: current.pageUiHidden,
      temporaryDisabled: current.temporaryDisabled,
      sessionId: this.tabRuntimeState.get(tabId)?.sessionId ?? '',
      ...patch
    })
  }

  private restoreTabRuntimeState(
    tabId: number,
    state: Readonly<{
      stateKnown: boolean
      pageUiHidden: boolean
      temporaryDisabled: boolean
    }>
  ): void {
    if (!state.stateKnown) {
      this.tabRuntimeState.delete(tabId)
      return
    }
    this.tabRuntimeState.set(tabId, {
      pageUiHidden: state.pageUiHidden,
      temporaryDisabled: state.temporaryDisabled,
      sessionId: this.tabRuntimeState.get(tabId)?.sessionId ?? ''
    })
  }

  private readRuntimeState(tabId: number): Promise<SiteRuntimeStateResponse | null> {
    return this.sendToFrame(tabId, 0, 'site.get-state', {}, siteRuntimeStateResponseSchema)
  }

  private async broadcastToFrames(
    tabId: number,
    frameIds: readonly number[],
    type: Extract<TabRequestType, 'site.set-temporary-disabled' | 'site.set-page-ui-hidden'>,
    payload: unknown
  ): Promise<void> {
    await Promise.allSettled(
      frameIds.map((frameId) => {
        const message = createTabRequest(type, payload)
        return this.sendMessageWithTimeout(
          tabId,
          message,
          frameId,
          CHILD_CONTROL_BROADCAST_TIMEOUT_MS,
          'Child frame control broadcast timed out'
        )
      })
    )
  }

  private sendMessageWithTimeout(
    tabId: number,
    message: unknown,
    frameId: number | undefined,
    timeoutMs = FRAME_MESSAGE_TIMEOUT_MS,
    timeoutMessage = 'Frame message timed out'
  ): Promise<unknown> {
    let request: Promise<unknown>
    try {
      request = this.tabs.send(tabId, message, frameId)
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    return new Promise<unknown>((resolve, reject) => {
      const timeoutHandle = globalThis.setTimeout(
        () => reject(new Error(timeoutMessage)),
        timeoutMs
      )
      void request.then(
        (value) => {
          globalThis.clearTimeout(timeoutHandle)
          resolve(value)
        },
        (error: unknown) => {
          globalThis.clearTimeout(timeoutHandle)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      )
    })
  }

  private async sendToFrame<T>(
    tabId: number,
    frameId: number,
    type: TabRequestType,
    payload: unknown,
    parser: { safeParse(value: unknown): { success: true; data: T } | { success: false } }
  ): Promise<T | null> {
    const request = createTabRequest(type, payload)
    let raw: unknown
    try {
      raw = await this.sendMessageWithTimeout(tabId, request, frameId)
    } catch {
      return null
    }
    const response = parseTabResponse(raw)
    if (
      !response ||
      response.requestId !== request.requestId ||
      response.payload.requestType !== request.type ||
      response.type === 'protocol.error'
    ) {
      return null
    }
    const parsed = parser.safeParse(response.payload.data)
    return parsed.success ? parsed.data : null
  }
}
