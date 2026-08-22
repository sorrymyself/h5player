export const MIN_PLAYBACK_RATE = 0.1
export const MAX_PLAYBACK_RATE = 16
export const MIN_VOLUME = 0
export const MAX_VOLUME = 1
export const MIN_AUDIO_GAIN = 1
export const MAX_AUDIO_GAIN = 6
/** Opacity threshold separating foreground playback from preview layers. */
export const MIN_FOREGROUND_MEDIA_OPACITY = 0.5

export function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
    throw new RangeError('bounds must be finite and minimum must not exceed maximum')
  }
  if (!Number.isFinite(value)) return minimum
  return Math.min(Math.max(value, minimum), maximum)
}

export function clampUnit(value: number): number {
  return clamp(value, MIN_VOLUME, MAX_VOLUME)
}

export function clampAudioGain(value: number): number {
  return clamp(value, MIN_AUDIO_GAIN, MAX_AUDIO_GAIN)
}

export function clampPlaybackRate(value: number): number {
  return clamp(value, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE)
}

export function clampMediaTime(value: number, duration: number | null): number {
  if (duration === null) return Math.max(Number.isFinite(value) ? value : 0, 0)
  return clamp(value, 0, duration)
}

export function roundMediaValue(value: number, fractionDigits = 6): number {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 12) {
    throw new RangeError('fractionDigits must be an integer between 0 and 12')
  }
  if (!Number.isFinite(value)) return value
  const factor = 10 ** fractionDigits
  return Math.round((value + Number.EPSILON) * factor) / factor
}
