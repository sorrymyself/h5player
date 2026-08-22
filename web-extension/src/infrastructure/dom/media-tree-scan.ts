/* eslint-disable @typescript-eslint/unbound-method -- DOM getters are captured before page code can shadow them. */

export type MediaDiscoveryRoot = Document | ShadowRoot

export interface MediaTreeScanResult {
  readonly media: readonly HTMLMediaElement[]
  readonly roots: ReadonlySet<MediaDiscoveryRoot>
}

interface CapturedGetter<TTarget, TValue> {
  readonly read: ((target: TTarget) => TValue) | null
}

function findDescriptor(
  prototype: object | null,
  property: PropertyKey
): PropertyDescriptor | null {
  let current = prototype
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property)
    if (descriptor !== undefined) return descriptor
    current = Object.getPrototypeOf(current) as object | null
  }
  return null
}

function captureGetter<TTarget, TValue>(
  prototype: object | null,
  property: PropertyKey
): CapturedGetter<TTarget, TValue> {
  const getter = findDescriptor(prototype, property)?.get as ((this: TTarget) => TValue) | undefined
  return {
    read: getter === undefined ? null : (target) => getter.call(target)
  }
}

const nodePrototype = typeof Node === 'undefined' ? null : Node.prototype
const elementPrototype = typeof Element === 'undefined' ? null : Element.prototype
const childNodesGetter = captureGetter<Node, NodeListOf<ChildNode> | null>(
  nodePrototype,
  'childNodes'
)
const nodeTypeGetter = captureGetter<Node, number>(nodePrototype, 'nodeType')
const localNameGetter = captureGetter<Element, string>(elementPrototype, 'localName')
const shadowRootGetter = captureGetter<Element, ShadowRoot | null>(elementPrototype, 'shadowRoot')

function readOr<TTarget, TValue>(
  getter: CapturedGetter<TTarget, TValue>,
  target: TTarget,
  fallback: TValue
): TValue {
  if (getter.read === null) return fallback
  try {
    return getter.read(target)
  } catch {
    return fallback
  }
}

function isMediaElement(element: Element): element is HTMLMediaElement {
  const localName = readOr(localNameGetter, element, '')
  return localName === 'video' || localName === 'audio'
}

function isElementNode(node: Node): node is Element {
  return readOr(nodeTypeGetter, node, -1) === 1
}

function openShadowRoot(element: Element): ShadowRoot | null {
  return readOr(shadowRootGetter, element, null)
}

function pushChildren(stack: Node[], node: Node): void {
  const childNodes = readOr(childNodesGetter, node, null)
  if (childNodes === null) return
  for (let index = childNodes.length - 1; index >= 0; index -= 1) {
    const child = childNodes.item(index)
    if (child !== null) stack.push(child)
  }
}

export function scanMediaTree(root: MediaDiscoveryRoot): MediaTreeScanResult {
  const media: HTMLMediaElement[] = []
  const roots = new Set<MediaDiscoveryRoot>([root])
  const stack: Node[] = []
  pushChildren(stack, root)

  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined || !isElementNode(node)) continue

    if (isMediaElement(node)) media.push(node)

    // Light DOM is pushed first so an open shadow tree is visited immediately after its host.
    pushChildren(stack, node)
    const shadowRoot = openShadowRoot(node)
    if (shadowRoot !== null) {
      roots.add(shadowRoot)
      pushChildren(stack, shadowRoot)
    }
  }

  return {
    media: Object.freeze(media),
    roots
  }
}

export function discoverMediaElements(root: MediaDiscoveryRoot): readonly HTMLMediaElement[] {
  return scanMediaTree(root).media
}
