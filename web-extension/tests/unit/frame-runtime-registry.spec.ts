import { describe, expect, it } from 'vitest'
import { FrameRuntimeRegistry } from '../../src/application/site'

const report = {
  ready: true,
  mediaCount: 1,
  activeMedia: true,
  anchoredMediaCount: 1,
  pageUiHidden: false,
  temporaryDisabled: false,
  updatedAt: 10
} as const

describe('FrameRuntimeRegistry', () => {
  it('summarizes top and child frame media without inventing top-frame ownership', () => {
    const registry = new FrameRuntimeRegistry()
    registry.report({ tabId: 1, frameId: 2, sessionId: 'child-session-0001' }, report)
    expect(registry.summarize(1)).toEqual({
      topFrameMediaCount: 0,
      childFrameMediaCount: 1,
      childFrameCount: 1,
      anchoredMediaCount: 1,
      mediaLocation: 'child-frame'
    })

    registry.report(
      { tabId: 1, frameId: 0, sessionId: 'top-session-0000001' },
      { ...report, mediaCount: 2, anchoredMediaCount: 2, updatedAt: 20 }
    )
    expect(registry.summarize(1)).toMatchObject({
      topFrameMediaCount: 2,
      childFrameMediaCount: 1,
      childFrameCount: 1,
      anchoredMediaCount: 3,
      mediaLocation: 'mixed'
    })
  })

  it('ignores stale reports and late teardown from a replaced frame session', () => {
    const registry = new FrameRuntimeRegistry()
    const newIdentity = { tabId: 1, frameId: 2, sessionId: 'new-session-0000001' }
    registry.report({ tabId: 1, frameId: 2, sessionId: 'old-session-0000001' }, report)
    registry.connect(newIdentity)
    registry.report(newIdentity, { ...report, mediaCount: 2, updatedAt: 20 })
    registry.report(
      { tabId: 1, frameId: 2, sessionId: 'old-session-0000001' },
      {
        ...report,
        ready: false,
        mediaCount: 0,
        activeMedia: false,
        anchoredMediaCount: 0,
        updatedAt: 30
      }
    )
    registry.report(
      { tabId: 1, frameId: 2, sessionId: 'new-session-0000001' },
      { ...report, mediaCount: 9, updatedAt: 19 }
    )
    expect(registry.summarize(1)).toMatchObject({
      childFrameMediaCount: 2,
      childFrameCount: 1,
      mediaLocation: 'child-frame'
    })
  })

  it('removes a matching frame session and clears a removed tab', () => {
    const registry = new FrameRuntimeRegistry()
    registry.report({ tabId: 1, frameId: 2, sessionId: 'child-session-0001' }, report)
    registry.remove({ tabId: 1, frameId: 2, sessionId: 'child-session-0001' })
    expect(registry.summarize(1).mediaLocation).toBe('none')

    registry.report({ tabId: 2, frameId: 0, sessionId: 'top-session-0000002' }, report)
    registry.removeTab(2)
    expect(registry.summarize(2).mediaLocation).toBe('none')
  })

  it('drops a stale frame immediately when browser delivery reports no receiver', () => {
    const registry = new FrameRuntimeRegistry()
    registry.report({ tabId: 1, frameId: 2, sessionId: 'child-session-0001' }, report)
    registry.report({ tabId: 1, frameId: 3, sessionId: 'child-session-0002' }, report)

    registry.removeFrame(1, 2)

    expect(registry.frameIds(1)).toEqual([3])
    expect(registry.summarize(1).childFrameCount).toBe(1)
  })

  it('prunes expired frame leases and exposes only live frame ids', () => {
    let now = 100
    const registry = new FrameRuntimeRegistry({ now: () => now, leaseMs: 20 })
    registry.report({ tabId: 1, frameId: 0, sessionId: 'top-session-0000001' }, report)
    registry.report({ tabId: 1, frameId: 2, sessionId: 'child-session-0001' }, report)
    expect(registry.frameIds(1)).toEqual([0, 2])

    now = 121
    expect(registry.frameIds(1)).toEqual([])
    expect(registry.summarize(1).mediaLocation).toBe('none')
  })

  it('routes media work to an active child frame before an empty top frame', () => {
    const registry = new FrameRuntimeRegistry()
    registry.report(
      { tabId: 1, frameId: 0, sessionId: 'top-session-0000001' },
      { ...report, mediaCount: 0, activeMedia: false, anchoredMediaCount: 0 }
    )
    registry.report(
      { tabId: 1, frameId: 7, sessionId: 'child-session-0007' },
      { ...report, updatedAt: 20 }
    )
    registry.report(
      { tabId: 1, frameId: 3, sessionId: 'child-session-0003' },
      { ...report, activeMedia: false, updatedAt: 30 }
    )

    expect(registry.mediaFrameIds(1)).toEqual([7, 3, 0])
  })

  it('removes a disconnected session without deleting its replacement', () => {
    const registry = new FrameRuntimeRegistry()
    const newIdentity = { tabId: 1, frameId: 2, sessionId: 'new-session-0000001' }
    registry.report({ tabId: 1, frameId: 2, sessionId: 'old-session-0000001' }, report)
    registry.connect(newIdentity)
    registry.report(newIdentity, { ...report, mediaCount: 2, updatedAt: 20 })
    registry.remove({ tabId: 1, frameId: 2, sessionId: 'old-session-0000001' })
    expect(registry.summarize(1).childFrameMediaCount).toBe(2)
    registry.remove({ tabId: 1, frameId: 2, sessionId: 'new-session-0000001' })
    expect(registry.summarize(1).mediaLocation).toBe('none')
  })

  it('identifies only the current live session as the frame owner', () => {
    const registry = new FrameRuntimeRegistry()
    const oldIdentity = { tabId: 1, frameId: 2, sessionId: 'old-session-0000001' }
    const newIdentity = { tabId: 1, frameId: 2, sessionId: 'new-session-0000001' }
    registry.report(oldIdentity, report)
    expect(registry.owns(oldIdentity)).toBe(true)
    registry.connect(newIdentity)
    registry.report(newIdentity, { ...report, updatedAt: 20 })
    expect(registry.owns(oldIdentity)).toBe(false)
    expect(registry.owns(newIdentity)).toBe(true)
  })

  it('keeps a ready=false frame identity for broadcasts until its lease expires', () => {
    let now = 100
    const registry = new FrameRuntimeRegistry({ now: () => now, leaseMs: 20 })
    const identity = { tabId: 1, frameId: 2, sessionId: 'child-session-0000001' }

    registry.report(identity, report)
    registry.report(identity, {
      ...report,
      ready: false,
      mediaCount: 0,
      activeMedia: false,
      anchoredMediaCount: 0,
      updatedAt: 20
    })

    expect(registry.summarize(1)).toEqual({
      topFrameMediaCount: 0,
      childFrameMediaCount: 0,
      childFrameCount: 0,
      anchoredMediaCount: 0,
      mediaLocation: 'none'
    })
    expect(registry.frameIds(1)).toEqual([2])

    now = 121
    expect(registry.frameIds(1)).toEqual([])
  })

  it('keeps a temporarily unavailable media owner routable for recovery broadcasts', () => {
    const registry = new FrameRuntimeRegistry()
    const identity = { tabId: 1, frameId: 2, sessionId: 'child-session-0000001' }
    registry.report(identity, report)
    registry.report(identity, {
      ...report,
      ready: false,
      mediaCount: 1,
      activeMedia: true,
      updatedAt: 20
    })

    expect(registry.mediaFrameIds(1)).toEqual([2])
  })

  it('handles ready=false, replacement, and disconnect races by session identity', () => {
    const registry = new FrameRuntimeRegistry()
    const oldIdentity = { tabId: 1, frameId: 2, sessionId: 'old-session-0000001' }
    const newIdentity = { tabId: 1, frameId: 2, sessionId: 'new-session-0000001' }

    registry.report(oldIdentity, report)
    registry.report(oldIdentity, {
      ...report,
      ready: false,
      mediaCount: 0,
      activeMedia: false,
      anchoredMediaCount: 0,
      updatedAt: 20
    })
    expect(registry.frameIds(1)).toEqual([2])

    registry.connect(newIdentity)
    registry.report(newIdentity, { ...report, mediaCount: 3, updatedAt: 30 })
    registry.report(oldIdentity, {
      ...report,
      ready: false,
      mediaCount: 0,
      activeMedia: false,
      anchoredMediaCount: 0,
      updatedAt: 40
    })
    registry.remove(oldIdentity)
    expect(registry.summarize(1)).toMatchObject({
      childFrameMediaCount: 3,
      childFrameCount: 1,
      mediaLocation: 'child-frame'
    })

    registry.remove(newIdentity)
    expect(registry.frameIds(1)).toEqual([])
  })

  it('accepts a dormant report from a newly connected session reusing a frame id', () => {
    const registry = new FrameRuntimeRegistry()
    const oldIdentity = { tabId: 1, frameId: 2, sessionId: 'old-session-0000001' }
    const newIdentity = { tabId: 1, frameId: 2, sessionId: 'new-session-0000001' }

    registry.report(oldIdentity, report)
    registry.connect(newIdentity)
    registry.report(newIdentity, {
      ...report,
      ready: false,
      mediaCount: 0,
      activeMedia: false,
      anchoredMediaCount: 0,
      temporaryDisabled: true,
      updatedAt: 1
    })

    expect(registry.owns(oldIdentity)).toBe(false)
    expect(registry.owns(newIdentity)).toBe(true)
    expect(registry.frameIds(1)).toEqual([2])
  })

  it('rejects a late ready report after a connected replacement owns the frame', () => {
    const registry = new FrameRuntimeRegistry()
    const oldIdentity = { tabId: 1, frameId: 2, sessionId: 'old-session-0000001' }
    const newIdentity = { tabId: 1, frameId: 2, sessionId: 'new-session-0000001' }

    registry.report(oldIdentity, report)
    registry.connect(newIdentity)
    expect(registry.report(newIdentity, { ...report, mediaCount: 2, updatedAt: 20 })).toBe(true)
    expect(registry.report(oldIdentity, { ...report, mediaCount: 9, updatedAt: 30 })).toBe(false)

    expect(registry.owns(oldIdentity)).toBe(false)
    expect(registry.owns(newIdentity)).toBe(true)
    expect(registry.summarize(1)).toMatchObject({
      childFrameMediaCount: 2,
      childFrameCount: 1,
      mediaLocation: 'child-frame'
    })
  })

  it('promotes a dormant report that arrives before the replacement session connects', () => {
    const registry = new FrameRuntimeRegistry()
    const oldIdentity = { tabId: 1, frameId: 2, sessionId: 'old-session-0000001' }
    const newIdentity = { tabId: 1, frameId: 2, sessionId: 'new-session-0000001' }

    registry.report(oldIdentity, report)
    expect(
      registry.report(newIdentity, {
        ...report,
        ready: false,
        mediaCount: 0,
        activeMedia: false,
        anchoredMediaCount: 1,
        temporaryDisabled: true,
        updatedAt: 20
      })
    ).toBe(false)
    registry.connect(newIdentity)

    expect(registry.owns(oldIdentity)).toBe(false)
    expect(registry.owns(newIdentity)).toBe(true)
    expect(registry.mediaFrameIds(1)).toEqual([2])
  })

  it('keeps unconnected replacement reports pending until their session connects', () => {
    const registry = new FrameRuntimeRegistry()
    const oldIdentity = { tabId: 1, frameId: 2, sessionId: 'old-session-0000001' }
    const newIdentity = { tabId: 1, frameId: 2, sessionId: 'new-session-0000001' }

    expect(registry.report(oldIdentity, report)).toBe(true)
    expect(registry.report(newIdentity, { ...report, mediaCount: 2, updatedAt: 20 })).toBe(false)
    expect(registry.report(oldIdentity, { ...report, mediaCount: 9, updatedAt: 30 })).toBe(true)
    expect(registry.owns(oldIdentity)).toBe(true)
    expect(registry.owns(newIdentity)).toBe(false)

    registry.connect(newIdentity)

    expect(registry.owns(oldIdentity)).toBe(false)
    expect(registry.owns(newIdentity)).toBe(true)
    expect(registry.summarize(1)).toMatchObject({
      childFrameMediaCount: 2,
      childFrameCount: 1,
      mediaLocation: 'child-frame'
    })
    expect(registry.report(oldIdentity, { ...report, mediaCount: 7, updatedAt: 40 })).toBe(false)
  })

  it('resolves only the matching tab report waiter and bounds idle waits', async () => {
    const registry = new FrameRuntimeRegistry()
    const matching = registry.waitForReport(1, 100)
    const unrelated = registry.waitForReport(2, 0)
    registry.report({ tabId: 1, frameId: 2, sessionId: 'child-session-0000001' }, report)
    await expect(matching).resolves.toBe(true)
    await expect(unrelated).resolves.toBe(false)
    await expect(registry.waitForReport(1, 0)).resolves.toBe(false)
  })

  it('keeps filtered waiters pending until an accepted report matches', async () => {
    const registry = new FrameRuntimeRegistry()
    const childMedia = registry.waitForReport(
      1,
      100,
      (_identity, state) => state.ready && state.mediaCount > 0
    )
    registry.report(
      { tabId: 1, frameId: 0, sessionId: 'top-session-0000001' },
      { ...report, mediaCount: 0 }
    )
    registry.report(
      { tabId: 1, frameId: 2, sessionId: 'child-session-0000001' },
      { ...report, ready: false, mediaCount: 0, updatedAt: 20 }
    )
    registry.report(
      { tabId: 1, frameId: 2, sessionId: 'child-session-0000001' },
      { ...report, updatedAt: 30 }
    )
    await expect(childMedia).resolves.toBe(true)
  })
})
