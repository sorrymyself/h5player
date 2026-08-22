import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '../../src/domain/settings'
import {
  SETTINGS_BACKUP_KEY,
  SETTINGS_STORAGE_KEY,
  SettingsRepository
} from '../../src/infrastructure/storage/settings-repository'
import { FakeClock, FakeLogger, FakeStoragePort } from '../test-support/fakes'

function createRepository(storage = new FakeStoragePort(), clock = new FakeClock()) {
  const logger = new FakeLogger()
  return { repository: new SettingsRepository(storage, clock, logger), storage, clock, logger }
}

describe('settings repository', () => {
  it('initializes defaults and survives a service-worker style reconstruction', async () => {
    const { repository, storage, clock } = createRepository()
    const initial = await repository.get()
    expect(initial.ok && initial.value.revision).toBe(0)

    const restarted = new SettingsRepository(storage, clock, new FakeLogger())
    const restored = await restarted.get()
    expect(restored).toEqual(initial)
  })

  it('migrates N-1 with a verified backup', async () => {
    const storage = new FakeStoragePort({
      [SETTINGS_STORAGE_KEY]: {
        schema: 'h5player.web-extension',
        schemaVersion: 0,
        revision: 2,
        updatedAt: 10,
        data: { enabled: false, defaultPlaybackRate: 2, defaultVolume: 0.5 }
      }
    })
    const { repository, logger } = createRepository(storage)
    const result = await repository.get()
    const backup = await repository.getLatestBackup()

    expect(result.ok && result.value.revision).toBe(3)
    expect(result.ok && result.value.data.global.enabled).toBe(false)
    expect(backup.ok && backup.value?.reason).toBe('migration')
    expect(logger.records.some((record) => record.eventCode === 'SETTINGS_MIGRATED')).toBe(true)
  })

  it('backs up corrupt data and starts from safe defaults', async () => {
    const corrupt = { schema: 'h5player.web-extension', schemaVersion: 1, data: 'broken' }
    const { repository, storage, logger } = createRepository(
      new FakeStoragePort({ [SETTINGS_STORAGE_KEY]: corrupt })
    )

    const recovered = await repository.get()
    const snapshot = storage.snapshot()
    expect(recovered.ok && recovered.value.data).toEqual(createDefaultSettings())
    expect(snapshot[SETTINGS_BACKUP_KEY]).toMatchObject({
      reason: 'corrupt-recovery',
      raw: corrupt
    })
    expect(logger.records.some((record) => record.eventCode === 'SETTINGS_CORRUPT_RECOVERED')).toBe(
      true
    )
  })

  it('does not overwrite future schema data', async () => {
    const future = { schema: 'h5player.web-extension', schemaVersion: 9, data: {} }
    const storage = new FakeStoragePort({ [SETTINGS_STORAGE_KEY]: future })
    const { repository } = createRepository(storage)

    await expect(repository.get()).resolves.toMatchObject({
      ok: false,
      error: { code: 'FUTURE_SCHEMA' }
    })
    expect(storage.snapshot()[SETTINGS_STORAGE_KEY]).toBe(future)
    expect(storage.snapshot()[SETTINGS_BACKUP_KEY]).toBeUndefined()
  })

  it('serializes concurrent field patches without losing unrelated changes', async () => {
    const storage = new FakeStoragePort()
    storage.writeDelayMs = 2
    const { repository } = createRepository(storage)
    await repository.get()

    const events: unknown[] = []
    const unsubscribe = repository.subscribe((event) => events.push(event))
    const [first, second] = await Promise.all([
      repository.update({ global: { enabled: false } }, 0, 'tab-1'),
      repository.update({ global: { media: { defaultPlaybackRate: 2 } } }, 0, 'tab-2')
    ])
    unsubscribe()

    const final = await repository.get()
    expect(first.ok && first.value.settings.revision).toBe(1)
    expect(second.ok && second.value.rebased).toBe(true)
    expect(final.ok && final.value.data.global.enabled).toBe(false)
    expect(final.ok && final.value.data.global.media.defaultPlaybackRate).toBe(2)
    expect(events).toHaveLength(2)
  })

  it('keeps invalid imports atomic and supports import rollback', async () => {
    const { repository, storage } = createRepository()
    await repository.get()
    const before = JSON.stringify(storage.snapshot())

    await expect(repository.import('{broken', 0, 'options')).resolves.toMatchObject({
      ok: false,
      error: { code: 'IMPORT_INVALID' }
    })
    expect(JSON.stringify(storage.snapshot())).toBe(before)

    const data = createDefaultSettings()
    data.global.enabled = false
    data.sites['https://example.com'] = { enabled: false }
    const imported = await repository.import(
      JSON.stringify({
        format: 'h5player.web-extension.settings',
        formatVersion: 3,
        exportedAt: '2026-08-10T00:00:00.000Z',
        data
      }),
      0,
      'options'
    )
    expect(imported.ok && imported.value.settings.data.global.enabled).toBe(false)

    const backup = await repository.getLatestBackup()
    if (!backup.ok || !backup.value) throw new Error('backup missing')
    const restored = await repository.restoreBackup(backup.value.backupId, 'options')
    expect(restored.ok && restored.value.settings.data.global.enabled).toBe(true)
  })

  it('exports a schema-valid document and reports storage failures', async () => {
    const { repository, storage } = createRepository()
    const exported = await repository.export()
    expect(exported.ok && JSON.parse(exported.value)).toMatchObject({
      format: 'h5player.web-extension.settings',
      formatVersion: 3
    })

    storage.failReads = true
    await expect(repository.getLatestBackup()).resolves.toMatchObject({
      ok: false,
      error: { code: 'STORAGE_READ_FAILED' }
    })
  })

  it('does not increment revision for a no-op and reports write failures', async () => {
    const { repository, storage } = createRepository()
    const initial = await repository.get()
    const noOp = await repository.update({ global: { enabled: true } }, 0, 'options')
    expect(initial.ok && noOp.ok && noOp.value.settings.revision).toBe(0)
    expect(noOp.ok && noOp.value.changedPaths).toEqual([])

    storage.failWrites = true
    await expect(
      repository.update({ global: { enabled: false } }, 0, 'options')
    ).resolves.toMatchObject({ ok: false, error: { code: 'STORAGE_WRITE_FAILED' } })
  })

  it('rejects oversized and non-normalized site imports before writing', async () => {
    const { repository, storage } = createRepository()
    await repository.get()
    const before = JSON.stringify(storage.snapshot())
    await expect(repository.import('x'.repeat(262_145), 0, 'options')).resolves.toMatchObject({
      ok: false,
      error: { code: 'IMPORT_INVALID' }
    })

    const data = createDefaultSettings()
    data.sites['https://EXAMPLE.com/path'] = { enabled: false }
    await expect(
      repository.import(
        JSON.stringify({
          format: 'h5player.web-extension.settings',
          formatVersion: 2,
          exportedAt: '2026-08-10T00:00:00.000Z',
          data
        }),
        0,
        'options'
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'IMPORT_INVALID' } })
    expect(JSON.stringify(storage.snapshot())).toBe(before)
  })

  it('refuses missing or checksum-corrupted backups', async () => {
    const { repository } = createRepository()
    await repository.get()
    await expect(repository.restoreBackup('missing-backup', 'options')).resolves.toMatchObject({
      ok: false,
      error: { code: 'BACKUP_NOT_FOUND' }
    })

    const storage = new FakeStoragePort({
      [SETTINGS_BACKUP_KEY]: {
        backupId: 'backup-identifier-1',
        createdAt: 100,
        reason: 'import',
        checksum: 'fnv1a64:0000000000000000',
        raw: { schemaVersion: 1 }
      }
    })
    const corrupted = createRepository(storage).repository
    await expect(corrupted.restoreBackup('backup-identifier-1', 'options')).resolves.toMatchObject({
      ok: false,
      error: { code: 'BACKUP_CORRUPT' }
    })
  })
})
