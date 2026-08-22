import type { SiteAdapterHookContext, SiteAdapterHooks } from '../registry'

const NETFLIX_RATE_CONTROL_SELECTORS = [
  'button.button-nfplayerPlaybackRate',
  'button.button-nfplayerSpeed',
  '[data-uia="player-speed-control"]',
  '[data-uia="controls-playback-rate"]',
  '[data-uia="control-playback-speed"]',
  '[data-uia="playback-speed-control"]'
] as const

const NETFLIX_SEEK_FORWARD_SELECTORS = [
  'button.button-nfplayerFastForward',
  '[data-uia="player-skip-forward"]'
] as const

const NETFLIX_SEEK_BACKWARD_SELECTORS = [
  'button.button-nfplayerBackTen',
  '[data-uia="player-skip-back"]'
] as const

function clickFirst(context: SiteAdapterHookContext, selectors: readonly string[]): boolean {
  for (const selector of selectors) {
    const element = context.querySelector(selector)
    if (!(element instanceof HTMLElement)) continue
    HTMLElement.prototype.click.call(element)
    return true
  }
  return false
}

function rateOptionSelectors(value: number): readonly string[] {
  const rate = String(value)
  return [
    `[data-playback-rate="${rate}"]`,
    `[data-rate="${rate}"]`,
    `[data-uia="player-speed-${rate}"]`,
    `[data-uia="playback-speed-${rate}"]`,
    `[data-uia="control-playback-speed-${rate}"]`,
    `[role="menuitemradio"][aria-label="${rate}x"]`
  ]
}

async function clickNetflixRate(context: SiteAdapterHookContext, value: number): Promise<boolean> {
  const options = rateOptionSelectors(value)
  if (clickFirst(context, options)) return true
  if (!clickFirst(context, NETFLIX_RATE_CONTROL_SELECTORS)) return false
  await Promise.resolve()
  return clickFirst(context, options)
}

export const NETFLIX_ADAPTER_HOOKS = Object.freeze({
  seekTo: (context: SiteAdapterHookContext, seconds: number) => {
    const currentTime = context.target.currentTime
    const selectors =
      seconds > currentTime ? NETFLIX_SEEK_FORWARD_SELECTORS : NETFLIX_SEEK_BACKWARD_SELECTORS
    if (seconds === currentTime || clickFirst(context, selectors)) return true
    throw new Error('Netflix native seek control unavailable')
  },
  setPlaybackRate: async (context: SiteAdapterHookContext, value: number) => {
    // Netflix does not expose its native speed menu on every surface (for
    // example, the public hero player). Returning false lets the controller
    // use its captured native setter while retaining native UI priority when
    // the menu is present.
    return clickNetflixRate(context, value)
  }
}) satisfies SiteAdapterHooks
