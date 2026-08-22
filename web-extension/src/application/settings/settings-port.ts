import type { Teardown } from '../ports/browser'
import type { ProgressRepositoryPort } from '../progress'
import type { PersistedSettingsV2, SettingsBackup, SettingsPatch } from '../../domain/settings'
import type { Result } from '../../shared/result'

export type SettingsErrorCode =
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_CORRUPT'
  | 'MIGRATION_FAILED'
  | 'FUTURE_SCHEMA'
  | 'IMPORT_INVALID'
  | 'BACKUP_NOT_FOUND'
  | 'BACKUP_CORRUPT'

export type SettingsError = {
  code: SettingsErrorCode
  message: string
}

export type SettingsMutation = {
  settings: PersistedSettingsV2
  changedPaths: string[]
  rebased: boolean
}

export type SettingsChangedEvent = {
  revision: number
  changedPaths: string[]
  source: string
}

export interface SettingsRepositoryPort extends ProgressRepositoryPort {
  get(): Promise<Result<PersistedSettingsV2, SettingsError>>
  getSnapshot(): Promise<
    Result<{ settings: PersistedSettingsV2; latestBackup: SettingsBackup | null }, SettingsError>
  >
  update(
    patch: SettingsPatch,
    expectedRevision: number | undefined,
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>>
  export(): Promise<Result<string, SettingsError>>
  import(
    content: string,
    expectedRevision: number | undefined,
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>>
  restoreBackup(backupId: string, source: string): Promise<Result<SettingsMutation, SettingsError>>
  reset(
    scope: 'all' | 'global' | 'sites' | 'progress',
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>>
  getLatestBackup(): Promise<Result<SettingsBackup | null, SettingsError>>
  subscribe(listener: (event: SettingsChangedEvent) => void): Teardown
}
