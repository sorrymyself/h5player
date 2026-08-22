function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createRequestId(): string {
  return typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : randomHex(16)
}

export function createSessionId(): string {
  return createRequestId()
}

/** Returns a 256-bit nonce encoded as lowercase hexadecimal. */
export function createSessionNonce(): string {
  return randomHex(32)
}
