export type FrameMediaLocation = 'none' | 'top-frame' | 'child-frame' | 'mixed'

export type FrameRuntimeReport = Readonly<{
  ready: boolean
  mediaCount: number
  activeMedia: boolean
  anchoredMediaCount: number
  pageUiHidden: boolean
  temporaryDisabled: boolean
  updatedAt: number
}>

export type FrameRuntimeIdentity = Readonly<{
  tabId: number
  frameId: number
  sessionId: string
}>

export type TabFrameRuntimeSummary = Readonly<{
  topFrameMediaCount: number
  childFrameMediaCount: number
  childFrameCount: number
  anchoredMediaCount: number
  mediaLocation: FrameMediaLocation
}>

export type FrameRuntimeRegistryOptions = Readonly<{
  now?: () => number
  leaseMs?: number
}>

type FrameRuntimeRecord = FrameRuntimeIdentity &
  FrameRuntimeReport &
  Readonly<{ receivedAt: number; hadMediaOwner: boolean; connected: boolean }>

type FrameRuntimeReportMatcher = (
  identity: FrameRuntimeIdentity,
  report: FrameRuntimeReport
) => boolean

const DEFAULT_LEASE_MS = 20_000

const EMPTY_SUMMARY: TabFrameRuntimeSummary = {
  topFrameMediaCount: 0,
  childFrameMediaCount: 0,
  childFrameCount: 0,
  anchoredMediaCount: 0,
  mediaLocation: 'none'
}

export class FrameRuntimeRegistry {
  private readonly records = new Map<number, Map<number, FrameRuntimeRecord>>()
  private readonly pendingRecords = new Map<number, Map<number, FrameRuntimeRecord>>()
  private readonly reportListeners = new Map<
    number,
    Set<Readonly<{ matches: FrameRuntimeReportMatcher; resolve: () => void }>>
  >()

  private readonly now: () => number
  private readonly leaseMs: number

  constructor(options: FrameRuntimeRegistryOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.leaseMs = Math.max(1, options.leaseMs ?? DEFAULT_LEASE_MS)
  }

  /**
   * A newly connected content session owns the frame slot immediately. This
   * matters when a frame starts while the page is temporarily disabled: its
   * first report can legitimately be dormant (ready=false), and must still
   * replace the previous session that used the same browser frameId.
   */
  connect(identity: FrameRuntimeIdentity): void {
    this.pruneExpired(identity.tabId)
    const frames = this.records.get(identity.tabId) ?? new Map<number, FrameRuntimeRecord>()
    const current = frames.get(identity.frameId)
    if (current !== undefined && current.sessionId === identity.sessionId) {
      if (current.connected) return
      frames.set(identity.frameId, { ...current, connected: true, receivedAt: this.now() })
      this.records.set(identity.tabId, frames)
      return
    }
    const pending = this.pendingRecords.get(identity.tabId)?.get(identity.frameId)
    const replacement =
      pending?.sessionId === identity.sessionId
        ? { ...pending, connected: true }
        : {
            ...identity,
            ready: false,
            mediaCount: 0,
            activeMedia: false,
            anchoredMediaCount: 0,
            pageUiHidden: false,
            temporaryDisabled: false,
            updatedAt: 0,
            receivedAt: this.now(),
            hadMediaOwner: false,
            connected: true
          }
    const pendingFrames = this.pendingRecords.get(identity.tabId)
    if (pendingFrames?.get(identity.frameId)?.sessionId === identity.sessionId) {
      pendingFrames.delete(identity.frameId)
      if (pendingFrames.size === 0) this.pendingRecords.delete(identity.tabId)
    }
    frames.set(identity.frameId, replacement)
    this.records.set(identity.tabId, frames)
  }

  report(identity: FrameRuntimeIdentity, report: FrameRuntimeReport): boolean {
    this.pruneExpired(identity.tabId)
    const frames = this.records.get(identity.tabId) ?? new Map<number, FrameRuntimeRecord>()
    const current = frames.get(identity.frameId)
    if (current !== undefined) {
      if (current.sessionId !== identity.sessionId && current.connected) return false
      if (current.sessionId === identity.sessionId && report.updatedAt < current.updatedAt) {
        return false
      }
      if (current.sessionId !== identity.sessionId) {
        const pendingFrames =
          this.pendingRecords.get(identity.tabId) ?? new Map<number, FrameRuntimeRecord>()
        pendingFrames.set(identity.frameId, {
          ...identity,
          ...report,
          receivedAt: this.now(),
          hadMediaOwner: report.mediaCount > 0 || report.activeMedia,
          connected: false
        })
        this.pendingRecords.set(identity.tabId, pendingFrames)
        return false
      }
    }
    frames.set(identity.frameId, {
      ...identity,
      ...report,
      receivedAt: this.now(),
      hadMediaOwner:
        (current?.hadMediaOwner ?? false) || report.mediaCount > 0 || report.activeMedia,
      connected: current?.sessionId === identity.sessionId && current.connected
    })
    this.records.set(identity.tabId, frames)
    this.notifyReport(identity, report)
    return true
  }

  removeTab(tabId: number): void {
    this.records.delete(tabId)
    this.pendingRecords.delete(tabId)
  }

  remove(identity: FrameRuntimeIdentity): void {
    const frames = this.records.get(identity.tabId)
    if (frames?.get(identity.frameId)?.sessionId === identity.sessionId) {
      frames.delete(identity.frameId)
      if (frames.size === 0) this.records.delete(identity.tabId)
    }
    const pendingFrames = this.pendingRecords.get(identity.tabId)
    if (pendingFrames?.get(identity.frameId)?.sessionId === identity.sessionId) {
      pendingFrames.delete(identity.frameId)
      if (pendingFrames.size === 0) this.pendingRecords.delete(identity.tabId)
    }
  }

  removeFrame(tabId: number, frameId: number): void {
    const frames = this.records.get(tabId)
    if (frames === undefined) return
    frames.delete(frameId)
    if (frames.size === 0) this.records.delete(tabId)
    const pendingFrames = this.pendingRecords.get(tabId)
    pendingFrames?.delete(frameId)
    if (pendingFrames?.size === 0) this.pendingRecords.delete(tabId)
  }

  owns(identity: FrameRuntimeIdentity): boolean {
    this.pruneExpired(identity.tabId)
    return this.records.get(identity.tabId)?.get(identity.frameId)?.sessionId === identity.sessionId
  }

  waitForReport(
    tabId: number,
    timeoutMs: number,
    matches: FrameRuntimeReportMatcher = () => true
  ): Promise<boolean> {
    const boundedTimeoutMs = Math.max(0, timeoutMs)
    return new Promise((resolve) => {
      let settled = false
      const listener = { matches, resolve: () => settle(true) }
      const settle = (changed: boolean): void => {
        if (settled) return
        settled = true
        globalThis.clearTimeout(timeout)
        const listeners = this.reportListeners.get(tabId)
        listeners?.delete(listener)
        if (listeners?.size === 0) this.reportListeners.delete(tabId)
        resolve(changed)
      }
      const timeout = globalThis.setTimeout(() => settle(false), boundedTimeoutMs)
      const listeners =
        this.reportListeners.get(tabId) ??
        new Set<Readonly<{ matches: FrameRuntimeReportMatcher; resolve: () => void }>>()
      listeners.add(listener)
      this.reportListeners.set(tabId, listeners)
    })
  }

  summarize(tabId: number): TabFrameRuntimeSummary {
    this.pruneExpired(tabId)
    const frames = this.records.get(tabId)
    if (frames === undefined) return EMPTY_SUMMARY

    let topFrameMediaCount = 0
    let childFrameMediaCount = 0
    let childFrameCount = 0
    let anchoredMediaCount = 0
    for (const record of frames.values()) {
      if (!record.ready) continue
      anchoredMediaCount += record.anchoredMediaCount
      if (record.frameId === 0) topFrameMediaCount = record.mediaCount
      else {
        childFrameCount += 1
        childFrameMediaCount += record.mediaCount
      }
    }

    const mediaLocation: FrameMediaLocation =
      topFrameMediaCount > 0
        ? childFrameMediaCount > 0
          ? 'mixed'
          : 'top-frame'
        : childFrameMediaCount > 0
          ? 'child-frame'
          : 'none'

    return {
      topFrameMediaCount,
      childFrameMediaCount,
      childFrameCount,
      anchoredMediaCount,
      mediaLocation
    }
  }

  frameIds(tabId: number): readonly number[] {
    this.pruneExpired(tabId)
    return [...(this.records.get(tabId)?.keys() ?? [])].sort((left, right) => left - right)
  }

  mediaFrameIds(tabId: number): readonly number[] {
    this.pruneExpired(tabId)
    const frames = [...(this.records.get(tabId)?.values() ?? [])].filter(
      // A temporarily disabled owner reports ready=false and mediaCount=0
      // while it tears down its local media runtime. Keep that exact frame
      // routable so a later enable command can wake it; ordinary empty or
      // unloaded frames remain excluded.
      (record) =>
        record.frameId === 0 ||
        record.mediaCount > 0 ||
        record.activeMedia ||
        record.temporaryDisabled ||
        record.hadMediaOwner
    )
    return frames
      .sort((left, right) => {
        if (left.activeMedia !== right.activeMedia) return left.activeMedia ? -1 : 1
        const leftHasMedia = left.mediaCount > 0
        const rightHasMedia = right.mediaCount > 0
        if (leftHasMedia !== rightHasMedia) return leftHasMedia ? -1 : 1
        if (left.frameId === 0 || right.frameId === 0) return left.frameId === 0 ? -1 : 1
        if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
        return left.frameId - right.frameId
      })
      .map((record) => record.frameId)
  }

  private pruneExpired(tabId: number): void {
    const frames = this.records.get(tabId)
    if (frames === undefined) return
    const expiredBefore = this.now() - this.leaseMs
    for (const [frameId, record] of frames) {
      if (record.receivedAt < expiredBefore) frames.delete(frameId)
    }
    if (frames.size === 0) this.records.delete(tabId)
    const pendingFrames = this.pendingRecords.get(tabId)
    if (pendingFrames !== undefined) {
      for (const [frameId, record] of pendingFrames) {
        if (record.receivedAt < expiredBefore) pendingFrames.delete(frameId)
      }
      if (pendingFrames.size === 0) this.pendingRecords.delete(tabId)
    }
  }

  private notifyReport(identity: FrameRuntimeIdentity, report: FrameRuntimeReport): void {
    for (const listener of [...(this.reportListeners.get(identity.tabId) ?? [])]) {
      if (listener.matches(identity, report)) listener.resolve()
    }
  }
}
