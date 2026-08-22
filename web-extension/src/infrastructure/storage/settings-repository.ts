import type { BrowserStoragePort, ClockPort, Teardown } from '../../application/ports/browser'
import type { LoggerPort } from '../../application/ports/logging'
import type {
  ProgressDeleteResult,
  ProgressError,
  ProgressPruneResult,
  ProgressReadResult,
  ProgressSaveResult
} from '../../application/progress'
import type {
  SettingsChangedEvent,
  SettingsError,
  SettingsMutation,
  SettingsRepositoryPort
} from '../../application/settings/settings-port'
import {
  createProgressRecord,
  enforceProgressPolicy,
  isProgressIdentity,
  isStoredProgressIdentity,
  MAX_PROGRESS_RECORDS,
  type ProgressIdentity,
  type ProgressRecord,
  type ProgressSample
} from '../../domain/progress'
import {
  createDefaultSettings,
  mergeSettings,
  normalizeSiteOrigin,
  resolveSettings,
  SETTINGS_EXPORT_FORMAT_VERSION,
  SETTINGS_SCHEMA_VERSION,
  settingsBackupSchema,
  settingsImportFileSchema,
  type PersistedSettingsV2,
  type SettingsBackup,
  type SettingsData,
  type SettingsPatch
} from '../../domain/settings'
import { createRequestId } from '../../shared/ids'
import { failure, success, type Result } from '../../shared/result'
import { checksumUnknown } from './checksum'
import {
  classifyPersistedSettings,
  migrateSettingsDataV1,
  migrateSettingsDataV2
} from './settings-migrations'
import { SETTINGS_BACKUP_KEY, SETTINGS_STORAGE_KEY } from './settings-storage-keys'

export { SETTINGS_BACKUP_KEY, SETTINGS_STORAGE_KEY } from './settings-storage-keys'
export const MAX_IMPORT_BYTES = 262_144

export type SettingsRepositoryOptions = Readonly<{
  maxProgressRecords?: number
}>

function settingsError(code: SettingsError['code'], message: string): SettingsError {
  return { code, message }
}

function validateIdentities(data: SettingsData): boolean {
  for (const siteId of Object.keys(data.sites)) {
    const normalized = normalizeSiteOrigin(siteId)
    if (!normalized.ok || normalized.value !== siteId) return false
  }
  for (const [key, record] of Object.entries(data.progress)) {
    if (!isStoredProgressIdentity(key, record)) return false
  }
  return true
}

export class SettingsRepository implements SettingsRepositoryPort {
  private mutationTail: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(event: SettingsChangedEvent) => void>()
  private readonly maxProgressRecords: number

  constructor(
    private readonly storage: BrowserStoragePort,
    private readonly clock: ClockPort,
    private readonly logger: LoggerPort,
    options: SettingsRepositoryOptions = {}
  ) {
    const configured = options.maxProgressRecords ?? MAX_PROGRESS_RECORDS
    this.maxProgressRecords =
      Number.isInteger(configured) && configured > 0
        ? Math.min(configured, MAX_PROGRESS_RECORDS)
        : MAX_PROGRESS_RECORDS
  }

  get(): Promise<Result<PersistedSettingsV2, SettingsError>> {
    return this.serialize(() => this.loadCurrent())
  }

  getSnapshot(): Promise<
    Result<{ settings: PersistedSettingsV2; latestBackup: SettingsBackup | null }, SettingsError>
  > {
    return this.serialize(async () => {
      const settings = await this.loadCurrent()
      if (!settings.ok) return settings
      const latestBackup = await this.readBackup()
      if (!latestBackup.ok) return latestBackup
      return success({ settings: settings.value, latestBackup: latestBackup.value })
    })
  }

  update(
    patch: SettingsPatch,
    expectedRevision: number | undefined,
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>> {
    return this.serialize(async () => {
      const current = await this.loadCurrent()
      if (!current.ok) return current
      const merged = mergeSettings(current.value.data, patch)
      const rebased = expectedRevision !== undefined && expectedRevision !== current.value.revision
      const now = this.clock.now()
      const progressPolicy = this.enforceProgressData(merged.data, now)
      const progressChanged =
        progressPolicy.removedKeys.length > 0 || progressPolicy.normalizedKeys.length > 0
      const changedPaths = [...merged.changedPaths]
      if (progressChanged && !changedPaths.includes('progress')) changedPaths.push('progress')

      if (changedPaths.length === 0) {
        return success({ settings: current.value, changedPaths: [], rebased })
      }

      const next: PersistedSettingsV2 = {
        ...current.value,
        revision: current.value.revision + 1,
        updatedAt: now,
        data: progressChanged ? { ...merged.data, progress: progressPolicy.records } : merged.data
      }
      const stored = await this.writeValues({ [SETTINGS_STORAGE_KEY]: next })
      if (!stored.ok) return stored
      this.notify({ revision: next.revision, changedPaths, source })
      return success({ settings: next, changedPaths, rebased })
    })
  }

  export(): Promise<Result<string, SettingsError>> {
    return this.serialize(async () => {
      const current = await this.loadCurrent()
      if (!current.ok) return current
      const progressPolicy = this.enforceProgressData(current.value.data, this.clock.now())
      return success(
        JSON.stringify(
          {
            format: 'h5player.web-extension.settings',
            formatVersion: SETTINGS_EXPORT_FORMAT_VERSION,
            exportedAt: new Date(this.clock.now()).toISOString(),
            data: { ...current.value.data, progress: progressPolicy.records }
          },
          null,
          2
        )
      )
    })
  }

  import(
    content: string,
    expectedRevision: number | undefined,
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>> {
    return this.serialize(async () => {
      if (new TextEncoder().encode(content).byteLength > MAX_IMPORT_BYTES) {
        return failure(settingsError('IMPORT_INVALID', 'Import exceeds the size limit'))
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(content) as unknown
      } catch {
        return failure(settingsError('IMPORT_INVALID', 'Import is not valid JSON'))
      }

      const imported = settingsImportFileSchema.safeParse(parsedJson)
      if (!imported.success) {
        return failure(settingsError('IMPORT_INVALID', 'Import does not match settings schema'))
      }
      const importedData: SettingsData =
        imported.data.formatVersion === SETTINGS_EXPORT_FORMAT_VERSION
          ? imported.data.data
          : imported.data.formatVersion === 2
            ? migrateSettingsDataV2(imported.data.data as SettingsData)
            : migrateSettingsDataV1(imported.data.data)
      if (!validateIdentities(importedData)) {
        return failure(
          settingsError('IMPORT_INVALID', 'Import contains invalid site or progress identities')
        )
      }

      const current = await this.loadCurrent()
      if (!current.ok) return current
      const rebased = expectedRevision !== undefined && expectedRevision !== current.value.revision
      const now = this.clock.now()
      const progressPolicy = this.enforceProgressData(importedData, now)
      const normalizedData: SettingsData = {
        ...importedData,
        progress: progressPolicy.records
      }
      if (JSON.stringify(normalizedData) === JSON.stringify(current.value.data)) {
        return success({ settings: current.value, changedPaths: [], rebased })
      }
      const next: PersistedSettingsV2 = {
        schema: 'h5player.web-extension',
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        revision: current.value.revision + 1,
        updatedAt: now,
        data: normalizedData
      }
      const backup = this.createBackup(current.value, 'import')
      const stored = await this.writeValues({
        [SETTINGS_STORAGE_KEY]: next,
        [SETTINGS_BACKUP_KEY]: backup
      })
      if (!stored.ok) return stored

      const changedPaths = ['global', 'sites', 'progress']
      this.notify({ revision: next.revision, changedPaths, source })
      return success({ settings: next, changedPaths, rebased })
    })
  }

  restoreBackup(
    backupId: string,
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>> {
    return this.serialize(async () => {
      const backupResult = await this.readBackup()
      if (!backupResult.ok) return backupResult
      const backup = backupResult.value
      if (!backup || backup.backupId !== backupId) {
        return failure(settingsError('BACKUP_NOT_FOUND', 'Requested backup was not found'))
      }
      if (checksumUnknown(backup.raw) !== backup.checksum) {
        return failure(settingsError('BACKUP_CORRUPT', 'Backup checksum mismatch'))
      }

      const restored = classifyPersistedSettings(backup.raw, this.clock.now())
      if (restored.kind === 'future') {
        return failure(settingsError('FUTURE_SCHEMA', 'Backup uses a future schema version'))
      }
      if (restored.kind === 'corrupt' || restored.kind === 'missing') {
        return failure(settingsError('BACKUP_CORRUPT', 'Backup cannot be restored'))
      }

      const current = await this.loadCurrent()
      if (!current.ok) return current
      const now = this.clock.now()
      const progressPolicy = this.enforceProgressData(restored.value.data, now)
      const next: PersistedSettingsV2 = {
        schema: 'h5player.web-extension',
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        revision: current.value.revision + 1,
        updatedAt: now,
        data: { ...restored.value.data, progress: progressPolicy.records }
      }
      const rollbackBackup = this.createBackup(current.value, 'rollback')
      const stored = await this.writeValues({
        [SETTINGS_STORAGE_KEY]: next,
        [SETTINGS_BACKUP_KEY]: rollbackBackup
      })
      if (!stored.ok) return stored

      const changedPaths = ['global', 'sites', 'progress']
      this.notify({ revision: next.revision, changedPaths, source })
      return success({ settings: next, changedPaths, rebased: false })
    })
  }

  getLatestBackup(): Promise<Result<SettingsBackup | null, SettingsError>> {
    return this.readBackup()
  }

  reset(
    scope: 'all' | 'global' | 'sites' | 'progress',
    source: string
  ): Promise<Result<SettingsMutation, SettingsError>> {
    return this.serialize(async () => {
      const current = await this.loadCurrent()
      if (!current.ok) return current
      const defaults = createDefaultSettings()
      const nextData: SettingsData = {
        global: scope === 'all' || scope === 'global' ? defaults.global : current.value.data.global,
        sites: scope === 'all' || scope === 'sites' ? {} : current.value.data.sites,
        progress: scope === 'all' || scope === 'progress' ? {} : current.value.data.progress
      }
      const now = this.clock.now()
      const progressPolicy = this.enforceProgressData(nextData, now)
      const normalizedData: SettingsData = { ...nextData, progress: progressPolicy.records }
      if (JSON.stringify(normalizedData) === JSON.stringify(current.value.data)) {
        return success({ settings: current.value, changedPaths: [], rebased: false })
      }

      const next: PersistedSettingsV2 = {
        schema: 'h5player.web-extension',
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        revision: current.value.revision + 1,
        updatedAt: now,
        data: normalizedData
      }
      const backup = this.createBackup(current.value, 'reset')
      const stored = await this.writeValues({
        [SETTINGS_STORAGE_KEY]: next,
        [SETTINGS_BACKUP_KEY]: backup
      })
      if (!stored.ok) return stored
      const changedPaths = scope === 'all' ? ['global', 'sites', 'progress'] : [scope]
      if (
        (progressPolicy.removedKeys.length > 0 || progressPolicy.normalizedKeys.length > 0) &&
        !changedPaths.includes('progress')
      ) {
        changedPaths.push('progress')
      }
      this.notify({ revision: next.revision, changedPaths, source })
      return success({ settings: next, changedPaths, rebased: false })
    })
  }

  saveProgress(
    identity: ProgressIdentity,
    sample: ProgressSample,
    source: string
  ): Promise<Result<ProgressSaveResult, ProgressError>> {
    return this.serialize(async () => {
      const current = await this.loadCurrent()
      if (!current.ok) return failure(current.error)
      if (!isProgressIdentity(identity)) {
        return failure({
          code: 'INVALID_MEDIA_IDENTITY',
          message: 'Progress identity is not canonical'
        })
      }

      const now = this.clock.now()
      const initialPolicy = this.enforceProgressData(current.value.data, now, identity.key)
      const effective = resolveSettings(current.value.data, identity.site)
      const privacyBlocked =
        current.value.data.global.diagnostics.retainProgressDays === 0 ||
        !effective.media.restoreProgress

      if (privacyBlocked) {
        const committed = await this.commitProgressState(
          current.value,
          initialPolicy.records,
          source
        )
        if (!committed.ok) return committed
        return success({
          saved: false,
          privacyBlocked: true,
          record: null,
          revision: committed.value.revision,
          prunedCount: initialPolicy.removedKeys.length,
          evictedCount: 0
        })
      }

      const recordResult = createProgressRecord(
        identity,
        sample,
        now,
        current.value.data.global.diagnostics.retainProgressDays
      )
      if (!recordResult.ok) return failure(recordResult.error)

      const candidateRecords: Readonly<Record<string, ProgressRecord>> = {
        ...initialPolicy.records,
        [identity.key]: recordResult.value
      }
      const finalPolicy = enforceProgressPolicy(candidateRecords, {
        now,
        retainProgressDays: current.value.data.global.diagnostics.retainProgressDays,
        maxRecords: this.maxProgressRecords,
        protectedKey: identity.key,
        restoreEnabled: (site) => resolveSettings(current.value.data, site).media.restoreProgress
      })
      const initialRemoved = new Set(initialPolicy.removedKeys)
      const evictedCount = finalPolicy.removedKeys.filter((key) => !initialRemoved.has(key)).length
      const committed = await this.commitProgressState(current.value, finalPolicy.records, source)
      if (!committed.ok) return committed
      const saved = identity.key in finalPolicy.records
      return success({
        saved,
        privacyBlocked: false,
        record: saved ? (finalPolicy.records[identity.key] ?? null) : null,
        revision: committed.value.revision,
        prunedCount: initialPolicy.removedKeys.length,
        evictedCount
      })
    })
  }

  readProgress(
    identity: ProgressIdentity,
    source: string
  ): Promise<Result<ProgressReadResult, ProgressError>> {
    return this.serialize(async () => {
      const current = await this.loadCurrent()
      if (!current.ok) return failure(current.error)
      if (!isProgressIdentity(identity)) {
        return failure({
          code: 'INVALID_MEDIA_IDENTITY',
          message: 'Progress identity is not canonical'
        })
      }

      const now = this.clock.now()
      const policy = this.enforceProgressData(current.value.data, now, identity.key)
      const effective = resolveSettings(current.value.data, identity.site)
      const privacyBlocked =
        current.value.data.global.diagnostics.retainProgressDays === 0 ||
        !effective.media.restoreProgress
      const committed = await this.commitProgressState(current.value, policy.records, source)
      if (!committed.ok) return committed
      const stored = policy.records[identity.key]
      const record =
        !privacyBlocked &&
        stored &&
        stored.site === identity.site &&
        stored.mediaKey === identity.mediaKey
          ? stored
          : null
      return success({
        record,
        privacyBlocked,
        revision: committed.value.revision,
        prunedCount: policy.removedKeys.length
      })
    })
  }

  deleteProgress(
    identity: ProgressIdentity,
    source: string
  ): Promise<Result<ProgressDeleteResult, ProgressError>> {
    return this.serialize(async () => {
      const current = await this.loadCurrent()
      if (!current.ok) return failure(current.error)
      if (!isProgressIdentity(identity)) {
        return failure({
          code: 'INVALID_MEDIA_IDENTITY',
          message: 'Progress identity is not canonical'
        })
      }

      const now = this.clock.now()
      const policy = this.enforceProgressData(current.value.data, now, identity.key)
      const existingRecord = current.value.data.progress[identity.key]
      const existed = existingRecord
        ? isStoredProgressIdentity(identity.key, existingRecord) &&
          existingRecord.site === identity.site &&
          existingRecord.mediaKey === identity.mediaKey
        : false
      const nextRecords = { ...policy.records }
      if (identity.key in nextRecords) delete nextRecords[identity.key]
      const committed = await this.commitProgressState(current.value, nextRecords, source)
      if (!committed.ok) return committed
      return success({
        deleted: existed,
        revision: committed.value.revision,
        prunedCount: policy.removedKeys.length
      })
    })
  }

  pruneProgress(source: string): Promise<Result<ProgressPruneResult, ProgressError>> {
    return this.serialize(async () => {
      const current = await this.loadCurrent()
      if (!current.ok) return failure(current.error)
      const policy = this.enforceProgressData(current.value.data, this.clock.now())
      const committed = await this.commitProgressState(current.value, policy.records, source)
      if (!committed.ok) return committed
      return success({
        removedCount: policy.removedKeys.length,
        normalizedCount: policy.normalizedKeys.length,
        remainingCount: Object.keys(policy.records).length,
        revision: committed.value.revision
      })
    })
  }

  subscribe(listener: (event: SettingsChangedEvent) => void): Teardown {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private enforceProgressData(
    data: SettingsData,
    now: number,
    protectedKey?: string
  ): ReturnType<typeof enforceProgressPolicy> {
    const basePolicy = {
      now,
      retainProgressDays: data.global.diagnostics.retainProgressDays,
      maxRecords: this.maxProgressRecords,
      restoreEnabled: (site: string) => resolveSettings(data, site).media.restoreProgress
    }
    return protectedKey === undefined
      ? enforceProgressPolicy(data.progress, basePolicy)
      : enforceProgressPolicy(data.progress, { ...basePolicy, protectedKey })
  }

  private async commitProgressState(
    current: PersistedSettingsV2,
    progress: Readonly<Record<string, ProgressRecord>>,
    source: string
  ): Promise<Result<{ revision: number }, ProgressError>> {
    if (JSON.stringify(progress) === JSON.stringify(current.data.progress)) {
      return success({ revision: current.revision })
    }

    const next: PersistedSettingsV2 = {
      ...current,
      revision: current.revision + 1,
      updatedAt: this.clock.now(),
      data: { ...current.data, progress }
    }
    const stored = await this.writeValues({ [SETTINGS_STORAGE_KEY]: next })
    if (!stored.ok) return failure(stored.error)
    this.notify({ revision: next.revision, changedPaths: ['progress'], source })
    return success({ revision: next.revision })
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(work, work)
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async loadCurrent(): Promise<Result<PersistedSettingsV2, SettingsError>> {
    const rawResult = await this.readValue(SETTINGS_STORAGE_KEY)
    if (!rawResult.ok) return rawResult
    const outcome = classifyPersistedSettings(rawResult.value, this.clock.now())

    if (outcome.kind === 'current') return success(outcome.value)
    if (outcome.kind === 'future') {
      return failure(
        settingsError('FUTURE_SCHEMA', `Unsupported schema version ${outcome.schemaVersion}`)
      )
    }

    if (outcome.kind === 'missing') {
      const stored = await this.writeValues({ [SETTINGS_STORAGE_KEY]: outcome.value })
      return stored.ok ? success(outcome.value) : stored
    }

    if (outcome.kind === 'migrated') {
      const backup = this.createBackup(outcome.raw, 'migration')
      const stored = await this.writeValues({
        [SETTINGS_STORAGE_KEY]: outcome.value,
        [SETTINGS_BACKUP_KEY]: backup
      })
      if (!stored.ok) return stored
      this.logger.log({
        level: 'info',
        module: 'settings-repository',
        eventCode: 'SETTINGS_MIGRATED',
        details: { schemaVersion: SETTINGS_SCHEMA_VERSION }
      })
      return success(outcome.value)
    }

    const recovered: PersistedSettingsV2 = {
      schema: 'h5player.web-extension',
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      revision: 0,
      updatedAt: this.clock.now(),
      data: createDefaultSettings()
    }
    const backup = this.createBackup(outcome.raw, 'corrupt-recovery')
    const stored = await this.writeValues({
      [SETTINGS_STORAGE_KEY]: recovered,
      [SETTINGS_BACKUP_KEY]: backup
    })
    if (!stored.ok) return stored
    this.logger.log({
      level: 'warn',
      module: 'settings-repository',
      eventCode: 'SETTINGS_CORRUPT_RECOVERED'
    })
    return success(recovered)
  }

  private createBackup(raw: unknown, reason: SettingsBackup['reason']): SettingsBackup {
    return {
      backupId: createRequestId(),
      createdAt: this.clock.now(),
      reason,
      checksum: checksumUnknown(raw),
      raw
    }
  }

  private async readBackup(): Promise<Result<SettingsBackup | null, SettingsError>> {
    const raw = await this.readValue(SETTINGS_BACKUP_KEY)
    if (!raw.ok) return raw
    if (raw.value === undefined) return success(null)
    const parsed = settingsBackupSchema.safeParse(raw.value)
    return parsed.success
      ? success(parsed.data)
      : failure(settingsError('BACKUP_CORRUPT', 'Stored backup is invalid'))
  }

  private async readValue(key: string): Promise<Result<unknown, SettingsError>> {
    try {
      return success(await this.storage.get(key))
    } catch (error) {
      return failure(
        settingsError(
          'STORAGE_READ_FAILED',
          error instanceof Error ? error.message : 'Storage read failed'
        )
      )
    }
  }

  private async writeValues(
    values: Readonly<Record<string, unknown>>
  ): Promise<Result<void, SettingsError>> {
    try {
      await this.storage.set(values)
      return success(undefined)
    } catch (error) {
      return failure(
        settingsError(
          'STORAGE_WRITE_FAILED',
          error instanceof Error ? error.message : 'Storage write failed'
        )
      )
    }
  }

  private notify(event: SettingsChangedEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
