import type { SettingsData } from '../settings/schema'

export const PROGRESS_RETENTION_MILLISECONDS_PER_DAY = 86_400_000
export const MAX_PROGRESS_RETENTION_DAYS = 365
export const MAX_PROGRESS_RECORDS = 5_000

export type ProgressRecord = Readonly<SettingsData['progress'][string]>
export type ProgressRecordMap = Readonly<Record<string, ProgressRecord>>

export type ProgressIdentity = Readonly<{
  key: string
  site: string
  mediaKey: string
}>

export type ProgressIdentityInput = Readonly<{
  pageUrl: string
  stableMediaId?: string | null | undefined
  mediaSourceUrl?: string | null | undefined
}>

export type ProgressSample = Readonly<{
  positionSeconds: number
  durationSeconds: number | null
}>

export type ProgressDomainErrorCode =
  | 'INVALID_PROGRESS_SITE'
  | 'INVALID_MEDIA_IDENTITY'
  | 'INVALID_PROGRESS_POSITION'
  | 'INVALID_PROGRESS_DURATION'
  | 'INVALID_PROGRESS_RETENTION'

export type ProgressDomainError = Readonly<{
  code: ProgressDomainErrorCode
  message: string
}>

export type ProgressPolicy = Readonly<{
  now: number
  retainProgressDays: number
  maxRecords: number
  restoreEnabled: (site: string) => boolean
  protectedKey?: string
}>

export type ProgressPolicyResult = Readonly<{
  records: Readonly<Record<string, ProgressRecord>>
  removedKeys: readonly string[]
  normalizedKeys: readonly string[]
}>
