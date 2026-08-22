import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaAdapterRegistry } from '../../src/adapters/registry'
import type {
  MediaAdapter,
  MediaControllerContext,
  ObservableMediaController,
  SiteAdapterDefinition,
  SiteAdapterDisablePolicy,
  SiteAdapterFeature
} from '../../src/domain/adapter'
import { createMediaCapabilities, type MediaSnapshot } from '../../src/domain/media'

function definition(
  id: string,
  hostname: string,
  priority = 100,
  selectors: SiteAdapterDefinition['selectors'] = {}
): SiteAdapterDefinition {
  return {
    id,
    version: '1.0.0',
    priority,
    owner: 'Compatibility Owner',
    tier: 1,
    supportLevel: 'preview',
    fixture: `${id}.html`,
    lastVerified: '2026-08-11',
    matches: [{ hostname }],
    features: ['playback', 'seek', 'playback-rate', 'fullscreen-native', 'fullscreen-web'],
    selectors
  }
}

class FakeController implements ObservableMediaController {
  readonly mediaId = 'media-0-1'
  readonly capabilities = createMediaCapabilities({ playback: true })
  readonly play = vi.fn(() => Promise.resolve())
  readonly pause = vi.fn(() => Promise.resolve())
  readonly seekTo = vi.fn(() => Promise.resolve())
  readonly setPlaybackRate = vi.fn(() => Promise.resolve())
  readonly setVolume = vi.fn(() => Promise.resolve())
  readonly setMuted = vi.fn(() => Promise.resolve())
  readonly toggleFullscreen = vi.fn(() => Promise.resolve())
  readonly teardown = vi.fn()

  getSnapshot(): MediaSnapshot {
    return {
      id: this.mediaId,
      frameId: 0,
      kind: 'video',
      state: 'paused',
      metrics: {
        width: 640,
        height: 360,
        duration: 60,
        currentTime: 0,
        volume: 1,
        playbackRate: 1,
        muted: false,
        visible: true
      },
      capabilities: this.capabilities,
      adapterId: 'generic',
      updatedAt: 1
    }
  }

  subscribe(): () => void {
    return () => undefined
  }
}

class FakeAdapter implements MediaAdapter<HTMLMediaElement> {
  readonly id = 'generic'
  readonly priority = 0
  readonly controllers: FakeController[] = []

  supports(target: unknown): target is HTMLMediaElement {
    return target instanceof HTMLMediaElement
  }

  createController(): FakeController {
    const controller = new FakeController()
    this.controllers.push(controller)
    return controller
  }
}

function video(): HTMLVideoElement {
  const element = document.createElement('video')
  document.body.append(element)
  return element
}

function context(): MediaControllerContext {
  return { mediaId: 'media-0-1', frameId: 0, now: () => 1 }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('MediaAdapterRegistry', () => {
  it('uses deterministic priority and id tie-breaking with generic fallback intact', () => {
    const fallback = new FakeAdapter()
    const lower = definition('lower', 'example.com', 10)
    const zeta = definition('zeta', 'example.com', 20)
    const alpha = definition('alpha', 'example.com', 20)
    const registry = new MediaAdapterRegistry({
      definitions: [lower, zeta, alpha],
      fallback,
      url: () => 'https://example.com/watch'
    })
    const controller = registry.createController(video(), context())

    const mutableAlphaMatch = alpha.matches[0] as { hostname: string }
    mutableAlphaMatch.hostname = 'mutated.invalid'
    for (let index = 0; index < 128; index += 1) registry.activate('alpha')

    expect(controller.getSnapshot().adapterId).toBe('alpha')
    expect(registry.getDiagnostics()).toEqual([
      expect.objectContaining({
        id: 'alpha',
        selected: true,
        selectedMediaCount: 128,
        status: 'selected'
      }),
      expect.objectContaining({ id: 'zeta', selected: false, status: 'available' }),
      expect.objectContaining({ id: 'lower', selected: false, status: 'available' })
    ])

    controller.teardown()
    expect(fallback.controllers[0]?.teardown).toHaveBeenCalledOnce()
  })

  it('rejects invalid catalogs before any controller is created', () => {
    expect(
      () =>
        new MediaAdapterRegistry({
          definitions: [definition('duplicate', 'a.example'), definition('duplicate', 'b.example')]
        })
    ).toThrow('Duplicate site adapter id')

    expect(
      () =>
        new MediaAdapterRegistry({
          definitions: [{ ...definition('tier', 'example.com'), tier: 3 as 1 }]
        })
    ).toThrow('Invalid tier')
    expect(
      () =>
        new MediaAdapterRegistry({
          definitions: [{ ...definition('date', 'example.com'), lastVerified: '2026-02-31' }]
        })
    ).toThrow('Invalid verification date')
    expect(
      () =>
        new MediaAdapterRegistry({
          definitions: [
            {
              ...definition('feature', 'example.com'),
              features: ['playback', 'unsupported' as 'fullscreen-native']
            }
          ]
        })
    ).toThrow('Invalid features')
    expect(
      () =>
        new MediaAdapterRegistry({
          definitions: Array.from({ length: 33 }, (_, index) =>
            definition(`adapter-${String(index)}`, `${String(index)}.example.com`)
          )
        })
    ).toThrow('Too many site adapter definitions')
    expect(
      () =>
        new MediaAdapterRegistry({
          definitions: [definition('known', 'example.com')],
          hooks: { unknown: {} }
        })
    ).toThrow('Unknown site adapter hooks')
  })

  it('applies declarative path prefixes without matching sibling routes', () => {
    let href = 'https://example.com/home'
    const pathSpecific = {
      ...definition('watch-only', 'example.com', 200),
      matches: [{ hostname: 'example.com', path: '/watch' }]
    }
    const registry = new MediaAdapterRegistry({
      definitions: [pathSpecific, definition('site-wide', 'example.com', 100)],
      fallback: new FakeAdapter(),
      url: () => href
    })
    const controller = registry.createController(video(), context())

    expect(controller.getSnapshot().adapterId).toBe('site-wide')
    href = 'https://example.com/watch/episode'
    expect(controller.getSnapshot().adapterId).toBe('watch-only')
    controller.teardown()
  })

  it('executes a bounded top-level next action through the selected adapter', () => {
    const nextButton = document.createElement('button')
    nextButton.className = 'site-next'
    document.body.append(nextButton)
    const clicked = vi.fn()
    nextButton.addEventListener('click', clicked)
    const registry = new MediaAdapterRegistry({
      definitions: [
        {
          ...definition('page-action', 'example.com'),
          features: ['next'],
          selectors: { next: ['.site-next'] }
        }
      ],
      fallback: new FakeAdapter(),
      url: () => 'https://example.com/watch'
    })

    expect(registry.executePageAction('next', document)).toEqual({
      declared: true,
      handled: true,
      adapterId: 'page-action'
    })
    expect(clicked).toHaveBeenCalledOnce()

    nextButton.remove()
    expect(registry.executePageAction('next', document)).toEqual({
      declared: true,
      handled: false,
      adapterId: 'page-action'
    })
  })

  it('executes autoplay only for an explicitly declared adapter page-start action', () => {
    const startButton = document.createElement('button')
    startButton.className = 'site-start'
    document.body.append(startButton)
    const clicked = vi.fn()
    startButton.addEventListener('click', clicked)
    const registry = new MediaAdapterRegistry({
      definitions: [
        {
          ...definition('page-start', 'example.com'),
          features: ['playback', 'autoplay'],
          selectors: { play: ['.site-start'], autoplay: ['.site-start'] }
        }
      ],
      fallback: new FakeAdapter(),
      url: () => 'https://example.com/watch'
    })

    expect(registry.executePageAction('autoplay', document)).toEqual({
      declared: true,
      handled: true,
      adapterId: 'page-start'
    })
    expect(clicked).toHaveBeenCalledOnce()

    const genericPlaybackOnly = new MediaAdapterRegistry({
      definitions: [definition('playback-only', 'example.com', 100, { play: ['.site-start'] })],
      fallback: new FakeAdapter(),
      url: () => 'https://example.com/watch'
    })
    expect(genericPlaybackOnly.executePageAction('autoplay', document)).toEqual({
      declared: false,
      handled: false,
      adapterId: 'playback-only'
    })
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('matches subdomains only when the rule opts in explicitly', () => {
    const defaultRegistry = new MediaAdapterRegistry({
      definitions: [definition('exact-only', 'example.com')],
      fallback: new FakeAdapter(),
      url: () => 'https://media.example.com/watch'
    })
    const defaultController = defaultRegistry.createController(video(), context())
    expect(defaultController.getSnapshot().adapterId).toBe('generic')
    defaultController.teardown()

    const registry = new MediaAdapterRegistry({
      definitions: [
        {
          ...definition('subdomains', 'example.com'),
          matches: [{ hostname: 'example.com', includeSubdomains: true }]
        }
      ],
      fallback: new FakeAdapter(),
      url: () => 'https://media.example.com/watch'
    })
    const controller = registry.createController(video(), context())
    expect(controller.getSnapshot().adapterId).toBe('subdomains')
    controller.teardown()
  })

  it('disables an exact adapter version and individual features predictably', async () => {
    const fallback = new FakeAdapter()
    const disabled = definition('disabled', 'example.com', 200)
    const active = definition('active', 'example.com', 100, {
      fullscreenNative: ['.site-fullscreen']
    })
    const button = document.createElement('button')
    button.className = 'site-fullscreen'
    document.body.append(button)
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    const disablePolicy = {
      adapterVersions: { disabled: ['1.0.0'] },
      features: { active: ['fullscreen-native'] as SiteAdapterFeature[] }
    } satisfies SiteAdapterDisablePolicy
    const registry = new MediaAdapterRegistry({
      definitions: [disabled, active],
      fallback,
      disablePolicy,
      url: () => 'https://example.com/'
    })
    const controller = registry.createController(video(), context())

    disablePolicy.adapterVersions.disabled[0] = '9.9.9'
    disablePolicy.features.active[0] = 'fullscreen-web'

    expect(controller.getSnapshot().adapterId).toBe('active')
    await controller.toggleFullscreen?.('native')
    expect(clicked).not.toHaveBeenCalled()
    expect(fallback.controllers[0]?.toggleFullscreen).toHaveBeenCalledWith('native')
    expect(registry.getDiagnostics()).toEqual([
      expect.objectContaining({ id: 'disabled', status: 'disabled' }),
      expect.objectContaining({
        id: 'active',
        disabledFeatures: ['fullscreen-native'],
        status: 'selected'
      })
    ])
    controller.teardown()
  })

  it('isolates attach, action, and detach hook failures from generic control', async () => {
    const fallback = new FakeAdapter()
    const onDetach = vi.fn(() => {
      throw new Error('detach failed')
    })
    const registry = new MediaAdapterRegistry({
      definitions: [
        definition('broken-attach', 'example.com', 200),
        definition('degraded', 'example.com', 100)
      ],
      fallback,
      hooks: {
        'broken-attach': {
          onAttach: () => {
            throw new Error('attach failed')
          }
        },
        degraded: {
          actions: {
            play: () => {
              throw new Error('action failed')
            }
          },
          onDetach
        }
      },
      url: () => 'https://example.com/'
    })
    const controller = registry.createController(video(), context())

    expect(controller.getSnapshot().adapterId).toBe('degraded')
    await expect(controller.play()).resolves.toBeUndefined()
    expect(fallback.controllers[0]?.play).toHaveBeenCalledOnce()
    expect(registry.getDiagnostics()).toEqual([
      expect.objectContaining({ id: 'broken-attach', status: 'degraded', failureCount: 1 }),
      expect.objectContaining({ id: 'degraded', status: 'degraded', failureCount: 1 })
    ])

    expect(() => controller.teardown()).not.toThrow()
    expect(onDetach).toHaveBeenCalledOnce()
    expect(fallback.controllers[0]?.teardown).toHaveBeenCalledOnce()
  })

  it('uses playback-rate hooks without manufacturing success after a rejected site bridge', async () => {
    const handledFallback = new FakeAdapter()
    const handledHook = vi.fn(() => true)
    const handledRegistry = new MediaAdapterRegistry({
      definitions: [definition('handled', 'example.com')],
      fallback: handledFallback,
      hooks: { handled: { setPlaybackRate: handledHook } },
      url: () => 'https://example.com/'
    })
    const handled = handledRegistry.createController(video(), context())

    await expect(handled.setPlaybackRate(1.5)).resolves.toBeUndefined()
    expect(handledHook).toHaveBeenCalledOnce()
    expect(handledFallback.controllers[0]?.setPlaybackRate).not.toHaveBeenCalled()
    handled.teardown()

    const declinedFallback = new FakeAdapter()
    const declinedHook = vi.fn(() => false)
    const declinedRegistry = new MediaAdapterRegistry({
      definitions: [definition('declined', 'example.com')],
      fallback: declinedFallback,
      hooks: { declined: { setPlaybackRate: declinedHook } },
      url: () => 'https://example.com/'
    })
    const declined = declinedRegistry.createController(video(), context())

    await expect(declined.setPlaybackRate(1.75)).resolves.toBeUndefined()
    expect(declinedFallback.controllers[0]?.setPlaybackRate).toHaveBeenCalledWith(1.75)
    declined.teardown()

    const rejectedFallback = new FakeAdapter()
    const rejectedHook = vi.fn(() => Promise.reject(new Error('Tencent bridge rejected')))
    const rejectedRegistry = new MediaAdapterRegistry({
      definitions: [definition('rejected', 'example.com')],
      fallback: rejectedFallback,
      hooks: { rejected: { setPlaybackRate: rejectedHook } },
      url: () => 'https://example.com/'
    })
    const rejected = rejectedRegistry.createController(video(), context())

    await expect(rejected.setPlaybackRate(2)).rejects.toThrow('Tencent bridge rejected')
    expect(rejectedFallback.controllers[0]?.setPlaybackRate).not.toHaveBeenCalled()
    expect(rejectedRegistry.getDiagnostics()[0]).toMatchObject({
      id: 'rejected',
      status: 'degraded',
      failureCount: 1,
      lastFailureStage: 'action'
    })
    rejected.teardown()
  })

  it('uses seek hooks without falling through after a rejected site-native action', async () => {
    const handledFallback = new FakeAdapter()
    const handledHook = vi.fn(() => true)
    const handledRegistry = new MediaAdapterRegistry({
      definitions: [definition('handled', 'example.com')],
      fallback: handledFallback,
      hooks: { handled: { seekTo: handledHook } },
      url: () => 'https://example.com/'
    })
    const handled = handledRegistry.createController(video(), context())

    await expect(handled.seekTo(20)).resolves.toBeUndefined()
    expect(handledHook).toHaveBeenCalledOnce()
    expect(handledFallback.controllers[0]?.seekTo).not.toHaveBeenCalled()
    handled.teardown()

    const rejectedFallback = new FakeAdapter()
    const rejectedRegistry = new MediaAdapterRegistry({
      definitions: [definition('rejected', 'example.com')],
      fallback: rejectedFallback,
      hooks: {
        rejected: {
          seekTo: () => {
            throw new Error('Native seek unavailable')
          }
        }
      },
      url: () => 'https://example.com/'
    })
    const rejected = rejectedRegistry.createController(video(), context())

    await expect(rejected.seekTo(30)).rejects.toThrow('Native seek unavailable')
    expect(rejectedFallback.controllers[0]?.seekTo).not.toHaveBeenCalled()
    expect(rejectedRegistry.getDiagnostics()[0]).toMatchObject({
      id: 'rejected',
      status: 'degraded',
      failureCount: 1,
      lastFailureStage: 'action'
    })
    rejected.teardown()
  })

  it('rematches an existing media controller after SPA URL changes', () => {
    let href = 'https://alpha.example/watch'
    const attachAlpha = vi.fn()
    const detachAlpha = vi.fn()
    const attachBeta = vi.fn()
    const registry = new MediaAdapterRegistry({
      definitions: [definition('alpha', 'alpha.example'), definition('beta', 'beta.example')],
      fallback: new FakeAdapter(),
      hooks: {
        alpha: { onAttach: attachAlpha, onDetach: detachAlpha },
        beta: { onAttach: attachBeta }
      },
      url: () => href
    })
    const controller = registry.createController(video(), context())
    expect(controller.getSnapshot().adapterId).toBe('alpha')

    href = 'https://beta.example/episode'
    expect(controller.getSnapshot().adapterId).toBe('beta')
    expect(attachAlpha).toHaveBeenCalledOnce()
    expect(detachAlpha).toHaveBeenCalledOnce()
    expect(attachBeta).toHaveBeenCalledOnce()
    expect(registry.getDiagnostics()).toEqual([
      expect.objectContaining({ id: 'beta', selected: true })
    ])
    controller.teardown()
  })

  it('prefers a declared selector and reports selector failures without throwing', async () => {
    const fallback = new FakeAdapter()
    const otherContainer = document.createElement('div')
    const otherButton = document.createElement('button')
    otherButton.className = 'player-toggle'
    const otherMedia = document.createElement('video')
    otherContainer.append(otherButton, otherMedia)
    document.body.append(otherContainer)
    const otherClicked = vi.fn()
    otherButton.addEventListener('click', otherClicked)

    const container = document.createElement('div')
    const button = document.createElement('button')
    button.className = 'player-toggle'
    const media = document.createElement('video')
    container.append(button, media)
    document.body.append(container)
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    const registry = new MediaAdapterRegistry({
      definitions: [
        definition('selector', 'example.com', 100, {
          play: ['[', '.player-toggle'],
          pause: ['.player-toggle']
        })
      ],
      fallback,
      url: () => 'https://example.com/'
    })
    const controller = registry.createController(media, context())

    await expect(controller.play()).resolves.toBeUndefined()
    expect(clicked).toHaveBeenCalledOnce()
    expect(otherClicked).not.toHaveBeenCalled()
    expect(fallback.controllers[0]?.play).not.toHaveBeenCalled()
    expect(registry.getDiagnostics()[0]).toMatchObject({ status: 'degraded', failureCount: 1 })
    controller.teardown()
  })
})
