import {
  ExperimentalMediaDownloadManager,
  type ExperimentalMediaDownloadPort
} from '../../adapters'

const runtimes = new WeakMap<Window, ExperimentalMediaDownloadPort>()

function createPort(manager: ExperimentalMediaDownloadManager): ExperimentalMediaDownloadPort {
  return Object.freeze({
    isEnabled: () => manager.isEnabled(),
    canDownload: (element: HTMLMediaElement) => manager.canDownload(element),
    prepareDownload: (element: HTMLMediaElement, intentId: string) =>
      manager.prepareDownload(element, intentId),
    cancelDownload: (element: HTMLMediaElement) => manager.cancelDownload(element),
    subscribe: (listener: Parameters<ExperimentalMediaDownloadPort['subscribe']>[0]) =>
      manager.subscribe(listener),
    // This port stays inside the extension-owned MAIN module registry. It is
    // never placed on Window, so page scripts cannot discover or invoke it.
    disable: () => manager.disable()
  })
}

export function installExperimentalMainRuntime(
  currentWindow: Window,
  currentDocument: Document
): ExperimentalMediaDownloadPort {
  const existing = runtimes.get(currentWindow)
  if (existing !== undefined) {
    if (existing.isEnabled()) return existing
    existing.disable()
  }

  const manager = new ExperimentalMediaDownloadManager(currentWindow, currentDocument)
  manager.configure(true)
  const port = createPort(manager)
  runtimes.set(currentWindow, port)
  return port
}

export function getExperimentalMainRuntime(
  currentWindow: Window
): ExperimentalMediaDownloadPort | null {
  return runtimes.get(currentWindow) ?? null
}
