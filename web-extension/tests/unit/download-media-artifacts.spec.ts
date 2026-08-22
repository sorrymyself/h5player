import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadMediaArtifacts,
  MediaDownloadCoordinator,
  resolveMediaDownloadFilename,
  type MediaDownloadPromptRequest
} from '../../src/ui/files/download-media'

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

function restoreProperty(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor === undefined) Reflect.deleteProperty(target, key)
  else Object.defineProperty(target, key, descriptor)
}

afterEach(() => {
  restoreProperty(globalThis, 'fetch', originalFetch)
  restoreProperty(URL, 'createObjectURL', originalCreateObjectUrl)
  restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('downloadMediaArtifacts', () => {
  it('clicks validated same-origin artifacts from the isolated content document', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await downloadMediaArtifacts([
      {
        kind: 'same-origin',
        url: `${window.location.origin}/video.mp4`,
        filename: 'episode_video.mp4'
      }
    ])

    expect(click).toHaveBeenCalledTimes(1)
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('episode_video.mp4')
  })

  it('rejects a same-origin artifact whose URL crosses the current origin', async () => {
    await expect(
      downloadMediaArtifacts([
        {
          kind: 'same-origin',
          url: 'https://attacker.invalid/video.mp4',
          filename: 'video.mp4'
        }
      ])
    ).rejects.toThrow('not allowed')
  })

  it('performs bounded cross-origin fetch in isolated content before clicking', async () => {
    vi.useFakeTimers()
    const fetchMedia = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-length': '3' }
      })
    )
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMedia
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:isolated-download')
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn()
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await downloadMediaArtifacts([
      {
        kind: 'cross-origin',
        url: 'https://cdn.example/video.mp4',
        filename: 'video.mp4'
      }
    ])

    expect(fetchMedia).toHaveBeenCalledWith(
      'https://cdn.example/video.mp4',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('edits a filename in isolated content and preserves the prepared extension', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const confirm = vi.fn().mockResolvedValue({ filenames: ['renamed episode'] })
    const coordinator = new MediaDownloadCoordinator({ confirm })

    await expect(
      coordinator.download([
        {
          kind: 'same-origin',
          url: `${window.location.origin}/video.mp4`,
          filename: 'episode_video.mp4'
        }
      ])
    ).resolves.toBe(true)

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicateState: 'new',
        artifacts: [expect.objectContaining({ suggestedFilename: 'episode_video.mp4' })]
      })
    )
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('renamed episode.mp4')
    expect(resolveMediaDownloadFilename('../unsafe?.webm', 'fallback.webm')).toBe('.. unsafe .webm')
  })

  it('marks completed and concurrent repeated downloads without silently blocking either request', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const deferred: {
      resolve: ((value: { filenames: string[] }) => void) | null
    } = { resolve: null }
    const states: string[] = []
    const confirm = vi.fn((request: MediaDownloadPromptRequest) => {
      states.push(request.duplicateState)
      if (states.length === 1) {
        return new Promise<{ filenames: string[] }>((resolve) => {
          deferred.resolve = resolve
        })
      }
      return Promise.resolve({
        filenames: request.artifacts.map((artifact) => artifact.suggestedFilename)
      })
    })
    const coordinator = new MediaDownloadCoordinator({ confirm })
    const artifacts = [
      {
        kind: 'same-origin' as const,
        url: `${window.location.origin}/video.mp4`,
        filename: 'video.mp4'
      }
    ]

    const first = coordinator.download(artifacts)
    const second = coordinator.download(artifacts)
    await second
    deferred.resolve?.({ filenames: ['video.mp4'] })
    await first
    await coordinator.download(artifacts)

    expect(states).toEqual(['new', 'downloading', 'downloaded'])
    expect(click).toHaveBeenCalledTimes(3)
  })

  it('cancels without clicking and immediately releases prepared blob artifacts', async () => {
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectUrl
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const coordinator = new MediaDownloadCoordinator({ confirm: () => Promise.resolve(null) })

    await expect(
      coordinator.download([
        {
          kind: 'blob',
          url: 'blob:captured-media',
          filename: 'video.mp4'
        }
      ])
    ).resolves.toBe(false)

    expect(click).not.toHaveBeenCalled()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:captured-media')
  })
})
