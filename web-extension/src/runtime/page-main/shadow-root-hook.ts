export type ShadowRootHookTeardown = () => void

export function installOpenShadowRootHook(
  currentWindow: Window,
  onOpen: (root: ShadowRoot) => void
): ShadowRootHookTeardown {
  const prototype = (currentWindow as Window & typeof globalThis).Element.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'attachShadow')
  if (
    descriptor === undefined ||
    typeof descriptor.value !== 'function' ||
    descriptor.configurable !== true
  ) {
    return () => undefined
  }
  const nativeAttachShadow = descriptor.value as Element['attachShadow']

  const wrappedAttachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
    const root = Reflect.apply(nativeAttachShadow, this, [init])
    if (root.mode === 'open') queueMicrotask(() => onOpen(root))
    return root
  }

  try {
    Object.defineProperty(prototype, 'attachShadow', {
      ...descriptor,
      value: wrappedAttachShadow
    })
  } catch {
    return () => undefined
  }

  return () => {
    const current = Object.getOwnPropertyDescriptor(prototype, 'attachShadow')
    if (current?.value !== wrappedAttachShadow) return
    try {
      Object.defineProperty(prototype, 'attachShadow', descriptor)
    } catch {
      // A hostile page may lock the descriptor after initialization.
    }
  }
}
