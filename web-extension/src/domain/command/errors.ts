import { failure, type Result } from '../../shared/result'
import type {
  CommandDiagnosticContext,
  CommandError,
  CommandErrorCode,
  CommandErrorMessageKey
} from './types'

const MESSAGE_KEYS: Record<CommandErrorCode, CommandErrorMessageKey> = {
  INVALID_COMMAND: 'command.error.invalidInput',
  COMMAND_NOT_REGISTERED: 'command.error.notRegistered',
  COMMAND_ALREADY_REGISTERED: 'command.error.alreadyRegistered',
  INVALID_COMMAND_HANDLER: 'command.error.invalidHandler',
  MEDIA_NOT_FOUND: 'command.error.mediaNotFound',
  MEDIA_UNAVAILABLE: 'command.error.mediaUnavailable',
  INVALID_MEDIA_SNAPSHOT: 'command.error.invalidMediaSnapshot',
  CAPABILITY_UNAVAILABLE: 'command.error.capabilityUnavailable',
  INVALID_COMMAND_RESULT: 'command.error.invalidResult',
  COMMAND_EXECUTION_FAILED: 'command.error.executionFailed',
  CAPTURE_NOT_READY: 'capture.error.notReady',
  CAPTURE_BLOCKED: 'capture.error.blocked',
  CAPTURE_TOO_LARGE: 'capture.error.tooLarge',
  CAPTURE_FAILED: 'capture.error.failed',
  DOWNLOAD_UNAVAILABLE: 'download.error.unavailable',
  DOWNLOAD_BLOCKED: 'download.error.blocked',
  DOWNLOAD_TOO_LARGE: 'download.error.tooLarge',
  DOWNLOAD_FAILED: 'download.error.failed',
  DOWNLOAD_CANCELLED: 'download.error.cancelled'
}

const SAFE_ERROR_NAMES = new Set([
  'AbortError',
  'Error',
  'InvalidStateError',
  'NotAllowedError',
  'NotSupportedError',
  'RangeError',
  'TypeError'
])

export function createCommandError(
  code: CommandErrorCode,
  context?: CommandDiagnosticContext
): CommandError {
  return context === undefined
    ? { code, messageKey: MESSAGE_KEYS[code] }
    : { code, messageKey: MESSAGE_KEYS[code], context }
}

export function commandFailure(
  code: CommandErrorCode,
  context?: CommandDiagnosticContext
): Result<never, CommandError> {
  return failure(createCommandError(code, context))
}

export function errorName(value: unknown): string {
  if (value instanceof Error && SAFE_ERROR_NAMES.has(value.name)) {
    return value.name
  }
  return 'UnknownError'
}
