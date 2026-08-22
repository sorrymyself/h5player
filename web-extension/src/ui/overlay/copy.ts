import type { OverlayLocale, OverlayMediaKind, OverlayPlaybackState, OverlayState } from './model'

const overlayCopy = {
  'zh-CN': {
    panelLabel: 'H5Player 页面媒体控制',
    kicker: '当前媒体',
    close: '关闭控制层',
    retry: '重试',
    loadingTitle: '正在连接媒体',
    loadingDetail: '正在读取当前页面的可控媒体状态。',
    emptyTitle: '暂未发现媒体',
    emptyDetail: '开始播放页面中的视频或音频后可再次尝试。',
    errorTitle: '媒体控制暂不可用',
    errorDetail: '连接当前媒体时出现问题。',
    unsupportedTitle: '当前媒体不支持控制',
    unsupportedDetail: '此播放器没有暴露可安全调用的控制能力。',
    video: '视频',
    audio: '音频',
    customVideo: '站点视频',
    playing: '播放中',
    paused: '已暂停',
    buffering: '缓冲中',
    ended: '已结束',
    play: '播放媒体',
    pause: '暂停媒体',
    seekBack: '后退 10 秒',
    seekForward: '前进 10 秒',
    timeline: '播放进度',
    unknownDuration: '时长未知',
    playbackRate: '播放速度',
    rateDown: '降低播放速度',
    rateUp: '提高播放速度',
    volume: '音量',
    mute: '静音',
    unmute: '取消静音',
    visual: '画面',
    zoomOut: '缩小画面',
    zoomIn: '放大画面',
    resetVisual: '重置画面',
    fullscreen: '进入全屏',
    exitFullscreen: '退出全屏',
    pictureInPicture: '进入画中画',
    exitPictureInPicture: '退出画中画',
    capture: '截取当前画面',
    download: '下载媒体',
    experimental: '实验性',
    busy: '操作处理中',
    unsupportedAction: '当前媒体不支持此操作',
    keyboardHint: '快捷键：K 播放/暂停 · ←/→ 快退/快进 · Esc 关闭'
  },
  'en-US': {
    panelLabel: 'H5Player page media controls',
    kicker: 'Active media',
    close: 'Close controls',
    retry: 'Retry',
    loadingTitle: 'Connecting to media',
    loadingDetail: 'Reading controllable media state from this page.',
    emptyTitle: 'No media found',
    emptyDetail: 'Start a video or audio track on the page, then try again.',
    errorTitle: 'Media controls unavailable',
    errorDetail: 'A problem occurred while connecting to the current media.',
    unsupportedTitle: 'This media cannot be controlled',
    unsupportedDetail: 'The player exposes no control capabilities that can be used safely.',
    video: 'Video',
    audio: 'Audio',
    customVideo: 'Site video',
    playing: 'Playing',
    paused: 'Paused',
    buffering: 'Buffering',
    ended: 'Ended',
    play: 'Play media',
    pause: 'Pause media',
    seekBack: 'Seek back 10 seconds',
    seekForward: 'Seek forward 10 seconds',
    timeline: 'Playback position',
    unknownDuration: 'Unknown duration',
    playbackRate: 'Playback rate',
    rateDown: 'Decrease playback rate',
    rateUp: 'Increase playback rate',
    volume: 'Volume',
    mute: 'Mute',
    unmute: 'Unmute',
    visual: 'Picture',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    resetVisual: 'Reset picture',
    fullscreen: 'Enter fullscreen',
    exitFullscreen: 'Exit fullscreen',
    pictureInPicture: 'Enter picture-in-picture',
    exitPictureInPicture: 'Exit picture-in-picture',
    capture: 'Capture current frame',
    download: 'Download media',
    experimental: 'Experimental',
    busy: 'Operation in progress',
    unsupportedAction: 'This media does not support the action',
    keyboardHint: 'Shortcuts: K play/pause · ←/→ seek · Esc close'
  }
} as const

export type OverlayCopy = (typeof overlayCopy)[OverlayLocale]

export function getOverlayCopy(locale: OverlayLocale): OverlayCopy {
  return overlayCopy[locale]
}

export function stateTitle(copy: OverlayCopy, state: OverlayState): string {
  const titles = {
    loading: copy.loadingTitle,
    empty: copy.emptyTitle,
    ready: copy.panelLabel,
    error: copy.errorTitle,
    unsupported: copy.unsupportedTitle
  } as const
  return titles[state]
}

export function stateDetail(copy: OverlayCopy, state: OverlayState): string {
  const details = {
    loading: copy.loadingDetail,
    empty: copy.emptyDetail,
    ready: copy.panelLabel,
    error: copy.errorDetail,
    unsupported: copy.unsupportedDetail
  } as const
  return details[state]
}

export function mediaKindLabel(copy: OverlayCopy, kind: OverlayMediaKind): string {
  const labels = { video: copy.video, audio: copy.audio, 'custom-video': copy.customVideo } as const
  return labels[kind]
}

export function playbackStateLabel(copy: OverlayCopy, state: OverlayPlaybackState): string {
  const labels = {
    playing: copy.playing,
    paused: copy.paused,
    buffering: copy.buffering,
    ended: copy.ended
  } as const
  return labels[state]
}
