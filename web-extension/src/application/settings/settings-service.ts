import { failure, success, type Result } from '../../shared/result'
import type {
  ProgressDeleteResult,
  ProgressError,
  ProgressPruneResult,
  ProgressReadResult,
  ProgressRepositoryPort,
  ProgressSaveResult
} from '../progress'
import type { ProgressIdentity, ProgressSample } from '../../domain/progress'
import type { PersistedSettingsV2, SettingsBackup, SettingsPatch } from '../../domain/settings'
import type { SettingsError, SettingsMutation, SettingsRepositoryPort } from './settings-port'

export class SettingsService implements ProgressRepositoryPort {
  constructor(private readonly repository: SettingsRepositoryPort) {}

  async getSnapshot(): Promise<
    Result<
      {
        settings: PersistedSettingsV2
        latestBackup: SettingsBackup | null
      },
      SettingsError
    >
  > {
    const snapshot = await this.repository.getSnapshot()
    return snapshot.ok ? success(snapshot.value) : failure(snapshot.error)
  }

  update(
    patch: SettingsPatch,
    expectedRevision: number | undefined,
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>> {
    return this.repository.update(patch, expectedRevision, source)
  }

  export(): Promise<Result<string, SettingsError>> {
    return this.repository.export()
  }

  import(
    content: string,
    expectedRevision: number | undefined,
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>> {
    return this.repository.import(content, expectedRevision, source)
  }

  restoreBackup(
    backupId: string,
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>> {
    return this.repository.restoreBackup(backupId, source)
  }

  reset(
    scope: 'all' | 'global' | 'sites' | 'progress',
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>> {
    return this.repository.reset(scope, source)
  }

  saveProgress(
    identity: ProgressIdentity,
    sample: ProgressSample,
    source: string
  ): Promise<Result<ProgressSaveResult, ProgressError>> {
    return this.repository.saveProgress(identity, sample, source)
  }

  readProgress(
    identity: ProgressIdentity,
    source: string
  ): Promise<Result<ProgressReadResult, ProgressError>> {
    return this.repository.readProgress(identity, source)
  }

  deleteProgress(
    identity: ProgressIdentity,
    source: string
  ): Promise<Result<ProgressDeleteResult, ProgressError>> {
    return this.repository.deleteProgress(identity, source)
  }

  pruneProgress(source: string): Promise<Result<ProgressPruneResult, ProgressError>> {
    return this.repository.pruneProgress(source)
  }
}
