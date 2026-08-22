import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MediaQuickControls from '../../src/ui/media/MediaQuickControls.vue'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'

function media(overrides: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    id: 'media-0-1',
    frameId: 0,
    kind: 'video',
    state: 'active',
    metrics: {
      width: 640,
      height: 360,
      duration: 120,
      currentTime: 30,
      volume: 0.75,
      playbackRate: 1.5,
      muted: false,
      visible: true
    },
    capabilities: createMediaCapabilities({
      playback: true,
      seek: true,
      playbackRate: true,
      mute: true
    }),
    adapterId: 'generic',
    updatedAt: 10,
    ...overrides
  }
}

function renderControls(props: Record<string, unknown> = {}) {
  return render(MediaQuickControls, {
    props: { media: media(), policy: null, feedback: null, locale: 'zh-CN', ...props }
  })
}

afterEach(() => vi.useRealTimers())

describe('MediaQuickControls', () => {
  it.each(['active', 'paused'] as const)(
    'keeps the operation panel hidden by default while media is %s',
    (state) => {
      renderControls({ media: media({ state }) })
      const trigger = screen.getByRole('button', { name: /打开媒体快捷控制/ })
      const root = trigger.closest('.media-tools')

      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(root?.classList.contains('is-dormant')).toBe(false)
      expect(screen.queryByRole('toolbar', { name: '媒体控制' })).toBeNull()
    }
  )

  it('fully fades the rate status after the initial three-second reveal', async () => {
    vi.useFakeTimers()
    renderControls()
    const trigger = screen.getByRole('button', { name: /打开媒体快捷控制/ })
    const root = trigger.closest('.media-tools')

    await vi.advanceTimersByTimeAsync(2_999)
    expect(root?.classList.contains('is-dormant')).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(root?.classList.contains('is-dormant')).toBe(true)
  })

  it('opens only from the rate status region and fades again two seconds after leaving', async () => {
    vi.useFakeTimers()
    renderControls()
    const trigger = screen.getByRole('button', { name: /打开媒体快捷控制/ })
    const hitbox = screen.getByTestId('media-rate-hitbox')
    const root = trigger.closest('.media-tools')
    if (!(root instanceof HTMLElement)) throw new Error('media tools root missing')

    await vi.advanceTimersByTimeAsync(3_000)
    expect(root.classList.contains('is-dormant')).toBe(true)

    await fireEvent.mouseEnter(hitbox)
    expect(root.classList.contains('is-dormant')).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('toolbar', { name: '媒体控制' })).toBeTruthy()

    await fireEvent.mouseLeave(root)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('toolbar', { name: '媒体控制' })).toBeNull()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(root.classList.contains('is-dormant')).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(root.classList.contains('is-dormant')).toBe(true)
  })

  it('expands only the transparent hover hitbox around the unchanged rate trigger', async () => {
    renderControls()
    const trigger = screen.getByRole('button', { name: /打开媒体快捷控制/ })
    const hitbox = screen.getByTestId('media-rate-hitbox')

    expect(hitbox.classList.contains('media-tools__trigger-hitbox')).toBe(true)
    expect(hitbox.querySelector('.media-tools__trigger')).toBe(trigger)
    expect(trigger.parentElement).toBe(hitbox)
    expect(trigger.classList.contains('media-tools__trigger')).toBe(true)

    await fireEvent.mouseEnter(hitbox)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('toolbar', { name: '媒体控制' })).toBeTruthy()
  })

  it('keeps a hovered panel open and cancels a pending fade when interaction resumes', async () => {
    vi.useFakeTimers()
    renderControls()
    const trigger = screen.getByRole('button', { name: /打开媒体快捷控制/ })
    const hitbox = screen.getByTestId('media-rate-hitbox')
    const root = trigger.closest('.media-tools')
    if (!(root instanceof HTMLElement)) throw new Error('media tools root missing')

    await fireEvent.mouseEnter(hitbox)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    await fireEvent.mouseLeave(root)
    await vi.advanceTimersByTimeAsync(1_500)
    await fireEvent.mouseEnter(hitbox)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(root.classList.contains('is-dormant')).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('groups transport, rate, scope, and visibility actions without a flat button wall', async () => {
    const rendered = renderControls()
    await fireEvent.click(screen.getByRole('button', { name: /打开媒体快捷控制/ }))

    const panel = screen.getByRole('toolbar', { name: '媒体控制' })
    expect(panel.querySelector('.media-tools__transport')).toBeTruthy()
    expect(panel.querySelector('.media-tools__section')).toBeTruthy()
    expect(panel.querySelector('.media-tools__settings-row')).toBeTruthy()
    expect(screen.getByRole('group', { name: '速度' })).toBeTruthy()

    await fireEvent.update(screen.getByRole('combobox', { name: '倍速应用范围' }), 'media')
    await fireEvent.click(screen.getByRole('button', { name: '2×' }))
    expect(rendered.emitted()['command']?.[0]).toEqual([
      { type: 'media.set-rate', mediaId: 'media-0-1', value: 2 },
      'media'
    ])
  })

  it('collapses an open operation panel when playback transitions to paused', async () => {
    const rendered = renderControls()
    const trigger = screen.getByRole('button', { name: /打开媒体快捷控制/ })
    const hitbox = screen.getByTestId('media-rate-hitbox')

    await fireEvent.mouseEnter(hitbox)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('toolbar', { name: '媒体控制' })).toBeTruthy()

    await rendered.rerender({
      media: media({ state: 'paused' }),
      policy: null,
      feedback: {
        id: 'feedback-pause',
        mediaId: 'media-0-1',
        commandId: 'media.pause',
        kind: 'state',
        messageKey: 'feedback.paused',
        tone: 'success',
        source: 'shortcut',
        createdAt: 10,
        expiresAt: 1_810
      },
      locale: 'zh-CN'
    })

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('toolbar', { name: '媒体控制' })).toBeNull()
  })

  it('supports outside collapse, Escape focus restore, and bounded Tab traversal', async () => {
    renderControls()
    const trigger = screen.getByRole('button', { name: /打开媒体快捷控制/ })
    await fireEvent.click(trigger)
    const hidePage = screen.getByRole('button', { name: '临时隐藏本页控件' })
    hidePage.focus()
    await fireEvent.keyDown(hidePage, { key: 'Tab' })
    expect(globalThis.document.activeElement).toBe(trigger)

    await fireEvent.keyDown(screen.getByRole('button', { name: '暂停' }), { key: 'Escape' })
    await Promise.resolve()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(globalThis.document.activeElement).toBe(trigger)

    await fireEvent.click(trigger)
    await fireEvent.pointerDown(globalThis.document.body, { pointerType: 'touch' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('emits page and media visibility actions', async () => {
    const rendered = renderControls()
    await fireEvent.click(screen.getByRole('button', { name: /打开媒体快捷控制/ }))
    await fireEvent.click(screen.getByRole('button', { name: '隐藏当前媒体控件' }))
    expect(rendered.emitted()['hideMedia']).toEqual([[null]])

    await fireEvent.click(screen.getByRole('button', { name: /打开媒体快捷控制/ }))
    await fireEvent.click(screen.getByRole('button', { name: '临时隐藏本页控件' }))
    expect(rendered.emitted()['hidePage']).toEqual([[null]])
  })

  it('reuses the rate status region for playback-rate feedback', async () => {
    const rendered = renderControls({ locale: 'en-US' })
    await rendered.rerender({
      media: media({ metrics: { ...media().metrics, playbackRate: 1.75 } }),
      policy: null,
      feedback: {
        id: 'feedback-1',
        mediaId: 'media-0-1',
        commandId: 'media.set-rate',
        kind: 'value',
        messageKey: 'feedback.playback-rate',
        value: 1.75,
        tone: 'success',
        source: 'shortcut',
        createdAt: 10,
        expiresAt: 1_810
      },
      locale: 'en-US'
    })

    const trigger = screen.getByRole('button', { name: /Playback speed 1.75×/ })
    expect(trigger.querySelector('.media-tools__rate-label')?.textContent).toBe('1.75×')
    expect(trigger.closest('.media-tools')?.classList.contains('has-feedback')).toBe(true)
    expect(globalThis.document.querySelector('.media-feedback')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Playback speed 1.75×')
  })
})
