import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import MediaDownloadPrompt from '../../src/ui/media/MediaDownloadPrompt.vue'

function request(duplicateState: 'new' | 'downloading' | 'downloaded' = 'new') {
  return {
    id: 'download-1',
    duplicateState,
    artifacts: [
      { kind: 'blob' as const, suggestedFilename: 'episode_video.mp4' },
      { kind: 'blob' as const, suggestedFilename: 'episode_audio.m4a' }
    ]
  }
}

describe('MediaDownloadPrompt', () => {
  it('edits every prepared filename and returns a non-blocking confirmation result', async () => {
    const rendered = render(MediaDownloadPrompt, {
      props: { request: request(), locale: 'zh-CN', theme: 'dark' }
    })

    expect(screen.getByRole('dialog', { name: '确认媒体下载' })).toBeTruthy()
    const inputs = screen.getAllByRole('textbox', { name: '文件名' })
    await fireEvent.update(inputs[0] as HTMLInputElement, '第一集')
    await fireEvent.update(inputs[1] as HTMLInputElement, '第一集音频')
    await fireEvent.click(screen.getByRole('button', { name: '下载' }))

    expect(rendered.emitted()['confirm']).toEqual([[{ filenames: ['第一集', '第一集音频'] }]])
  })

  it.each([
    ['downloading', '同一媒体正在下载，继续会重复保存。'],
    ['downloaded', '同一媒体已下载过，继续会再次保存。']
  ] as const)('explains the %s duplicate state before another save', (state, message) => {
    render(MediaDownloadPrompt, {
      props: { request: request(state), locale: 'zh-CN', theme: 'light' }
    })

    expect(screen.getByRole('status').textContent).toContain(message)
    expect(screen.getByRole('button', { name: '再次下载' })).toBeTruthy()
  })

  it('cancels with Escape without submitting filenames', async () => {
    const rendered = render(MediaDownloadPrompt, {
      props: { request: request(), locale: 'en-US' }
    })

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(rendered.emitted()['cancel']).toHaveLength(1)
    expect(rendered.emitted()['confirm']).toBeUndefined()
  })
})
