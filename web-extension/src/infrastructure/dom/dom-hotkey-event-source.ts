import type {
  HotkeyEventSourcePort,
  HotkeyRuntimeEvent
} from '../../application/hotkeys/hotkey-controller'
import type { Teardown } from '../../application/ports/browser'

function composedElements(event: KeyboardEvent): readonly Element[] {
  return event.composedPath().filter((item): item is Element => item instanceof Element)
}

function isEditable(elements: readonly Element[]): boolean {
  return elements.some((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true
    if (element instanceof HTMLSelectElement) return true
    if (element.getAttribute('role') === 'textbox') return true
    return element instanceof HTMLElement && element.isContentEditable
  })
}

function containsMedia(element: Element | null): boolean {
  if (!element) return false
  if (element instanceof HTMLMediaElement) return true
  return element.querySelector('video, audio') !== null
}

function isPlayerFocused(document: Document, elements: readonly Element[]): boolean {
  if (elements.some((element) => containsMedia(element))) return true
  if (containsMedia(document.activeElement)) return true
  return containsMedia(document.fullscreenElement)
}

export class DomHotkeyEventSource implements HotkeyEventSourcePort {
  constructor(
    private readonly window: Window,
    private readonly document: Document
  ) {}

  subscribe(listener: (event: HotkeyRuntimeEvent) => void): Teardown {
    const onKeyDown = (event: KeyboardEvent): void => {
      const elements = composedElements(event)
      listener({
        code: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        repeat: event.repeat,
        isComposing: event.isComposing,
        editableTarget: isEditable(elements),
        playerFocused: isPlayerFocused(this.document, elements),
        trusted: event.isTrusted === true,
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopImmediatePropagation()
      })
    }
    this.window.addEventListener('keydown', onKeyDown, true)
    return () => this.window.removeEventListener('keydown', onKeyDown, true)
  }
}
