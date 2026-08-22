import { mediaDownloadArtifactSchema, type MediaDownloadArtifact } from '../../domain/download'

const MAX_MEDIA_DOWNLOAD_BYTES = 128 * 1_024 * 1_024
const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000
const DOWNLOAD_HISTORY_LIMIT = 256
const DOWNLOAD_HISTORY_TTL_MS = 30 * 60_000

export type MediaDownloadDuplicateState = 'new' | 'downloading' | 'downloaded'

export type MediaDownloadPromptArtifact = Readonly<{
  kind: MediaDownloadArtifact['kind']
  suggestedFilename: string
  mimeType?: string
  byteLength?: number
}>

export type MediaDownloadPromptRequest = Readonly<{
  id: string
  duplicateState: MediaDownloadDuplicateState
  artifacts: readonly MediaDownloadPromptArtifact[]
}>

export type MediaDownloadPromptResult = Readonly<{
  filenames: readonly string[]
}>

export type MediaDownloadPrompt = (
  request: MediaDownloadPromptRequest
) => Promise<MediaDownloadPromptResult | null>

export type MediaDownloadCoordinatorOptions = Readonly<{
  confirm?: MediaDownloadPrompt
  now?: () => number
}>

type DownloadHistory = {
  activeCount: number
  completedAt: number | null
  lastTouchedAt: number
}

function safeFilename(value: string): string {
  const normalized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || '<>:"/\\|?*'.includes(character) ? ' ' : character
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return (normalized || 'media').slice(0, 256)
}

function filenameExtension(filename: string): string {
  const match = filename.match(/(\.[a-z0-9]{1,12})$/i)
  return match?.[1] ?? ''
}

export function resolveMediaDownloadFilename(value: string, fallback: string): string {
  const safeFallback = safeFilename(fallback)
  const extension = filenameExtension(safeFallback)
  const normalized = safeFilename(value)
  if (!extension || normalized.toLowerCase().endsWith(extension.toLowerCase())) return normalized
  const maxStemLength = Math.max(1, 256 - extension.length)
  return `${normalized.slice(0, maxStemLength)}${extension}`
}

function clickDownload(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeFilename(filename)
  anchor.rel = 'noopener noreferrer'
  anchor.hidden = true
  ;(document.body ?? document.documentElement).append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
  }
}

function isAllowedArtifactUrl(artifact: MediaDownloadArtifact): boolean {
  try {
    const url = new URL(artifact.url, globalThis.location.href)
    if (artifact.kind === 'blob') return url.protocol === 'blob:'
    if (artifact.kind === 'same-origin') return url.origin === globalThis.location.origin
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

async function downloadCrossOriginArtifact(artifact: MediaDownloadArtifact): Promise<void> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), MEDIA_DOWNLOAD_TIMEOUT_MS)
  try {
    const target = new URL(artifact.url, globalThis.location.href)
    const fetchUrl =
      target.protocol === 'http:' && globalThis.location.protocol === 'https:'
        ? artifact.url.replace(/^http:/i, 'https:')
        : artifact.url
    const response = await globalThis.fetch(fetchUrl, {
      credentials: 'include',
      signal: controller.signal
    })
    if (!response.ok) throw new Error('Cross-origin media request failed')
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_DOWNLOAD_BYTES) {
      throw new Error('Cross-origin media is too large')
    }
    const blob = await response.blob()
    if (blob.size > MAX_MEDIA_DOWNLOAD_BYTES) throw new Error('Cross-origin media is too large')
    const objectUrl = URL.createObjectURL(blob)
    try {
      clickDownload(objectUrl, artifact.filename)
    } finally {
      globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), artifact.revokeAfterMs ?? 60_000)
    }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function downloadMediaArtifacts(
  artifacts: readonly MediaDownloadArtifact[],
  options: MediaDownloadCoordinatorOptions = {}
): Promise<boolean> {
  const coordinator = new MediaDownloadCoordinator(options)
  return coordinator.download(artifacts)
}

function batchKey(artifacts: readonly MediaDownloadArtifact[]): string {
  return JSON.stringify(artifacts.map(({ kind, url }) => [kind, url]))
}

function duplicateState(history: DownloadHistory | undefined): MediaDownloadDuplicateState {
  if (history === undefined) return 'new'
  if (history.activeCount > 0) return 'downloading'
  return history.completedAt === null ? 'new' : 'downloaded'
}

function releaseBlobArtifacts(artifacts: readonly MediaDownloadArtifact[]): void {
  for (const artifact of artifacts) {
    if (artifact.kind !== 'blob') continue
    try {
      URL.revokeObjectURL(artifact.url)
    } catch {
      // A page teardown or an already-revoked URL is harmless.
    }
  }
}

export class MediaDownloadCoordinator {
  private readonly history = new Map<string, DownloadHistory>()
  private readonly confirm: MediaDownloadPrompt | null
  private readonly now: () => number
  private sequence = 0

  constructor(options: MediaDownloadCoordinatorOptions = {}) {
    this.confirm = options.confirm ?? null
    this.now = options.now ?? Date.now
  }

  async download(values: readonly MediaDownloadArtifact[]): Promise<boolean> {
    const artifacts = values.map((value) => mediaDownloadArtifactSchema.parse(value))
    if (artifacts.length === 0) throw new Error('No media download artifacts were prepared')
    for (const artifact of artifacts) {
      if (!isAllowedArtifactUrl(artifact)) throw new Error('Media download URL is not allowed')
    }

    const observedAt = Math.max(0, this.now())
    this.pruneHistory(observedAt)
    const key = batchKey(artifacts)
    const existing = this.history.get(key)
    const state = existing ?? { activeCount: 0, completedAt: null, lastTouchedAt: observedAt }
    const requestState = duplicateState(existing)
    state.activeCount += 1
    state.lastTouchedAt = observedAt
    this.history.set(key, state)

    let completed = false
    try {
      const result =
        this.confirm === null
          ? { filenames: artifacts.map((artifact) => artifact.filename) }
          : await this.confirm({
              id: `media-download-${++this.sequence}`,
              duplicateState: requestState,
              artifacts: artifacts.map((artifact) => ({
                kind: artifact.kind,
                suggestedFilename: artifact.filename,
                ...(artifact.mimeType === undefined ? {} : { mimeType: artifact.mimeType }),
                ...(artifact.byteLength === undefined ? {} : { byteLength: artifact.byteLength })
              }))
            })
      if (result === null) {
        if (existing === undefined) releaseBlobArtifacts(artifacts)
        return false
      }
      if (result.filenames.length !== artifacts.length) {
        throw new Error('Media download confirmation did not cover every artifact')
      }

      const confirmedArtifacts = artifacts.map((artifact, index) => ({
        ...artifact,
        filename: resolveMediaDownloadFilename(
          result.filenames[index] ?? artifact.filename,
          artifact.filename
        )
      }))
      for (const artifact of confirmedArtifacts) {
        if (artifact.kind === 'cross-origin') {
          await downloadCrossOriginArtifact(artifact)
          continue
        }
        clickDownload(artifact.url, artifact.filename)
        if (artifact.kind === 'blob') {
          globalThis.setTimeout(
            () => URL.revokeObjectURL(artifact.url),
            artifact.revokeAfterMs ?? 60_000
          )
        }
      }
      completed = true
      state.completedAt = Math.max(0, this.now())
      return true
    } catch (error) {
      if (existing === undefined) releaseBlobArtifacts(artifacts)
      throw error
    } finally {
      state.activeCount = Math.max(0, state.activeCount - 1)
      state.lastTouchedAt = Math.max(0, this.now())
      if (!completed && state.activeCount === 0 && state.completedAt === null) {
        this.history.delete(key)
      }
    }
  }

  clearHistory(): void {
    this.history.clear()
  }

  private pruneHistory(now: number): void {
    for (const [key, state] of this.history) {
      if (state.activeCount === 0 && now - state.lastTouchedAt > DOWNLOAD_HISTORY_TTL_MS) {
        this.history.delete(key)
      }
    }
    if (this.history.size <= DOWNLOAD_HISTORY_LIMIT) return
    const removable = [...this.history.entries()]
      .filter(([, state]) => state.activeCount === 0)
      .sort((left, right) => left[1].lastTouchedAt - right[1].lastTouchedAt)
    for (const [key] of removable) {
      if (this.history.size <= DOWNLOAD_HISTORY_LIMIT) break
      this.history.delete(key)
    }
  }
}
