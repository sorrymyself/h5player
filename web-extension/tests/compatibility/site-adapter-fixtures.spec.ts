import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaAdapterRegistry } from '../../src/adapters/registry'
import { createProductionAdapterRegistry } from '../../src/adapters'
import { SITE_ADAPTER_DEFINITIONS } from '../../src/adapters/sites'
import type {
  MediaControllerContext,
  SiteAdapterDefinition,
  SiteAdapterSelectorMap
} from '../../src/domain/adapter'

const TIER_1_IDS = ['youtube', 'bilibili', 'tencent-video', 'iqiyi', 'youku']

function fixturePath(definition: SiteAdapterDefinition): string {
  return path.resolve('tests/fixtures/sites', definition.fixture)
}

function fixtureUrl(definition: SiteAdapterDefinition): string {
  const match = definition.matches[0]
  if (!match) throw new Error(`Missing fixture URL for ${definition.id}`)
  return `https://${match.hostname}${match.path ?? '/fixture'}`
}

function loadFixture(html: string): HTMLMediaElement {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.body.replaceChildren(
    ...[...parsed.body.childNodes].map((node) => document.importNode(node, true))
  )
  const media = document.querySelector('video, audio')
  if (!(media instanceof HTMLMediaElement)) throw new Error('Fixture has no media element')
  return media
}

function context(id: string): MediaControllerContext {
  return { mediaId: `fixture-${id}`, frameId: 0, now: () => 1 }
}

function firstPresent(selectors: readonly string[] | undefined): HTMLElement | null {
  if (!selectors) return null
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element instanceof HTMLElement) return element
  }
  return null
}

function declaredSelectorGroups(selectors: SiteAdapterSelectorMap): readonly (readonly string[])[] {
  return Object.values(selectors).filter((value): value is readonly string[] => value !== undefined)
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('site adapter catalog', () => {
  it('has complete, unique, and current ownership metadata', () => {
    const ids = SITE_ADAPTER_DEFINITIONS.map((definition) => definition.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => TIER_1_IDS.includes(id)).sort()).toEqual([...TIER_1_IDS].sort())
    expect(
      SITE_ADAPTER_DEFINITIONS.filter((definition) => definition.tier === 2).length
    ).toBeGreaterThanOrEqual(5)

    for (const rawDefinition of SITE_ADAPTER_DEFINITIONS) {
      const definition = rawDefinition as SiteAdapterDefinition
      expect(definition.owner.length).toBeGreaterThan(3)
      expect(definition.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(definition.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(definition.fixture).toBe(`${definition.id}.html`)
      expect(definition.matches.length).toBeGreaterThan(0)
      expect(definition.features.length).toBeGreaterThan(0)
      if (definition.features.includes('playback')) {
        expect(definition.selectors.play?.length).toBeGreaterThan(0)
        expect(definition.selectors.pause?.length).toBeGreaterThan(0)
      }
      if (definition.features.includes('fullscreen-native')) {
        expect(definition.selectors.fullscreenNative?.length).toBeGreaterThan(0)
      }
      if (definition.features.includes('fullscreen-web')) {
        expect(definition.selectors.fullscreenWeb?.length).toBeGreaterThan(0)
      }
      if (definition.features.includes('next')) {
        expect(definition.selectors.next?.length).toBeGreaterThan(0)
      }
      if (definition.features.includes('autoplay')) {
        expect(definition.selectors.autoplay?.length).toBeGreaterThan(0)
      }
    }
  })

  it.each(SITE_ADAPTER_DEFINITIONS)(
    '$id matches its sanitized fixture and executes declared selector actions',
    async (rawDefinition) => {
      const definition = rawDefinition as SiteAdapterDefinition
      const html = await readFile(fixturePath(definition), 'utf8')
      expect(html).not.toMatch(/(?:token|cookie|account|https?:\/\/)/i)
      const media = loadFixture(html)
      const registry = new MediaAdapterRegistry({
        definitions: SITE_ADAPTER_DEFINITIONS,
        url: () => fixtureUrl(definition)
      })
      const controller = registry.createController(media, context(definition.id))

      expect(controller.getSnapshot().adapterId).toBe(definition.id)
      expect(registry.getDiagnostics()).toContainEqual(
        expect.objectContaining({ id: definition.id, selected: true, status: 'selected' })
      )
      for (const selectors of declaredSelectorGroups(definition.selectors)) {
        expect(firstPresent(selectors)).not.toBeNull()
      }

      const play = firstPresent(definition.selectors.play)
      if (play) {
        const clicked = vi.fn()
        play.addEventListener('click', clicked)
        await controller.play()
        expect(clicked).toHaveBeenCalledOnce()
      }

      const pause = firstPresent(definition.selectors.pause)
      if (pause) {
        const clicked = vi.fn()
        pause.addEventListener('click', clicked)
        await controller.pause()
        expect(clicked).toHaveBeenCalledOnce()
      }

      const nativeFullscreen = firstPresent(definition.selectors.fullscreenNative)
      if (nativeFullscreen) {
        const clicked = vi.fn()
        nativeFullscreen.addEventListener('click', clicked)
        await controller.toggleFullscreen?.('native')
        expect(clicked).toHaveBeenCalledOnce()
      }

      const webFullscreen = firstPresent(definition.selectors.fullscreenWeb)
      if (webFullscreen) {
        const clicked = vi.fn()
        webFullscreen.addEventListener('click', clicked)
        await controller.toggleFullscreen?.('web')
        expect(clicked).toHaveBeenCalledOnce()
      }

      const next = firstPresent(definition.selectors.next)
      if (next) {
        const clicked = vi.fn()
        next.addEventListener('click', clicked)
        await controller.playNext?.()
        expect(clicked).toHaveBeenCalledOnce()
      }

      const autoplay = firstPresent(definition.selectors.autoplay)
      if (autoplay) {
        const clicked = vi.fn()
        autoplay.addEventListener('click', clicked)
        expect(registry.executePageAction('autoplay', document)).toEqual({
          declared: true,
          handled: true,
          adapterId: definition.id
        })
        expect(clicked).toHaveBeenCalledOnce()
      }
      controller.teardown()
    }
  )

  it('retains the generic adapter for an unmatched host', () => {
    const media = loadFixture('<video width="640" height="360"></video>')
    const registry = new MediaAdapterRegistry({
      definitions: SITE_ADAPTER_DEFINITIONS,
      url: () => 'https://unmatched.invalid/video'
    })
    const controller = registry.createController(media, context('generic'))

    expect(controller.getSnapshot().adapterId).toBe('generic')
    expect(registry.getDiagnostics()).toEqual([])
    controller.teardown()
  })

  it.each([
    {
      fixture: 'bilibili-live.html',
      url: 'https://live.bilibili.com/123',
      selector: '.bilibili-live-player-video-controller-web-fullscreen-btn button',
      mode: 'web' as const
    },
    {
      fixture: 'bilibili-dynamic.html',
      url: 'https://t.bilibili.com/456',
      selector: 'button[name="fullscreen-button"]',
      mode: 'native' as const
    }
  ])('covers the Bilibili $fixture surface', async ({ fixture, url, selector, mode }) => {
    const media = loadFixture(await readFile(path.resolve('tests/fixtures/sites', fixture), 'utf8'))
    const control = document.querySelector(selector)
    if (!(control instanceof HTMLElement)) throw new Error(`Missing ${fixture} control`)
    const clicked = vi.fn()
    control.addEventListener('click', clicked)
    const registry = new MediaAdapterRegistry({
      definitions: SITE_ADAPTER_DEFINITIONS,
      url: () => url
    })
    const controller = registry.createController(media, context(fixture))

    expect(controller.getSnapshot().adapterId).toBe('bilibili')
    await controller.toggleFullscreen?.(mode)
    expect(clicked).toHaveBeenCalledOnce()
    controller.teardown()
  })

  it('uses Netflix native controls for relative seek direction and playback rate', async () => {
    const definition = SITE_ADAPTER_DEFINITIONS.find((entry) => entry.id === 'netflix')
    if (!definition) throw new Error('Missing Netflix adapter')
    const media = loadFixture(await readFile(fixturePath(definition), 'utf8'))
    media.currentTime = 30
    const back = document.querySelector('button.button-nfplayerBackTen')
    const forward = document.querySelector('button.button-nfplayerFastForward')
    const rate = document.querySelector('[data-playback-rate="1.5"]')
    if (
      !(back instanceof HTMLElement) ||
      !(forward instanceof HTMLElement) ||
      !(rate instanceof HTMLElement)
    ) {
      throw new Error('Missing Netflix fixture controls')
    }
    const backClicked = vi.fn()
    const forwardClicked = vi.fn()
    const rateClicked = vi.fn()
    back.addEventListener('click', backClicked)
    forward.addEventListener('click', forwardClicked)
    rate.addEventListener('click', rateClicked)
    const registry = createProductionAdapterRegistry({
      url: () => 'https://www.netflix.com/watch/1'
    })
    const controller = registry.createController(media, context('netflix-native'))

    await controller.seekTo(40)
    await controller.seekTo(20)
    await controller.setPlaybackRate(1.5)

    expect(forwardClicked).toHaveBeenCalledOnce()
    expect(backClicked).toHaveBeenCalledOnce()
    expect(rateClicked).toHaveBeenCalledOnce()
    expect(media.currentTime).toBe(30)
    expect(media.playbackRate).toBe(1)
    controller.teardown()
  })

  it('degrades Netflix seek while falling back to the captured playback-rate setter', async () => {
    const media = loadFixture('<video width="640" height="360"></video>')
    media.currentTime = 30
    const registry = createProductionAdapterRegistry({
      url: () => 'https://www.netflix.com/watch/1'
    })
    const controller = registry.createController(media, context('netflix-degraded'))

    await expect(controller.seekTo(40)).rejects.toThrow('Netflix native seek control unavailable')
    await expect(controller.setPlaybackRate(1.5)).resolves.toBeUndefined()
    expect(media.currentTime).toBe(30)
    expect(media.playbackRate).toBe(1.5)
    expect(registry.getDiagnostics()[0]).toMatchObject({
      id: 'netflix',
      status: 'degraded',
      failureCount: 1,
      lastFailureStage: 'action'
    })
    controller.teardown()
  })
})
