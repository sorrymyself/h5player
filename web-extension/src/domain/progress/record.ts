import { failure, success, type Result } from '../../shared/result'
import { progressRecordSchema } from '../settings/schema'
import { isProgressIdentity } from './identity'
import {
  MAX_PROGRESS_RETENTION_DAYS,
  PROGRESS_RETENTION_MILLISECONDS_PER_DAY,
  type ProgressDomainError,
  type ProgressIdentity,
  type ProgressRecord,
  type ProgressSample
} from './model'

function progressRecordError(
  code: ProgressDomainError['code'],
  message: string
): ProgressDomainError {
  return { code, message }
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

export function createProgressRecord(
  identity: ProgressIdentity,
  sample: ProgressSample,
  now: number,
  retainProgressDays: number
): Result<ProgressRecord, ProgressDomainError> {
  if (!isProgressIdentity(identity)) {
    return failure(
      progressRecordError('INVALID_MEDIA_IDENTITY', 'Progress identity is not canonical')
    )
  }
  if (!isFiniteNonNegative(sample.positionSeconds)) {
    return failure(
      progressRecordError(
        'INVALID_PROGRESS_POSITION',
        'Progress position must be a finite non-negative number'
      )
    )
  }
  if (sample.durationSeconds !== null && !isFiniteNonNegative(sample.durationSeconds)) {
    return failure(
      progressRecordError(
        'INVALID_PROGRESS_DURATION',
        'Progress duration must be null or a finite non-negative number'
      )
    )
  }
  if (
    !Number.isInteger(retainProgressDays) ||
    retainProgressDays <= 0 ||
    retainProgressDays > MAX_PROGRESS_RETENTION_DAYS ||
    !isFiniteNonNegative(now)
  ) {
    return failure(
      progressRecordError(
        'INVALID_PROGRESS_RETENTION',
        'Progress retention must be between 1 and 365 days'
      )
    )
  }

  const positionSeconds =
    sample.durationSeconds === null
      ? sample.positionSeconds
      : Math.min(sample.positionSeconds, sample.durationSeconds)
  const parsed = progressRecordSchema.safeParse({
    site: identity.site,
    mediaKey: identity.mediaKey,
    positionSeconds,
    durationSeconds: sample.durationSeconds,
    updatedAt: now,
    expiresAt: now + retainProgressDays * PROGRESS_RETENTION_MILLISECONDS_PER_DAY
  })

  return parsed.success
    ? success(parsed.data)
    : failure(progressRecordError('INVALID_PROGRESS_POSITION', 'Progress record failed validation'))
}
