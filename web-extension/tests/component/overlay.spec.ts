import axe from 'axe-core'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import MediaOverlay from '../../src/ui/overlay/MediaOverlay.vue'
import type {
  OverlayCapabilitiesViewModel,
  OverlayEvent,
  OverlayState,
  OverlayViewModel
} from '../../src/ui/overlay/model'

const allCapabilities: OverlayCapabilitiesViewModel = {
  playback: true,
  seek: true,
  playbackRate: true,
  volume: true,
  mute: true,
  visual: true,
  fullscreen: true,
  pictureInPicture: true,
  capture: true,
  download: true
}

function readyModel(overrides: Partial<OverlayViewModel> = {}): OverlayViewModel {
  return {
    version: 1,
    open: true,
    locale: 'zh-CN',
    theme: 'dark',
    state: 'ready',
    media: {
      id: 'media-0-1',
      label: '示例视频',
      kind: 'video',
      playbackState: 'paused',
      currentTimeSeconds: 30,
      durationSeconds: 120,
      playbackRate: 1.25,
      volume: 0.6,
      muted: false,
      zoom: 1.1,
      fullscreen: false,
      pictureInPicture: false
    },
    capabilities: allCapabilities,
    busyControls: [],
    statusDetail: null,
    notice: { tone: 'success', message: '状态已同步' },
    ...overrides
  }
}

function stateModel(state: Exclude<OverlayState, 'ready'>): OverlayViewModel {
  return readyModel({ state, media: null, notice: null })
}

function renderOverlay(model = readyModel()) {
  const events: OverlayEvent[] = []
  const rendered = render(MediaOverlay, {
    props: {
      model,
      onIntent: (event: OverlayEvent) => events.push(event)
    }
  })
  return { events, ...rendered }
}

describe('MediaOverlay', () => {
  it('renders a serializable ready view model, focuses the primary action, and passes axe', async () => {
    const model = readyModel()
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)

    const { container } = renderOverlay(model)
    const play = screen.getByRole('button', { name: '播放媒体' })
    await waitFor(() => expect(globalThis.document.activeElement).toBe(play))

    expect(screen.getByRole('dialog', { name: '示例视频' })).toBeTruthy()
    expect(screen.getByText('0:30')).toBeTruthy()
    expect(screen.getByText('2:00')).toBeTruthy()
    expect(screen.getByText('1.25×')).toBeTruthy()
    expect(screen.getByText('110%')).toBeTruthy()

    const result = await axe.run(container)
    expect(result.violations).toEqual([])
  })

  it('emits versioned, serializable intents for every presentation control group', async () => {
    const { events } = renderOverlay()

    await fireEvent.click(screen.getByRole('button', { name: '播放媒体' }))
    await fireEvent.click(screen.getByRole('button', { name: '后退 10 秒' }))
    await fireEvent.input(screen.getByRole('slider', { name: '播放进度' }), {
      target: { value: '45' }
    })
    await fireEvent.click(screen.getByRole('button', { name: '提高播放速度' }))
    await fireEvent.input(screen.getByRole('slider', { name: '音量' }), {
      target: { value: '35' }
    })
    await fireEvent.click(screen.getByRole('button', { name: '静音' }))
    await fireEvent.click(screen.getByRole('button', { name: '放大画面' }))
    await fireEvent.click(screen.getByRole('button', { name: '重置画面' }))
    await fireEvent.click(screen.getByRole('button', { name: '进入全屏' }))
    await fireEvent.click(screen.getByRole('button', { name: '进入画中画' }))
    await fireEvent.click(screen.getByRole('button', { name: '截取当前画面' }))
    await fireEvent.click(screen.getByRole('button', { name: /下载媒体/ }))
    await fireEvent.click(screen.getByRole('button', { name: '关闭控制层' }))

    expect(events.map((event) => event.intent)).toEqual([
      { type: 'media.play', mediaId: 'media-0-1', source: 'control' },
      {
        type: 'media.seek',
        mediaId: 'media-0-1',
        deltaSeconds: -10,
        source: 'control'
      },
      {
        type: 'media.seek-to',
        mediaId: 'media-0-1',
        valueSeconds: 45,
        source: 'control'
      },
      { type: 'media.set-rate', mediaId: 'media-0-1', value: 1.35, source: 'control' },
      { type: 'media.set-volume', mediaId: 'media-0-1', value: 0.35, source: 'control' },
      { type: 'media.toggle-mute', mediaId: 'media-0-1', source: 'control' },
      { type: 'visual.adjust-zoom', mediaId: 'media-0-1', delta: 0.1, source: 'control' },
      { type: 'visual.reset', mediaId: 'media-0-1', source: 'control' },
      { type: 'display.toggle-fullscreen', mediaId: 'media-0-1', source: 'control' },
      {
        type: 'display.toggle-picture-in-picture',
        mediaId: 'media-0-1',
        source: 'control'
      },
      { type: 'capture.request', mediaId: 'media-0-1', source: 'control' },
      { type: 'download.request', mediaId: 'media-0-1', source: 'control' },
      { type: 'overlay.close', source: 'control' }
    ])
    expect(events.every((event) => event.version === 1)).toBe(true)
    expect(JSON.parse(JSON.stringify(events))).toEqual(events)
  })

  it('supports shell shortcuts without hijacking keyboard events from native controls', async () => {
    const { events } = renderOverlay()
    const dialog = screen.getByRole('dialog')
    const volume = screen.getByRole('slider', { name: '音量' })

    dialog.focus()
    await fireEvent.keyDown(dialog, { key: 'k' })
    await fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    await fireEvent.keyDown(volume, { key: 'ArrowRight' })
    await fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(events.map((event) => event.intent)).toEqual([
      { type: 'media.play', mediaId: 'media-0-1', source: 'shortcut' },
      {
        type: 'media.seek',
        mediaId: 'media-0-1',
        deltaSeconds: 10,
        source: 'shortcut'
      },
      { type: 'overlay.dismiss', source: 'shortcut' }
    ])
  })

  it('disables unsupported or busy capabilities and never emits their intents', async () => {
    const capabilities: OverlayCapabilitiesViewModel = {
      ...allCapabilities,
      seek: false,
      pictureInPicture: false,
      capture: false
    }
    const { events } = renderOverlay(
      readyModel({ capabilities, busyControls: ['playback-rate', 'download'] })
    )

    const seek = screen.getByRole<HTMLButtonElement>('button', { name: '前进 10 秒' })
    const rate = screen.getByRole<HTMLButtonElement>('button', { name: '提高播放速度' })
    const pip = screen.getByRole<HTMLButtonElement>('button', { name: '进入画中画' })
    const capture = screen.getByRole<HTMLButtonElement>('button', { name: '截取当前画面' })
    const download = screen.getByRole<HTMLButtonElement>('button', { name: /下载媒体/ })

    expect([seek, rate, pip, capture, download].every((button) => button.disabled)).toBe(true)
    await fireEvent.click(seek)
    await fireEvent.click(rate)
    await fireEvent.click(pip)
    await fireEvent.click(capture)
    await fireEvent.click(download)
    expect(events).toEqual([])
    expect(screen.getByText('操作处理中')).toBeTruthy()
  })

  it.each([
    ['loading', '正在连接媒体', 'status'],
    ['empty', '暂未发现媒体', 'status'],
    ['error', '媒体控制暂不可用', 'alert'],
    ['unsupported', '当前媒体不支持控制', 'status']
  ] as const)('renders the %s state with an accessible %s message', (state, title, role) => {
    renderOverlay(stateModel(state))
    expect(screen.getByRole(role, { name: '' }).textContent).toContain(title)
  })

  it('uses caller-provided status detail, exposes retry, and renders English copy', async () => {
    const { events } = renderOverlay(
      readyModel({
        state: 'error',
        media: null,
        locale: 'en-US',
        statusDetail: 'The page bridge timed out.',
        notice: null
      })
    )

    expect(screen.getByRole('alert').textContent).toContain('The page bridge timed out.')
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(events[0]).toEqual({
      version: 1,
      intent: { type: 'overlay.retry', source: 'control' }
    })
  })

  it('renders nothing when closed', () => {
    renderOverlay(readyModel({ open: false }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
