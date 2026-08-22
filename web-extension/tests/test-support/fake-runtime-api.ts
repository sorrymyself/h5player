import type { DiagnosticResponse } from '../../src/application/diagnostics'
import type { MediaCommand } from '../../src/domain/command'
import type { MediaCommandResultResponse, MediaPageState } from '../../src/application/media'
import type { RuntimeApiPort } from '../../src/application/runtime/runtime-api-port'
import type {
  SettingsMutationResponse,
  SettingsSnapshotResponse,
  SystemPingResponse
} from '../../src/application/settings/contracts'
import type {
  SiteContextResponse,
  SitePageUiVisibilityResponse,
  SiteReconcileResponse,
  SiteTemporaryDisableResponse
} from '../../src/application/site'
import {
  createDefaultSettings,
  mergeSettings,
  persistedSettingsV2Schema,
  settingsImportFileSchema,
  settingsBackupSchema,
  SETTINGS_SCHEMA_VERSION,
  type PersistedSettingsV2,
  type SettingsBackup,
  type SettingsData,
  type SettingsPatch
} from '../../src/domain/settings'
import { migrateSettingsDataV1 } from '../../src/infrastructure/storage/settings-migrations'
import { createSettingsEnvelope } from './settings-fixtures'

function cloneSettings(value: PersistedSettingsV2): PersistedSettingsV2 {
  return persistedSettingsV2Schema.parse(JSON.parse(JSON.stringify(value)) as unknown)
}

function cloneBackup(value: SettingsBackup): SettingsBackup {
  return settingsBackupSchema.parse(JSON.parse(JSON.stringify(value)) as unknown)
}

export class FakeRuntimeApi implements RuntimeApiPort {
  settings = createSettingsEnvelope()
  latestBackup: SettingsBackup | null = null
  siteContext: SiteContextResponse = {
    tab: null,
    permission: 'unknown',
    enabled: true,
    temporaryDisabled: false,
    mediaCount: 0,
    activeMedia: false,
    runtime: 'unknown',
    reason: 'no-active-tab'
  }
  readonly updateCalls: Array<{ patch: SettingsPatch; expectedRevision?: number }> = []
  readonly reconcileCalls: boolean[] = []
  getSettingsCalls = 0

  ping(): Promise<SystemPingResponse> {
    return Promise.resolve({
      extensionVersion: '0.1.0',
      phase: 6,
      protocol: 1,
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION
    })
  }

  getMediaState(): Promise<MediaPageState> {
    return Promise.reject(new Error('No media fixture configured'))
  }

  executeMediaCommand(command: MediaCommand): Promise<MediaCommandResultResponse> {
    void command
    return Promise.reject(new Error('No media fixture configured'))
  }

  getSettings(): Promise<SettingsSnapshotResponse> {
    this.getSettingsCalls += 1
    return Promise.resolve({
      settings: cloneSettings(this.settings),
      latestBackup: this.latestBackup ? cloneBackup(this.latestBackup) : null
    })
  }

  updateSettings(
    patch: SettingsPatch,
    expectedRevision?: number
  ): Promise<SettingsMutationResponse> {
    const call: { patch: SettingsPatch; expectedRevision?: number } = { patch }
    if (expectedRevision !== undefined) call.expectedRevision = expectedRevision
    this.updateCalls.push(call)
    const merged = mergeSettings(this.settings.data, patch)
    const rebased = expectedRevision !== undefined && expectedRevision !== this.settings.revision
    if (merged.changedPaths.length > 0) {
      this.settings = {
        ...this.settings,
        revision: this.settings.revision + 1,
        updatedAt: this.settings.updatedAt + 1,
        data: merged.data
      }
    }
    return Promise.resolve({
      settings: cloneSettings(this.settings),
      changedPaths: merged.changedPaths,
      rebased
    })
  }

  exportSettings(): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        format: 'h5player.web-extension.settings',
        formatVersion: 3,
        exportedAt: '2026-08-10T00:00:00.000Z',
        data: this.settings.data
      })
    )
  }

  importSettings(content: string, expectedRevision?: number): Promise<SettingsMutationResponse> {
    const parsedJson = JSON.parse(content) as unknown
    const imported = settingsImportFileSchema.parse(parsedJson)
    const data =
      imported.formatVersion === 3
        ? imported.data
        : imported.formatVersion === 2
          ? { ...imported.data, global: { ...imported.data.global, download: { enabled: true } } }
          : migrateSettingsDataV1(imported.data)
    this.backup('import')
    const rebased = expectedRevision !== undefined && expectedRevision !== this.settings.revision
    this.settings = {
      ...this.settings,
      revision: this.settings.revision + 1,
      updatedAt: this.settings.updatedAt + 1,
      data
    }
    return Promise.resolve({
      settings: cloneSettings(this.settings),
      changedPaths: ['global', 'sites', 'progress'],
      rebased
    })
  }

  restoreBackup(backupId: string): Promise<SettingsMutationResponse> {
    if (!this.latestBackup || this.latestBackup.backupId !== backupId) {
      return Promise.reject(new Error('BACKUP_NOT_FOUND'))
    }
    const restored = persistedSettingsV2Schema.parse(this.latestBackup.raw)
    this.backup('rollback')
    this.settings = {
      ...this.settings,
      revision: this.settings.revision + 1,
      updatedAt: this.settings.updatedAt + 1,
      data: restored.data
    }
    return Promise.resolve({
      settings: cloneSettings(this.settings),
      changedPaths: ['global', 'sites', 'progress'],
      rebased: false
    })
  }

  resetSettings(scope: 'all' | 'global' | 'sites' | 'progress'): Promise<SettingsMutationResponse> {
    const defaults = createDefaultSettings()
    const nextData: SettingsData = {
      global: scope === 'all' || scope === 'global' ? defaults.global : this.settings.data.global,
      sites: scope === 'all' || scope === 'sites' ? {} : this.settings.data.sites,
      progress: scope === 'all' || scope === 'progress' ? {} : this.settings.data.progress
    }
    this.backup('reset')
    this.settings = {
      ...this.settings,
      revision: this.settings.revision + 1,
      updatedAt: this.settings.updatedAt + 1,
      data: nextData
    }
    return Promise.resolve({
      settings: cloneSettings(this.settings),
      changedPaths: scope === 'all' ? ['global', 'sites', 'progress'] : [scope],
      rebased: false
    })
  }

  getSiteContext(): Promise<SiteContextResponse> {
    return Promise.resolve(JSON.parse(JSON.stringify(this.siteContext)) as SiteContextResponse)
  }

  setTemporarySiteDisabled(disabled: boolean): Promise<SiteTemporaryDisableResponse> {
    this.siteContext = {
      ...this.siteContext,
      temporaryDisabled: disabled,
      runtime: disabled ? 'disabled' : this.siteContext.runtime,
      reason: disabled ? 'temporarily-disabled' : this.siteContext.reason
    }
    return Promise.resolve({ disabled })
  }

  setPageUiHidden(hidden: boolean): Promise<SitePageUiVisibilityResponse> {
    this.siteContext = {
      ...this.siteContext,
      pageUiHidden: hidden,
      hiddenMediaCount: hidden ? (this.siteContext.mediaCount ?? 0) : 0
    }
    return Promise.resolve({ hidden, hiddenMediaCount: this.siteContext.hiddenMediaCount ?? 0 })
  }

  reconcileSiteAccess(bootstrapCurrentTab: boolean): Promise<SiteReconcileResponse> {
    this.reconcileCalls.push(bootstrapCurrentTab)
    return Promise.resolve({ registeredOrigins: 1, bootstrapped: bootstrapCurrentTab })
  }

  getDiagnostics(): Promise<DiagnosticResponse> {
    return Promise.reject(new Error('No diagnostics fixture configured'))
  }

  private backup(reason: SettingsBackup['reason']): void {
    this.latestBackup = {
      backupId: `backup-${this.settings.revision}-identifier`,
      createdAt: this.settings.updatedAt,
      reason,
      checksum: 'fnv1a64:0000000000000000',
      raw: cloneSettings(this.settings)
    }
  }
}
