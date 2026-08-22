export type LiveProbeViewport = Readonly<{
  width: number
  height: number
}>

export type ShadowProbeStatus = 'available' | 'probe-limited' | 'unknown'

export function canHostVisibleShadowUi(viewport: LiveProbeViewport): boolean {
  return (
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0
  )
}

export function isStaleFrameMessagingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:could not establish connection\. receiving end does not exist|no frame with id \d+|frame (?:with id \d+ )?was removed|the frame was removed)/i.test(
    message
  )
}

export function shadowProbeStatusForFrameFailure(
  error: unknown,
  isChildFrame: boolean
): Exclude<ShadowProbeStatus, 'available'> {
  if (isChildFrame) return 'probe-limited'
  const message = error instanceof Error ? error.message : String(error)
  return /(?:target|session|frame|context).*(?:closed|detached|removed|not found|given id)/i.test(
    message
  )
    ? 'probe-limited'
    : 'unknown'
}

export async function readFrameOrGlobalState<T>(
  frameId: number,
  readFrame: (frameId: number) => Promise<T>,
  readGlobal: () => Promise<T>
): Promise<T> {
  if (frameId === 0) return readGlobal()
  try {
    return await readFrame(frameId)
  } catch (error) {
    if (!isStaleFrameMessagingError(error)) throw error
    return readGlobal()
  }
}
