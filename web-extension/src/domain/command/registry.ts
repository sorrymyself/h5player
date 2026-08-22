import { failure, success, type Result } from '../../shared/result'
import {
  isControllableMediaState,
  mediaSnapshotSchema,
  type MediaControllerResolver,
  type MediaId
} from '../media'
import { commandFailure, createCommandError, errorName } from './errors'
import {
  MEDIA_COMMAND_TYPES,
  mediaCommandSchema,
  commandResultSchema,
  type CommandError,
  type CommandHandler,
  type CommandResult,
  type CommandSuccess,
  type MediaCommand,
  type MediaCommandType,
  type ResolvedCommandContext
} from './types'

type StoredCommandHandler = CommandHandler<MediaCommand>

const COMMAND_TYPE_SET = new Set<string>(MEDIA_COMMAND_TYPES)

export class CommandRegistry {
  private readonly handlers = new Map<MediaCommandType, StoredCommandHandler>()
  private readonly pendingByMedia = new Map<MediaId, Promise<void>>()

  constructor(
    private readonly controllers: MediaControllerResolver,
    handlers: readonly CommandHandler[] = []
  ) {
    for (const handler of handlers) {
      const result = this.register(handler)
      if (!result.ok) {
        throw new TypeError(result.error.code)
      }
    }
  }

  register<C extends MediaCommand>(handler: CommandHandler<C>): Result<void, CommandError> {
    if (!COMMAND_TYPE_SET.has(handler.type)) {
      return failure(
        createCommandError('INVALID_COMMAND_HANDLER', {
          commandType: String(handler.type)
        })
      )
    }
    if (this.handlers.has(handler.type)) {
      return failure(
        createCommandError('COMMAND_ALREADY_REGISTERED', {
          commandType: handler.type
        })
      )
    }
    this.handlers.set(handler.type, handler)
    return success(undefined)
  }

  unregister(type: MediaCommandType): boolean {
    return this.handlers.delete(type)
  }

  has(type: MediaCommandType): boolean {
    return this.handlers.has(type)
  }

  registeredTypes(): readonly MediaCommandType[] {
    return [...this.handlers.keys()]
  }

  execute(input: unknown): Promise<CommandResult> {
    return this.dispatch(input)
  }

  async dispatch(input: unknown): Promise<CommandResult> {
    const parsed = mediaCommandSchema.safeParse(input)
    if (!parsed.success) {
      return commandFailure('INVALID_COMMAND', {
        issueCount: parsed.error.issues.length
      })
    }

    const command = parsed.data
    const handler = this.handlers.get(command.type)
    if (handler === undefined) {
      return commandFailure('COMMAND_NOT_REGISTERED', { commandType: command.type })
    }

    return this.enqueue(command, handler)
  }

  private enqueue(command: MediaCommand, handler: StoredCommandHandler): Promise<CommandResult> {
    const previous = this.pendingByMedia.get(command.mediaId) ?? Promise.resolve()
    const run = previous.then(() => this.executeCommand(command, handler))
    const guarded = run.catch((error: unknown) =>
      commandFailure('COMMAND_EXECUTION_FAILED', {
        commandType: command.type,
        mediaId: command.mediaId,
        phase: 'registry',
        cause: errorName(error)
      })
    )
    const tail = guarded.then(() => undefined)
    this.pendingByMedia.set(command.mediaId, tail)
    return guarded.finally(() => {
      if (this.pendingByMedia.get(command.mediaId) === tail) {
        this.pendingByMedia.delete(command.mediaId)
      }
    })
  }

  private async executeCommand(
    command: MediaCommand,
    handler: StoredCommandHandler
  ): Promise<CommandResult> {
    let controller
    try {
      controller = this.controllers.resolve(command.mediaId)
    } catch (error) {
      return commandFailure('COMMAND_EXECUTION_FAILED', {
        commandType: command.type,
        mediaId: command.mediaId,
        phase: 'resolve',
        cause: errorName(error)
      })
    }
    if (controller === undefined) {
      return commandFailure('MEDIA_NOT_FOUND', { mediaId: command.mediaId })
    }
    if (controller.mediaId !== command.mediaId) {
      return commandFailure('MEDIA_NOT_FOUND', {
        mediaId: command.mediaId,
        phase: 'identity'
      })
    }

    let rawSnapshot: unknown
    try {
      rawSnapshot = controller.getSnapshot()
    } catch (error) {
      return commandFailure('COMMAND_EXECUTION_FAILED', {
        commandType: command.type,
        mediaId: command.mediaId,
        phase: 'snapshot-before',
        cause: errorName(error)
      })
    }
    const before = mediaSnapshotSchema.safeParse(rawSnapshot)
    if (!before.success) {
      return commandFailure('INVALID_MEDIA_SNAPSHOT', {
        mediaId: command.mediaId,
        issueCount: before.error.issues.length,
        phase: 'before'
      })
    }
    if (before.data.id !== command.mediaId) {
      return commandFailure('INVALID_MEDIA_SNAPSHOT', {
        mediaId: command.mediaId,
        phase: 'identity'
      })
    }
    if (!isControllableMediaState(before.data.state)) {
      return commandFailure('MEDIA_UNAVAILABLE', {
        mediaId: command.mediaId,
        state: before.data.state
      })
    }
    if (
      handler.requiredCapability !== undefined &&
      !before.data.capabilities[handler.requiredCapability]
    ) {
      return commandFailure('CAPABILITY_UNAVAILABLE', {
        mediaId: command.mediaId,
        capability: handler.requiredCapability
      })
    }

    const context: ResolvedCommandContext = {
      controller,
      snapshot: before.data
    }
    let result: CommandResult
    try {
      result = await handler.execute(command, context)
    } catch (error) {
      return commandFailure('COMMAND_EXECUTION_FAILED', {
        commandType: command.type,
        mediaId: command.mediaId,
        phase: 'execute',
        cause: errorName(error)
      })
    }
    const parsedResult = commandResultSchema.safeParse(result)
    if (!parsedResult.success) {
      return commandFailure('INVALID_COMMAND_RESULT', {
        commandType: command.type,
        mediaId: command.mediaId,
        issueCount: parsedResult.error.issues.length,
        phase: 'shape'
      })
    }
    if (!parsedResult.data.ok) {
      return failure(
        createCommandError(parsedResult.data.error.code, parsedResult.data.error.context)
      )
    }

    const checked = this.validateSuccess(command, parsedResult.data.value)
    return checked.ok ? success(checked.value) : failure(checked.error)
  }

  private validateSuccess(
    command: MediaCommand,
    value: CommandSuccess
  ): Result<CommandSuccess, CommandError> {
    if (
      value.commandType !== command.type ||
      value.mediaId !== command.mediaId ||
      value.snapshot.id !== command.mediaId
    ) {
      return failure(
        createCommandError('INVALID_COMMAND_RESULT', {
          commandType: command.type,
          mediaId: command.mediaId,
          phase: 'identity'
        })
      )
    }
    return success(value)
  }
}
