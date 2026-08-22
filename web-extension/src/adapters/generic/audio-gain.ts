type AudioContextConstructor = {
  new (): AudioContext
  readonly prototype: AudioContext
}

type GainWindow = Window & {
  readonly AudioContext?: AudioContextConstructor
  readonly webkitAudioContext?: AudioContextConstructor
}

function audioContextConstructor(currentWindow: Window): AudioContextConstructor | null {
  const candidate = currentWindow as GainWindow
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null
}

export function canCreateAudioGain(currentWindow: Window): boolean {
  const constructor = audioContextConstructor(currentWindow)
  return (
    constructor !== null &&
    typeof constructor.prototype.createMediaElementSource === 'function' &&
    typeof constructor.prototype.createGain === 'function'
  )
}

/**
 * A MediaElementAudioSourceNode can be created for a cross-origin element
 * without throwing, but the browser may render the graph silent when the
 * media was not loaded with CORS. Require an explicit CORS mode before
 * advertising gain for cross-origin sources; construction remains the final
 * capability check and still downgrades atomically on failure.
 */
export function canUseAudioGain(element: HTMLMediaElement, currentWindow: Window): boolean {
  if (!canCreateAudioGain(currentWindow)) return false
  const source = element.currentSrc || element.src
  if (!source) return true
  let url: URL
  try {
    url = new URL(source, element.ownerDocument.baseURI)
  } catch {
    return false
  }
  if (url.protocol === 'blob:' || url.protocol === 'data:') return true
  if (url.origin === currentWindow.location.origin) return true
  return element.crossOrigin === 'anonymous' || element.crossOrigin === 'use-credentials'
}

/**
 * Owns one media element's Web Audio graph. The graph is created lazily so a
 * disabled/default installation never changes the page's audio routing.
 */
export class MediaElementAudioGain {
  private readonly context: AudioContext
  private readonly source: MediaElementAudioSourceNode
  private readonly gainNode: GainNode
  private disposed = false

  constructor(element: HTMLMediaElement, currentWindow: Window) {
    const constructor = audioContextConstructor(currentWindow)
    if (constructor === null) throw new Error('Web Audio is unavailable')
    this.context = new constructor()
    try {
      this.source = this.context.createMediaElementSource(element)
      this.gainNode = this.context.createGain()
      this.source.connect(this.gainNode)
      this.gainNode.connect(this.context.destination)
    } catch (error) {
      void this.context.close().catch(() => undefined)
      throw error instanceof Error ? error : new Error('Web Audio gain setup failed')
    }
  }

  setGain(value: number): void {
    if (this.disposed) throw new Error('Web Audio gain is disposed')
    const normalized = Number.isFinite(value) ? Math.min(6, Math.max(1, value)) : 1
    this.gainNode.gain.value = normalized
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    try {
      this.source.disconnect()
    } catch {
      // A page may already have torn down the graph.
    }
    try {
      this.gainNode.disconnect()
    } catch {
      // A page may already have torn down the graph.
    }
    void this.context.close().catch(() => undefined)
  }
}
