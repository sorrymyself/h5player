import type { RuntimeTransportPort, SchedulerPort } from '../../application/ports/browser'
import {
  createRuntimeRequest,
  parseRuntimeResponse,
  type EnvelopeContext,
  type ProtocolErrorCode,
  type RuntimeClientSource,
  type RuntimeRequestEnvelope,
  type RuntimeRequestType
} from '../../shared/protocol'

export interface SafeParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

export type RuntimeRequestOptions = {
  timeoutMs?: number
  signal?: AbortSignal
}

export class RuntimeRequestError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'RuntimeRequestError'
  }
}

export class RuntimeRequestClient {
  constructor(
    private readonly source: RuntimeClientSource,
    private readonly transport: RuntimeTransportPort,
    private readonly scheduler: SchedulerPort,
    private readonly context: EnvelopeContext = {}
  ) {}

  async request<T>(
    type: RuntimeRequestType,
    payload: unknown,
    responseParser: SafeParser<T>,
    options: RuntimeRequestOptions = {}
  ): Promise<T> {
    if (options.signal?.aborted) {
      throw new RuntimeRequestError('REQUEST_CANCELLED', false, 'Request was cancelled')
    }

    const maxAttempts = this.transport.reconnect ? 2 : 1
    let lastError: RuntimeRequestError | null = null

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const request = createRuntimeRequest(this.source, type, payload, this.context)
      try {
        return await this.execute(request, responseParser, options)
      } catch (error) {
        const normalized =
          error instanceof RuntimeRequestError
            ? error
            : new RuntimeRequestError(
                'TRANSPORT_UNAVAILABLE',
                true,
                error instanceof Error ? error.message : 'Runtime transport failed'
              )
        lastError = normalized

        const shouldReconnect =
          normalized.code === 'TRANSPORT_UNAVAILABLE' &&
          normalized.retryable &&
          attempt + 1 < maxAttempts
        if (!shouldReconnect || !this.transport.reconnect) throw normalized
        await this.transport.reconnect()
      }
    }

    throw (
      lastError ??
      new RuntimeRequestError('TRANSPORT_UNAVAILABLE', true, 'Runtime transport unavailable')
    )
  }

  private async execute<T>(
    request: RuntimeRequestEnvelope,
    responseParser: SafeParser<T>,
    options: RuntimeRequestOptions
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 5_000
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null
    let abortListener: (() => void) | null = null

    const guard = new Promise<never>((_resolve, reject) => {
      timeoutHandle = this.scheduler.setTimeout(() => {
        void this.cancel(request)
        reject(new RuntimeRequestError('REQUEST_TIMEOUT', true, 'Runtime request timed out'))
      }, timeoutMs)

      if (options.signal) {
        abortListener = () => {
          void this.cancel(request)
          reject(new RuntimeRequestError('REQUEST_CANCELLED', false, 'Request was cancelled'))
        }
        options.signal.addEventListener('abort', abortListener, { once: true })
      }
    })

    try {
      const rawResponse = await Promise.race([this.transport.send(request), guard])
      const response = parseRuntimeResponse(rawResponse)
      if (
        !response ||
        response.requestId !== request.requestId ||
        response.payload.requestType !== request.type ||
        (this.context.sessionId !== undefined && response.sessionId !== this.context.sessionId)
      ) {
        throw new RuntimeRequestError('INVALID_ENVELOPE', false, 'Invalid runtime response')
      }

      if (response.type === 'protocol.error') {
        throw new RuntimeRequestError(
          response.payload.error.code,
          response.payload.error.retryable,
          response.payload.error.messageKey
        )
      }

      const parsed = responseParser.safeParse(response.payload.data)
      if (!parsed.success) {
        throw new RuntimeRequestError('INVALID_PAYLOAD', false, 'Invalid response payload')
      }
      return parsed.data
    } catch (error) {
      if (error instanceof RuntimeRequestError) throw error
      throw new RuntimeRequestError(
        'TRANSPORT_UNAVAILABLE',
        true,
        error instanceof Error ? error.message : 'Runtime transport failed'
      )
    } finally {
      if (timeoutHandle) this.scheduler.clearTimeout(timeoutHandle)
      if (options.signal && abortListener) {
        options.signal.removeEventListener('abort', abortListener)
      }
    }
  }

  private async cancel(request: RuntimeRequestEnvelope): Promise<void> {
    const cancellation = createRuntimeRequest(
      this.source,
      'protocol.cancel',
      { targetRequestId: request.requestId },
      this.context
    )
    try {
      await this.transport.send(cancellation)
    } catch {
      // The original request already owns the user-visible error path.
    }
  }
}
