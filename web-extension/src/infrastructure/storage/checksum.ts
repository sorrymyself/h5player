export function checksumUnknown(value: unknown): string {
  const serialized = JSON.stringify(value) ?? 'undefined'
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * prime)
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}
