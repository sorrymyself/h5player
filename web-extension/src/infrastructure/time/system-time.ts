import type { ClockPort, SchedulerPort } from '../../application/ports/browser'

export const systemClock: ClockPort = {
  now: () => Date.now()
}

export const systemScheduler: SchedulerPort = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle)
}
