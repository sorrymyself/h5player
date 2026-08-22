import { isStoredProgressIdentity } from './identity'
import {
  MAX_PROGRESS_RECORDS,
  MAX_PROGRESS_RETENTION_DAYS,
  PROGRESS_RETENTION_MILLISECONDS_PER_DAY,
  type ProgressPolicy,
  type ProgressPolicyResult,
  type ProgressRecord
} from './model'

function normalizedCapacity(value: number): number {
  if (!Number.isInteger(value) || value < 1) return 1
  return Math.min(value, MAX_PROGRESS_RECORDS)
}

function validRetentionDays(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_PROGRESS_RETENTION_DAYS
}

function removeSensitiveLegacyFields(record: ProgressRecord): ProgressRecord {
  if (!Object.prototype.hasOwnProperty.call(record, 'titleHint')) return record
  const sanitized = { ...record }
  delete sanitized.titleHint
  return sanitized
}

function evictionOrder(
  left: readonly [string, ProgressRecord],
  right: readonly [string, ProgressRecord],
  protectedKey?: string
): number {
  if (left[0] === right[0]) return 0
  if (left[0] === protectedKey) return 1
  if (right[0] === protectedKey) return -1
  if (left[1].updatedAt !== right[1].updatedAt) {
    return left[1].updatedAt - right[1].updatedAt
  }
  if (left[1].expiresAt !== right[1].expiresAt) {
    return left[1].expiresAt - right[1].expiresAt
  }
  return left[0].localeCompare(right[0])
}

export function enforceProgressPolicy(
  records: Readonly<Record<string, ProgressRecord>>,
  policy: ProgressPolicy
): ProgressPolicyResult {
  const retained: Record<string, ProgressRecord> = {}
  const removedKeys: string[] = []
  const normalizedKeys: string[] = []

  if (!validRetentionDays(policy.retainProgressDays)) {
    return {
      records: {},
      removedKeys: Object.keys(records),
      normalizedKeys
    }
  }

  const retentionMilliseconds = policy.retainProgressDays * PROGRESS_RETENTION_MILLISECONDS_PER_DAY
  for (const [key, record] of Object.entries(records)) {
    if (!isStoredProgressIdentity(key, record) || !policy.restoreEnabled(record.site)) {
      removedKeys.push(key)
      continue
    }

    const sanitizedRecord = removeSensitiveLegacyFields(record)
    const expiresAt = Math.min(
      sanitizedRecord.expiresAt,
      sanitizedRecord.updatedAt + retentionMilliseconds
    )
    if (expiresAt <= policy.now) {
      removedKeys.push(key)
      continue
    }

    if (expiresAt !== record.expiresAt || sanitizedRecord !== record) {
      retained[key] = { ...sanitizedRecord, expiresAt }
      normalizedKeys.push(key)
    } else {
      retained[key] = sanitizedRecord
    }
  }

  const capacity = normalizedCapacity(policy.maxRecords)
  const entries = Object.entries(retained)
  const overflow = Math.max(0, entries.length - capacity)
  if (overflow > 0) {
    entries
      .sort((left, right) => evictionOrder(left, right, policy.protectedKey))
      .slice(0, overflow)
      .forEach(([key]) => {
        delete retained[key]
        removedKeys.push(key)
      })
  }

  return { records: retained, removedKeys, normalizedKeys }
}
