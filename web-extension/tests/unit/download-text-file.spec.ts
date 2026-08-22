import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadTextFile } from '../../src/ui/files/download-text-file'

const originalCreateObjectUrl = URL.createObjectURL.bind(URL)
const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL)

afterEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: originalCreateObjectUrl
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: originalRevokeObjectUrl
  })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('downloadTextFile', () => {
  it('uses a temporary Blob URL and revokes it after activating the download anchor', () => {
    vi.useFakeTimers()
    const createObjectUrl = vi.fn().mockReturnValue('blob:h5player-test')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    downloadTextFile('{"safe":true}', 'h5player-settings.json')

    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(createObjectUrl.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(click).toHaveBeenCalledOnce()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('h5player-settings.json')
    expect(anchor.href).toContain('blob:h5player-test')

    vi.runAllTimers()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:h5player-test')
  })
})
