import type { MediaCommand } from '../command'
import { clampPlaybackRate, type MediaSnapshot } from '../media'
import { getHotkeyCommandDefinition } from './catalog'
import type { HotkeyCommandId } from './model'

const DEFAULT_RESTORE_RATE = 1.5
const NUMERIC_ACCUMULATION_WINDOW_MS = 300
const DEFAULT_RATE_EPSILON = 1e-6

type NumericRateBase = 1 | 2 | 3 | 4

export type HotkeyPlanningState = Readonly<{
  lastNonDefaultRate: number
  lastNumericPress: Readonly<{
    base: NumericRateBase
    at: number
    value: number
  }> | null
}>

export type HotkeyPlanInput = Readonly<{
  commandId: HotkeyCommandId
  snapshot: MediaSnapshot
  now: number
  state: HotkeyPlanningState
}>

export type HotkeyPlanResult = Readonly<{
  command: MediaCommand
  state: HotkeyPlanningState
}>

export function createHotkeyPlanningState(): HotkeyPlanningState {
  return Object.freeze({ lastNonDefaultRate: DEFAULT_RESTORE_RATE, lastNumericPress: null })
}

function isDefaultRate(value: number): boolean {
  return Math.abs(value - 1) <= DEFAULT_RATE_EPSILON
}

function numericRateBase(commandId: HotkeyCommandId): NumericRateBase | null {
  switch (commandId) {
    case 'media.rate-1':
      return 1
    case 'media.rate-2':
      return 2
    case 'media.rate-3':
      return 3
    case 'media.rate-4':
      return 4
    default:
      return null
  }
}

function setRateCommand(snapshot: MediaSnapshot, value: number): MediaCommand {
  return { type: 'media.set-rate', mediaId: snapshot.id, value: clampPlaybackRate(value) }
}

export function planHotkeyCommand(input: HotkeyPlanInput): HotkeyPlanResult {
  const currentRate = input.snapshot.metrics.playbackRate
  const observedNonDefaultRate = isDefaultRate(currentRate)
    ? input.state.lastNonDefaultRate
    : currentRate
  const base = numericRateBase(input.commandId)

  if (base !== null) {
    const previous = input.state.lastNumericPress
    const accumulates =
      previous !== null &&
      previous.base === base &&
      input.now >= previous.at &&
      input.now - previous.at <= NUMERIC_ACCUMULATION_WINDOW_MS
    const value = clampPlaybackRate(accumulates ? previous.value + base : base)
    const state = Object.freeze({
      lastNonDefaultRate: observedNonDefaultRate,
      lastNumericPress: Object.freeze({ base, at: input.now, value })
    })
    return Object.freeze({ command: setRateCommand(input.snapshot, value), state })
  }

  if (input.commandId === 'media.rate-reset') {
    const value = isDefaultRate(currentRate) ? observedNonDefaultRate : 1
    const state = Object.freeze({
      lastNonDefaultRate: observedNonDefaultRate,
      lastNumericPress: null
    })
    return Object.freeze({ command: setRateCommand(input.snapshot, value), state })
  }

  const definition = getHotkeyCommandDefinition(input.commandId)
  if (definition.action !== 'media') {
    throw new TypeError(`Hotkey command is not a media action: ${input.commandId}`)
  }

  return Object.freeze({
    command: definition.createCommand(input.snapshot),
    state: Object.freeze({
      lastNonDefaultRate: observedNonDefaultRate,
      lastNumericPress: null
    })
  })
}
