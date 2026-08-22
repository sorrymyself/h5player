/* eslint-disable @typescript-eslint/unbound-method -- Native DOM intrinsics are captured once and called with explicit receivers. */

import {
  CAPTURE_MAX_BYTES,
  CAPTURE_MAX_DIMENSION,
  CAPTURE_MAX_PIXELS,
  CaptureFailure,
  captureArtifactSchema,
  captureMimeTypeSchema,
  type CaptureArtifact,
  type CaptureOptions
} from '../../domain/capture'
import { nativeMediaBindings } from './native-media-bindings'

const documentPrototype = typeof Document === 'undefined' ? null : Document.prototype
const canvasPrototype =
  typeof HTMLCanvasElement === 'undefined' ? null : HTMLCanvasElement.prototype
const contextPrototype =
  typeof CanvasRenderingContext2D === 'undefined' ? null : CanvasRenderingContext2D.prototype
const mediaPrototype = typeof HTMLMediaElement === 'undefined' ? null : HTMLMediaElement.prototype
const blobPrototype = typeof Blob === 'undefined' ? null : Blob.prototype

const createElementMethod = documentPrototype?.createElement ?? null
const getContextMethod = canvasPrototype?.getContext ?? null
const toBlobMethod = canvasPrototype?.toBlob ?? null
const drawImageMethod = contextPrototype?.drawImage ?? null
const blobArrayBufferMethod = blobPrototype?.arrayBuffer ?? null
const canvasWidthSetter =
  canvasPrototype === null
    ? undefined
    : (Object.getOwnPropertyDescriptor(canvasPrototype, 'width')?.set as
        ((this: HTMLCanvasElement, value: number) => void) | undefined)
const canvasHeightSetter =
  canvasPrototype === null
    ? undefined
    : (Object.getOwnPropertyDescriptor(canvasPrototype, 'height')?.set as
        ((this: HTMLCanvasElement, value: number) => void) | undefined)
const readyStateGetter =
  mediaPrototype === null
    ? undefined
    : (Object.getOwnPropertyDescriptor(mediaPrototype, 'readyState')?.get as
        ((this: HTMLMediaElement) => number) | undefined)
const scheduleTimeout = globalThis.setTimeout.bind(globalThis)
const clearScheduledTimeout = globalThis.clearTimeout.bind(globalThis)

function captureFailure(error: unknown, fallback: string): CaptureFailure {
  if (error instanceof CaptureFailure) return error
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'SecurityError'
  ) {
    return new CaptureFailure(
      'CAPTURE_BLOCKED',
      'The browser blocked drawing this media frame to a canvas'
    )
  }
  return new CaptureFailure('CAPTURE_FAILED', fallback)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []
  let chunk = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const hasSecond = index + 1 < bytes.length
    const hasThird = index + 2 < bytes.length
    const second = hasSecond ? (bytes[index + 1] ?? 0) : 0
    const third = hasThird ? (bytes[index + 2] ?? 0) : 0
    const value = (first << 16) | (second << 8) | third
    chunk += alphabet[(value >> 18) & 63]
    chunk += alphabet[(value >> 12) & 63]
    chunk += hasSecond ? alphabet[(value >> 6) & 63] : '='
    chunk += hasThird ? alphabet[value & 63] : '='
    if (chunk.length >= 16_384) {
      chunks.push(chunk)
      chunk = ''
    }
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks.join('')
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: CaptureOptions['mimeType'],
  quality: number | undefined
): Promise<Blob> {
  if (toBlobMethod === null) {
    return Promise.reject(new CaptureFailure('CAPTURE_FAILED', 'Canvas encoding is unavailable'))
  }
  return new Promise<Blob>((resolve, reject) => {
    let settled = false
    const timeout = scheduleTimeout(() => {
      if (settled) return
      settled = true
      reject(new CaptureFailure('CAPTURE_FAILED', 'Canvas encoding timed out'))
    }, 3_000)
    const finish = (blob: Blob | null): void => {
      if (settled) return
      settled = true
      clearScheduledTimeout(timeout)
      if (blob === null) {
        reject(new CaptureFailure('CAPTURE_FAILED', 'Canvas encoder returned no image'))
      } else {
        resolve(blob)
      }
    }
    try {
      toBlobMethod.call(canvas, finish, mimeType, quality)
    } catch (error) {
      if (!settled) {
        settled = true
        clearScheduledTimeout(timeout)
        reject(captureFailure(error, 'Canvas encoding failed'))
      }
    }
  })
}

const captureAvailable =
  createElementMethod !== null &&
  getContextMethod !== null &&
  drawImageMethod !== null &&
  toBlobMethod !== null &&
  blobArrayBufferMethod !== null &&
  canvasWidthSetter !== undefined &&
  canvasHeightSetter !== undefined

export const nativeCaptureBindings = Object.freeze({
  available: captureAvailable,

  async captureVideoFrame(
    element: HTMLMediaElement,
    options: CaptureOptions
  ): Promise<CaptureArtifact> {
    if (
      !captureAvailable ||
      createElementMethod === null ||
      getContextMethod === null ||
      drawImageMethod === null ||
      blobArrayBufferMethod === null ||
      canvasWidthSetter === undefined ||
      canvasHeightSetter === undefined ||
      !nativeMediaBindings.isVideo(element)
    ) {
      throw new CaptureFailure('CAPTURE_FAILED', 'Video capture is unavailable')
    }
    const readyState = readyStateGetter?.call(element) ?? 0
    const width = Math.trunc(nativeMediaBindings.readVideoWidth(element))
    const height = Math.trunc(nativeMediaBindings.readVideoHeight(element))
    if (readyState < 2 || width < 1 || height < 1) {
      throw new CaptureFailure('CAPTURE_NOT_READY', 'The video has no decoded frame to capture')
    }
    if (
      width > CAPTURE_MAX_DIMENSION ||
      height > CAPTURE_MAX_DIMENSION ||
      width * height > CAPTURE_MAX_PIXELS
    ) {
      throw new CaptureFailure('CAPTURE_TOO_LARGE', 'The decoded frame exceeds capture limits')
    }

    try {
      const canvas = createElementMethod.call(element.ownerDocument, 'canvas')
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new CaptureFailure('CAPTURE_FAILED', 'The browser did not create a canvas')
      }
      canvasWidthSetter.call(canvas, width)
      canvasHeightSetter.call(canvas, height)
      const context = getContextMethod.call(canvas, '2d', {
        alpha: false,
        willReadFrequently: false
      }) as CanvasRenderingContext2D | null
      if (context === null) {
        throw new CaptureFailure('CAPTURE_FAILED', 'The browser did not provide a 2D canvas')
      }
      drawImageMethod.call(context, element, 0, 0, width, height, 0, 0, width, height)
      const blob = await canvasBlob(canvas, options.mimeType, options.quality)
      if (blob.size < 1 || blob.size > CAPTURE_MAX_BYTES) {
        throw new CaptureFailure('CAPTURE_TOO_LARGE', 'The encoded capture exceeds size limits')
      }
      const mimeType = captureMimeTypeSchema.safeParse(blob.type)
      if (!mimeType.success) {
        throw new CaptureFailure('CAPTURE_FAILED', 'Canvas encoder returned an unsupported format')
      }
      const buffer = await blobArrayBufferMethod.call(blob)
      return captureArtifactSchema.parse({
        mimeType: mimeType.data,
        width,
        height,
        byteLength: buffer.byteLength,
        dataBase64: arrayBufferToBase64(buffer)
      })
    } catch (error) {
      throw captureFailure(error, 'Video frame capture failed')
    }
  }
})
