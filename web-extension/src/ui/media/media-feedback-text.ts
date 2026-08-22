import type { MediaFeedbackEvent } from '../../application/feedback'
import {
  formatMediaNumber as formatNumber,
  translateMedia as translate,
  type MediaLocale as Locale,
  type MediaMessageKey
} from './media-messages'

const directFeedbackKeys = new Set<MediaMessageKey>([
  'feedback.played',
  'feedback.paused',
  'feedback.muted',
  'feedback.unmuted',
  'feedback.fullscreen',
  'feedback.capture',
  'feedback.downloadStarted',
  'feedback.downloadQueued'
])

const renamedFeedbackKeys = {
  'feedback.playback-rate-protection-disabled': 'feedback.playbackRateProtectionDisabled',
  'feedback.playback-rate-protection-exhausted': 'feedback.playbackRateProtectionExhausted',
  'feedback.transform-reset': 'feedback.transformReset',
  'feedback.visual-reset': 'feedback.visualReset',
  'feedback.picture-in-picture': 'feedback.pictureInPicture',
  'download.error.cancelled': 'feedback.downloadCancelled',
  'feedback.play-next': 'feedback.playNext',
  'feedback.restore-progress-enabled': 'feedback.restoreProgressEnabled',
  'feedback.restore-progress-disabled': 'feedback.restoreProgressDisabled',
  'feedback.restore-progress-failed': 'feedback.restoreProgressFailed'
} as const satisfies Record<string, MediaMessageKey>

const formattedNumberFeedbackKeys = {
  'feedback.playback-rate': 'feedback.playbackRate',
  'feedback.playback-rate-restored': 'feedback.playbackRateRestored',
  'feedback.audio-gain': 'feedback.audioGain',
  'feedback.zoom': 'feedback.zoom',
  'feedback.filter-brightness': 'feedback.brightness',
  'feedback.filter-contrast': 'feedback.contrast',
  'feedback.filter-saturation': 'feedback.saturation',
  'feedback.filter-hue': 'feedback.hue',
  'feedback.filter-blur': 'feedback.blur'
} as const satisfies Record<string, MediaMessageKey>

export function formatMediaFeedback(event: MediaFeedbackEvent, locale: Locale): string {
  const numericValue = typeof event.value === 'number' ? event.value : 0
  const eventMessageKey = event.messageKey as MediaMessageKey
  if (directFeedbackKeys.has(eventMessageKey)) return translate(locale, eventMessageKey)
  const directKey = renamedFeedbackKeys[event.messageKey as keyof typeof renamedFeedbackKeys]
  if (directKey !== undefined) return translate(locale, directKey)
  const formattedNumberKey =
    formattedNumberFeedbackKeys[event.messageKey as keyof typeof formattedNumberFeedbackKeys]
  if (formattedNumberKey !== undefined) {
    return translate(locale, formattedNumberKey, {
      value: formatNumber(numericValue, locale)
    })
  }
  switch (event.messageKey) {
    case 'feedback.volume':
      return translate(locale, 'feedback.volume', { value: Math.round(numericValue * 100) })
    case 'feedback.seek-forward':
      return translate(locale, 'feedback.seekForward', { value: numericValue })
    case 'feedback.seek-backward':
      return translate(locale, 'feedback.seekBackward', { value: numericValue })
    case 'feedback.rotation':
      return translate(locale, 'feedback.rotation', { value: numericValue })
    case 'feedback.frame-step':
      return translate(
        locale,
        numericValue >= 0 ? 'feedback.frameForward' : 'feedback.frameBackward',
        { value: Math.abs(numericValue) }
      )
    case 'feedback.pan':
      return translate(locale, 'feedback.pan', { value: String(event.value ?? '') })
    case 'feedback.flip-horizontal':
      return translate(
        locale,
        event.value === false ? 'feedback.flipHorizontalOff' : 'feedback.flipHorizontalOn'
      )
    case 'feedback.flip-vertical':
      return translate(
        locale,
        event.value === false ? 'feedback.flipVerticalOff' : 'feedback.flipVerticalOn'
      )
    default:
      return event.kind === 'error'
        ? translate(locale, 'feedback.actionUnavailable')
        : translate(locale, 'feedback.applied')
  }
}
