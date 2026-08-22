import type { ClockPort } from '../../application/ports/browser'

export type ReplayGuardOptions = {
  ttlMs?: number
  maxEntries?: number
}

export class ReplayGuard {
  private readonly seen = new Map<string, number>()
  private readonly ttlMs: number
  private readonly maxEntries: number

  constructor(
    private readonly clock: ClockPort,
    options: ReplayGuardOptions = {}
  ) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000
    this.maxEntries = options.maxEntries ?? 1_000
  }

  accept(scope: string, requestId: string): boolean {
    const now = this.clock.now()
    this.prune(now)
    const key = `${scope}:${requestId}`
    if (this.seen.has(key)) return false

    this.seen.set(key, now)
    if (this.seen.size > this.maxEntries) {
      const oldestKey = this.seen.keys().next().value
      if (typeof oldestKey === 'string') this.seen.delete(oldestKey)
    }
    return true
  }

  clearScope(scope: string): void {
    const prefix = `${scope}:`
    for (const key of this.seen.keys()) {
      if (key.startsWith(prefix)) this.seen.delete(key)
    }
  }

  private prune(now: number): void {
    for (const [key, timestamp] of this.seen) {
      if (now - timestamp <= this.ttlMs) continue
      this.seen.delete(key)
    }
  }
}
