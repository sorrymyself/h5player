import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  containExtensionContextInvalidation,
  consumeChromeRuntimeLastError,
  isExtensionContextInvalidatedError,
  subscribeExtensionContextInvalidationBoundary,
  subscribeRuntimeReconnect,
  type RuntimeLifetimePort
} from '../../src/infrastructure/browser/runtime-reconnect'

class FakePort implements RuntimeLifetimePort {
  disconnectError: unknown
  readonly consumeDisconnectError = vi.fn(() => this.disconnectError)
  readonly listeners = new Set<() => void>()
  readonly disconnect = vi.fn(() => {
    for (const listener of [...this.listeners]) listener()
  })
  readonly onDisconnect = {
    addListener: (listener: () => void) => this.listeners.add(listener),
    removeListener: (listener: () => void) => this.listeners.delete(listener)
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('runtime reconnect lifetime', () => {
  it('consumes Chrome runtime.lastError during disconnect callbacks', () => {
    const disconnectError = { message: 'The message channel is closed.' }
    const readLastError = vi.fn(() => disconnectError)
    vi.stubGlobal('chrome', {
      runtime: {
        get lastError() {
          return readLastError()
        }
      }
    })

    expect(consumeChromeRuntimeLastError()).toBe(disconnectError)
    expect(readLastError).toHaveBeenCalledOnce()
  })

  it('contains invalidated unhandled rejections and leaves unrelated failures visible', () => {
    const listeners = new Set<(event: PromiseRejectionEvent) => void>()
    const source = {
      addEventListener: (
        _type: 'unhandledrejection',
        listener: (event: PromiseRejectionEvent) => void
      ) => listeners.add(listener),
      removeEventListener: (
        _type: 'unhandledrejection',
        listener: (event: PromiseRejectionEvent) => void
      ) => listeners.delete(listener)
    }
    const onContextInvalidated = vi.fn()
    const teardown = subscribeExtensionContextInvalidationBoundary(source, onContextInvalidated)
    const preventInvalidated = vi.fn()
    const preventUnrelated = vi.fn()
    const invalidatedEvent = {
      reason: new Error('Extension context invalidated.'),
      preventDefault: preventInvalidated
    } as unknown as PromiseRejectionEvent
    const unrelatedEvent = {
      reason: new Error('ordinary failure'),
      preventDefault: preventUnrelated
    } as unknown as PromiseRejectionEvent

    for (const listener of listeners) listener(invalidatedEvent)
    for (const listener of listeners) listener(unrelatedEvent)

    expect(preventInvalidated).toHaveBeenCalledOnce()
    expect(preventUnrelated).not.toHaveBeenCalled()
    expect(onContextInvalidated).toHaveBeenCalledOnce()
    teardown()
    expect(listeners).toHaveLength(0)
  })

  it('contains invalidated async entrypoint failures but preserves unrelated errors', async () => {
    const cleanup = vi.fn()

    await expect(
      containExtensionContextInvalidation(
        () => Promise.reject(new Error('Extension context invalidated.')),
        cleanup
      )
    ).resolves.toBeUndefined()
    expect(cleanup).toHaveBeenCalledOnce()

    await expect(
      containExtensionContextInvalidation(
        () => Promise.reject(new Error('unexpected startup failure')),
        cleanup
      )
    ).rejects.toThrow('unexpected startup failure')
  })

  it('reconnects a disconnected MV3 port and stops cleanly on teardown', async () => {
    vi.useFakeTimers()
    const ports = [new FakePort(), new FakePort()]
    const connectedPorts: RuntimeLifetimePort[] = []
    const connect = vi.fn(() => {
      const port = ports.shift()
      if (port === undefined) throw new Error('unexpected extra reconnect')
      connectedPorts.push(port)
      return port
    })
    const onConnected = vi.fn()
    const onContextInvalidated = vi.fn()
    const teardown = subscribeRuntimeReconnect({
      connect,
      onConnected,
      onContextInvalidated,
      retryDelayMs: 25
    })

    expect(connect).toHaveBeenCalledTimes(1)
    expect(onConnected).toHaveBeenCalledTimes(1)
    connectedPorts[0]?.disconnect()
    await vi.advanceTimersByTimeAsync(25)

    expect(connect).toHaveBeenCalledTimes(2)
    expect(onConnected).toHaveBeenCalledTimes(2)
    expect(connectedPorts[0]?.consumeDisconnectError).toHaveBeenCalledOnce()
    teardown()
    teardown()
    await vi.runAllTimersAsync()
    expect(connect).toHaveBeenCalledTimes(2)
    expect(onContextInvalidated).not.toHaveBeenCalled()
  })

  it('consumes a BFCache disconnect error before reconnecting', async () => {
    vi.useFakeTimers()
    const first = new FakePort()
    first.disconnectError = new Error(
      'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.'
    )
    const second = new FakePort()
    const connect = vi.fn()
    connect.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const onContextInvalidated = vi.fn()

    const teardown = subscribeRuntimeReconnect({
      connect,
      onConnected: vi.fn(),
      onContextInvalidated,
      retryDelayMs: 5
    })
    first.disconnect()
    await vi.advanceTimersByTimeAsync(5)

    expect(first.consumeDisconnectError).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledTimes(2)
    expect(onContextInvalidated).not.toHaveBeenCalled()
    teardown()
  })

  it('stops reconnecting when the disconnect reason invalidates the extension context', async () => {
    vi.useFakeTimers()
    const port = new FakePort()
    port.disconnectError = { message: 'Extension context invalidated.' }
    const connect = vi.fn(() => port)
    const onContextInvalidated = vi.fn()

    const teardown = subscribeRuntimeReconnect({
      connect,
      onConnected: vi.fn(),
      onContextInvalidated,
      retryDelayMs: 5
    })
    port.disconnect()
    await vi.runAllTimersAsync()

    expect(port.consumeDisconnectError).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledOnce()
    expect(onContextInvalidated).toHaveBeenCalledOnce()
    teardown()
  })

  it('stops permanently when connect reports an invalidated extension context', async () => {
    vi.useFakeTimers()
    const connect = vi.fn((): RuntimeLifetimePort => {
      throw new Error('Extension context invalidated.')
    })
    const onContextInvalidated = vi.fn()

    const teardown = subscribeRuntimeReconnect({
      connect,
      onConnected: vi.fn(),
      onContextInvalidated,
      retryDelayMs: 1
    })
    await vi.runAllTimersAsync()

    expect(connect).toHaveBeenCalledOnce()
    expect(onContextInvalidated).toHaveBeenCalledOnce()
    expect(() => teardown()).not.toThrow()
  })

  it('recognizes invalidation across Error and browser-style string values', () => {
    expect(isExtensionContextInvalidatedError(new Error('Extension context invalidated.'))).toBe(
      true
    )
    expect(isExtensionContextInvalidatedError('Uncaught: extension context invalidated')).toBe(true)
    expect(isExtensionContextInvalidatedError({ message: 'Extension context invalidated.' })).toBe(
      true
    )
    expect(isExtensionContextInvalidatedError(new Error('Receiving end does not exist'))).toBe(
      false
    )
  })
})
