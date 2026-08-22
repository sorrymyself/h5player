import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaDownloadPromptQueue } from '../../src/ui/files/media-download-prompt-queue'
import type { MediaDownloadPromptRequest } from '../../src/ui/files/download-media'

function request(id: string): MediaDownloadPromptRequest {
  return {
    id,
    duplicateState: 'new',
    artifacts: [{ kind: 'same-origin', suggestedFilename: `${id}.mp4` }]
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MediaDownloadPromptQueue', () => {
  it('serializes requests and exposes only the current confirmation', async () => {
    const changed: Array<string | null> = []
    const queue = new MediaDownloadPromptQueue({
      onChanged: (current) => changed.push(current?.id ?? null)
    })

    const first = queue.request(request('first'))
    const second = queue.request(request('second'))
    expect(changed).toEqual(['first'])

    expect(queue.resolveCurrent({ filenames: ['first-renamed.mp4'] })).toBe(true)
    await expect(first).resolves.toEqual({ filenames: ['first-renamed.mp4'] })
    expect(changed).toEqual(['first', 'second'])

    expect(queue.resolveCurrent(null)).toBe(true)
    await expect(second).resolves.toBeNull()
    expect(changed).toEqual(['first', 'second', null])
    queue.teardown()
  })

  it('cancels a stale prompt after the bounded timeout', async () => {
    vi.useFakeTimers()
    const changed: Array<string | null> = []
    const queue = new MediaDownloadPromptQueue({
      onChanged: (current) => changed.push(current?.id ?? null),
      timeoutMs: 1_000
    })

    const result = queue.request(request('stale'))
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(result).resolves.toBeNull()
    expect(changed).toEqual(['stale', null])
  })

  it('resolves every queued request when the content runtime tears down', async () => {
    const changed: Array<string | null> = []
    const queue = new MediaDownloadPromptQueue({
      onChanged: (current) => changed.push(current?.id ?? null)
    })
    const first = queue.request(request('first'))
    const second = queue.request(request('second'))

    queue.teardown()

    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toBeNull()
    expect(changed.at(-1)).toBeNull()
    await expect(queue.request(request('after-teardown'))).resolves.toBeNull()
  })
})
