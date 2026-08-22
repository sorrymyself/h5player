import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCaptureFilename,
  decodeCaptureArtifact,
  downloadCaptureArtifact
} from '../../src/ui/files/download-capture'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('capture download helper', () => {
  it('decodes a bounded artifact and creates a neutral filename', () => {
    const blob = decodeCaptureArtifact({
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteLength: 3,
      dataBase64: 'AQID'
    })

    expect(blob.size).toBe(3)
    expect(blob.type).toBe('image/png')
    expect(createCaptureFilename('image/jpeg', Date.UTC(2026, 7, 11, 1, 2, 3))).toBe(
      'h5player-capture-20260811T010203Z.jpg'
    )
  })

  it('rejects malformed or length-mismatched base64 data', () => {
    expect(() =>
      decodeCaptureArtifact({
        mimeType: 'image/png',
        width: 1,
        height: 1,
        byteLength: 3,
        dataBase64: '***='
      })
    ).toThrow(/valid base64/)
    expect(() =>
      decodeCaptureArtifact({
        mimeType: 'image/png',
        width: 1,
        height: 1,
        byteLength: 2,
        dataBase64: 'AQID'
      })
    ).toThrow(/length/)
  })

  it('downloads through a temporary Blob URL without requiring extension permissions', () => {
    vi.useFakeTimers()
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:capture')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined)
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    downloadCaptureArtifact(
      {
        mimeType: 'image/png',
        width: 1,
        height: 1,
        byteLength: 3,
        dataBase64: 'AQID'
      },
      Date.UTC(2026, 7, 11, 1, 2, 3)
    )

    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(anchor.href).toBe('blob:capture')
    expect(anchor.download).toBe('h5player-capture-20260811T010203Z.png')
    expect(click).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:capture')
    vi.useRealTimers()
  })
})
