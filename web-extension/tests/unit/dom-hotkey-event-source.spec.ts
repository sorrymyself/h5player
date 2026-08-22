import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HotkeyRuntimeEvent } from '../../src/application/hotkeys'
import { DomHotkeyEventSource } from '../../src/infrastructure/dom'

afterEach(() => {
  document.body.replaceChildren()
})

describe('DomHotkeyEventSource', () => {
  it('marks editable composed targets and exposes native cancellation controls', () => {
    const input = document.createElement('input')
    document.body.append(input)
    const listener = vi.fn((event: HotkeyRuntimeEvent) => {
      event.preventDefault()
      event.stopPropagation()
    })
    const source = new DomHotkeyEventSource(window, document)
    const teardown = source.subscribe(listener)
    const keyboard = new KeyboardEvent('keydown', {
      code: 'Space',
      bubbles: true,
      composed: true,
      cancelable: true
    })

    input.dispatchEvent(keyboard)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      code: 'Space',
      editableTarget: true,
      playerFocused: false,
      trusted: false
    })
    expect(keyboard.defaultPrevented).toBe(true)

    teardown()
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))
    expect(listener).toHaveBeenCalledOnce()
  })

  it('detects player focus through a media-containing event path', () => {
    const player = document.createElement('button')
    player.append(document.createElement('video'))
    document.body.append(player)
    const listener = vi.fn()
    const source = new DomHotkeyEventSource(window, document)
    source.subscribe(listener)

    player.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true, composed: true })
    )
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      editableTarget: false,
      playerFocused: true
    })
  })
})
