import { describe, expect, it, vi } from 'vitest'
import { installOpenShadowRootHook } from '../../src/runtime/page-main/shadow-root-hook'

type AttachShadowLike = (this: object, init: ShadowRootInit) => ShadowRoot

function fakeWindow(prototype: object): Window {
  return { Element: { prototype } } as unknown as Window
}

function installNativeAttachShadow(prototype: object, implementation: AttachShadowLike): void {
  Object.defineProperty(prototype, 'attachShadow', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: implementation
  })
}

describe('open shadow-root hook coverage', () => {
  it('reports only open roots and restores the exact native descriptor', async () => {
    const prototype = {}
    const nativeAttachShadow = vi.fn(function (this: object, init: ShadowRootInit): ShadowRoot {
      return { host: this, mode: init.mode } as unknown as ShadowRoot
    })
    installNativeAttachShadow(prototype, nativeAttachShadow)
    const original = Object.getOwnPropertyDescriptor(prototype, 'attachShadow')
    const onOpen = vi.fn()
    const teardown = installOpenShadowRootHook(fakeWindow(prototype), onOpen)
    const wrapped = Object.getOwnPropertyDescriptor(prototype, 'attachShadow')
      ?.value as AttachShadowLike

    const host = {}
    const openRoot = wrapped.call(host, { mode: 'open' })
    wrapped.call(host, { mode: 'closed' })
    await Promise.resolve()

    expect(nativeAttachShadow).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledWith(openRoot)

    teardown()
    teardown()
    expect(Object.getOwnPropertyDescriptor(prototype, 'attachShadow')).toEqual(original)
  })

  it('returns inert teardown when attachShadow cannot be safely wrapped', () => {
    const missingPrototype = {}
    const nonFunctionPrototype = {}
    Object.defineProperty(nonFunctionPrototype, 'attachShadow', {
      configurable: true,
      value: 'not-a-function'
    })
    const lockedPrototype = {}
    Object.defineProperty(lockedPrototype, 'attachShadow', {
      configurable: false,
      value: () => undefined
    })
    const onOpen = vi.fn()

    expect(() => installOpenShadowRootHook(fakeWindow(missingPrototype), onOpen)()).not.toThrow()
    expect(() =>
      installOpenShadowRootHook(fakeWindow(nonFunctionPrototype), onOpen)()
    ).not.toThrow()
    expect(() => installOpenShadowRootHook(fakeWindow(lockedPrototype), onOpen)()).not.toThrow()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('contains installation failure and preserves a later hostile replacement', () => {
    const target = {}
    const nativeAttachShadow = function (this: object, init: ShadowRootInit): ShadowRoot {
      return { host: this, mode: init.mode } as unknown as ShadowRoot
    }
    installNativeAttachShadow(target, nativeAttachShadow)
    let rejectDefinitions = true
    const throwingPrototype = new Proxy(target, {
      defineProperty(current, property, attributes) {
        if (rejectDefinitions) throw new Error('locked')
        return Reflect.defineProperty(current, property, attributes)
      }
    })

    const inertTeardown = installOpenShadowRootHook(fakeWindow(throwingPrototype), vi.fn())
    expect(() => inertTeardown()).not.toThrow()
    expect(Object.getOwnPropertyDescriptor(target, 'attachShadow')?.value).toBe(nativeAttachShadow)

    rejectDefinitions = false
    const teardown = installOpenShadowRootHook(fakeWindow(throwingPrototype), vi.fn())
    const hostileReplacement = () => undefined
    Object.defineProperty(target, 'attachShadow', {
      configurable: true,
      value: hostileReplacement
    })
    teardown()
    expect(Object.getOwnPropertyDescriptor(target, 'attachShadow')?.value).toBe(hostileReplacement)
  })

  it('contains descriptor restoration failure during teardown', () => {
    const target = {}
    const nativeAttachShadow = function (this: object, init: ShadowRootInit): ShadowRoot {
      return { host: this, mode: init.mode } as unknown as ShadowRoot
    }
    installNativeAttachShadow(target, nativeAttachShadow)
    let rejectDefinitions = false
    const prototype = new Proxy(target, {
      defineProperty(current, property, attributes) {
        if (rejectDefinitions) throw new Error('locked after install')
        return Reflect.defineProperty(current, property, attributes)
      }
    })
    const teardown = installOpenShadowRootHook(fakeWindow(prototype), vi.fn())
    const wrapped: unknown = Object.getOwnPropertyDescriptor(target, 'attachShadow')?.value

    rejectDefinitions = true
    expect(() => teardown()).not.toThrow()
    expect(Object.getOwnPropertyDescriptor(target, 'attachShadow')?.value).toBe(wrapped)
  })
})
