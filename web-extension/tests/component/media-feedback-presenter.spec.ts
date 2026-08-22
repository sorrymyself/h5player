import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import MediaFeedbackPresenter from '../../src/ui/media/MediaFeedbackPresenter.vue'

describe('MediaFeedbackPresenter', () => {
  it('renders page fallback feedback without controls or focus interception', () => {
    render(MediaFeedbackPresenter, {
      props: {
        event: {
          id: 'audio-feedback',
          mediaId: 'media-audio',
          commandId: 'media.set-rate',
          kind: 'value',
          messageKey: 'feedback.playback-rate',
          value: 1.5,
          tone: 'success',
          source: 'shortcut',
          createdAt: 10,
          expiresAt: 1_810
        },
        locale: 'zh-CN',
        variant: 'page',
        theme: 'light'
      }
    })

    const status = screen.getByRole('status')
    expect(status.classList.contains('is-page')).toBe(true)
    expect(status.classList.contains('is-kind-value')).toBe(true)
    expect(status.classList.contains('theme-light')).toBe(true)
    expect(status.textContent).toContain('播放速度 1.5×')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('uses assertive alert semantics for command errors', () => {
    render(MediaFeedbackPresenter, {
      props: {
        event: {
          id: 'error-feedback',
          mediaId: 'media-0-1',
          commandId: 'media.set-rate',
          kind: 'error',
          messageKey: 'command.error.capabilityUnavailable',
          value: 'CAPABILITY_UNAVAILABLE',
          tone: 'danger',
          source: 'overlay',
          createdAt: 10,
          expiresAt: 1_810
        },
        locale: 'en-US'
      }
    })
    const alert = screen.getByRole('alert')
    expect(alert.getAttribute('aria-live')).toBe('assertive')
    expect(alert.classList.contains('is-kind-error')).toBe(true)
  })
})
