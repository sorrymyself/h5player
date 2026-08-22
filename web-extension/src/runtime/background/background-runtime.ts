import type { LoggerPort } from '../../application/ports/logging'
import type { TabsPort } from '../../application/ports/browser'
import {
  crossTabPublishPayloadSchema,
  crossTabPublishResponseSchema,
  mediaCommandResultResponseSchema,
  mediaExecutePayloadSchema,
  mediaGetStatePayloadSchema,
  mediaPageStateSchema,
  pictureInPictureControlStateSchema,
  pictureInPictureExecutePayloadSchema,
  pictureInPictureOwnerSnapshotSchema,
  pictureInPicturePresencePayloadSchema,
  experimentalEnsureMainResponseSchema,
  activeMediaForState,
  hasRoutableActiveMedia,
  selectRoutableMediaState,
  isDefinitiveRoutableMediaState
} from '../../application/media'
import type {
  CrossTabMediaEventService,
  MediaCommandResultResponse,
  MediaExecutePayload,
  PictureInPictureControlService
} from '../../application/media'
import { mediaCommandSchema, type MediaCommand } from '../../domain/command'
import { resolveSettings, SETTINGS_SCHEMA_VERSION } from '../../domain/settings'
import {
  progressDeletePayloadSchema,
  progressDeleteResponseSchema,
  progressPrunePayloadSchema,
  progressPruneResponseSchema,
  progressReadPayloadSchema,
  progressReadResponseSchema,
  progressRestoreToggleResponseSchema,
  progressSavePayloadSchema,
  progressSaveResponseSchema
} from '../../application/progress'
import type { ProgressService } from '../../application/progress'
import {
  cancellationResponseSchema,
  emptyPayloadSchema,
  protocolCancelPayloadSchema,
  settingsImportPayloadSchema,
  settingsMutationResponseSchema,
  settingsRestorePayloadSchema,
  settingsResetPayloadSchema,
  settingsSnapshotResponseSchema,
  settingsUpdatePayloadSchema,
  systemPingResponseSchema
} from '../../application/settings/contracts'
import type { DiagnosticsService } from '../../application/diagnostics/diagnostics-service'
import {
  siteContextResponseSchema,
  siteReconcilePayloadSchema,
  siteReconcileResponseSchema,
  sitePageUiVisibilityPayloadSchema,
  sitePageUiVisibilityResponseSchema,
  frameRuntimeReportPayloadSchema,
  frameRuntimeReportResponseSchema,
  siteTemporaryDisablePayloadSchema,
  siteTemporaryDisableResponseSchema
} from '../../application/site/contracts'
import type { SiteAccessService } from '../../application/site/site-access-service'
import type { FrameRuntimeRegistry } from '../../application/site/frame-runtime-registry'
import type { SettingsService } from '../../application/settings/settings-service'
import type { SettingsError } from '../../application/settings/settings-port'
import {
  playbackSiteIntentPayloadSchema,
  playbackSiteIntentResponseSchema
} from '../../application/playback'
import type { ReplayGuard } from '../../infrastructure/messaging/replay-guard'
import {
  CURRENT_EXTENSION_PHASE,
  createRuntimeError,
  createRuntimeSuccess,
  parseRuntimeRequest,
  type EnvelopeContext,
  type ProtocolErrorCode,
  type RuntimeRequestEnvelope
} from '../../shared/protocol'
import { authorizeRuntimeSender, type RuntimeSenderMetadata } from './sender-policy'
import {
  createTabRequest,
  parseTabResponse,
  type TabRequestType,
  type TabTransportErrorCode
} from '../../shared/tab-protocol'

type BackgroundRuntimeOptions = {
  extensionId: string
  extensionVersion: string
  settings: SettingsService
  replayGuard: ReplayGuard
  logger: LoggerPort
  tabs: TabsPort
  siteAccess: SiteAccessService
  frameRegistry: FrameRuntimeRegistry
  diagnostics: DiagnosticsService
  crossTab?: CrossTabMediaEventService
  pictureInPicture?: PictureInPictureControlService
  progress?: ProgressService
}

type SafeParser<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

type ForwardedFrameResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{
      ok: false
      code: ProtocolErrorCode
      messageKey: string
      retryable: boolean
      dropFrame: boolean
    }>

const PICTURE_IN_PICTURE_REMOTE_COMMANDS = new Set<MediaCommand['type']>([
  'media.play',
  'media.pause',
  'media.seek',
  'media.step-frame',
  'media.set-rate',
  'media.adjust-rate',
  'media.set-volume',
  'media.adjust-volume',
  'media.set-gain',
  'media.adjust-gain',
  'media.set-muted',
  'media.toggle-mute',
  'media.toggle-picture-in-picture'
])

function mapSettingsError(error: SettingsError): ProtocolErrorCode {
  switch (error.code) {
    case 'FUTURE_SCHEMA':
      return 'FUTURE_SCHEMA'
    case 'IMPORT_INVALID':
      return 'IMPORT_INVALID'
    case 'STORAGE_CORRUPT':
    case 'BACKUP_CORRUPT':
      return 'STORAGE_CORRUPT'
    case 'MIGRATION_FAILED':
      return 'MIGRATION_FAILED'
    default:
      return 'INTERNAL_ERROR'
  }
}

function mapProgressError(error: { code: string }): ProtocolErrorCode {
  if (error.code.startsWith('INVALID_')) return 'INVALID_PAYLOAD'
  if (error.code === 'FUTURE_SCHEMA') return 'FUTURE_SCHEMA'
  if (error.code === 'STORAGE_CORRUPT' || error.code === 'BACKUP_CORRUPT') {
    return 'STORAGE_CORRUPT'
  }
  if (error.code === 'MIGRATION_FAILED') return 'MIGRATION_FAILED'
  return 'INTERNAL_ERROR'
}

function responseContext(authorized: {
  tabId?: number
  frameId?: number
  sessionId?: string
}): EnvelopeContext {
  const context: EnvelopeContext = {}
  if (authorized.tabId !== undefined) context.tabId = authorized.tabId
  if (authorized.frameId !== undefined) context.frameId = authorized.frameId
  if (authorized.sessionId !== undefined) context.sessionId = authorized.sessionId
  return context
}

function mapTabTransportError(code: TabTransportErrorCode): ProtocolErrorCode {
  switch (code) {
    case 'INVALID_PAYLOAD':
      return 'INVALID_PAYLOAD'
    case 'UNAUTHORIZED_SOURCE':
      return 'UNAUTHORIZED_SOURCE'
    case 'REPLAY_DETECTED':
      return 'REPLAY_DETECTED'
    case 'PAGE_RUNTIME_UNAVAILABLE':
      return 'TARGET_UNAVAILABLE'
    case 'INVALID_ENVELOPE':
    case 'INTERNAL_ERROR':
      return 'INTERNAL_ERROR'
  }
}

export class BackgroundRuntime {
  private readonly inFlight = new Map<string, AbortController>()
  private initialization: Promise<void> | null = null

  constructor(private readonly options: BackgroundRuntimeOptions) {}

  initialize(): Promise<void> {
    this.initialization ??= this.performInitialize()
    return this.initialization
  }

  private async performInitialize(): Promise<void> {
    const initialized = await this.options.settings.getSnapshot()
    if (!initialized.ok) {
      this.options.logger.log({
        level: 'error',
        module: 'background-runtime',
        eventCode: 'SETTINGS_INITIALIZATION_FAILED',
        details: { code: initialized.error.code }
      })
    }
    try {
      await this.options.siteAccess.initialize()
    } catch (error) {
      this.options.logger.log({
        level: 'error',
        module: 'background-runtime',
        eventCode: 'CONTENT_SCRIPT_REGISTRATION_FAILED',
        details: { error }
      })
    }
  }

  async handle(rawMessage: unknown, sender: RuntimeSenderMetadata): Promise<unknown> {
    const request = parseRuntimeRequest(rawMessage)
    if (!request) {
      this.options.logger.log({
        level: 'warn',
        module: 'background-runtime',
        eventCode: 'MESSAGE_REJECTED_INVALID_ENVELOPE'
      })
      return null
    }

    const authorized = authorizeRuntimeSender(request, sender, this.options.extensionId)
    if (!authorized.ok) {
      this.options.logger.log({
        level: 'warn',
        module: 'background-runtime',
        eventCode: 'MESSAGE_REJECTED_UNAUTHORIZED',
        correlationId: request.requestId,
        details: { source: request.source, type: request.type }
      })
      return createRuntimeError(
        request,
        'UNAUTHORIZED_SOURCE',
        'protocol.error.unauthorized-source'
      )
    }

    const context = responseContext(authorized.value)
    if (
      request.source === 'content' &&
      request.type !== 'site.report-frame-state' &&
      authorized.value.tabId !== undefined &&
      authorized.value.frameId !== undefined &&
      authorized.value.sessionId !== undefined &&
      this.options.frameRegistry
        .frameIds(authorized.value.tabId)
        .includes(authorized.value.frameId) &&
      !this.options.frameRegistry.owns({
        tabId: authorized.value.tabId,
        frameId: authorized.value.frameId,
        sessionId: authorized.value.sessionId
      })
    ) {
      return createRuntimeError(
        request,
        'UNAUTHORIZED_SOURCE',
        'protocol.error.unauthorized-source',
        false,
        context
      )
    }
    if (!this.options.replayGuard.accept(authorized.value.scope, request.requestId)) {
      return createRuntimeError(
        request,
        'REPLAY_DETECTED',
        'protocol.error.replay-detected',
        false,
        context
      )
    }

    if (request.type === 'protocol.cancel') {
      return this.cancelRequest(request, authorized.value.scope, context)
    }

    const inFlightKey = `${authorized.value.scope}:${request.requestId}`
    const controller = new AbortController()
    this.inFlight.set(inFlightKey, controller)
    try {
      return await this.route(
        request,
        authorized.value.scope,
        authorized.value.siteOrigin,
        context,
        controller.signal
      )
    } catch (error) {
      this.options.logger.log({
        level: 'error',
        module: 'background-runtime',
        eventCode: 'MESSAGE_HANDLER_FAILED',
        correlationId: request.requestId,
        details: { type: request.type, error }
      })
      return createRuntimeError(
        request,
        'INTERNAL_ERROR',
        'protocol.error.internal',
        false,
        context
      )
    } finally {
      this.inFlight.delete(inFlightKey)
    }
  }

  private async route(
    request: RuntimeRequestEnvelope,
    source: string,
    siteOrigin: string | undefined,
    context: EnvelopeContext,
    signal: AbortSignal
  ): Promise<unknown> {
    if (signal.aborted) {
      return createRuntimeError(
        request,
        'REQUEST_CANCELLED',
        'protocol.error.request-cancelled',
        false,
        context
      )
    }

    switch (request.type) {
      case 'system.ping': {
        if (!emptyPayloadSchema.safeParse(request.payload).success) {
          return this.invalidPayload(request, context)
        }
        const response: {
          extensionVersion: string
          phase: typeof CURRENT_EXTENSION_PHASE
          protocol: 1
          settingsSchemaVersion: typeof SETTINGS_SCHEMA_VERSION
          tabId?: number
          frameId?: number
          siteOrigin?: string
        } = {
          extensionVersion: this.options.extensionVersion,
          phase: CURRENT_EXTENSION_PHASE,
          protocol: 1,
          settingsSchemaVersion: SETTINGS_SCHEMA_VERSION
        }
        if (context.tabId !== undefined) response.tabId = context.tabId
        if (context.frameId !== undefined) response.frameId = context.frameId
        if (siteOrigin !== undefined) response.siteOrigin = siteOrigin
        return createRuntimeSuccess(request, systemPingResponseSchema.parse(response), context)
      }
      case 'settings.get': {
        if (!emptyPayloadSchema.safeParse(request.payload).success) {
          return this.invalidPayload(request, context)
        }
        const result = await this.options.settings.getSnapshot()
        return result.ok
          ? createRuntimeSuccess(
              request,
              settingsSnapshotResponseSchema.parse(result.value),
              context
            )
          : this.settingsFailure(request, result.error, context)
      }
      case 'settings.update': {
        const payload = settingsUpdatePayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        const result = await this.options.settings.update(
          payload.data.patch,
          payload.data.expectedRevision,
          source
        )
        return result.ok
          ? createRuntimeSuccess(
              request,
              settingsMutationResponseSchema.parse(result.value),
              context
            )
          : this.settingsFailure(request, result.error, context)
      }
      case 'progress.toggle-restore': {
        if (!emptyPayloadSchema.safeParse(request.payload).success || siteOrigin === undefined) {
          return this.invalidPayload(request, context)
        }
        const snapshot = await this.options.settings.getSnapshot()
        if (!snapshot.ok) return this.settingsFailure(request, snapshot.error, context)
        const existing = snapshot.value.settings.data.sites[siteOrigin]
        const enabled = !(
          existing?.media?.restoreProgress ??
          snapshot.value.settings.data.global.media.restoreProgress
        )
        const result = await this.options.settings.update(
          {
            sites: {
              [siteOrigin]: {
                ...existing,
                enabled: existing?.enabled ?? true,
                media: {
                  ...existing?.media,
                  restoreProgress: enabled
                }
              }
            }
          },
          snapshot.value.settings.revision,
          source
        )
        return result.ok
          ? createRuntimeSuccess(
              request,
              progressRestoreToggleResponseSchema.parse({
                origin: siteOrigin,
                enabled,
                settings: result.value.settings,
                changedPaths: result.value.changedPaths
              }),
              context
            )
          : this.settingsFailure(request, result.error, context)
      }
      case 'playback.set-site-intent': {
        const payload = playbackSiteIntentPayloadSchema.safeParse(request.payload)
        if (!payload.success || context.tabId === undefined || context.frameId === undefined) {
          return this.invalidPayload(request, context)
        }
        if (siteOrigin === undefined) {
          return createRuntimeError(
            request,
            'UNAUTHORIZED_SOURCE',
            'protocol.error.unauthorized-source',
            false,
            context
          )
        }
        const snapshot = await this.options.settings.getSnapshot()
        if (!snapshot.ok) return this.settingsFailure(request, snapshot.error, context)
        const existing = snapshot.value.settings.data.sites[siteOrigin]
        const protectAgainstSiteReset =
          payload.data.protectAgainstSiteReset ??
          existing?.policies?.protectPlaybackRate ??
          snapshot.value.settings.data.global.policies.protectPlaybackRate
        const result = await this.options.settings.update(
          {
            sites: {
              [siteOrigin]: {
                ...existing,
                enabled: existing?.enabled ?? true,
                media: {
                  ...existing?.media,
                  defaultPlaybackRate: payload.data.value
                },
                policies: {
                  ...existing?.policies,
                  protectPlaybackRate: protectAgainstSiteReset
                }
              }
            }
          },
          snapshot.value.settings.revision,
          source
        )
        return result.ok
          ? createRuntimeSuccess(
              request,
              playbackSiteIntentResponseSchema.parse({
                origin: siteOrigin,
                value: payload.data.value,
                protectAgainstSiteReset,
                settings: result.value.settings,
                changedPaths: result.value.changedPaths
              }),
              context
            )
          : this.settingsFailure(request, result.error, context)
      }
      case 'settings.export': {
        if (!emptyPayloadSchema.safeParse(request.payload).success) {
          return this.invalidPayload(request, context)
        }
        const result = await this.options.settings.export()
        return result.ok
          ? createRuntimeSuccess(request, { content: result.value }, context)
          : this.settingsFailure(request, result.error, context)
      }
      case 'settings.import': {
        const payload = settingsImportPayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        const result = await this.options.settings.import(
          payload.data.content,
          payload.data.expectedRevision,
          source
        )
        return result.ok
          ? createRuntimeSuccess(
              request,
              settingsMutationResponseSchema.parse(result.value),
              context
            )
          : this.settingsFailure(request, result.error, context)
      }
      case 'settings.restore-backup': {
        const payload = settingsRestorePayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        const result = await this.options.settings.restoreBackup(payload.data.backupId, source)
        return result.ok
          ? createRuntimeSuccess(
              request,
              settingsMutationResponseSchema.parse(result.value),
              context
            )
          : this.settingsFailure(request, result.error, context)
      }
      case 'settings.reset': {
        const payload = settingsResetPayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        const result = await this.options.settings.reset(payload.data.scope, source)
        return result.ok
          ? createRuntimeSuccess(
              request,
              settingsMutationResponseSchema.parse(result.value),
              context
            )
          : this.settingsFailure(request, result.error, context)
      }
      case 'site.get-context': {
        if (!emptyPayloadSchema.safeParse(request.payload).success) {
          return this.invalidPayload(request, context)
        }
        // Popup can wake a suspended MV3 worker before startup recovery has
        // collected child-frame leases. Wait for that bounded recovery here;
        // content frame reports remain routable during initialization.
        await this.initialize()
        const result = await this.options.siteAccess.getContext()
        return createRuntimeSuccess(request, siteContextResponseSchema.parse(result), context)
      }
      case 'site.report-frame-state': {
        const payload = frameRuntimeReportPayloadSchema.safeParse(request.payload)
        if (
          !payload.success ||
          context.tabId === undefined ||
          context.frameId === undefined ||
          context.sessionId === undefined
        ) {
          return this.invalidPayload(request, context)
        }
        const identity = {
          tabId: context.tabId,
          frameId: context.frameId,
          sessionId: context.sessionId
        }
        const reportAccepted = this.options.frameRegistry.report(identity, payload.data)
        const topStateChanged =
          reportAccepted &&
          context.frameId === 0 &&
          this.options.siteAccess.recordTopFrameRuntimeState(context.tabId, context.sessionId, {
            pageUiHidden: payload.data.pageUiHidden,
            temporaryDisabled: payload.data.temporaryDisabled
          })
        const tabRuntimeState = this.options.siteAccess.runtimeStateForTab(context.tabId)
        if (topStateChanged) void this.options.siteAccess.refreshFrameStates(context.tabId)
        return createRuntimeSuccess(
          request,
          frameRuntimeReportResponseSchema.parse({ accepted: reportAccepted, ...tabRuntimeState }),
          context
        )
      }
      case 'site.set-temporary-disabled': {
        const payload = siteTemporaryDisablePayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        const result = await this.options.siteAccess.setTemporaryDisabled(payload.data.disabled)
        return createRuntimeSuccess(
          request,
          siteTemporaryDisableResponseSchema.parse(result),
          context
        )
      }
      case 'site.set-page-ui-hidden': {
        const payload = sitePageUiVisibilityPayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        const result =
          request.source === 'content' && context.tabId !== undefined
            ? await this.options.siteAccess.setPageUiHiddenForTab(
                context.tabId,
                payload.data.hidden
              )
            : await this.options.siteAccess.setPageUiHidden(payload.data.hidden)
        return createRuntimeSuccess(
          request,
          sitePageUiVisibilityResponseSchema.parse(result),
          context
        )
      }
      case 'site.reconcile': {
        const payload = siteReconcilePayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        const result = await this.options.siteAccess.reconcile(payload.data.bootstrapCurrentTab)
        return createRuntimeSuccess(request, siteReconcileResponseSchema.parse(result), context)
      }
      case 'diagnostics.get': {
        if (!emptyPayloadSchema.safeParse(request.payload).success) {
          return this.invalidPayload(request, context)
        }
        const result = await this.options.diagnostics.get()
        return createRuntimeSuccess(request, result, context)
      }
      case 'experimental.ensure-main': {
        if (!emptyPayloadSchema.safeParse(request.payload).success) {
          return this.invalidPayload(request, context)
        }
        if (
          request.source !== 'content' ||
          context.tabId === undefined ||
          context.frameId === undefined ||
          siteOrigin === undefined
        ) {
          return createRuntimeError(
            request,
            'UNAUTHORIZED_SOURCE',
            'protocol.error.unauthorized-source',
            false,
            context
          )
        }
        const snapshot = await this.options.settings.getSnapshot()
        if (!snapshot.ok) return this.settingsFailure(request, snapshot.error, context)
        const effective = resolveSettings(snapshot.value.settings.data, siteOrigin)
        const runtimeState = this.options.siteAccess.runtimeStateForTab(context.tabId)
        const allowed =
          snapshot.value.settings.data.global.enabled &&
          effective.enabled &&
          !runtimeState.temporaryDisabled &&
          effective.policies.allowExperimental &&
          effective.download.enabled
        if (!allowed) {
          return createRuntimeSuccess(
            request,
            experimentalEnsureMainResponseSchema.parse({ injected: false, allowed: false }),
            context
          )
        }
        await this.options.siteAccess.injectExperimentalMain(context.tabId, context.frameId)
        return createRuntimeSuccess(
          request,
          experimentalEnsureMainResponseSchema.parse({ injected: true, allowed: true }),
          context
        )
      }
      case 'media.picture-in-picture.presence': {
        const payload = pictureInPicturePresencePayloadSchema.safeParse(request.payload)
        if (
          !payload.success ||
          context.tabId === undefined ||
          context.frameId === undefined ||
          context.sessionId === undefined ||
          this.options.pictureInPicture === undefined
        ) {
          return this.invalidPayload(request, context)
        }
        const owner = this.options.pictureInPicture.report(payload.data, {
          tabId: context.tabId,
          frameId: context.frameId,
          sessionId: context.sessionId
        })
        return createRuntimeSuccess(
          request,
          pictureInPictureOwnerSnapshotSchema.parse(owner),
          context
        )
      }
      case 'media.picture-in-picture.get-state': {
        if (
          !emptyPayloadSchema.safeParse(request.payload).success ||
          context.tabId === undefined ||
          context.frameId === undefined ||
          context.sessionId === undefined ||
          this.options.pictureInPicture === undefined
        ) {
          return this.invalidPayload(request, context)
        }
        const owner = this.options.pictureInPicture.current()
        if (owner === null) {
          return createRuntimeSuccess(
            request,
            pictureInPictureControlStateSchema.parse({ owner: null, state: null }),
            context
          )
        }
        const forwarded = await this.forwardToFrame(
          owner.tabId,
          owner.frameId,
          'media.get-state',
          {},
          mediaPageStateSchema
        )
        if (!forwarded.ok) {
          this.options.pictureInPicture.invalidate(owner.generation)
          return createRuntimeError(
            request,
            forwarded.code,
            forwarded.messageKey,
            forwarded.retryable,
            context
          )
        }
        if (!forwarded.data.media.some((media) => media.id === owner.mediaId)) {
          this.options.pictureInPicture.invalidate(owner.generation)
          return createRuntimeSuccess(
            request,
            pictureInPictureControlStateSchema.parse({ owner: null, state: null }),
            context
          )
        }
        return createRuntimeSuccess(
          request,
          pictureInPictureControlStateSchema.parse({
            owner: this.options.pictureInPicture.snapshot().owner,
            state: forwarded.data
          }),
          context
        )
      }
      case 'media.picture-in-picture.execute': {
        const payload = pictureInPictureExecutePayloadSchema.safeParse(request.payload)
        if (
          !payload.success ||
          context.tabId === undefined ||
          context.frameId === undefined ||
          context.sessionId === undefined ||
          this.options.pictureInPicture === undefined
        ) {
          return this.invalidPayload(request, context)
        }
        const owner = this.options.pictureInPicture.resolve(payload.data.generation)
        if (
          owner === null ||
          (owner.tabId === context.tabId && owner.frameId === context.frameId)
        ) {
          return createRuntimeError(
            request,
            'TARGET_UNAVAILABLE',
            'media.error.picture-in-picture-stale',
            true,
            context
          )
        }
        if (!PICTURE_IN_PICTURE_REMOTE_COMMANDS.has(payload.data.command.type)) {
          return createRuntimeError(
            request,
            'PERMISSION_DENIED',
            'media.error.picture-in-picture-command-blocked',
            false,
            context
          )
        }
        const command = mediaCommandSchema.parse({
          ...payload.data.command,
          mediaId: owner.mediaId
        })
        const forwarded = await this.forwardToFrame(
          owner.tabId,
          owner.frameId,
          'media.execute',
          {
            command,
            ...(payload.data.playbackRateScope === undefined
              ? {}
              : { playbackRateScope: payload.data.playbackRateScope })
          },
          mediaCommandResultResponseSchema
        )
        if (!forwarded.ok) {
          if (forwarded.code === 'TARGET_UNAVAILABLE') {
            this.options.pictureInPicture.invalidate(owner.generation)
          }
          return createRuntimeError(
            request,
            forwarded.code,
            forwarded.messageKey,
            forwarded.retryable,
            context
          )
        }
        return createRuntimeSuccess(request, forwarded.data, context)
      }
      case 'media.get-state': {
        const payload = mediaGetStatePayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        return this.forwardToMediaFrames(
          request,
          'media.get-state',
          payload.data,
          mediaPageStateSchema,
          context,
          signal,
          hasRoutableActiveMedia,
          undefined,
          (states) => selectRoutableMediaState(states),
          isDefinitiveRoutableMediaState
        )
      }
      case 'media.execute': {
        const payload = mediaExecutePayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        const acceptsResponse =
          payload.data.command.type === 'media.play-next'
            ? (response: MediaCommandResultResponse) => response.result.ok
            : (response: MediaCommandResultResponse) =>
                response.result.ok || response.result.error.code !== 'MEDIA_NOT_FOUND'
        return this.forwardToMediaFrames(
          request,
          'media.execute',
          payload.data,
          mediaCommandResultResponseSchema,
          context,
          signal,
          acceptsResponse,
          request.source === 'content'
            ? undefined
            : (tabId) => this.retargetMediaCommandAcrossFrames(tabId, payload.data)
        )
      }
      case 'progress.read': {
        const payload = progressReadPayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        if (this.options.progress === undefined) {
          return createRuntimeError(
            request,
            'INTERNAL_ERROR',
            'progress.error.unavailable',
            true,
            context
          )
        }
        const result = await this.options.progress.read(payload.data, source)
        return result.ok
          ? createRuntimeSuccess(request, progressReadResponseSchema.parse(result.value), context)
          : createRuntimeError(
              request,
              mapProgressError(result.error),
              `progress.error.${result.error.code.toLowerCase()}`,
              false,
              context
            )
      }
      case 'progress.save': {
        const payload = progressSavePayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        if (this.options.progress === undefined) {
          return createRuntimeError(
            request,
            'INTERNAL_ERROR',
            'progress.error.unavailable',
            true,
            context
          )
        }
        const result = await this.options.progress.save(payload.data, source)
        return result.ok
          ? createRuntimeSuccess(request, progressSaveResponseSchema.parse(result.value), context)
          : createRuntimeError(
              request,
              mapProgressError(result.error),
              `progress.error.${result.error.code.toLowerCase()}`,
              false,
              context
            )
      }
      case 'progress.delete': {
        const payload = progressDeletePayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        if (this.options.progress === undefined) {
          return createRuntimeError(
            request,
            'INTERNAL_ERROR',
            'progress.error.unavailable',
            true,
            context
          )
        }
        const result = await this.options.progress.delete(payload.data, source)
        return result.ok
          ? createRuntimeSuccess(request, progressDeleteResponseSchema.parse(result.value), context)
          : createRuntimeError(
              request,
              mapProgressError(result.error),
              `progress.error.${result.error.code.toLowerCase()}`,
              false,
              context
            )
      }
      case 'progress.prune': {
        if (!progressPrunePayloadSchema.safeParse(request.payload).success) {
          return this.invalidPayload(request, context)
        }
        if (this.options.progress === undefined) {
          return createRuntimeError(
            request,
            'INTERNAL_ERROR',
            'progress.error.unavailable',
            true,
            context
          )
        }
        const result = await this.options.progress.prune(source)
        return result.ok
          ? createRuntimeSuccess(request, progressPruneResponseSchema.parse(result.value), context)
          : createRuntimeError(
              request,
              mapProgressError(result.error),
              `progress.error.${result.error.code.toLowerCase()}`,
              false,
              context
            )
      }
      case 'media.cross-tab.publish': {
        const payload = crossTabPublishPayloadSchema.safeParse(request.payload)
        if (!payload.success) return this.invalidPayload(request, context)
        if (context.tabId === undefined || context.frameId === undefined) {
          return createRuntimeError(
            request,
            'UNAUTHORIZED_SOURCE',
            'protocol.error.unauthorized-source',
            false,
            context
          )
        }
        if (this.options.crossTab === undefined) {
          return createRuntimeError(
            request,
            'INTERNAL_ERROR',
            'media.error.cross-tab-unavailable',
            true,
            context
          )
        }
        const result = await this.options.crossTab.publish(payload.data, {
          tabId: context.tabId,
          frameId: context.frameId
        })
        return createRuntimeSuccess(request, crossTabPublishResponseSchema.parse(result), context)
      }
      case 'protocol.cancel':
        return createRuntimeSuccess(
          request,
          cancellationResponseSchema.parse({ cancelled: false }),
          context
        )
    }
  }

  private async forwardToMediaFrames<T>(
    request: RuntimeRequestEnvelope,
    type: TabRequestType,
    payload: unknown,
    parser: SafeParser<T>,
    context: EnvelopeContext,
    signal: AbortSignal,
    accepts: (data: T) => boolean,
    recover?: (tabId: number) => Promise<T | null>,
    select?: (data: readonly T[]) => T | null,
    stop?: (data: T) => boolean
  ): Promise<unknown> {
    const targetTab = await this.resolveMediaTargetTab(request, context)
    if (!targetTab.ok) {
      return createRuntimeError(
        request,
        targetTab.code,
        targetTab.messageKey,
        targetTab.retryable,
        context
      )
    }
    if (signal.aborted) {
      return createRuntimeError(
        request,
        'REQUEST_CANCELLED',
        'protocol.error.request-cancelled',
        false,
        context
      )
    }

    const frameIds = this.mediaFrameCandidates(targetTab.tabId)
    let fallbackData: T | null = null
    let fallbackFailure: Extract<ForwardedFrameResult<T>, { ok: false }> | null = null
    const acceptedData: T[] = []
    for (const frameId of frameIds) {
      const result = await this.forwardToFrame(targetTab.tabId, frameId, type, payload, parser)
      if (signal.aborted) {
        return createRuntimeError(
          request,
          'REQUEST_CANCELLED',
          'protocol.error.request-cancelled',
          false,
          context
        )
      }
      if (!result.ok) {
        fallbackFailure = result
        if (result.dropFrame) {
          this.options.frameRegistry.removeFrame(targetTab.tabId, frameId)
        }
        continue
      }
      fallbackData ??= result.data
      if (accepts(result.data)) {
        if (select === undefined) return createRuntimeSuccess(request, result.data, context)
        acceptedData.push(result.data)
        if (stop?.(result.data) === true) {
          const selected = select(acceptedData)
          if (selected !== null) return createRuntimeSuccess(request, selected, context)
        }
        continue
      }
    }

    if (select !== undefined && acceptedData.length > 0) {
      const selected = select(acceptedData)
      if (selected !== null) return createRuntimeSuccess(request, selected, context)
    }

    const recovered = await recover?.(targetTab.tabId)
    if (recovered !== undefined && recovered !== null) {
      fallbackData = recovered
      if (accepts(recovered)) return createRuntimeSuccess(request, recovered, context)
    }

    if (fallbackData !== null) return createRuntimeSuccess(request, fallbackData, context)
    if (fallbackFailure !== null) {
      return createRuntimeError(
        request,
        fallbackFailure.code,
        fallbackFailure.messageKey,
        fallbackFailure.retryable,
        context
      )
    }
    return createRuntimeError(
      request,
      'TARGET_UNAVAILABLE',
      'media.error.content-unavailable',
      true,
      context
    )
  }

  private async retargetMediaCommandAcrossFrames(
    tabId: number,
    payload: MediaExecutePayload
  ): Promise<MediaCommandResultResponse | null> {
    const states = []
    for (const frameId of this.mediaFrameCandidates(tabId)) {
      const stateResult = await this.forwardToFrame(
        tabId,
        frameId,
        'media.get-state',
        {},
        mediaPageStateSchema
      )
      if (!stateResult.ok) {
        if (stateResult.dropFrame) {
          this.options.frameRegistry.removeFrame(tabId, frameId)
        }
        continue
      }
      states.push(stateResult.data)
    }

    const selectedState = selectRoutableMediaState(states)
    if (selectedState === null) return null
    const active = activeMediaForState(selectedState)
    if (active === null) return null
    const command: MediaCommand = { ...payload.command, mediaId: active.id }
    const retried = await this.forwardToFrame(
      tabId,
      active.frameId,
      'media.execute',
      { ...payload, command },
      mediaCommandResultResponseSchema
    )
    if (!retried.ok) {
      if (retried.dropFrame) {
        this.options.frameRegistry.removeFrame(tabId, active.frameId)
      }
      return null
    }
    return retried.data
  }

  private async resolveMediaTargetTab(
    request: RuntimeRequestEnvelope,
    context: EnvelopeContext
  ): Promise<
    | Readonly<{ ok: true; tabId: number }>
    | Readonly<{
        ok: false
        code: ProtocolErrorCode
        messageKey: string
        retryable: boolean
      }>
  > {
    if (request.source === 'content') {
      return context.tabId === undefined
        ? {
            ok: false,
            code: 'UNAUTHORIZED_SOURCE',
            messageKey: 'protocol.error.unauthorized-source',
            retryable: false
          }
        : { ok: true, tabId: context.tabId }
    }

    let activeTab: Awaited<ReturnType<TabsPort['getActive']>>
    try {
      activeTab = await this.options.tabs.getActive()
    } catch {
      return {
        ok: false,
        code: 'TARGET_UNAVAILABLE',
        messageKey: 'media.error.active-tab-unavailable',
        retryable: true
      }
    }
    return activeTab === null
      ? {
          ok: false,
          code: 'TARGET_UNAVAILABLE',
          messageKey: 'media.error.no-active-tab',
          retryable: false
        }
      : { ok: true, tabId: activeTab.id }
  }

  private mediaFrameCandidates(tabId: number): readonly number[] {
    const candidates = this.options.frameRegistry.mediaFrameIds(tabId)
    return candidates.length === 0 ? [0] : [...new Set([...candidates, 0])]
  }

  private async forwardToFrame<T>(
    tabId: number,
    frameId: number,
    type: TabRequestType,
    payload: unknown,
    parser: SafeParser<T>
  ): Promise<ForwardedFrameResult<T>> {
    const tabRequest = createTabRequest(type, payload)
    let rawResponse: unknown
    try {
      rawResponse = await this.options.tabs.send(tabId, tabRequest, frameId)
    } catch {
      return {
        ok: false,
        code: 'TARGET_UNAVAILABLE',
        messageKey: 'media.error.content-unavailable',
        retryable: true,
        dropFrame: true
      }
    }

    const tabResponse = parseTabResponse(rawResponse)
    if (
      !tabResponse ||
      tabResponse.requestId !== tabRequest.requestId ||
      tabResponse.payload.requestType !== tabRequest.type
    ) {
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        messageKey: 'media.error.invalid-content-response',
        retryable: false,
        dropFrame: false
      }
    }
    if (tabResponse.type === 'protocol.error') {
      return {
        ok: false,
        code: mapTabTransportError(tabResponse.payload.error.code),
        messageKey: tabResponse.payload.error.messageKey,
        retryable: tabResponse.payload.error.retryable,
        dropFrame: false
      }
    }

    const parsed = parser.safeParse(tabResponse.payload.data)
    return parsed.success
      ? { ok: true, data: parsed.data }
      : {
          ok: false,
          code: 'INTERNAL_ERROR',
          messageKey: 'media.error.invalid-content-payload',
          retryable: false,
          dropFrame: false
        }
  }

  private cancelRequest(
    request: RuntimeRequestEnvelope,
    scope: string,
    context: EnvelopeContext
  ): unknown {
    const payload = protocolCancelPayloadSchema.safeParse(request.payload)
    if (!payload.success) return this.invalidPayload(request, context)
    const controller = this.inFlight.get(`${scope}:${payload.data.targetRequestId}`)
    controller?.abort()
    return createRuntimeSuccess(
      request,
      cancellationResponseSchema.parse({ cancelled: Boolean(controller) }),
      context
    )
  }

  private invalidPayload(request: RuntimeRequestEnvelope, context: EnvelopeContext): unknown {
    return createRuntimeError(
      request,
      'INVALID_PAYLOAD',
      'protocol.error.invalid-payload',
      false,
      context
    )
  }

  private settingsFailure(
    request: RuntimeRequestEnvelope,
    error: SettingsError,
    context: EnvelopeContext
  ): unknown {
    return createRuntimeError(
      request,
      mapSettingsError(error),
      `settings.error.${error.code.toLowerCase()}`,
      false,
      context
    )
  }
}
