import type { RuntimeApiPort } from '../../application/runtime/runtime-api-port'
import { mediaCommandResultResponseSchema, mediaPageStateSchema } from '../../application/media'
import type { MediaCommand } from '../../domain/command'
import {
  settingsExportResponseSchema,
  settingsMutationResponseSchema,
  settingsSnapshotResponseSchema,
  systemPingResponseSchema
} from '../../application/settings/contracts'
import type { SettingsPatch } from '../../domain/settings'
import { diagnosticResponseSchema } from '../../application/diagnostics/contracts'
import {
  siteContextResponseSchema,
  sitePageUiVisibilityResponseSchema,
  siteReconcileResponseSchema,
  siteTemporaryDisableResponseSchema
} from '../../application/site/contracts'
import type { RuntimeRequestClient } from './request-client'

export class RuntimeApiClient implements RuntimeApiPort {
  constructor(private readonly client: RuntimeRequestClient) {}

  ping(options: { signal?: AbortSignal } = {}) {
    return this.client.request('system.ping', {}, systemPingResponseSchema, options)
  }

  getMediaState(options: { signal?: AbortSignal } = {}) {
    return this.client.request('media.get-state', {}, mediaPageStateSchema, options)
  }

  executeMediaCommand(
    command: MediaCommand,
    options: {
      signal?: AbortSignal
      playbackRateScope?: 'site' | 'page' | 'media'
    } = {}
  ) {
    return this.client.request(
      'media.execute',
      {
        command,
        ...(options.playbackRateScope === undefined
          ? {}
          : { playbackRateScope: options.playbackRateScope })
      },
      mediaCommandResultResponseSchema,
      options
    )
  }

  getSettings(options: { signal?: AbortSignal } = {}) {
    return this.client.request('settings.get', {}, settingsSnapshotResponseSchema, options)
  }

  updateSettings(
    patch: SettingsPatch,
    expectedRevision?: number,
    options: { signal?: AbortSignal } = {}
  ) {
    const payload: { patch: SettingsPatch; expectedRevision?: number } = { patch }
    if (expectedRevision !== undefined) payload.expectedRevision = expectedRevision
    return this.client.request('settings.update', payload, settingsMutationResponseSchema, options)
  }

  async exportSettings(options: { signal?: AbortSignal } = {}): Promise<string> {
    const result = await this.client.request(
      'settings.export',
      {},
      settingsExportResponseSchema,
      options
    )
    return result.content
  }

  importSettings(
    content: string,
    expectedRevision?: number,
    options: { signal?: AbortSignal } = {}
  ) {
    const payload: { content: string; expectedRevision?: number } = { content }
    if (expectedRevision !== undefined) payload.expectedRevision = expectedRevision
    return this.client.request('settings.import', payload, settingsMutationResponseSchema, options)
  }

  restoreBackup(backupId: string, options: { signal?: AbortSignal } = {}) {
    return this.client.request(
      'settings.restore-backup',
      { backupId },
      settingsMutationResponseSchema,
      options
    )
  }

  resetSettings(
    scope: 'all' | 'global' | 'sites' | 'progress',
    options: { signal?: AbortSignal } = {}
  ) {
    return this.client.request('settings.reset', { scope }, settingsMutationResponseSchema, options)
  }

  getSiteContext(options: { signal?: AbortSignal } = {}) {
    return this.client.request('site.get-context', {}, siteContextResponseSchema, options)
  }

  setTemporarySiteDisabled(disabled: boolean, options: { signal?: AbortSignal } = {}) {
    return this.client.request(
      'site.set-temporary-disabled',
      { disabled },
      siteTemporaryDisableResponseSchema,
      options
    )
  }

  setPageUiHidden(hidden: boolean, options: { signal?: AbortSignal } = {}) {
    return this.client.request(
      'site.set-page-ui-hidden',
      { hidden },
      sitePageUiVisibilityResponseSchema,
      options
    )
  }

  reconcileSiteAccess(bootstrapCurrentTab: boolean, options: { signal?: AbortSignal } = {}) {
    return this.client.request(
      'site.reconcile',
      { bootstrapCurrentTab },
      siteReconcileResponseSchema,
      options
    )
  }

  getDiagnostics(options: { signal?: AbortSignal } = {}) {
    return this.client.request('diagnostics.get', {}, diagnosticResponseSchema, options)
  }
}
