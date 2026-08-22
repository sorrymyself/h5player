export type RuntimeDisconnectEvent = Readonly<{
  addListener(listener: () => void): void
  removeListener(listener: () => void): void
}>

export type RuntimeLifetimePort = Readonly<{
  onDisconnect: RuntimeDisconnectEvent
  disconnect(): void
  consumeDisconnectError?(): unknown
}>

export type RuntimeUnhandledRejectionSource = Readonly<{
  addEventListener(
    type: 'unhandledrejection',
    listener: (event: PromiseRejectionEvent) => void
  ): void
  removeEventListener(
    type: 'unhandledrejection',
    listener: (event: PromiseRejectionEvent) => void
  ): void
}>

/** Reads Chrome's per-callback lastError so disconnects do not become unchecked errors. */
export function consumeChromeRuntimeLastError(): unknown {
  try {
    return (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { lastError?: { message?: string } } }
      }
    ).chrome?.runtime?.lastError
  } catch (error) {
    return error
  }
}

export type RuntimeReconnectOptions = Readonly<{
  connect(): RuntimeLifetimePort
  onConnected(): void
  onContextInvalidated(): void
  retryDelayMs?: number
}>

export function isExtensionContextInvalidatedError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : String(error)
  return /extension context invalidated/i.test(message)
}

export function subscribeExtensionContextInvalidationBoundary(
  source: RuntimeUnhandledRejectionSource,
  onContextInvalidated: () => void
): () => void {
  const listener = (event: PromiseRejectionEvent): void => {
    if (!isExtensionContextInvalidatedError(event.reason)) return
    event.preventDefault()
    try {
      onContextInvalidated()
    } catch {
      // Cleanup is best-effort after the browser destroys the extension world.
    }
  }
  source.addEventListener('unhandledrejection', listener)
  return () => {
    try {
      source.removeEventListener('unhandledrejection', listener)
    } catch {
      // The old extension world may already be unavailable.
    }
  }
}

export async function containExtensionContextInvalidation<T>(
  operation: () => Promise<T>,
  onContextInvalidated: () => void
): Promise<T | undefined> {
  try {
    return await operation()
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) throw error
    try {
      onContextInvalidated()
    } catch {
      // Browser-owned APIs can fail again while an invalidated context is being released.
    }
    return undefined
  }
}

/** Maintains one MV3 lifetime port and permanently stops when its extension context dies. */
export function subscribeRuntimeReconnect(options: RuntimeReconnectOptions): () => void {
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 100)
  let disposed = false
  let invalidationReported = false
  let port: RuntimeLifetimePort | null = null
  let disconnectListener: (() => void) | null = null
  let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null

  const clearRetry = (): void => {
    if (retryTimer !== null) globalThis.clearTimeout(retryTimer)
    retryTimer = null
  }

  const detachPort = (disconnect: boolean): void => {
    const currentPort = port
    const currentListener = disconnectListener
    port = null
    disconnectListener = null
    if (currentPort === null) return
    if (currentListener !== null) {
      try {
        currentPort.onDisconnect.removeListener(currentListener)
      } catch {
        // The browser invalidates Port methods together with the extension context.
      }
    }
    if (!disconnect) return
    try {
      currentPort.disconnect()
    } catch {
      // Teardown remains complete when the browser already destroyed the port.
    }
  }

  const invalidate = (): void => {
    if (disposed) return
    disposed = true
    clearRetry()
    detachPort(false)
    if (invalidationReported) return
    invalidationReported = true
    options.onContextInvalidated()
  }

  const scheduleReconnect = (connect: () => void): void => {
    if (disposed || retryTimer !== null) return
    retryTimer = globalThis.setTimeout(() => {
      retryTimer = null
      connect()
    }, retryDelayMs)
  }

  const connect = (): void => {
    if (disposed) return
    let nextPort: RuntimeLifetimePort
    try {
      nextPort = options.connect()
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) invalidate()
      else scheduleReconnect(connect)
      return
    }

    const handleDisconnect = (): void => {
      let disconnectError: unknown
      try {
        disconnectError = nextPort.consumeDisconnectError?.()
      } catch (error) {
        disconnectError = error
      }
      if (port !== nextPort) return
      if (isExtensionContextInvalidatedError(disconnectError)) {
        invalidate()
        return
      }
      detachPort(false)
      scheduleReconnect(connect)
    }
    port = nextPort
    disconnectListener = handleDisconnect
    try {
      nextPort.onDisconnect.addListener(handleDisconnect)
    } catch (error) {
      detachPort(true)
      if (isExtensionContextInvalidatedError(error)) invalidate()
      else scheduleReconnect(connect)
      return
    }
    try {
      options.onConnected()
    } catch {
      // Connection observers recover their own runtime state asynchronously.
    }
  }

  connect()
  return () => {
    if (disposed) return
    disposed = true
    clearRetry()
    detachPort(true)
  }
}
