import { describe, expect, it } from 'vitest'
import {
  createProgressIdentity,
  createProgressRecord,
  enforceProgressPolicy,
  isProgressIdentity,
  PROGRESS_RETENTION_MILLISECONDS_PER_DAY,
  type ProgressIdentity,
  type ProgressRecord
} from '../../src/domain/progress'

function identity(input: Parameters<typeof createProgressIdentity>[0]): ProgressIdentity {
  const result = createProgressIdentity(input)
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

function record(
  progressIdentity: ProgressIdentity,
  updatedAt: number,
  retainProgressDays = 30
): ProgressRecord {
  const result = createProgressRecord(
    progressIdentity,
    { positionSeconds: 12, durationSeconds: 120 },
    updatedAt,
    retainProgressDays
  )
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

describe('progress domain', () => {
  it('creates deterministic identities without retaining source, query, or fragment data', () => {
    const first = identity({
      pageUrl: 'https://Example.com/watch/episode?account=alice#comments',
      mediaSourceUrl: 'https://cdn.example.com/private/video.mp4?token=secret-a#segment'
    })
    const second = identity({
      pageUrl: 'https://example.com/watch/episode?account=bob#other',
      mediaSourceUrl: 'https://cdn.example.com/private/video.mp4?token=secret-b#different'
    })

    expect(first).toEqual(second)
    expect(first.site).toBe('https://example.com')
    expect(first.mediaKey).toMatch(/^source:fnv1a64:[a-f0-9]{16}$/)
    expect(first.key).toMatch(/^progress:fnv1a64:[a-f0-9]{16}$/)
    expect(isProgressIdentity(first)).toBe(true)
    expect(JSON.stringify(first)).not.toMatch(/alice|bob|secret|video\.mp4|watch\/episode/)
  })

  it('prefers a hashed stable media id and rejects unsupported page identities', () => {
    const first = identity({
      pageUrl: 'https://example.com/watch',
      stableMediaId: 'episode-42?private=true',
      mediaSourceUrl: 'https://cdn.example.com/first.mp4'
    })
    const second = identity({
      pageUrl: 'https://example.com/other',
      stableMediaId: 'episode-42?private=true',
      mediaSourceUrl: 'https://cdn.example.com/second.mp4'
    })
    expect(first.mediaKey).toBe(second.mediaKey)
    expect(first.mediaKey).toMatch(/^stable:fnv1a64:/)
    expect(first.mediaKey).not.toContain('episode-42')

    expect(createProgressIdentity({ pageUrl: 'file:///tmp/video.mp4' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PROGRESS_SITE' }
    })
  })

  it('validates samples, clamps transient position overflow, and calculates TTL', () => {
    const progressIdentity = identity({
      pageUrl: 'https://example.com/watch',
      stableMediaId: 'episode-1'
    })
    const now = 1_700_000_000_000
    const created = createProgressRecord(
      progressIdentity,
      { positionSeconds: 125, durationSeconds: 120 },
      now,
      7
    )

    expect(created).toMatchObject({
      ok: true,
      value: {
        positionSeconds: 120,
        durationSeconds: 120,
        updatedAt: now,
        expiresAt: now + 7 * PROGRESS_RETENTION_MILLISECONDS_PER_DAY
      }
    })
    expect(
      createProgressRecord(
        progressIdentity,
        { positionSeconds: Number.NaN, durationSeconds: null },
        now,
        7
      )
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PROGRESS_POSITION' } })
    expect(
      createProgressRecord(progressIdentity, { positionSeconds: 1, durationSeconds: -1 }, now, 7)
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PROGRESS_DURATION' } })
    expect(
      createProgressRecord(progressIdentity, { positionSeconds: 1, durationSeconds: null }, now, 0)
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PROGRESS_RETENTION' } })
  })

  it('enforces expiry, current retention, privacy, canonical identity, and capacity', () => {
    const first = identity({ pageUrl: 'https://a.example/watch', stableMediaId: 'first' })
    const second = identity({ pageUrl: 'https://b.example/watch', stableMediaId: 'second' })
    const third = identity({ pageUrl: 'https://c.example/watch', stableMediaId: 'third' })
    const now = 1_700_000_000_000
    const records: Record<string, ProgressRecord> = {
      [first.key]: record(first, now - 4 * PROGRESS_RETENTION_MILLISECONDS_PER_DAY, 30),
      [second.key]: record(second, now - 2_000, 30),
      [third.key]: record(third, now - 1_000, 30),
      'raw:https://private.example/video?token=secret': {
        site: 'https://a.example',
        mediaKey: 'https://private.example/video?token=secret',
        positionSeconds: 1,
        durationSeconds: 2,
        updatedAt: now,
        expiresAt: now + PROGRESS_RETENTION_MILLISECONDS_PER_DAY
      }
    }

    const result = enforceProgressPolicy(records, {
      now,
      retainProgressDays: 3,
      maxRecords: 1,
      protectedKey: third.key,
      restoreEnabled: (site) => site !== second.site
    })

    expect(Object.keys(result.records)).toEqual([third.key])
    expect(result.removedKeys).toEqual(
      expect.arrayContaining([
        first.key,
        second.key,
        'raw:https://private.example/video?token=secret'
      ])
    )
    const thirdRecord = records[third.key]
    if (!thirdRecord) throw new Error('third record missing')
    expect(result.records[third.key]?.expiresAt).toBe(
      thirdRecord.updatedAt + 3 * PROGRESS_RETENTION_MILLISECONDS_PER_DAY
    )
    expect(result.normalizedKeys).toContain(third.key)
  })

  it('treats zero-day retention as a hard privacy gate', () => {
    const progressIdentity = identity({
      pageUrl: 'https://example.com/watch',
      stableMediaId: 'episode'
    })
    const records = { [progressIdentity.key]: record(progressIdentity, 100) }
    expect(
      enforceProgressPolicy(records, {
        now: 100,
        retainProgressDays: 0,
        maxRecords: 10,
        restoreEnabled: () => true
      })
    ).toEqual({ records: {}, removedKeys: [progressIdentity.key], normalizedKeys: [] })
  })
})
