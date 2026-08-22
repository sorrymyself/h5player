import type { Locale } from '../i18n/messages'

const mediaMessages = {
  popup: {
    play: ['播放', 'Play'],
    pause: ['暂停', 'Pause'],
    seekBack: ['后退 10 秒', 'Back 10 sec'],
    seekForward: ['前进 10 秒', 'Forward 10 sec'],
    mute: ['静音', 'Mute'],
    unmute: ['取消静音', 'Unmute'],
    speed: ['速度', 'Speed'],
    audioGain: ['音量增益', 'Audio gain'],
    rateScope: ['倍速应用范围', 'Playback rate scope']
  },
  scope: {
    site: ['锁定本站', 'Lock this site'],
    page: ['仅本页', 'This page only'],
    media: ['仅当前媒体', 'Current media only']
  },
  mediaControls: {
    open: ['打开媒体快捷控制', 'Open media quick controls'],
    hideMedia: ['隐藏当前媒体控件', 'Hide controls for this media'],
    hidePage: ['临时隐藏本页控件', 'Temporarily hide page controls'],
    cancelDownload: ['取消等待下载', 'Cancel pending download']
  },
  feedback: {
    playbackRate: ['播放速度 {value}×', 'Playback speed {value}×'],
    playbackRateRestored: ['已恢复到 {value}×', 'Restored to {value}×'],
    playbackRateProtectionDisabled: [
      '网站已修改速度；当前未开启保护',
      'The site changed speed; protection is currently off'
    ],
    playbackRateProtectionExhausted: [
      '网站持续重置速度，已停止重复尝试',
      'The site keeps resetting speed; repeated attempts stopped'
    ],
    volume: ['音量 {value}%', 'Volume {value}%'],
    audioGain: ['音量增益 {value}×', 'Audio gain {value}×'],
    seekForward: ['前进 {value} 秒', 'Forward {value} sec'],
    seekBackward: ['后退 {value} 秒', 'Back {value} sec'],
    played: ['已播放', 'Playing'],
    paused: ['已暂停', 'Paused'],
    muted: ['已静音', 'Muted'],
    unmuted: ['已取消静音', 'Unmuted'],
    zoom: ['画面缩放 {value}×', 'Zoom {value}×'],
    rotation: ['画面旋转 {value}°', 'Rotated {value}°'],
    frameForward: ['前进 {value} 帧', 'Forward {value} frame(s)'],
    frameBackward: ['后退 {value} 帧', 'Back {value} frame(s)'],
    pan: ['画面位置 {value}', 'Position {value}'],
    flipHorizontalOn: ['水平镜像已开启', 'Horizontal mirror on'],
    flipHorizontalOff: ['水平镜像已关闭', 'Horizontal mirror off'],
    flipVerticalOn: ['垂直镜像已开启', 'Vertical mirror on'],
    flipVerticalOff: ['垂直镜像已关闭', 'Vertical mirror off'],
    brightness: ['亮度 {value}', 'Brightness {value}'],
    contrast: ['对比度 {value}', 'Contrast {value}'],
    saturation: ['饱和度 {value}', 'Saturation {value}'],
    hue: ['色相 {value}°', 'Hue {value}°'],
    blur: ['模糊 {value}px', 'Blur {value}px'],
    transformReset: ['画面变换已重置', 'Transform reset'],
    visualReset: ['画面效果已全部重置', 'All visual effects reset'],
    fullscreen: ['全屏状态已切换', 'Fullscreen state changed'],
    pictureInPicture: ['画中画状态已切换', 'Picture-in-picture state changed'],
    capture: ['截图已生成', 'Capture created'],
    downloadStarted: ['下载已开始', 'Download started'],
    downloadQueued: ['媒体结束后将自动下载', 'Download will start when the media ends'],
    downloadCancelled: ['已取消等待中的媒体下载', 'Pending media download cancelled'],
    playNext: ['已切换到下一集', 'Playing next episode'],
    restoreProgressEnabled: ['本站已启用播放进度恢复', 'Progress restore enabled for this site'],
    restoreProgressDisabled: ['本站已关闭播放进度恢复', 'Progress restore disabled for this site'],
    restoreProgressFailed: ['播放进度恢复设置未能更新', 'Could not update progress restore'],
    actionUnavailable: ['操作未完成', 'Action unavailable'],
    applied: ['操作已生效', 'Applied']
  },
  mediaDownload: {
    confirmTitle: ['确认媒体下载', 'Confirm media download'],
    filename: ['文件名', 'Filename'],
    filenameIndexed: ['文件 {value}', 'File {value}'],
    alreadyDownloading: [
      '同一媒体正在下载，继续会重复保存。',
      'The same media is already downloading. Continuing will save another copy.'
    ],
    alreadyDownloaded: [
      '同一媒体已下载过，继续会再次保存。',
      'The same media was downloaded before. Continuing will save it again.'
    ],
    cancel: ['取消', 'Cancel'],
    download: ['下载', 'Download'],
    downloadAgain: ['再次下载', 'Download again']
  },
  'policy.source': {
    'product-default': ['产品默认', 'Product default'],
    'global-setting': ['全局默认', 'Global default'],
    'site-rule': ['本站策略', 'Site policy'],
    'page-session': ['本页临时', 'Page session'],
    'media-session': ['当前媒体', 'Current media']
  },
  policy: {
    protected: ['保护已开', 'Protection on'],
    unprotected: ['保护未开', 'Protection off']
  },
  a11y: {
    mediaControls: ['媒体控制', 'Media controls']
  }
} as const satisfies Record<string, Record<string, readonly [string, string]>>

export type MediaLocale = Locale
type MediaMessageGroups = typeof mediaMessages
type MediaMessageGroupName = Extract<keyof MediaMessageGroups, string>
export type MediaMessageKey = {
  [Group in MediaMessageGroupName]: `${Group}.${Extract<keyof MediaMessageGroups[Group], string>}`
}[MediaMessageGroupName]

export function translateMedia(
  locale: MediaLocale,
  key: MediaMessageKey,
  params: Readonly<Record<string, string | number>> = {}
): string {
  const separator = key.lastIndexOf('.')
  const group = key.slice(0, separator) as keyof MediaMessageGroups
  const name = key.slice(separator + 1)
  const template =
    (mediaMessages[group] as Readonly<Record<string, readonly [string, string]>>)[name]?.[
      locale === 'zh-CN' ? 0 : 1
    ] ?? key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

export function formatMediaNumber(
  value: number,
  locale: MediaLocale,
  maximumFractionDigits = 2
): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}
