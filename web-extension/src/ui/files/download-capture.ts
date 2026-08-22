import { captureArtifactSchema, type CaptureArtifact } from '../../domain/capture'

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export function createCaptureFilename(
  mimeType: CaptureArtifact['mimeType'],
  now = Date.now()
): string {
  const timestamp = new Date(now)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `h5player-capture-${timestamp}.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}`
}

export function decodeCaptureArtifact(artifact: CaptureArtifact): Blob {
  const parsed = captureArtifactSchema.parse(artifact)
  if (!BASE64_PATTERN.test(parsed.dataBase64)) {
    throw new Error('Capture payload is not valid base64')
  }
  const binary = globalThis.atob(parsed.dataBase64)
  if (binary.length !== parsed.byteLength) {
    throw new Error('Capture payload length does not match its metadata')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: parsed.mimeType })
}

export function downloadCaptureArtifact(artifact: CaptureArtifact, now = Date.now()): void {
  const blob = decodeCaptureArtifact(artifact)
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = createCaptureFilename(artifact.mimeType, now)
  anchor.rel = 'noopener'
  anchor.click()
  globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
