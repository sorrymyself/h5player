/* eslint-disable @typescript-eslint/unbound-method -- Native accessors are intentionally captured, compared, and called with explicit receivers. */

import { afterEach, describe, expect, it } from 'vitest'
import type { MediaCommand } from '../../src/domain/command'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'
import { MediaControlAuthority } from '../../src/runtime/page-main/media-control-authority'

const authorities: MediaControlAuthority[] = []

function createAuthority(now: () => number = () => 100, seekLeaseMs = 1_500) {
  const authority = new MediaControlAuthority(window, document, now, seekLeaseMs)
  authorities.push(authority)
  expect(authority.install()).toBe(true)
  return authority
}

function mediaSnapshot(
  element: HTMLMediaElement,
  overrides: Readonly<{
    id?: string
    state?: MediaSnapshot['state']
    playbackRate?: number
    volume?: number
    muted?: boolean
    currentTime?: number
  }> = {}
): MediaSnapshot {
  return {
    id: overrides.id ?? 'media-0-1',
    frameId: 0,
    kind: 'video',
    state: overrides.state ?? 'paused',
    metrics: {
      width: 640,
      height: 360,
      duration: 120,
      currentTime: overrides.currentTime ?? element.currentTime,
      volume: overrides.volume ?? element.volume,
      playbackRate: overrides.playbackRate ?? element.playbackRate,
      muted: overrides.muted ?? element.muted,
      visible: true
    },
    capabilities: createMediaCapabilities({
      playback: true,
      seek: true,
      playbackRate: true,
      volume: true,
      mute: true
    }),
    adapterId: 'generic',
    updatedAt: 100
  }
}

function nativeSetter(property: 'playbackRate' | 'volume' | 'muted' | 'currentTime') {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, property)
  if (descriptor?.set === undefined) throw new Error(`Missing native ${property} setter`)
  return descriptor.set
}

function record(
  authority: MediaControlAuthority,
  command: MediaCommand,
  element: HTMLMediaElement,
  overrides: Parameters<typeof mediaSnapshot>[1] = {}
): void {
  authority.recordCommand(command, mediaSnapshot(element, overrides))
}

afterEach(() => {
  for (const authority of authorities.splice(0)) authority.teardown()
  document.body.replaceChildren()
})

describe('MediaControlAuthority', () => {
  it('keeps getters transparent and leaves unbound media untouched', () => {
    const before = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')
    const authority = createAuthority()
    const after = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')
    const unbound = document.createElement('video')
    document.body.append(unbound)

    authority.configure({ playbackRate: true, volume: true, currentTime: true })
    unbound.playbackRate = 1.75
    unbound.volume = 0.4
    unbound.muted = true
    unbound.currentTime = 20

    expect(after?.get).toBe(before?.get)
    expect(unbound.playbackRate).toBe(1.75)
    expect(unbound.volume).toBe(0.4)
    expect(unbound.muted).toBe(true)
    expect(unbound.currentTime).toBe(20)
  })

  it('does not promote the site value to user intent before an extension command', () => {
    const authority = createAuthority()
    const video = document.createElement('video')
    document.body.append(video)
    authority.attach(video, 'media-0-1')
    authority.configure({ playbackRate: true, volume: true, currentTime: false })

    video.playbackRate = 1.25
    video.volume = 0.5

    expect(video.playbackRate).toBe(1.25)
    expect(video.volume).toBe(0.5)
  })

  it('protects rate, volume and mute per instance after confirmed extension commands', () => {
    const authority = createAuthority()
    const first = document.createElement('video')
    const second = document.createElement('video')
    document.body.append(first, second)
    const release = authority.attach(first, 'media-0-1')
    authority.attach(second, 'media-0-2')
    authority.configure({ playbackRate: true, volume: true, currentTime: false })

    first.playbackRate = 1.5
    first.volume = 0.7
    first.muted = false
    record(authority, { type: 'media.set-rate', mediaId: 'media-0-1', value: 1.5 }, first)
    record(authority, { type: 'media.set-volume', mediaId: 'media-0-1', value: 0.7 }, first)

    first.playbackRate = 1
    first.volume = 0.2
    first.muted = true
    second.playbackRate = 2
    second.volume = 0.3
    second.muted = true

    expect(first.playbackRate).toBe(1.5)
    expect(first.volume).toBe(0.7)
    expect(first.muted).toBe(false)
    expect(second.playbackRate).toBe(2)
    expect(second.volume).toBe(0.3)
    expect(second.muted).toBe(true)
    expect(authority.diagnostics()[0]).toMatchObject({
      blockedWrites: { playbackRate: 1, volume: 1, muted: 1 }
    })

    authority.configure({ playbackRate: false, volume: false, currentTime: false })
    first.playbackRate = 1
    first.volume = 0.2
    first.muted = true
    expect(first.playbackRate).toBe(1)
    expect(first.volume).toBe(0.2)
    expect(first.muted).toBe(true)

    release()
    authority.configure({ playbackRate: true, volume: true, currentTime: false })
    first.playbackRate = 1.25
    expect(first.playbackRate).toBe(1.25)
  })

  it('treats mute and volume as one protected user intent group', () => {
    const authority = createAuthority()
    const video = document.createElement('video')
    document.body.append(video)
    authority.attach(video, 'media-0-1')
    authority.configure({ playbackRate: false, volume: true, currentTime: false })
    video.volume = 0.6
    video.muted = true
    record(authority, { type: 'media.set-muted', mediaId: 'media-0-1', value: true }, video)

    video.volume = 0.1
    video.muted = false

    expect(video.volume).toBe(0.6)
    expect(video.muted).toBe(true)
  })

  it('recovers from a site that cached the native setter before installation', async () => {
    const bypassSetter = nativeSetter('playbackRate')
    const authority = createAuthority()
    const video = document.createElement('video')
    document.body.append(video)
    authority.attach(video, 'media-0-1')
    authority.configure({ playbackRate: true, volume: false, currentTime: false })
    video.playbackRate = 1.75
    record(authority, { type: 'media.set-rate', mediaId: 'media-0-1', value: 1.75 }, video)

    bypassSetter.call(video, 1)
    expect(video.playbackRate).toBe(1)
    video.dispatchEvent(new Event('ratechange'))
    await Promise.resolve()

    expect(video.playbackRate).toBe(1.75)
  })

  it('uses a short seek lease without freezing natural playback or later site seeks', () => {
    let now = 1_000
    const authority = createAuthority(() => now, 1_500)
    const video = document.createElement('video')
    document.body.append(video)
    authority.attach(video, 'media-0-1')
    authority.configure({ playbackRate: false, volume: false, currentTime: true })
    video.currentTime = 10
    record(authority, { type: 'media.seek', mediaId: 'media-0-1', deltaSeconds: 10 }, video, {
      state: 'active',
      currentTime: 10,
      playbackRate: 1
    })

    video.currentTime = 50
    expect(video.currentTime).toBe(10)

    now += 500
    video.currentTime = 10.5
    expect(video.currentTime).toBe(10.5)

    now += 1_100
    video.currentTime = 50
    expect(video.currentTime).toBe(50)
    expect(authority.diagnostics()[0]?.hasSeekLease).toBe(false)
  })

  it('protects a custom accessor, passes equal writes, and inherits intent on target replacement', () => {
    const authority = createAuthority()
    authority.configure({ playbackRate: true, volume: false, currentTime: false })
    const first = document.createElement('fake-video') as HTMLElement & { playbackRate: number }
    const second = document.createElement('fake-video') as HTMLElement & { playbackRate: number }
    let firstRate = 1
    let secondRate = 1
    let firstWrites = 0
    let secondWrites = 0
    Object.defineProperty(first, 'playbackRate', {
      configurable: true,
      get: () => firstRate,
      set: (value: number) => {
        firstWrites += 1
        firstRate = value
      }
    })
    Object.defineProperty(second, 'playbackRate', {
      configurable: true,
      get: () => secondRate,
      set: (value: number) => {
        secondWrites += 1
        secondRate = value
      }
    })

    authority.attachCustomPlaybackRate(first, 'media-13-tencent-viewport')
    expect(authority.writeCustomPlaybackRate(first, 'media-13-tencent-viewport', 1.5)).toBe(true)
    authority.recordCommand(
      { type: 'media.set-rate', mediaId: 'media-13-tencent-viewport', value: 1.5 },
      mediaSnapshot(document.createElement('video'), {
        id: 'media-13-tencent-viewport',
        playbackRate: 1.5
      })
    )
    first.playbackRate = 1.5
    first.playbackRate = 1
    expect(first.playbackRate).toBe(1.5)
    expect(firstWrites).toBe(2)

    authority.attachCustomPlaybackRate(second, 'media-13-tencent-viewport')
    expect(second.playbackRate).toBe(1.5)
    second.playbackRate = 1
    first.playbackRate = 1

    expect(second.playbackRate).toBe(1.5)
    expect(first.playbackRate).toBe(1)
    expect(secondWrites).toBe(1)
  })

  it('arms a replacement custom rate before a synchronous site reset can restore the old intent', () => {
    const authority = createAuthority()
    authority.configure({ playbackRate: true, volume: false, currentTime: false })
    const target = document.createElement('fake-video') as HTMLElement & { playbackRate: number }
    let rate = 1.5
    Object.defineProperty(target, 'playbackRate', {
      configurable: true,
      get: () => rate,
      set: (value: number) => {
        rate = value
        if (value === 2) target.playbackRate = 1.5
      }
    })

    authority.attachCustomPlaybackRate(target, 'media-14-tencent-viewport')
    authority.recordCommand(
      { type: 'media.set-rate', mediaId: 'media-14-tencent-viewport', value: 1.5 },
      mediaSnapshot(document.createElement('video'), {
        id: 'media-14-tencent-viewport',
        playbackRate: 1.5
      })
    )

    expect(authority.writeCustomPlaybackRate(target, 'media-14-tencent-viewport', 2)).toBe(true)
    expect(target.playbackRate).toBe(2)
    expect(authority.diagnostics()[0]).toMatchObject({
      blockedWrites: { playbackRate: 1 }
    })
  })

  it('does not overwrite a descriptor that the page replaces after installation', () => {
    const prototype = HTMLMediaElement.prototype
    const original = Object.getOwnPropertyDescriptor(prototype, 'playbackRate')
    if (original?.set === undefined) throw new Error('Missing playbackRate descriptor')
    const authority = createAuthority()
    const replacement = function (this: HTMLMediaElement, value: number): void {
      original.set?.call(this, value)
    }
    Object.defineProperty(prototype, 'playbackRate', { ...original, set: replacement })

    authority.teardown()
    authorities.splice(authorities.indexOf(authority), 1)
    expect(Object.getOwnPropertyDescriptor(prototype, 'playbackRate')?.set).toBe(replacement)

    Object.defineProperty(prototype, 'playbackRate', original)
  })
})
