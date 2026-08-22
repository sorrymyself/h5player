import type { SiteAdapterHooks } from '../registry'
import { NETFLIX_ADAPTER_HOOKS } from './netflix-hooks'
import { TENCENT_VIDEO_ADAPTER_HOOKS } from './tencent-video-hooks'

export const SITE_ADAPTER_HOOKS = Object.freeze({
  netflix: NETFLIX_ADAPTER_HOOKS,
  'tencent-video': TENCENT_VIDEO_ADAPTER_HOOKS
}) satisfies Readonly<Record<string, SiteAdapterHooks>>
