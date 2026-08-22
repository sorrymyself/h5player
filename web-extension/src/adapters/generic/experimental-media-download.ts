import {
  MediaDownloadFailure,
  mediaDownloadIntentIdSchema,
  type MediaDownloadArtifact,
  type MediaDownloadEvent,
  type MediaDownloadPreparation
} from '../../domain/download'

export const EXPERIMENTAL_DOWNLOAD_MAX_BUFFER_BYTES = 128 * 1_024 * 1_024
export const EXPERIMENTAL_DOWNLOAD_MAX_PAGE_BYTES = 256 * 1_024 * 1_024
export const EXPERIMENTAL_DOWNLOAD_MAX_CHUNKS = 20_000
export const EXPERIMENTAL_DOWNLOAD_PENDING_TIMEOUT_MS = 60 * 60_000

export type ExperimentalMediaDownloadLimits = Readonly<{
  maxBufferBytes: number
  maxPageBytes: number
  maxChunks: number
  pendingTimeoutMs?: number
}>

type ResolvedExperimentalMediaDownloadLimits = Readonly<{
  maxBufferBytes: number
  maxPageBytes: number
  maxChunks: number
  pendingTimeoutMs: number
}>

const DEFAULT_LIMITS: ResolvedExperimentalMediaDownloadLimits = Object.freeze({
  maxBufferBytes: EXPERIMENTAL_DOWNLOAD_MAX_BUFFER_BYTES,
  maxPageBytes: EXPERIMENTAL_DOWNLOAD_MAX_PAGE_BYTES,
  maxChunks: EXPERIMENTAL_DOWNLOAD_MAX_CHUNKS,
  pendingTimeoutMs: EXPERIMENTAL_DOWNLOAD_PENDING_TIMEOUT_MS
})

type MethodPatch = () => void

type SourceBufferRecord = {
  readonly sourceBuffer: SourceBuffer
  readonly mimeType: string
  chunks: ArrayBuffer[]
  byteLength: number
}

type PendingDownload = {
  readonly element: HTMLMediaElement
  readonly title: string
  readonly intentId: string
  readonly timeoutHandle: number
}

type MediaSourceRecord = {
  readonly mediaSource: MediaSource
  readonly generation: number
  readonly buffers: SourceBufferRecord[]
  readonly objectUrls: Set<string>
  readonly elements: Set<HTMLMediaElement>
  detachSourceClose: (() => void) | null
  ended: boolean
  overflowed: boolean
  incomplete: boolean
  downloaded: boolean
  disposed: boolean
  terminalFailure: MediaDownloadFailure | null
  pending: PendingDownload | null
}

type PatchFactory = (original: (...args: never[]) => unknown) => (...args: never[]) => unknown

export interface ExperimentalMediaDownloadPort {
  isEnabled(): boolean
  canDownload(element: HTMLMediaElement): boolean
  prepareDownload(element: HTMLMediaElement, intentId: string): Promise<MediaDownloadPreparation>
  cancelDownload(element: HTMLMediaElement): boolean
  subscribe(listener: (event: MediaDownloadEvent) => void): () => void
  disable(): void
}

function patchMethod(target: object, key: string, factory: PatchFactory): MethodPatch | null {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (descriptor === undefined || typeof descriptor.value !== 'function') return null
  const replacement = factory(descriptor.value as (...args: never[]) => unknown)
  if (!Reflect.defineProperty(target, key, { ...descriptor, value: replacement })) return null
  return () => {
    const current = Object.getOwnPropertyDescriptor(target, key)
    if (current?.value !== replacement) return
    Reflect.defineProperty(target, key, descriptor)
  }
}

function copyBufferSource(value: unknown): ArrayBuffer | null {
  try {
    if (value instanceof ArrayBuffer) return value.slice(0)
    if (!ArrayBuffer.isView(value)) return null
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return Uint8Array.from(bytes).buffer
  } catch {
    return null
  }
}

function normalizeFilenamePart(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || '<>:"/\\|?*'.includes(character) ? ' ' : character
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeTitle(value: string, maxLength = 140): string {
  return (normalizeFilenamePart(value) || 'media').slice(0, maxLength)
}

function safeFilename(title: string, suffix: string): string {
  const safeSuffix = normalizeFilenamePart(suffix).replace(/\s+/g, '')
  const boundedSuffix = safeSuffix.slice(0, 20)
  const maxTitleLength = Math.max(1, 180 - boundedSuffix.length)
  return `${safeTitle(title, maxTitleLength)}${boundedSuffix}`
}

function sourceExtension(source: string, kind: 'video' | 'audio'): string {
  try {
    const match = new URL(source, 'https://example.invalid').pathname.match(/\.([a-z0-9]{2,5})$/i)
    if (
      match?.[1] !== undefined &&
      /^(?:mp4|m4v|webm|mov|mkv|mp3|m4a|aac|ogg|wav)$/i.test(match[1])
    ) {
      return match[1].toLowerCase()
    }
  } catch {
    // The fallback below is sufficient for opaque media URLs.
  }
  return kind === 'video' ? 'mp4' : 'mp3'
}

function mimeParts(mimeType: string): { readonly kind: string; readonly extension: string } {
  const [essence = '', parameters = ''] = mimeType.split(';', 2)
  const [rawKind = 'media', rawFormat = 'bin'] = essence.trim().toLowerCase().split('/', 2)
  const kind = /^(?:audio|video)$/.test(rawKind) ? rawKind : 'media'
  const extension = /^[a-z0-9]{2,8}$/.test(rawFormat) ? rawFormat : 'bin'
  const codec = parameters.match(/codecs\s*=\s*["']?([^"']+)/i)?.[1]?.toLowerCase() ?? ''
  if (extension === 'mp4' && kind === 'audio' && codec.includes('mp4a')) {
    return { kind, extension: 'm4a' }
  }
  return { kind, extension }
}

function isSameOriginHttpUrl(source: string, baseUrl: string): boolean {
  try {
    const target = new URL(source, baseUrl)
    const current = new URL(baseUrl)
    return (
      (target.protocol === 'http:' || target.protocol === 'https:') &&
      target.origin === current.origin
    )
  } catch {
    return false
  }
}

function canAttemptBoundedFetch(
  element: HTMLMediaElement,
  source: string,
  baseUrl: string
): boolean {
  try {
    const target = new URL(source, baseUrl)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
  } catch {
    return false
  }
  return Number.isFinite(element.duration) && element.duration >= 0 && element.duration < 5 * 60
}

export class ExperimentalMediaDownloadManager {
  private readonly records = new Set<MediaSourceRecord>()
  private sourceRecords = new WeakMap<MediaSource, MediaSourceRecord>()
  private sourceBufferRecords = new WeakMap<SourceBuffer, SourceBufferRecord>()
  private sourceBufferOwners = new WeakMap<SourceBuffer, MediaSourceRecord>()
  private elementRecords = new WeakMap<HTMLMediaElement, MediaSourceRecord>()
  private readonly objectUrls = new Map<string, MediaSourceRecord>()
  private readonly patches: MethodPatch[] = []
  private readonly limits: ResolvedExperimentalMediaDownloadLimits
  private enabled = false
  private installed = false
  private mseHooked = false
  private captureGeneration = 0
  private capturedBytes = 0
  private createObjectUrl: ((object: Blob | MediaSource) => string) | null = null
  private revokeObjectUrl: ((url: string) => void) | null = null
  private readonly eventListeners = new Set<(event: MediaDownloadEvent) => void>()

  constructor(
    private readonly currentWindow: Window,
    private readonly currentDocument: Document,
    limits: ExperimentalMediaDownloadLimits = DEFAULT_LIMITS
  ) {
    const pendingTimeoutMs = limits.pendingTimeoutMs ?? EXPERIMENTAL_DOWNLOAD_PENDING_TIMEOUT_MS
    if (
      !Number.isSafeInteger(limits.maxBufferBytes) ||
      !Number.isSafeInteger(limits.maxPageBytes) ||
      !Number.isSafeInteger(limits.maxChunks) ||
      !Number.isSafeInteger(pendingTimeoutMs) ||
      limits.maxBufferBytes < 1 ||
      limits.maxPageBytes < limits.maxBufferBytes ||
      limits.maxChunks < 1 ||
      pendingTimeoutMs < 1
    ) {
      throw new TypeError('Invalid experimental media download limits')
    }
    this.limits = Object.freeze({ ...limits, pendingTimeoutMs })
  }

  install(): boolean {
    return this.enabled ? this.installPatches() : false
  }

  configure(enabled: boolean): void {
    if (!enabled) {
      this.enabled = false
      this.captureGeneration += 1
      this.disposeAllRecords()
      this.restorePatches()
      return
    }
    if (this.enabled && this.installed) return
    this.captureGeneration += 1
    this.disposeAllRecords()
    this.enabled = true
    this.installPatches()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  disable(): void {
    this.configure(false)
  }

  subscribe(listener: (event: MediaDownloadEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  canDownload(element: HTMLMediaElement): boolean {
    this.pruneDisconnectedElements()
    if (!this.enabled || !element.isConnected) {
      this.disconnectElement(element)
      return false
    }
    const source = element.currentSrc || element.src
    if (!source) {
      this.disconnectElement(element)
      return false
    }
    if (source.startsWith('blob:')) {
      const record = this.objectUrls.get(source)
      if (!this.isCurrentRecord(record)) {
        this.disconnectElement(element)
        return false
      }
      this.bindElement(record, element)
      return true
    }
    this.disconnectElement(element)
    return (
      isSameOriginHttpUrl(source, this.currentWindow.location.href) ||
      canAttemptBoundedFetch(element, source, this.currentWindow.location.href)
    )
  }

  prepareDownload(element: HTMLMediaElement, intentId: string): Promise<MediaDownloadPreparation> {
    const normalizedIntentId = mediaDownloadIntentIdSchema.parse(intentId)
    try {
      return Promise.resolve(this.prepareDownloadNow(element, normalizedIntentId))
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('Media download failed'))
    }
  }

  cancelDownload(element: HTMLMediaElement): boolean {
    const record = this.elementRecords.get(element)
    if (!this.isCurrentRecord(record) || record.pending === null) return false
    const pending = this.takePendingDownload(record)
    if (pending === null) return false
    this.emit({
      type: 'failed',
      intentId: pending.intentId,
      code: 'DOWNLOAD_CANCELLED',
      message: 'Media download was cancelled by the user'
    })
    return true
  }

  teardown(): void {
    this.enabled = false
    this.captureGeneration += 1
    this.disposeAllRecords()
    this.restorePatches()
  }

  private installPatches(): boolean {
    if (this.installed) return this.mseHooked

    const urlConstructor = Reflect.get(this.currentWindow, 'URL') as typeof URL | undefined
    const mediaSourceConstructor = Reflect.get(this.currentWindow, 'MediaSource') as
      typeof MediaSource | undefined
    const sourceBufferConstructor = Reflect.get(this.currentWindow, 'SourceBuffer') as
      typeof SourceBuffer | undefined
    const createObjectUrl =
      typeof urlConstructor?.createObjectURL === 'function'
        ? urlConstructor.createObjectURL.bind(urlConstructor)
        : null
    const revokeObjectUrl =
      typeof urlConstructor?.revokeObjectURL === 'function'
        ? urlConstructor.revokeObjectURL.bind(urlConstructor)
        : null
    if (
      urlConstructor === undefined ||
      mediaSourceConstructor === undefined ||
      sourceBufferConstructor === undefined ||
      createObjectUrl === null ||
      revokeObjectUrl === null
    ) {
      return false
    }

    const localPatches: MethodPatch[] = []
    const addPatch = (patch: MethodPatch | null): boolean => {
      if (patch === null) return false
      localPatches.push(patch)
      return true
    }
    const connectObjectUrl = (mediaSource: MediaSource, url: string): void => {
      this.connectObjectUrl(mediaSource, url)
    }
    const forgetObjectUrl = (url: string): void => {
      this.forgetObjectUrl(url)
    }
    const connectSourceBuffer = (
      mediaSource: MediaSource,
      sourceBuffer: SourceBuffer,
      mimeType: string
    ): void => {
      this.connectSourceBuffer(mediaSource, sourceBuffer, mimeType)
    }
    const captureSourceBuffer = (sourceBuffer: SourceBuffer, data: BufferSource): void => {
      this.captureSourceBuffer(sourceBuffer, data)
    }
    const markEnded = (mediaSource: MediaSource, error?: EndOfStreamError): void => {
      this.markEnded(mediaSource, error)
    }
    const installed =
      addPatch(
        patchMethod(
          urlConstructor,
          'createObjectURL',
          (original) =>
            function (this: typeof URL, object: Blob | MediaSource): string {
              const url = Reflect.apply(original, this, [object]) as string
              if (object instanceof mediaSourceConstructor) connectObjectUrl(object, url)
              return url
            }
        )
      ) &&
      addPatch(
        patchMethod(
          urlConstructor,
          'revokeObjectURL',
          (original) =>
            function (this: typeof URL, url: string): void {
              try {
                forgetObjectUrl(url)
              } finally {
                Reflect.apply(original, this, [url])
              }
            }
        )
      ) &&
      addPatch(
        patchMethod(
          mediaSourceConstructor.prototype,
          'addSourceBuffer',
          (original) =>
            function (this: MediaSource, mimeType: string): SourceBuffer {
              const sourceBuffer = Reflect.apply(original, this, [mimeType]) as SourceBuffer
              connectSourceBuffer(this, sourceBuffer, mimeType)
              return sourceBuffer
            }
        )
      ) &&
      addPatch(
        patchMethod(
          sourceBufferConstructor.prototype,
          'appendBuffer',
          (original) =>
            function (this: SourceBuffer, data: BufferSource): void {
              Reflect.apply(original, this, [data])
              captureSourceBuffer(this, data)
            }
        )
      ) &&
      addPatch(
        patchMethod(
          mediaSourceConstructor.prototype,
          'endOfStream',
          (original) =>
            function (this: MediaSource, error?: EndOfStreamError): void {
              Reflect.apply(original, this, error === undefined ? [] : [error])
              markEnded(this, error)
            }
        )
      )

    if (!installed) {
      for (const restore of localPatches.reverse()) restore()
      return false
    }
    this.createObjectUrl = createObjectUrl
    this.revokeObjectUrl = revokeObjectUrl
    this.patches.push(...localPatches)
    this.installed = true
    this.mseHooked = true
    return true
  }

  private restorePatches(): void {
    for (const restore of this.patches.reverse()) restore()
    this.patches.length = 0
    this.createObjectUrl = null
    this.revokeObjectUrl = null
    this.mseHooked = false
    this.installed = false
  }

  private prepareDownloadNow(
    element: HTMLMediaElement,
    intentId: string
  ): MediaDownloadPreparation {
    if (!this.enabled) {
      throw new MediaDownloadFailure('DOWNLOAD_BLOCKED', 'Experimental download is disabled')
    }
    const source = element.currentSrc || element.src
    if (!source) {
      throw new MediaDownloadFailure('DOWNLOAD_UNAVAILABLE', 'Media source is unavailable')
    }
    const title = safeTitle(element.dataset['title'] || this.currentDocument.title || 'media')
    if (!source.startsWith('blob:')) {
      const artifact = this.prepareDirectDownload(element, source, title)
      return { intentId, disposition: 'started', artifacts: [artifact] }
    }

    const record = this.objectUrls.get(source)
    if (!this.isCurrentRecord(record)) {
      throw new MediaDownloadFailure(
        'DOWNLOAD_UNAVAILABLE',
        'The active MediaSource was not captured from its first segment'
      )
    }
    this.bindElement(record, element)
    if (record.terminalFailure !== null) throw record.terminalFailure
    if (record.incomplete) {
      throw new MediaDownloadFailure('DOWNLOAD_UNAVAILABLE', 'Captured media is incomplete')
    }
    if (record.overflowed) {
      throw new MediaDownloadFailure('DOWNLOAD_TOO_LARGE', 'Captured media exceeded limits')
    }
    if (record.downloaded) {
      throw new MediaDownloadFailure('DOWNLOAD_UNAVAILABLE', 'Captured media was already consumed')
    }
    if (!record.ended) {
      this.queuePendingDownload(record, element, title, intentId)
      return { intentId, disposition: 'queued', artifacts: [] }
    }
    const artifacts = this.startMediaSourcePreparation(record, title)
    return { intentId, disposition: 'started', artifacts }
  }

  private ensureRecord(mediaSource: MediaSource): MediaSourceRecord | null {
    if (!this.enabled || !this.mseHooked) return null
    const existing = this.sourceRecords.get(mediaSource)
    if (this.isCurrentRecord(existing)) return existing
    if (existing !== undefined) this.disposeRecord(existing)
    const record: MediaSourceRecord = {
      mediaSource,
      generation: this.captureGeneration,
      buffers: [],
      objectUrls: new Set(),
      elements: new Set(),
      detachSourceClose: null,
      ended: false,
      overflowed: false,
      incomplete: false,
      downloaded: false,
      disposed: false,
      terminalFailure: null,
      pending: null
    }
    const addEventListener = Reflect.get(mediaSource, 'addEventListener')
    const removeEventListener = Reflect.get(mediaSource, 'removeEventListener')
    if (typeof addEventListener === 'function' && typeof removeEventListener === 'function') {
      const onSourceClose = (): void => this.disposeRecord(record)
      try {
        Reflect.apply(addEventListener, mediaSource, ['sourceclose', onSourceClose])
        record.detachSourceClose = () => {
          try {
            Reflect.apply(removeEventListener, mediaSource, ['sourceclose', onSourceClose])
          } catch {
            // A detached MediaSource may reject listener removal.
          }
        }
      } catch {
        // A hostile or non-standard MediaSource may not support lifecycle listeners.
      }
    }
    this.sourceRecords.set(mediaSource, record)
    this.records.add(record)
    return record
  }

  private connectObjectUrl(mediaSource: MediaSource, url: string): void {
    const record = this.ensureRecord(mediaSource)
    if (record === null) return
    const previous = this.objectUrls.get(url)
    if (previous !== undefined && previous !== record) {
      previous.objectUrls.delete(url)
      this.disposeRecord(previous)
    }
    record.objectUrls.add(url)
    this.objectUrls.set(url, record)
  }

  private forgetObjectUrl(url: string): void {
    const record = this.objectUrls.get(url)
    if (record === undefined) return
    this.objectUrls.delete(url)
    record.objectUrls.delete(url)
    if (record.objectUrls.size === 0) this.disposeRecord(record)
  }

  private connectSourceBuffer(
    mediaSource: MediaSource,
    sourceBuffer: SourceBuffer,
    mimeType: string
  ): void {
    const record = this.ensureRecord(mediaSource)
    if (record === null) return
    const bufferRecord: SourceBufferRecord = {
      sourceBuffer,
      mimeType: String(mimeType || 'application/octet-stream').slice(0, 256),
      chunks: [],
      byteLength: 0
    }
    record.buffers.push(bufferRecord)
    this.sourceBufferRecords.set(sourceBuffer, bufferRecord)
    this.sourceBufferOwners.set(sourceBuffer, record)
  }

  private captureSourceBuffer(sourceBuffer: SourceBuffer, data: unknown): void {
    if (!this.enabled) return
    const bufferRecord = this.sourceBufferRecords.get(sourceBuffer)
    const record = this.sourceBufferOwners.get(sourceBuffer)
    if (
      bufferRecord === undefined ||
      !this.isCurrentRecord(record) ||
      record.ended ||
      record.overflowed ||
      record.terminalFailure !== null
    ) {
      return
    }
    const chunk = copyBufferSource(data)
    if (chunk === null || chunk.byteLength === 0) {
      record.incomplete = true
      this.clearRecordData(record)
      return
    }
    if (
      bufferRecord.chunks.length >= this.limits.maxChunks ||
      bufferRecord.byteLength + chunk.byteLength > this.limits.maxBufferBytes ||
      this.capturedBytes + chunk.byteLength > this.limits.maxPageBytes
    ) {
      record.overflowed = true
      this.clearRecordData(record)
      return
    }
    bufferRecord.chunks.push(chunk)
    bufferRecord.byteLength += chunk.byteLength
    this.capturedBytes += chunk.byteLength
  }

  private markEnded(mediaSource: MediaSource, error?: EndOfStreamError): void {
    const record = this.sourceRecords.get(mediaSource)
    if (!this.isCurrentRecord(record)) return
    record.ended = true
    const pending = this.takePendingDownload(record)
    if (error !== undefined) {
      record.terminalFailure = new MediaDownloadFailure(
        'DOWNLOAD_FAILED',
        `MediaSource ended with ${error}`
      )
      this.clearRecordData(record)
      if (pending !== null) {
        this.emit({
          type: 'failed',
          intentId: pending.intentId,
          code: record.terminalFailure.code,
          message: record.terminalFailure.message
        })
      }
      return
    }
    if (pending === null) return
    if (!this.enabled || record.overflowed || record.incomplete) {
      const failure = new MediaDownloadFailure(
        record.overflowed ? 'DOWNLOAD_TOO_LARGE' : 'DOWNLOAD_UNAVAILABLE',
        record.overflowed
          ? 'Captured media exceeded limits'
          : 'Captured media is incomplete or no longer available'
      )
      record.terminalFailure = failure
      this.clearRecordData(record)
      this.emit({
        type: 'failed',
        intentId: pending.intentId,
        code: failure.code,
        message: failure.message
      })
      return
    }
    try {
      const artifacts = this.startMediaSourcePreparation(record, pending.title)
      this.emit({
        type: 'ready',
        preparation: { intentId: pending.intentId, disposition: 'started', artifacts }
      })
    } catch (error) {
      record.terminalFailure =
        error instanceof MediaDownloadFailure
          ? error
          : new MediaDownloadFailure('DOWNLOAD_FAILED', 'Queued media download failed')
      this.clearRecordData(record)
      this.emit({
        type: 'failed',
        intentId: pending.intentId,
        code: record.terminalFailure.code,
        message: record.terminalFailure.message
      })
    }
  }

  private prepareDirectDownload(
    element: HTMLMediaElement,
    source: string,
    title: string
  ): MediaDownloadArtifact {
    const videoConstructor = Reflect.get(this.currentWindow, 'HTMLVideoElement') as
      typeof HTMLVideoElement | undefined
    const kind =
      videoConstructor !== undefined && element instanceof videoConstructor ? 'video' : 'audio'
    const filename = safeFilename(title, `_${kind}.${sourceExtension(source, kind)}`)
    if (isSameOriginHttpUrl(source, this.currentWindow.location.href)) {
      return { kind: 'same-origin', url: source, filename }
    }
    if (!canAttemptBoundedFetch(element, source, this.currentWindow.location.href)) {
      throw new MediaDownloadFailure(
        'DOWNLOAD_UNAVAILABLE',
        'Cross-origin direct download is unavailable for this media'
      )
    }
    return { kind: 'cross-origin', url: source, filename }
  }

  private startMediaSourcePreparation(
    record: MediaSourceRecord,
    title: string
  ): MediaDownloadArtifact[] {
    if (!this.isCurrentRecord(record)) {
      throw new MediaDownloadFailure('DOWNLOAD_UNAVAILABLE', 'Captured media is stale')
    }
    const bindings = this.objectUrlBindings()
    if (bindings === null) {
      throw new MediaDownloadFailure('DOWNLOAD_UNAVAILABLE', 'Blob download is unavailable')
    }
    const artifacts: MediaDownloadArtifact[] = []
    const createdUrls: string[] = []
    try {
      for (const buffer of record.buffers) {
        if (buffer.byteLength === 0 || buffer.chunks.length === 0) continue
        const media = mimeParts(buffer.mimeType)
        let blob: Blob
        try {
          const blobConstructor = Reflect.get(this.currentWindow, 'Blob') as typeof Blob | undefined
          if (blobConstructor === undefined) {
            throw new MediaDownloadFailure('DOWNLOAD_UNAVAILABLE', 'Blob is unavailable')
          }
          blob = new blobConstructor(buffer.chunks, { type: buffer.mimeType })
        } catch {
          throw new MediaDownloadFailure('DOWNLOAD_FAILED', 'Captured media could not be assembled')
        }
        const blobUrl = bindings.create(blob)
        createdUrls.push(blobUrl)
        artifacts.push({
          kind: 'blob',
          url: blobUrl,
          filename: safeFilename(title, `_${media.kind}.${media.extension}`),
          mimeType: buffer.mimeType,
          byteLength: buffer.byteLength,
          revokeAfterMs: 60_000
        })
      }
    } catch (error) {
      for (const url of createdUrls) bindings.revoke(url)
      throw error
    }
    if (artifacts.length === 0) {
      throw new MediaDownloadFailure('DOWNLOAD_UNAVAILABLE', 'No captured media data is ready')
    }
    record.downloaded = true
    this.disposeRecord(record)
    return artifacts
  }

  private objectUrlBindings(): {
    readonly create: (object: Blob | MediaSource) => string
    readonly revoke: (url: string) => void
  } | null {
    if (this.createObjectUrl !== null && this.revokeObjectUrl !== null) {
      return { create: this.createObjectUrl, revoke: this.revokeObjectUrl }
    }
    const urlConstructor = Reflect.get(this.currentWindow, 'URL') as typeof URL | undefined
    if (
      typeof urlConstructor?.createObjectURL !== 'function' ||
      typeof urlConstructor.revokeObjectURL !== 'function'
    ) {
      return null
    }
    return {
      create: urlConstructor.createObjectURL.bind(urlConstructor),
      revoke: urlConstructor.revokeObjectURL.bind(urlConstructor)
    }
  }

  private emit(event: MediaDownloadEvent): void {
    for (const listener of [...this.eventListeners]) {
      try {
        listener(event)
      } catch {
        // Download observers must not break capture lifecycle.
      }
    }
  }

  private queuePendingDownload(
    record: MediaSourceRecord,
    element: HTMLMediaElement,
    title: string,
    intentId: string
  ): void {
    this.cancelPendingDownload(record)
    const timeoutHandle = this.currentWindow.setTimeout(() => {
      if (!this.isCurrentRecord(record) || record.pending?.timeoutHandle !== timeoutHandle) return
      record.pending = null
      record.terminalFailure = new MediaDownloadFailure(
        'DOWNLOAD_FAILED',
        'MediaSource download timed out before completion'
      )
      this.clearRecordData(record)
      this.emit({
        type: 'failed',
        intentId,
        code: record.terminalFailure.code,
        message: record.terminalFailure.message
      })
    }, this.limits.pendingTimeoutMs)
    record.pending = { element, title, intentId, timeoutHandle }
  }

  private takePendingDownload(record: MediaSourceRecord): PendingDownload | null {
    const pending = record.pending
    if (pending === null) return null
    this.currentWindow.clearTimeout(pending.timeoutHandle)
    record.pending = null
    return pending
  }

  private cancelPendingDownload(record: MediaSourceRecord): void {
    const pending = record.pending
    if (pending === null) return
    this.currentWindow.clearTimeout(pending.timeoutHandle)
    record.pending = null
  }

  private bindElement(record: MediaSourceRecord, element: HTMLMediaElement): void {
    const previous = this.elementRecords.get(element)
    if (previous === record) return
    if (previous !== undefined) {
      previous.elements.delete(element)
      if (previous.elements.size === 0) this.disposeRecord(previous)
    }
    record.elements.add(element)
    this.elementRecords.set(element, record)
  }

  private disconnectElement(element: HTMLMediaElement): void {
    const record = this.elementRecords.get(element)
    if (record === undefined) return
    this.elementRecords.delete(element)
    record.elements.delete(element)
    if (record.elements.size === 0) this.disposeRecord(record)
  }

  private pruneDisconnectedElements(): void {
    for (const record of [...this.records]) {
      for (const element of [...record.elements]) {
        if (!element.isConnected) this.disconnectElement(element)
      }
    }
  }

  private isCurrentRecord(record: MediaSourceRecord | undefined): record is MediaSourceRecord {
    return (
      record !== undefined &&
      !record.disposed &&
      record.generation === this.captureGeneration &&
      this.records.has(record)
    )
  }

  private disposeAllRecords(): void {
    for (const record of [...this.records]) this.disposeRecord(record)
    this.records.clear()
    this.objectUrls.clear()
    this.sourceRecords = new WeakMap()
    this.sourceBufferRecords = new WeakMap()
    this.sourceBufferOwners = new WeakMap()
    this.elementRecords = new WeakMap()
    this.capturedBytes = 0
  }

  private disposeRecord(record: MediaSourceRecord): void {
    if (record.disposed) return
    record.disposed = true
    const pending = record.pending
    this.cancelPendingDownload(record)
    if (pending !== null) {
      this.emit({
        type: 'failed',
        intentId: pending.intentId,
        code: this.enabled ? 'DOWNLOAD_UNAVAILABLE' : 'DOWNLOAD_BLOCKED',
        message: this.enabled
          ? 'The captured media source was replaced or released'
          : 'Experimental media download was disabled'
      })
    }
    try {
      record.detachSourceClose?.()
    } catch {
      // Teardown must continue even when a host object rejects cleanup.
    }
    record.detachSourceClose = null
    for (const url of record.objectUrls) {
      if (this.objectUrls.get(url) === record) this.objectUrls.delete(url)
    }
    record.objectUrls.clear()
    for (const element of record.elements) {
      if (this.elementRecords.get(element) === record) this.elementRecords.delete(element)
    }
    record.elements.clear()
    this.clearRecordData(record)
    record.buffers.length = 0
    this.records.delete(record)
  }

  private clearRecordData(record: MediaSourceRecord): void {
    for (const buffer of record.buffers) {
      this.capturedBytes = Math.max(0, this.capturedBytes - buffer.byteLength)
      buffer.chunks = []
      buffer.byteLength = 0
    }
  }
}
