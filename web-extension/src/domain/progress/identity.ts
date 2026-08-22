import { failure, success, type Result } from '../../shared/result'
import { normalizeSiteOrigin } from '../settings'
import type { ProgressDomainError, ProgressIdentity, ProgressIdentityInput } from './model'

const MAX_IDENTITY_INPUT_LENGTH = 8_192
const HASH_OFFSET = 0xcbf29ce484222325n
const HASH_PRIME = 0x100000001b3n
const HASH_PATTERN = /^fnv1a64:[a-f0-9]{16}$/
const MEDIA_KEY_PATTERN = /^(?:stable|source|page):fnv1a64:[a-f0-9]{16}$/
const RECORD_KEY_PATTERN = /^progress:fnv1a64:[a-f0-9]{16}$/

function progressIdentityError(
  code: ProgressDomainError['code'],
  message: string
): ProgressDomainError {
  return { code, message }
}

export function hashProgressIdentity(value: string): string {
  let hash = HASH_OFFSET
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * HASH_PRIME)
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function createProgressRecordKey(site: string, mediaKey: string): string {
  return `progress:${hashProgressIdentity(`${site}\u0000${mediaKey}`)}`
}

function safeUrl(value: string, base?: string): URL | null {
  if (value.length > MAX_IDENTITY_INPUT_LENGTH) return null
  try {
    return base === undefined ? new URL(value) : new URL(value, base)
  } catch {
    return null
  }
}

function webFingerprint(url: URL): string | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return `${url.origin.toLowerCase()}${url.pathname}`
}

function createMediaKey(input: ProgressIdentityInput, pageUrl: URL): string | null {
  const stableMediaId = input.stableMediaId?.trim()
  if (stableMediaId) {
    if (stableMediaId.length > MAX_IDENTITY_INPUT_LENGTH) return null
    return `stable:${hashProgressIdentity(stableMediaId)}`
  }

  if (input.mediaSourceUrl) {
    const sourceUrl = safeUrl(input.mediaSourceUrl, pageUrl.href)
    const sourceFingerprint = sourceUrl ? webFingerprint(sourceUrl) : null
    if (sourceFingerprint) return `source:${hashProgressIdentity(sourceFingerprint)}`
  }

  const pageFingerprint = webFingerprint(pageUrl)
  return pageFingerprint ? `page:${hashProgressIdentity(pageFingerprint)}` : null
}

export function createProgressIdentity(
  input: ProgressIdentityInput
): Result<ProgressIdentity, ProgressDomainError> {
  const normalizedSite = normalizeSiteOrigin(input.pageUrl)
  const pageUrl = safeUrl(input.pageUrl)
  if (!normalizedSite.ok || !pageUrl) {
    return failure(
      progressIdentityError('INVALID_PROGRESS_SITE', 'Progress requires a valid HTTP(S) page URL')
    )
  }

  const mediaKey = createMediaKey(input, pageUrl)
  if (!mediaKey) {
    return failure(
      progressIdentityError(
        'INVALID_MEDIA_IDENTITY',
        'Progress media identity is missing or exceeds the size limit'
      )
    )
  }

  return success({
    key: createProgressRecordKey(normalizedSite.value, mediaKey),
    site: normalizedSite.value,
    mediaKey
  })
}

export function isProgressIdentity(value: ProgressIdentity): boolean {
  const normalizedSite = normalizeSiteOrigin(value.site)
  return (
    normalizedSite.ok &&
    normalizedSite.value === value.site &&
    HASH_PATTERN.test(value.mediaKey.slice(value.mediaKey.indexOf(':') + 1)) &&
    MEDIA_KEY_PATTERN.test(value.mediaKey) &&
    RECORD_KEY_PATTERN.test(value.key) &&
    createProgressRecordKey(value.site, value.mediaKey) === value.key
  )
}

export function isStoredProgressIdentity(
  key: string,
  record: Pick<ProgressIdentity, 'site' | 'mediaKey'>
): boolean {
  return isProgressIdentity({ key, site: record.site, mediaKey: record.mediaKey })
}
