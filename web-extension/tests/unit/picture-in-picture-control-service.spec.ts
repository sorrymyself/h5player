import { describe, expect, it, vi } from 'vitest'
import { PictureInPictureControlService } from '../../src/application/media'
import { parseTabRequest } from '../../src/shared/tab-protocol'
import { FakeClock, FakeTabsPort } from '../test-support/fakes'

const owner = Object.freeze({ tabId: 3, frameId: 7, sessionId: 'owner-session' })

describe('PictureInPictureControlService', () => {
  it('renews an active lease, enters grace, and expires fail-closed', () => {
    const clock = new FakeClock(1_000)
    const service = new PictureInPictureControlService(new FakeTabsPort(), clock, {
      activeLeaseMs: 3_000,
      graceLeaseMs: 10_000
    })

    const first = service.report(
      { state: 'active', mediaId: 'media-owner', observedAt: clock.now() },
      owner
    )
    expect(first.owner).toMatchObject({
      tabId: 3,
      frameId: 7,
      mediaId: 'media-owner',
      state: 'active',
      generation: 1,
      expiresAt: 4_000
    })

    clock.advance(1_500)
    const renewed = service.report(
      { state: 'active', mediaId: 'media-owner', observedAt: clock.now() },
      owner
    )
    expect(renewed.owner).toMatchObject({ generation: 1, expiresAt: 5_500 })

    clock.advance(500)
    const grace = service.report(
      { state: 'inactive', mediaId: 'media-owner', observedAt: clock.now() },
      owner
    )
    expect(grace.owner).toMatchObject({ state: 'grace', generation: 1, expiresAt: 13_000 })
    expect(service.resolve(1)).not.toBeNull()

    clock.advance(10_001)
    expect(service.snapshot().owner).toBeNull()
    expect(service.resolve(1)).toBeNull()
  })

  it('replaces owners by generation and rejects stale cleanup identities', () => {
    const clock = new FakeClock(1_000)
    const service = new PictureInPictureControlService(new FakeTabsPort(), clock)

    service.report({ state: 'active', mediaId: 'media-a', observedAt: clock.now() }, owner)
    const replacement = Object.freeze({
      tabId: 8,
      frameId: 2,
      sessionId: 'replacement-session'
    })
    const second = service.report(
      { state: 'active', mediaId: 'media-b', observedAt: clock.now() },
      replacement
    )

    expect(second.owner).toMatchObject({ tabId: 8, frameId: 2, generation: 2 })
    expect(service.resolve(1)).toBeNull()
    service.removeFrame({ ...replacement, sessionId: 'stale-session' })
    expect(service.snapshot().owner).not.toBeNull()
    service.removeFrame(replacement)
    expect(service.snapshot().owner).toBeNull()
  })

  it('broadcasts owner changes to every registered frame', async () => {
    const clock = new FakeClock(1_000)
    const tabs = new FakeTabsPort()
    tabs.tabs = [
      { id: 3, url: 'https://owner.example' },
      { id: 4, url: 'https://source.example' }
    ]
    const frames = new Map<number, readonly number[]>([
      [3, [0, 7]],
      [4, [0, 4, 4]]
    ])
    const service = new PictureInPictureControlService(tabs, clock, {
      frameIds: (tabId) => frames.get(tabId) ?? []
    })

    service.report({ state: 'active', mediaId: 'media-owner', observedAt: clock.now() }, owner)

    await vi.waitFor(() => expect(tabs.sent).toHaveLength(4))
    expect(tabs.sent.map(({ tabId, frameId }) => [tabId, frameId])).toEqual([
      [3, 0],
      [3, 7],
      [4, 0],
      [4, 4]
    ])
    for (const sent of tabs.sent) {
      expect(parseTabRequest(sent.message)).toMatchObject({
        type: 'media.picture-in-picture.owner-changed',
        payload: { owner: { mediaId: 'media-owner', generation: 1 } }
      })
    }
  })
})
