/* eslint-disable @typescript-eslint/unbound-method -- Native DOM intrinsics are intentionally captured and invoked with explicit receivers. */

type NativeGetter<TTarget, TValue> = (target: TTarget) => TValue
type NativeSetter<TTarget, TValue> = (target: TTarget, value: TValue) => void

interface NativeAccessor<TTarget, TValue> {
  readonly get: NativeGetter<TTarget, TValue> | null
  readonly set: NativeSetter<TTarget, TValue> | null
}

function asError(value: unknown, fallbackMessage: string): Error {
  return value instanceof Error ? value : new Error(fallbackMessage)
}

function findDescriptor(
  prototype: object | null,
  property: PropertyKey
): PropertyDescriptor | null {
  let current: object | null = prototype
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property)
    if (descriptor !== undefined) return descriptor
    current = Object.getPrototypeOf(current) as object | null
  }
  return null
}

function captureAccessor<TTarget, TValue>(
  prototype: object | null,
  property: PropertyKey
): NativeAccessor<TTarget, TValue> {
  const descriptor = findDescriptor(prototype, property)
  const getter = descriptor?.get as ((this: TTarget) => TValue) | undefined
  const setter = descriptor?.set as ((this: TTarget, value: TValue) => void) | undefined
  return {
    get: getter === undefined ? null : (target) => getter.call(target),
    set: setter === undefined ? null : (target, value) => setter.call(target, value)
  }
}

const mediaPrototype = typeof HTMLMediaElement === 'undefined' ? null : HTMLMediaElement.prototype
const videoPrototype = typeof HTMLVideoElement === 'undefined' ? null : HTMLVideoElement.prototype
const elementPrototype = typeof Element === 'undefined' ? null : Element.prototype
const nodePrototype = typeof Node === 'undefined' ? null : Node.prototype
const htmlElementPrototype = typeof HTMLElement === 'undefined' ? null : HTMLElement.prototype
const documentPrototype = typeof Document === 'undefined' ? null : Document.prototype
const stylePrototype =
  typeof CSSStyleDeclaration === 'undefined' ? null : CSSStyleDeclaration.prototype

const playMethod = mediaPrototype?.play ?? null
const pauseMethod = mediaPrototype?.pause ?? null
const addEventListenerMethod =
  typeof EventTarget === 'undefined' ? null : EventTarget.prototype.addEventListener
const removeEventListenerMethod =
  typeof EventTarget === 'undefined' ? null : EventTarget.prototype.removeEventListener
const getBoundingClientRectMethod = elementPrototype?.getBoundingClientRect ?? null
const getAttributeMethod = elementPrototype?.getAttribute ?? null
const requestFullscreenMethod = elementPrototype?.requestFullscreen ?? null
const requestPictureInPictureMethod = videoPrototype?.requestPictureInPicture ?? null
const exitFullscreenMethod = documentPrototype?.exitFullscreen ?? null
const exitPictureInPictureMethod = documentPrototype?.exitPictureInPicture ?? null
const getRootNodeMethod = nodePrototype?.getRootNode ?? null
const containsMethod = nodePrototype?.contains ?? null
const getComputedStyleMethod = (() => {
  const view = typeof window === 'undefined' ? null : window
  if (view === null) return null
  const descriptor = findDescriptor(view, 'getComputedStyle')
  if (typeof descriptor?.value === 'function') {
    return descriptor.value as Window['getComputedStyle']
  }
  try {
    return typeof view.getComputedStyle === 'function' ? view.getComputedStyle : null
  } catch {
    return null
  }
})()
const parentElementGetter = findDescriptor(nodePrototype, 'parentElement')?.get as
  ((this: Node) => HTMLElement | null) | undefined
const setStylePropertyMethod = stylePrototype?.setProperty ?? null
const getStylePropertyValueMethod = stylePrototype?.getPropertyValue ?? null

const currentTimeAccessor = captureAccessor<HTMLMediaElement, number>(mediaPrototype, 'currentTime')
const currentSrcAccessor = captureAccessor<HTMLMediaElement, string>(mediaPrototype, 'currentSrc')
const srcAccessor = captureAccessor<HTMLMediaElement, string>(mediaPrototype, 'src')
const durationAccessor = captureAccessor<HTMLMediaElement, number>(mediaPrototype, 'duration')
const volumeAccessor = captureAccessor<HTMLMediaElement, number>(mediaPrototype, 'volume')
const playbackRateAccessor = captureAccessor<HTMLMediaElement, number>(
  mediaPrototype,
  'playbackRate'
)
const mutedAccessor = captureAccessor<HTMLMediaElement, boolean>(mediaPrototype, 'muted')
const pausedAccessor = captureAccessor<HTMLMediaElement, boolean>(mediaPrototype, 'paused')
const errorAccessor = captureAccessor<HTMLMediaElement, MediaError | null>(mediaPrototype, 'error')
const videoWidthAccessor = captureAccessor<HTMLMediaElement, number>(videoPrototype, 'videoWidth')
const videoHeightAccessor = captureAccessor<HTMLMediaElement, number>(videoPrototype, 'videoHeight')
const displayWidthAccessor = captureAccessor<HTMLMediaElement, number>(videoPrototype, 'width')
const displayHeightAccessor = captureAccessor<HTMLMediaElement, number>(videoPrototype, 'height')
const clientWidthAccessor = captureAccessor<HTMLMediaElement, number>(
  elementPrototype,
  'clientWidth'
)
const clientHeightAccessor = captureAccessor<HTMLMediaElement, number>(
  elementPrototype,
  'clientHeight'
)
const hiddenAccessor = captureAccessor<HTMLMediaElement, boolean>(htmlElementPrototype, 'hidden')
const styleAccessor = captureAccessor<HTMLMediaElement, CSSStyleDeclaration>(
  htmlElementPrototype,
  'style'
)
const isConnectedAccessor = captureAccessor<HTMLMediaElement, boolean>(nodePrototype, 'isConnected')
const localNameAccessor = captureAccessor<HTMLMediaElement, string>(elementPrototype, 'localName')
const fullscreenElementAccessor = captureAccessor<Document, Element | null>(
  documentPrototype,
  'fullscreenElement'
)
const fullscreenEnabledAccessor = captureAccessor<Document, boolean>(
  documentPrototype,
  'fullscreenEnabled'
)
const pictureInPictureElementAccessor = captureAccessor<Document, Element | null>(
  documentPrototype,
  'pictureInPictureElement'
)
const pictureInPictureEnabledAccessor = captureAccessor<Document, boolean>(
  documentPrototype,
  'pictureInPictureEnabled'
)
const disablePictureInPictureAccessor = captureAccessor<HTMLVideoElement, boolean>(
  videoPrototype,
  'disablePictureInPicture'
)
const cssTextAccessor = captureAccessor<CSSStyleDeclaration, string>(stylePrototype, 'cssText')

function readOr<T>(
  accessor: NativeAccessor<HTMLMediaElement, T>,
  target: HTMLMediaElement,
  fallback: T
): T {
  if (accessor.get === null) return fallback
  try {
    return accessor.get(target)
  } catch {
    return fallback
  }
}

function readDocumentOr<T>(
  accessor: NativeAccessor<Document, T>,
  target: Document,
  fallback: T
): T {
  if (accessor.get === null) return fallback
  try {
    return accessor.get(target)
  } catch {
    return fallback
  }
}

function readVideoOr<T>(
  accessor: NativeAccessor<HTMLVideoElement, T>,
  target: HTMLVideoElement,
  fallback: T
): T {
  if (accessor.get === null) return fallback
  try {
    return accessor.get(target)
  } catch {
    return fallback
  }
}

function nativeStyle(element: HTMLMediaElement): CSSStyleDeclaration | null {
  if (styleAccessor.get === null) return null
  try {
    return styleAccessor.get(element)
  } catch {
    return null
  }
}

function nativeParentElement(element: Element): HTMLElement | null {
  if (parentElementGetter === undefined) return element.parentElement
  try {
    return parentElementGetter.call(element)
  } catch {
    return null
  }
}

function nativeRootNode(element: Element): Node | null {
  if (getRootNodeMethod === null) return null
  try {
    return getRootNodeMethod.call(element)
  } catch {
    return null
  }
}

export const nativeMediaBindings = Object.freeze({
  hasPlayback: playMethod !== null && pauseMethod !== null,
  hasSeek: currentTimeAccessor.set !== null,
  hasPlaybackRate: playbackRateAccessor.set !== null,
  hasVolume: volumeAccessor.set !== null,
  hasMute: mutedAccessor.set !== null,
  hasVisualStyles:
    styleAccessor.get !== null && cssTextAccessor.set !== null && setStylePropertyMethod !== null,
  hasFullscreenNative: requestFullscreenMethod !== null && exitFullscreenMethod !== null,
  hasFullscreenWeb:
    styleAccessor.get !== null && cssTextAccessor.set !== null && setStylePropertyMethod !== null,
  hasFullscreen:
    (requestFullscreenMethod !== null && exitFullscreenMethod !== null) ||
    (styleAccessor.get !== null && cssTextAccessor.set !== null && setStylePropertyMethod !== null),
  hasPictureInPicture:
    requestPictureInPictureMethod !== null && exitPictureInPictureMethod !== null,

  isMediaElement(target: unknown): target is HTMLMediaElement {
    if (typeof target !== 'object' || target === null || localNameAccessor.get === null)
      return false
    try {
      const media = target as HTMLMediaElement
      const localName = localNameAccessor.get(media)
      if (localName !== 'video' && localName !== 'audio') return false
      pausedAccessor.get?.(media)
      return true
    } catch {
      return false
    }
  },

  isVideo(element: HTMLMediaElement): element is HTMLVideoElement {
    return readOr(localNameAccessor, element, '') === 'video'
  },

  isPictureInPictureEnabled(element: HTMLMediaElement): boolean {
    if (
      readOr(localNameAccessor, element, '') !== 'video' ||
      requestPictureInPictureMethod === null ||
      exitPictureInPictureMethod === null
    ) {
      return false
    }
    const document = element.ownerDocument
    const documentEnabled = readDocumentOr(pictureInPictureEnabledAccessor, document, true)
    const disabled = readVideoOr(
      disablePictureInPictureAccessor,
      element as HTMLVideoElement,
      false
    )
    return documentEnabled && !disabled
  },

  play(element: HTMLMediaElement): Promise<void> {
    if (playMethod === null) return Promise.reject(new Error('Native media play is unavailable'))
    try {
      return Promise.resolve(playMethod.call(element))
    } catch (error) {
      return Promise.reject(asError(error, 'Native media play failed'))
    }
  },

  pause(element: HTMLMediaElement): void {
    if (pauseMethod === null) throw new Error('Native media pause is unavailable')
    pauseMethod.call(element)
  },

  readCurrentTime: (element: HTMLMediaElement) => readOr(currentTimeAccessor, element, 0),
  readCurrentSrc: (element: HTMLMediaElement) =>
    readOr(currentSrcAccessor, element, '') || readOr(srcAccessor, element, ''),
  readDuration: (element: HTMLMediaElement) => readOr(durationAccessor, element, Number.NaN),
  readVolume: (element: HTMLMediaElement) => readOr(volumeAccessor, element, 1),
  readPlaybackRate: (element: HTMLMediaElement) => readOr(playbackRateAccessor, element, 1),
  readMuted: (element: HTMLMediaElement) => readOr(mutedAccessor, element, false),
  readPaused: (element: HTMLMediaElement) => readOr(pausedAccessor, element, true),
  readError: (element: HTMLMediaElement) => readOr(errorAccessor, element, null),
  readVideoWidth: (element: HTMLMediaElement) => readOr(videoWidthAccessor, element, 0),
  readVideoHeight: (element: HTMLMediaElement) => readOr(videoHeightAccessor, element, 0),
  readDisplayWidth: (element: HTMLMediaElement) => readOr(displayWidthAccessor, element, 0),
  readDisplayHeight: (element: HTMLMediaElement) => readOr(displayHeightAccessor, element, 0),
  readClientWidth: (element: HTMLMediaElement) => readOr(clientWidthAccessor, element, 0),
  readClientHeight: (element: HTMLMediaElement) => readOr(clientHeightAccessor, element, 0),
  readHidden: (element: HTMLMediaElement) => readOr(hiddenAccessor, element, false),
  readIsConnected: (element: HTMLMediaElement) => readOr(isConnectedAccessor, element, false),

  writeCurrentTime(element: HTMLMediaElement, value: number): void {
    if (currentTimeAccessor.set === null) throw new Error('Native media seeking is unavailable')
    currentTimeAccessor.set(element, value)
  },

  writePlaybackRate(element: HTMLMediaElement, value: number): void {
    if (playbackRateAccessor.set === null) {
      throw new Error('Native media playback rate is unavailable')
    }
    playbackRateAccessor.set(element, value)
  },

  writeVolume(element: HTMLMediaElement, value: number): void {
    if (volumeAccessor.set === null) throw new Error('Native media volume is unavailable')
    volumeAccessor.set(element, value)
  },

  writeMuted(element: HTMLMediaElement, value: boolean): void {
    if (mutedAccessor.set === null) throw new Error('Native media mute is unavailable')
    mutedAccessor.set(element, value)
  },

  requestFullscreen(element: HTMLMediaElement): Promise<void> {
    if (requestFullscreenMethod === null) {
      return Promise.reject(new Error('Native fullscreen request is unavailable'))
    }
    try {
      return Promise.resolve(requestFullscreenMethod.call(element)).then(() => undefined)
    } catch (error) {
      return Promise.reject(asError(error, 'Native fullscreen request failed'))
    }
  },

  exitFullscreen(element: HTMLMediaElement): Promise<void> {
    if (exitFullscreenMethod === null) {
      return Promise.reject(new Error('Native fullscreen exit is unavailable'))
    }
    try {
      return Promise.resolve(exitFullscreenMethod.call(element.ownerDocument)).then(() => undefined)
    } catch (error) {
      return Promise.reject(asError(error, 'Native fullscreen exit failed'))
    }
  },

  readFullscreenElement(element: HTMLMediaElement): Element | null {
    return readDocumentOr(fullscreenElementAccessor, element.ownerDocument, null)
  },

  isFullscreenEnabled(element: HTMLMediaElement): boolean {
    return readDocumentOr(fullscreenEnabledAccessor, element.ownerDocument, true)
  },

  requestPictureInPicture(element: HTMLMediaElement): Promise<void> {
    if (requestPictureInPictureMethod === null) {
      return Promise.reject(new Error('Picture-in-picture request is unavailable'))
    }
    try {
      return Promise.resolve(requestPictureInPictureMethod.call(element as HTMLVideoElement)).then(
        () => undefined
      )
    } catch (error) {
      return Promise.reject(asError(error, 'Picture-in-picture request failed'))
    }
  },

  exitPictureInPicture(element: HTMLMediaElement): Promise<void> {
    if (exitPictureInPictureMethod === null) {
      return Promise.reject(new Error('Picture-in-picture exit is unavailable'))
    }
    try {
      return Promise.resolve(exitPictureInPictureMethod.call(element.ownerDocument)).then(
        () => undefined
      )
    } catch (error) {
      return Promise.reject(asError(error, 'Picture-in-picture exit failed'))
    }
  },

  readPictureInPictureElement(element: HTMLMediaElement): Element | null {
    return readDocumentOr(pictureInPictureElementAccessor, element.ownerDocument, null)
  },

  readStyleCssText(element: HTMLMediaElement): string {
    const style = nativeStyle(element)
    if (style === null || cssTextAccessor.get === null) return ''
    try {
      return cssTextAccessor.get(style)
    } catch {
      return ''
    }
  },

  writeStyleCssText(element: HTMLMediaElement, value: string): void {
    const style = nativeStyle(element)
    if (style === null || cssTextAccessor.set === null) {
      throw new Error('Native media style is unavailable')
    }
    cssTextAccessor.set(style, value)
  },

  setStyleProperty(
    element: HTMLMediaElement,
    property: string,
    value: string,
    priority = ''
  ): void {
    const style = nativeStyle(element)
    if (style === null || setStylePropertyMethod === null) {
      throw new Error('Native media style property API is unavailable')
    }
    setStylePropertyMethod.call(style, property, value, priority)
  },

  readStyleProperty(element: HTMLMediaElement, property: string): string {
    const style = nativeStyle(element)
    if (style === null || getStylePropertyValueMethod === null) return ''
    try {
      return getStylePropertyValueMethod.call(style, property)
    } catch {
      return ''
    }
  },

  readOpacity(element: HTMLMediaElement): number {
    const view = element.ownerDocument.defaultView
    if (view === null || getComputedStyleMethod === null) return 1
    try {
      const value = Number(getComputedStyleMethod.call(view, element).opacity)
      return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
    } catch {
      return 1
    }
  },

  getBoundingClientRect(element: HTMLMediaElement): DOMRect | null {
    if (getBoundingClientRectMethod === null) return null
    try {
      return getBoundingClientRectMethod.call(element)
    } catch {
      return null
    }
  },

  isRendered(element: HTMLMediaElement): boolean {
    const view = element.ownerDocument.defaultView
    if (view === null || getComputedStyleMethod === null) return true
    const visited = new Set<Element>()
    let current: Element | null = element
    while (current !== null && !visited.has(current)) {
      visited.add(current)
      try {
        const style = getComputedStyleMethod.call(view, current)
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse'
        ) {
          return false
        }
      } catch {
        return true
      }

      const parent = nativeParentElement(current)
      if (parent !== null) {
        current = parent
        continue
      }
      const root = nativeRootNode(current)
      current =
        root !== null && root.nodeType === 11 && 'host' in root ? (root as ShadowRoot).host : null
    }
    return true
  },

  getNumericAttribute(element: HTMLMediaElement, name: string): number {
    if (getAttributeMethod === null) return 0
    try {
      const value = getAttributeMethod.call(element, name)
      if (value === null || value.trim() === '') return 0
      const parsed = Number(value)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    } catch {
      return 0
    }
  },

  addEventListener(
    element: HTMLMediaElement,
    type: string,
    listener: EventListener,
    capture = false
  ): void {
    if (addEventListenerMethod === null) return
    addEventListenerMethod.call(element, type, listener, capture)
  },

  removeEventListener(
    element: HTMLMediaElement,
    type: string,
    listener: EventListener,
    capture = false
  ): void {
    if (removeEventListenerMethod === null) return
    removeEventListenerMethod.call(element, type, listener, capture)
  },

  addDocumentEventListener(
    document: Document,
    type: string,
    listener: EventListener,
    capture = false
  ): void {
    if (addEventListenerMethod === null) return
    addEventListenerMethod.call(document, type, listener, capture)
  },

  removeDocumentEventListener(
    document: Document,
    type: string,
    listener: EventListener,
    capture = false
  ): void {
    if (removeEventListenerMethod === null) return
    removeEventListenerMethod.call(document, type, listener, capture)
  },

  contains(container: Element, target: Element): boolean {
    if (containsMethod === null) return false
    try {
      return containsMethod.call(container, target)
    } catch {
      return false
    }
  }
})
