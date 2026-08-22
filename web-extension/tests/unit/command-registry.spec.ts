import { describe, expect, it } from 'vitest'
import {
  CommandRegistry,
  commandFailure,
  commandSuccess,
  mediaCommandSchema,
  type CommandHandler,
  type PlayCommand
} from '../../src/domain/command'
import {
  createMediaCapabilities,
  type MediaController,
  type MediaControllerResolver,
  type MediaSnapshot
} from '../../src/domain/media'

function snapshot(
  overrides: Partial<Pick<MediaSnapshot, 'id' | 'state' | 'capabilities'>> = {}
): MediaSnapshot {
  return {
    id: overrides.id ?? 'media-1',
    frameId: 0,
    kind: 'video',
    state: overrides.state ?? 'paused',
    metrics: {
      width: 640,
      height: 360,
      duration: 100,
      currentTime: 10,
      volume: 0.5,
      playbackRate: 1,
      muted: false,
      visible: true
    },
    capabilities:
      overrides.capabilities ??
      createMediaCapabilities({
        playback: true,
        seek: true,
        playbackRate: true,
        volume: true,
        mute: true
      }),
    adapterId: 'fake',
    updatedAt: 1
  }
}

function controller(
  current: () => MediaSnapshot = () => snapshot(),
  capabilities = createMediaCapabilities({ playback: true })
): MediaController {
  return {
    mediaId: 'media-1',
    capabilities,
    getSnapshot: current,
    play: () => Promise.resolve(),
    pause: () => Promise.resolve(),
    seekTo: () => Promise.resolve(),
    setPlaybackRate: () => Promise.resolve(),
    setVolume: () => Promise.resolve(),
    setMuted: () => Promise.resolve()
  }
}

function resolver(value: MediaController | undefined): MediaControllerResolver {
  return { resolve: () => value }
}

const playHandler: CommandHandler<PlayCommand> = {
  type: 'media.play',
  requiredCapability: 'playback',
  execute(command, context) {
    return Promise.resolve(commandSuccess(command, context.snapshot, false))
  }
}

async function errorCode(result: ReturnType<CommandRegistry['dispatch']>) {
  const resolved = await result
  return resolved.ok ? null : resolved.error.code
}

describe('media command schema', () => {
  it('accepts the complete typed command surface', () => {
    const commands = [
      { type: 'media.play', mediaId: 'media-1' },
      { type: 'media.pause', mediaId: 'media-1' },
      { type: 'media.seek', mediaId: 'media-1', deltaSeconds: -5 },
      { type: 'media.set-rate', mediaId: 'media-1', value: 2 },
      { type: 'media.adjust-rate', mediaId: 'media-1', delta: 0.1 },
      { type: 'media.set-volume', mediaId: 'media-1', value: 0.8 },
      { type: 'media.adjust-volume', mediaId: 'media-1', delta: -0.05 },
      { type: 'media.set-muted', mediaId: 'media-1', value: true },
      { type: 'media.toggle-mute', mediaId: 'media-1' }
    ]
    expect(commands.every((command) => mediaCommandSchema.safeParse(command).success)).toBe(true)
  })

  it('rejects unknown fields, unknown commands, malformed IDs, and non-finite numbers', () => {
    const invalid = [
      { type: 'media.play', mediaId: 'media-1', script: 'alert(1)' },
      { type: 'media.delete', mediaId: 'media-1' },
      { type: 'media.play', mediaId: '' },
      { type: 'media.seek', mediaId: 'media-1', deltaSeconds: Number.NaN },
      { type: 'media.set-volume', mediaId: 'media-1', value: Number.POSITIVE_INFINITY },
      { type: 'media.set-muted', mediaId: 'media-1', value: 1 }
    ]
    expect(invalid.every((command) => !mediaCommandSchema.safeParse(command).success)).toBe(true)
  })
})

describe('CommandRegistry', () => {
  it('registers, lists, rejects duplicates, and unregisters handlers predictably', async () => {
    const registry = new CommandRegistry(resolver(controller()))
    expect(registry.register(playHandler)).toEqual({ ok: true, value: undefined })
    expect(registry.has('media.play')).toBe(true)
    expect(registry.registeredTypes()).toEqual(['media.play'])
    expect(registry.register(playHandler)).toMatchObject({
      ok: false,
      error: { code: 'COMMAND_ALREADY_REGISTERED' }
    })
    const invalidHandler = {
      ...playHandler,
      type: 'media.invalid'
    } as unknown as CommandHandler
    expect(registry.register(invalidHandler)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_COMMAND_HANDLER' }
    })
    expect(() => new CommandRegistry(resolver(controller()), [playHandler, playHandler])).toThrow(
      'COMMAND_ALREADY_REGISTERED'
    )
    expect(registry.unregister('media.play')).toBe(true)
    expect(registry.unregister('media.play')).toBe(false)
    expect(await errorCode(registry.execute({ type: 'media.play', mediaId: 'media-1' }))).toBe(
      'COMMAND_NOT_REGISTERED'
    )
  })

  it('returns stable errors for invalid input, missing media, and unavailable state', async () => {
    const missing = new CommandRegistry(resolver(undefined), [playHandler])
    expect(await errorCode(missing.dispatch({ type: 'media.play', mediaId: '' }))).toBe(
      'INVALID_COMMAND'
    )
    expect(await errorCode(missing.dispatch({ type: 'media.play', mediaId: 'media-1' }))).toBe(
      'MEDIA_NOT_FOUND'
    )

    const removed = new CommandRegistry(
      resolver(controller(() => snapshot({ state: 'removed' }))),
      [playHandler]
    )
    expect(await errorCode(removed.dispatch({ type: 'media.play', mediaId: 'media-1' }))).toBe(
      'MEDIA_UNAVAILABLE'
    )
  })

  it('checks declared capabilities before invoking a handler', async () => {
    let calls = 0
    const handler: CommandHandler<PlayCommand> = {
      ...playHandler,
      execute(command, context) {
        calls += 1
        return Promise.resolve(commandSuccess(command, context.snapshot, false))
      }
    }
    const noPlayback = controller(() =>
      snapshot({ capabilities: createMediaCapabilities({ playback: false }) })
    )
    const registry = new CommandRegistry(resolver(noPlayback), [handler])
    const result = await registry.dispatch({ type: 'media.play', mediaId: 'media-1' })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'CAPABILITY_UNAVAILABLE',
        context: { capability: 'playback' }
      }
    })
    expect(calls).toBe(0)

    const unrestrictedHandler: CommandHandler<PlayCommand> = {
      type: 'media.play',
      execute(command, context) {
        return Promise.resolve(commandSuccess(command, context.snapshot, false))
      }
    }
    const unrestricted = new CommandRegistry(resolver(noPlayback), [unrestrictedHandler])
    expect(
      await successOrError(unrestricted.dispatch({ type: 'media.play', mediaId: 'media-1' }))
    ).toBe('success')
  })

  it('rejects controller and snapshot identity mismatches', async () => {
    const wrongController = { ...controller(), mediaId: 'media-2' }
    const controllerMismatch = new CommandRegistry(resolver(wrongController), [playHandler])
    expect(
      await errorCode(controllerMismatch.dispatch({ type: 'media.play', mediaId: 'media-1' }))
    ).toBe('MEDIA_NOT_FOUND')

    const wrongSnapshot = controller(() => snapshot({ id: 'media-2' }))
    const snapshotMismatch = new CommandRegistry(resolver(wrongSnapshot), [playHandler])
    expect(
      await errorCode(snapshotMismatch.dispatch({ type: 'media.play', mediaId: 'media-1' }))
    ).toBe('INVALID_MEDIA_SNAPSHOT')

    const invalidSnapshot = controller(() => ({
      ...snapshot(),
      metrics: { ...snapshot().metrics, volume: 2 }
    }))
    const invalidShape = new CommandRegistry(resolver(invalidSnapshot), [playHandler])
    expect(await errorCode(invalidShape.dispatch({ type: 'media.play', mediaId: 'media-1' }))).toBe(
      'INVALID_MEDIA_SNAPSHOT'
    )
  })

  it('converts resolver, snapshot, and handler exceptions into serializable errors', async () => {
    const throwingResolver = new CommandRegistry(
      {
        resolve() {
          throw new Error('secret resolver details')
        }
      },
      [playHandler]
    )
    const throwingSnapshot = new CommandRegistry(
      resolver(
        controller(() => {
          throw new RangeError('secret snapshot details')
        })
      ),
      [playHandler]
    )
    const throwingHandler = new CommandRegistry(resolver(controller()), [
      {
        ...playHandler,
        execute: () => Promise.reject(new TypeError('secret execution details'))
      }
    ])
    const customNamedError = new Error('secret custom details')
    customNamedError.name = 'SecretTokenError'
    const customErrorHandler = new CommandRegistry(resolver(controller()), [
      {
        ...playHandler,
        execute: () => Promise.reject(customNamedError)
      }
    ])

    const results = await Promise.all([
      throwingResolver.dispatch({ type: 'media.play', mediaId: 'media-1' }),
      throwingSnapshot.dispatch({ type: 'media.play', mediaId: 'media-1' }),
      throwingHandler.dispatch({ type: 'media.play', mediaId: 'media-1' }),
      customErrorHandler.dispatch({ type: 'media.play', mediaId: 'media-1' })
    ])
    expect(results.map((result) => (result.ok ? null : result.error.code))).toEqual([
      'COMMAND_EXECUTION_FAILED',
      'COMMAND_EXECUTION_FAILED',
      'COMMAND_EXECUTION_FAILED',
      'COMMAND_EXECUTION_FAILED'
    ])
    expect(results[3]).toMatchObject({
      ok: false,
      error: { context: { cause: 'UnknownError' } }
    })
    expect(JSON.stringify(results)).not.toContain('secret')
  })

  it('normalizes handler failures and rejects success identity mismatches', async () => {
    const failureHandler: CommandHandler<PlayCommand> = {
      ...playHandler,
      execute: () => Promise.resolve(commandFailure('MEDIA_UNAVAILABLE', { state: 'paused' }))
    }
    const failed = new CommandRegistry(resolver(controller()), [failureHandler])
    expect(await failed.dispatch({ type: 'media.play', mediaId: 'media-1' })).toEqual({
      ok: false,
      error: {
        code: 'MEDIA_UNAVAILABLE',
        messageKey: 'command.error.mediaUnavailable',
        context: { state: 'paused' }
      }
    })

    const mismatchedHandler: CommandHandler<PlayCommand> = {
      ...playHandler,
      execute(command, context) {
        const result = commandSuccess(command, context.snapshot, false)
        return Promise.resolve({
          ok: true,
          value: { ...result.value, mediaId: 'media-2' }
        })
      }
    }
    const mismatched = new CommandRegistry(resolver(controller()), [mismatchedHandler])
    expect(await errorCode(mismatched.dispatch({ type: 'media.play', mediaId: 'media-1' }))).toBe(
      'INVALID_COMMAND_RESULT'
    )
  })

  it('validates handler results before returning them', async () => {
    const malformedHandler: CommandHandler<PlayCommand> = {
      ...playHandler,
      execute(command, context) {
        return Promise.resolve({
          ...commandSuccess(command, context.snapshot, false),
          extra: true
        })
      }
    }
    const registry = new CommandRegistry(resolver(controller()), [malformedHandler])
    expect(await errorCode(registry.dispatch({ type: 'media.play', mediaId: 'media-1' }))).toBe(
      'INVALID_COMMAND_RESULT'
    )
  })
})

async function successOrError(result: ReturnType<CommandRegistry['dispatch']>) {
  const resolved = await result
  return resolved.ok ? 'success' : resolved.error.code
}
