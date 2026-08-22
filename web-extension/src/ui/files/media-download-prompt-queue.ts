import type {
  MediaDownloadPrompt,
  MediaDownloadPromptRequest,
  MediaDownloadPromptResult
} from './download-media'

const DEFAULT_PROMPT_TIMEOUT_MS = 5 * 60_000

type QueueEntry = {
  readonly request: MediaDownloadPromptRequest
  readonly resolve: (result: MediaDownloadPromptResult | null) => void
  timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null
}

export type MediaDownloadPromptQueueOptions = Readonly<{
  onChanged: (request: MediaDownloadPromptRequest | null) => void
  timeoutMs?: number
}>

export class MediaDownloadPromptQueue {
  private readonly entries: QueueEntry[] = []
  private readonly onChanged: (request: MediaDownloadPromptRequest | null) => void
  private readonly timeoutMs: number
  private disposed = false

  readonly request: MediaDownloadPrompt = (request) => {
    if (this.disposed) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.entries.push({ request, resolve, timeoutHandle: null })
      if (this.entries.length === 1) this.activateCurrent()
    })
  }

  constructor(options: MediaDownloadPromptQueueOptions) {
    this.onChanged = options.onChanged
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS)
  }

  resolveCurrent(result: MediaDownloadPromptResult | null): boolean {
    const current = this.entries.shift()
    if (current === undefined) return false
    if (current.timeoutHandle !== null) globalThis.clearTimeout(current.timeoutHandle)
    current.resolve(result)
    this.activateCurrent()
    return true
  }

  teardown(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.entries.splice(0)) {
      if (entry.timeoutHandle !== null) globalThis.clearTimeout(entry.timeoutHandle)
      entry.resolve(null)
    }
    this.onChanged(null)
  }

  private activateCurrent(): void {
    const current = this.entries[0]
    if (current === undefined || this.disposed) {
      this.onChanged(null)
      return
    }
    current.timeoutHandle = globalThis.setTimeout(() => {
      if (this.entries[0] !== current) return
      this.resolveCurrent(null)
    }, this.timeoutMs)
    this.onChanged(current.request)
  }
}
