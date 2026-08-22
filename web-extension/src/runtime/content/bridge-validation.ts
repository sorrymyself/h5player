import { parseBridgeMessage, type BridgeMessage } from '../../shared/protocol'
import {
  parsePageMediaMessage,
  type PageMediaMessage
} from '../../infrastructure/messaging/page-media-protocol'

export type BridgeSession = {
  sessionId: string
  nonce: string
  origin: string
}

export function validateBridgeEvent(
  event: Pick<MessageEvent<unknown>, 'data' | 'origin' | 'source'>,
  currentWindow: Window,
  session: BridgeSession,
  expectedSource: BridgeMessage['source']
): BridgeMessage | null {
  if (event.source !== currentWindow || event.origin !== session.origin) return null
  const message = parseBridgeMessage(event.data)
  if (
    !message ||
    message.source !== expectedSource ||
    message.sessionId !== session.sessionId ||
    message.nonce !== session.nonce
  ) {
    return null
  }
  return message
}

export function validatePageMediaEvent(
  event: Pick<MessageEvent<unknown>, 'data' | 'origin' | 'source'>,
  currentWindow: Window,
  session: BridgeSession,
  expectedSource: PageMediaMessage['source']
): PageMediaMessage | null {
  if (event.source !== currentWindow || event.origin !== session.origin) return null
  const message = parsePageMediaMessage(event.data)
  if (
    !message ||
    message.source !== expectedSource ||
    message.sessionId !== session.sessionId ||
    message.nonce !== session.nonce
  ) {
    return null
  }
  return message
}
