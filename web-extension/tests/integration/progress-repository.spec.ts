import { describe, expect, it } from 'vitest'
import { ProgressService } from '../../src/application/progress'
import { SettingsService } from '../../src/application/settings/settings-service'
import { createProgressIdentity } from '../../src/domain/progress'
import { createDefaultSettings } from '../../src/domain/settings'
import {
  SETTINGS_STORAGE_KEY,
  SettingsRepository,
  type SettingsRepositoryOptions
} from '../../src/infrastructure/storage/settings-repository'
import { FakeClock, FakeLogger, FakeStoragePort } from '../test-support/fakes'

function createHarness(
  options: SettingsRepositoryOptions = {},
  storage = new FakeStoragePort(),
  clock = new FakeClock()
) {
  const repository = new SettingsRepository(storage, clock, new FakeLogger(), options)
  const settings = new SettingsService(repository)
  return {
    repository,
    progress: new ProgressService(settings),
    settings,
    storage,
    clock
  }
}

async function enableProgress(
  repository: SettingsRepository,
  retainProgressDays = 30
): Promise<void> {
  const result = await repository.update(
    {
      global: {
        media: { restoreProgress: true },
        diagnostics: { retainProgressDays }
      }
    },
    undefined,
    'test'
  )
  if (!result.ok) throw new Error(result.error.code)
}

const episode = {
  pageUrl: 'https://example.com/watch/episode?viewer=alice#comments',
  mediaSourceUrl: 'https://cdn.example.com/private/video.mp4?token=secret#fragment'
} as const

describe('progress repository', () => {
  it('blocks persistence by default and stores only de-sensitive identity when enabled', async () => {
    const { repository, progress, storage } = createHarness()
    const blocked = await progress.save({ ...episode, positionSeconds: 15, durationSeconds: 100 })
    expect(blocked).toMatchObject({
      ok: true,
      value: { saved: false, privacyBlocked: true, record: null }
    })

    await enableProgress(repository)
    const saved = await progress.save({ ...episode, positionSeconds: 15, durationSeconds: 100 })
    expect(saved).toMatchObject({
      ok: true,
      value: {
        saved: true,
        privacyBlocked: false,
        record: { site: 'https://example.com', positionSeconds: 15 }
      }
    })
    const serialized = JSON.stringify(storage.snapshot()[SETTINGS_STORAGE_KEY])
    expect(serialized).not.toMatch(/viewer=alice|secret|fragment|video\.mp4|watch\/episode/)

    const read = await progress.read({
      pageUrl: 'https://example.com/watch/episode?viewer=bob#other',
      mediaSourceUrl: 'https://cdn.example.com/private/video.mp4?token=different#other'
    })
    expect(read.ok && read.value.record?.positionSeconds).toBe(15)
  })

  it('expires records at TTL and persists pruning atomically', async () => {
    const { repository, progress, clock, storage } = createHarness()
    await enableProgress(repository, 1)
    await progress.save({ ...episode, positionSeconds: 20, durationSeconds: 100 })
    clock.advance(86_400_000)

    const read = await progress.read(episode)
    expect(read).toMatchObject({
      ok: true,
      value: { record: null, prunedCount: 1, privacyBlocked: false }
    })
    const envelope = storage.snapshot()[SETTINGS_STORAGE_KEY]
    expect(envelope).toMatchObject({ data: { progress: {} } })
  })

  it('evicts the oldest record at capacity while protecting the current save', async () => {
    const { repository, progress, clock } = createHarness({ maxProgressRecords: 2 })
    await enableProgress(repository)
    const first = { pageUrl: 'https://example.com/one', stableMediaId: 'one' }
    const second = { pageUrl: 'https://example.com/two', stableMediaId: 'two' }
    const third = { pageUrl: 'https://example.com/three', stableMediaId: 'three' }

    await progress.save({ ...first, positionSeconds: 1 })
    clock.advance(1)
    await progress.save({ ...second, positionSeconds: 2 })
    clock.advance(1)
    const saved = await progress.save({ ...third, positionSeconds: 3 })

    expect(saved).toMatchObject({ ok: true, value: { saved: true, evictedCount: 1 } })
    expect(await progress.read(first)).toMatchObject({ ok: true, value: { record: null } })
    expect(await progress.read(second)).toMatchObject({
      ok: true,
      value: { record: { positionSeconds: 2 } }
    })
    expect(await progress.read(third)).toMatchObject({
      ok: true,
      value: { record: { positionSeconds: 3 } }
    })
  })

  it('clears affected records when restore or retention privacy gates are disabled', async () => {
    const { repository, progress, settings } = createHarness()
    await enableProgress(repository)
    await progress.save({ ...episode, positionSeconds: 25 })

    const disabled = await settings.update(
      { global: { media: { restoreProgress: false } } },
      undefined,
      'options'
    )
    expect(disabled.ok).toBe(true)
    if (!disabled.ok) throw new Error(disabled.error.code)
    expect(disabled.value.changedPaths).toEqual(
      expect.arrayContaining(['global.media.restoreProgress', 'progress'])
    )
    expect(disabled.value.settings.data.progress).toEqual({})
    expect(await progress.read(episode)).toMatchObject({
      ok: true,
      value: { privacyBlocked: true, record: null }
    })

    await settings.update(
      {
        sites: {
          'https://example.com': {
            enabled: true,
            media: { restoreProgress: true }
          }
        }
      },
      undefined,
      'options'
    )
    expect(await progress.save({ ...episode, positionSeconds: 30 })).toMatchObject({
      ok: true,
      value: { saved: true, privacyBlocked: false }
    })

    const zeroRetention = await settings.update(
      { global: { diagnostics: { retainProgressDays: 0 } } },
      undefined,
      'options'
    )
    expect(zeroRetention.ok && zeroRetention.value.settings.data.progress).toEqual({})
    expect(await progress.save({ ...episode, positionSeconds: 35 })).toMatchObject({
      ok: true,
      value: { saved: false, privacyBlocked: true }
    })
  })

  it('serializes concurrent saves and survives repository reconstruction', async () => {
    const storage = new FakeStoragePort()
    storage.writeDelayMs = 2
    const clock = new FakeClock()
    const { repository, progress } = createHarness({}, storage, clock)
    await enableProgress(repository)

    await Promise.all([
      progress.save({
        pageUrl: 'https://example.com/one',
        stableMediaId: 'one',
        positionSeconds: 1
      }),
      progress.save({
        pageUrl: 'https://example.com/two',
        stableMediaId: 'two',
        positionSeconds: 2
      })
    ])

    const restarted = new ProgressService(
      new SettingsRepository(storage, clock, new FakeLogger(), { maxProgressRecords: 10 })
    )
    expect(
      await restarted.read({ pageUrl: 'https://example.com/one', stableMediaId: 'one' })
    ).toMatchObject({
      ok: true,
      value: { record: { positionSeconds: 1 } }
    })
    expect(
      await restarted.read({ pageUrl: 'https://example.com/two', stableMediaId: 'two' })
    ).toMatchObject({
      ok: true,
      value: { record: { positionSeconds: 2 } }
    })
  })

  it('supports delete and explicit prune with revisioned change events', async () => {
    const { repository, progress, clock } = createHarness()
    await enableProgress(repository, 1)
    const events: unknown[] = []
    const unsubscribe = repository.subscribe((event) => events.push(event))
    await progress.save({ ...episode, positionSeconds: 40 })
    const deleted = await progress.delete(episode)
    expect(deleted).toMatchObject({ ok: true, value: { deleted: true } })

    await progress.save({ ...episode, positionSeconds: 45 })
    clock.advance(86_400_000)
    const pruned = await progress.prune()
    unsubscribe()
    expect(pruned).toMatchObject({
      ok: true,
      value: { removedCount: 1, remainingCount: 0 }
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ changedPaths: ['progress'], source: 'progress-service' })
      ])
    )
  })

  it('returns structured validation and storage failures without partial writes', async () => {
    const { repository, progress, storage } = createHarness()
    await enableProgress(repository)
    expect(await progress.save({ pageUrl: 'file:///tmp/video', positionSeconds: 1 })).toMatchObject(
      {
        ok: false,
        error: { code: 'INVALID_PROGRESS_SITE' }
      }
    )
    expect(await progress.save({ ...episode, positionSeconds: -1 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PROGRESS_POSITION' }
    })

    const before = JSON.stringify(storage.snapshot())
    storage.failWrites = true
    expect(await progress.save({ ...episode, positionSeconds: 50 })).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_WRITE_FAILED' }
    })
    expect(JSON.stringify(storage.snapshot())).toBe(before)
  })

  it('rejects imported progress records that expose a raw media source', async () => {
    const { repository, storage } = createHarness()
    await repository.get()
    const before = JSON.stringify(storage.snapshot())
    const data = createDefaultSettings()
    data.global.media.restoreProgress = true
    data.progress['raw-source'] = {
      site: 'https://example.com',
      mediaKey: 'https://cdn.example.com/video.mp4?token=secret',
      positionSeconds: 10,
      durationSeconds: 100,
      updatedAt: 1_700_000_000_000,
      expiresAt: 1_700_086_400_000
    }

    const result = await repository.import(
      JSON.stringify({
        format: 'h5player.web-extension.settings',
        formatVersion: 3,
        exportedAt: '2026-08-11T00:00:00.000Z',
        data
      }),
      undefined,
      'options'
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'IMPORT_INVALID' } })
    expect(JSON.stringify(storage.snapshot())).toBe(before)
  })

  it('strips legacy title hints from imported progress and exported settings', async () => {
    const { repository, storage, clock } = createHarness()
    const progressIdentity = createProgressIdentity({
      pageUrl: 'https://example.com/watch',
      stableMediaId: 'episode-42'
    })
    if (!progressIdentity.ok) throw new Error(progressIdentity.error.code)
    const data = createDefaultSettings()
    data.global.media.restoreProgress = true
    data.progress[progressIdentity.value.key] = {
      site: progressIdentity.value.site,
      mediaKey: progressIdentity.value.mediaKey,
      positionSeconds: 10,
      durationSeconds: 100,
      titleHint: 'Private viewing title',
      updatedAt: clock.now(),
      expiresAt: clock.now() + 86_400_000
    }

    const imported = await repository.import(
      JSON.stringify({
        format: 'h5player.web-extension.settings',
        formatVersion: 3,
        exportedAt: '2026-08-11T00:00:00.000Z',
        data
      }),
      undefined,
      'options'
    )
    expect(imported.ok).toBe(true)
    const serializedStorage = JSON.stringify(storage.snapshot()[SETTINGS_STORAGE_KEY])
    expect(serializedStorage).not.toContain('Private viewing title')
    expect(serializedStorage).not.toContain('titleHint')

    const exported = await repository.export()
    expect(exported.ok).toBe(true)
    if (!exported.ok) throw new Error(exported.error.code)
    expect(exported.value).not.toContain('Private viewing title')
    expect(exported.value).not.toContain('titleHint')
  })
})
