import axe from 'axe-core'
import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import ShortcutRecorder from '../../src/ui/components/ShortcutRecorder.vue'

const props = {
  chord: 'Space' as const,
  label: '播放 / 暂停',
  recordLabel: '录制快捷键',
  recordingLabel: '按下组合键…',
  cancelHint: '按 Esc 取消',
  emptyLabel: '未分配'
}

describe('ShortcutRecorder', () => {
  it('records a supported chord while keeping browser-reserved input in the recorder', async () => {
    const onInvalid = vi.fn()
    const onRecorded = vi.fn()
    render(ShortcutRecorder, { props: { ...props, onInvalid, onRecorded } })
    const button = screen.getByRole('button', { name: '录制快捷键: 播放 / 暂停' })

    await fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    await fireEvent.keyDown(button, { key: 'l', code: 'KeyL', ctrlKey: true })
    expect(onInvalid).toHaveBeenCalledWith('RESERVED_BROWSER_SHORTCUT')
    expect(button.getAttribute('aria-pressed')).toBe('true')

    await fireEvent.keyDown(button, { key: 'p', code: 'KeyP' })
    expect(onRecorded).toHaveBeenCalledWith('KeyP')
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('supports Escape cancellation and has no automated accessibility violations', async () => {
    const onCancelled = vi.fn()
    const { container } = render(ShortcutRecorder, {
      props: { ...props, error: '与“后退 5 秒”冲突', onCancelled }
    })
    const button = screen.getByRole('button', { name: '录制快捷键: 播放 / 暂停' })
    await fireEvent.click(button)
    await fireEvent.keyDown(button, { key: 'Escape', code: 'Escape' })
    expect(onCancelled).toHaveBeenCalledOnce()

    const result = await axe.run(container)
    expect(result.violations).toEqual([])
  })
})
