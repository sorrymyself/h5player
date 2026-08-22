import type { Result } from '../../shared/result'
import type {
  ProgressDomainError,
  ProgressIdentity,
  ProgressIdentityInput,
  ProgressRecord,
  ProgressSample
} from '../../domain/progress'

export type ProgressStorageErrorCode =
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_CORRUPT'
  | 'MIGRATION_FAILED'
  | 'FUTURE_SCHEMA'
  | 'IMPORT_INVALID'
  | 'BACKUP_NOT_FOUND'
  | 'BACKUP_CORRUPT'

export type ProgressError =
  | ProgressDomainError
  | Readonly<{
      code: ProgressStorageErrorCode
      message: string
    }>

export type ProgressSaveResult = Readonly<{
  saved: boolean
  privacyBlocked: boolean
  record: ProgressRecord | null
  revision: number
  prunedCount: number
  evictedCount: number
}>

export type ProgressReadResult = Readonly<{
  record: ProgressRecord | null
  privacyBlocked: boolean
  revision: number
  prunedCount: number
}>

export type ProgressDeleteResult = Readonly<{
  deleted: boolean
  revision: number
  prunedCount: number
}>

export type ProgressPruneResult = Readonly<{
  removedCount: number
  normalizedCount: number
  remainingCount: number
  revision: number
}>

export interface ProgressRepositoryPort {
  saveProgress(
    identity: ProgressIdentity,
    sample: ProgressSample,
    source: string
  ): Promise<Result<ProgressSaveResult, ProgressError>>
  readProgress(
    identity: ProgressIdentity,
    source: string
  ): Promise<Result<ProgressReadResult, ProgressError>>
  deleteProgress(
    identity: ProgressIdentity,
    source: string
  ): Promise<Result<ProgressDeleteResult, ProgressError>>
  pruneProgress(source: string): Promise<Result<ProgressPruneResult, ProgressError>>
}

export type ProgressSaveInput = ProgressIdentityInput &
  Readonly<{
    positionSeconds: number
    durationSeconds?: number | null | undefined
  }>

export type ProgressReadInput = ProgressIdentityInput
export type ProgressDeleteInput = ProgressIdentityInput
