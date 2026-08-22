import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOTKEY_BINDINGS,
  HotkeyInterpreter,
  createHotkeyPlanningState,
  displayHotkeyChord,
  findHotkeyConflict,
  getHotkeyCommandDefinition,
  hotkeyChordSchema,
  keyboardEventToChord,
  planHotkeyCommand,
  resolveHotkeyBindings,
  validateHotkeyChord
} from '../../src/domain/hotkey'
import type { MediaSnapshot } from '../../src/domain/media'

const baseEvent = {
  code: 'Space',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false
} as const

const baseContext = {
  enabled: true,
  scope: 'page' as const,
  bindings: {},
  editableTarget: false,
  playerFocused: false
}

function snapshot(
  overrides: Omit<Partial<MediaSnapshot>, 'metrics' | 'capabilities'> & {
    metrics?: Partial<MediaSnapshot['metrics']>
    capabilities?: Partial<MediaSnapshot['capabilities']>
  } = {}
): MediaSnapshot {
  const metrics: MediaSnapshot['metrics'] = Object.assign(
    {
      width: 1280,
      height: 720,
      duration: 120,
      currentTime: 30,
      volume: 0.5,
      playbackRate: 1,
      muted: false,
      visible: true
    },
    overrides.metrics
  )
  const capabilities: MediaSnapshot['capabilities'] = Object.assign(
    {
      playback: true,
      seek: true,
      playbackRate: true,
      volume: true,
      mute: true,
      visual: true,
      fullscreen: true,
      fullscreenNative: true,
      fullscreenWeb: true,
      pictureInPicture: true,
      capture: true,
      next: true,
      downloadExperimental: false
    },
    overrides.capabilities
  )
  return {
    id: 'media-1',
    frameId: 0,
    kind: 'video',
    state: 'paused',
    visual: {
      zoom: 1.25,
      pan: { x: 10, y: -5 },
      rotation: 90,
      flip: { horizontal: false, vertical: true },
      filters: { brightness: 1.2, contrast: 1.1, saturation: 0.9, hue: 5, blur: 2 }
    },
    presentation: { fullscreen: 'none', pictureInPicture: false },
    adapterId: 'generic',
    updatedAt: 1,
    ...overrides,
    metrics,
    capabilities
  }
}

describe('hotkey domain', () => {
  it('canonicalizes supported chords and rejects modifier-only, unsupported, and browser-reserved input', () => {
    expect(validateHotkeyChord('shift+ctrl+x')).toEqual({
      ok: true,
      chord: 'Ctrl+Shift+KeyX'
    })
    expect(validateHotkeyChord('left')).toEqual({ ok: true, chord: 'ArrowLeft' })
    expect(validateHotkeyChord('Ctrl')).toEqual({ ok: false, code: 'MODIFIER_ONLY' })
    expect(validateHotkeyChord('F12')).toEqual({ ok: false, code: 'UNSUPPORTED_KEY' })
    expect(validateHotkeyChord('Ctrl+L')).toEqual({
      ok: false,
      code: 'RESERVED_BROWSER_SHORTCUT'
    })
    expect(hotkeyChordSchema.safeParse('Ctrl+KeyL').success).toBe(false)
  })

  it('uses physical KeyboardEvent.code and renders platform-appropriate labels', () => {
    expect(
      keyboardEventToChord({
        code: 'KeyC',
        ctrlKey: false,
        altKey: true,
        shiftKey: true,
        metaKey: false
      })
    ).toEqual({ ok: true, chord: 'Alt+Shift+KeyC' })
    expect(displayHotkeyChord('Ctrl+ArrowLeft', 'other')).toBe('Ctrl+←')
    expect(displayHotkeyChord('Shift+Meta+KeyC', 'mac')).toBe('⇧⌘C')
  })

  it('accepts and displays Legacy numpad rate chords', () => {
    expect(validateHotkeyChord('Numpad3')).toEqual({ ok: true, chord: 'Numpad3' })
    expect(displayHotkeyChord('Numpad3', 'other')).toBe('Numpad 3')
  })

  it('freezes the complete Legacy default binding map', () => {
    expect(DEFAULT_HOTKEY_BINDINGS).toEqual({
      Space: 'media.toggle-play',
      ArrowLeft: 'media.seek-backward-5',
      ArrowRight: 'media.seek-forward-5',
      'Ctrl+ArrowLeft': 'media.seek-backward-30',
      'Ctrl+ArrowRight': 'media.seek-forward-30',
      ArrowDown: 'media.volume-down',
      ArrowUp: 'media.volume-up',
      'Ctrl+ArrowDown': 'media.volume-down-20',
      'Ctrl+ArrowUp': 'media.volume-up-20',
      KeyX: 'media.rate-down',
      KeyC: 'media.rate-up',
      KeyZ: 'media.rate-reset',
      Digit1: 'media.rate-1',
      Digit2: 'media.rate-2',
      Digit3: 'media.rate-3',
      Digit4: 'media.rate-4',
      Numpad1: 'media.rate-1',
      Numpad2: 'media.rate-2',
      Numpad3: 'media.rate-3',
      Numpad4: 'media.rate-4',
      Enter: 'media.fullscreen-native',
      'Shift+Enter': 'media.fullscreen-web',
      'Shift+KeyP': 'media.picture-in-picture',
      'Shift+KeyS': 'media.capture',
      'Shift+KeyD': 'media.download',
      'Shift+KeyR': 'settings.toggle-restore-progress',
      KeyM: 'media.flip-horizontal',
      'Shift+KeyM': 'media.flip-vertical',
      'Shift+KeyX': 'media.zoom-out',
      'Shift+KeyC': 'media.zoom-in',
      'Shift+KeyZ': 'media.reset-transform',
      'Shift+ArrowLeft': 'media.pan-left',
      'Shift+ArrowRight': 'media.pan-right',
      'Shift+ArrowUp': 'media.pan-up',
      'Shift+ArrowDown': 'media.pan-down',
      KeyD: 'media.step-frame-backward',
      KeyF: 'media.step-frame-forward',
      KeyW: 'media.brightness-down',
      KeyE: 'media.brightness-up',
      KeyR: 'media.contrast-down',
      KeyT: 'media.contrast-up',
      KeyY: 'media.saturation-down',
      KeyU: 'media.saturation-up',
      KeyI: 'media.hue-down',
      KeyO: 'media.hue-up',
      KeyJ: 'media.blur-down',
      KeyK: 'media.blur-up',
      KeyQ: 'media.reset-all',
      KeyS: 'media.rotate',
      KeyN: 'media.play-next'
    })
  })

  it('creates Legacy presentation and capture commands', () => {
    const media = snapshot()
    expect(getHotkeyCommandDefinition('media.fullscreen-native').createCommand(media)).toEqual({
      type: 'media.toggle-fullscreen',
      mediaId: 'media-1',
      mode: 'native'
    })
    expect(getHotkeyCommandDefinition('media.fullscreen-web').createCommand(media)).toEqual({
      type: 'media.toggle-fullscreen',
      mediaId: 'media-1',
      mode: 'web'
    })
    expect(getHotkeyCommandDefinition('media.picture-in-picture').createCommand(media)).toEqual({
      type: 'media.toggle-picture-in-picture',
      mediaId: 'media-1'
    })
    expect(getHotkeyCommandDefinition('media.capture').createCommand(media)).toEqual({
      type: 'media.capture',
      mediaId: 'media-1'
    })
  })

  it('creates Legacy visual commands from the current visual snapshot', () => {
    const media = snapshot()
    expect(getHotkeyCommandDefinition('media.flip-horizontal').createCommand(media)).toEqual({
      type: 'media.toggle-flip',
      mediaId: 'media-1',
      axis: 'horizontal'
    })
    expect(getHotkeyCommandDefinition('media.flip-vertical').createCommand(media)).toEqual({
      type: 'media.toggle-flip',
      mediaId: 'media-1',
      axis: 'vertical'
    })
    expect(getHotkeyCommandDefinition('media.zoom-in').createCommand(media)).toEqual({
      type: 'media.set-zoom',
      mediaId: 'media-1',
      value: 1.3
    })
    expect(getHotkeyCommandDefinition('media.pan-up').createCommand(media)).toEqual({
      type: 'media.pan',
      mediaId: 'media-1',
      deltaX: 0,
      deltaY: -10
    })
    expect(getHotkeyCommandDefinition('media.brightness-down').createCommand(media)).toEqual({
      type: 'media.set-filter',
      mediaId: 'media-1',
      filter: 'brightness',
      value: 1.1
    })
    expect(getHotkeyCommandDefinition('media.blur-up').createCommand(media)).toEqual({
      type: 'media.set-filter',
      mediaId: 'media-1',
      filter: 'blur',
      value: 3
    })
  })

  it('uses default visual values when a snapshot has no visual state', () => {
    const media = snapshot({ visual: undefined })
    expect(getHotkeyCommandDefinition('media.zoom-out').createCommand(media)).toMatchObject({
      type: 'media.set-zoom',
      value: 0.95
    })
    expect(getHotkeyCommandDefinition('media.hue-down').createCommand(media)).toMatchObject({
      type: 'media.set-filter',
      value: -1
    })
  })

  it('creates Legacy frame, reset, rotation, volume, and navigation commands', () => {
    const media = snapshot()
    expect(getHotkeyCommandDefinition('media.step-frame-forward').createCommand(media)).toEqual({
      type: 'media.step-frame',
      mediaId: 'media-1',
      frames: 1
    })
    expect(getHotkeyCommandDefinition('media.step-frame-backward').createCommand(media)).toEqual({
      type: 'media.step-frame',
      mediaId: 'media-1',
      frames: -1
    })
    expect(getHotkeyCommandDefinition('media.reset-all').createCommand(media)).toEqual({
      type: 'media.reset-visual',
      mediaId: 'media-1'
    })
    expect(getHotkeyCommandDefinition('media.rotate').createCommand(media)).toMatchObject({
      type: 'media.rotate',
      deltaDegrees: 90
    })
    expect(getHotkeyCommandDefinition('media.volume-up-20').createCommand(media)).toMatchObject({
      type: 'media.adjust-volume',
      delta: 0.2
    })
    expect(getHotkeyCommandDefinition('media.play-next').createCommand(media)).toEqual({
      type: 'media.play-next',
      mediaId: 'media-1'
    })
  })

  it('gates Legacy commands using snapshot capabilities', () => {
    const unsupported = snapshot({
      capabilities: {
        seek: false,
        playback: false,
        visual: false,
        fullscreenNative: false,
        fullscreenWeb: false,
        pictureInPicture: false,
        capture: false,
        next: false
      }
    })
    expect(
      getHotkeyCommandDefinition('media.step-frame-forward').supportsSnapshot?.(unsupported)
    ).toBe(false)
    expect(
      getHotkeyCommandDefinition('media.fullscreen-native').supportsSnapshot?.(unsupported)
    ).toBe(false)
    expect(
      getHotkeyCommandDefinition('media.picture-in-picture').supportsSnapshot?.(unsupported)
    ).toBe(false)
    expect(getHotkeyCommandDefinition('media.capture').supportsSnapshot?.(unsupported)).toBe(false)
    expect(getHotkeyCommandDefinition('media.zoom-in').supportsSnapshot?.(unsupported)).toBe(false)
    expect(getHotkeyCommandDefinition('media.play-next').supportsSnapshot?.(unsupported)).toBe(
      false
    )
    expect(
      getHotkeyCommandDefinition('media.step-frame-forward').supportsSnapshot?.(
        snapshot({ adapterId: 'netflix' })
      )
    ).toBe(false)
  })

  it('toggles Z between 1x and the last observed non-1x rate', () => {
    const first = planHotkeyCommand({
      commandId: 'media.rate-reset',
      snapshot: snapshot({ metrics: { playbackRate: 1.75 } }),
      now: 0,
      state: createHotkeyPlanningState()
    })
    expect(first.command).toMatchObject({ type: 'media.set-rate', value: 1 })

    const second = planHotkeyCommand({
      commandId: 'media.rate-reset',
      snapshot: snapshot({ metrics: { playbackRate: 1 } }),
      now: 100,
      state: first.state
    })
    expect(second.command).toMatchObject({ type: 'media.set-rate', value: 1.75 })
  })

  it('uses 1.5x as the initial Z restore rate', () => {
    const result = planHotkeyCommand({
      commandId: 'media.rate-reset',
      snapshot: snapshot({ metrics: { playbackRate: 1 } }),
      now: 0,
      state: createHotkeyPlanningState()
    })
    expect(result.command).toMatchObject({ type: 'media.set-rate', value: 1.5 })
  })

  it('adds repeated numeric rates within 300 ms', () => {
    const first = planHotkeyCommand({
      commandId: 'media.rate-2',
      snapshot: snapshot(),
      now: 100,
      state: createHotkeyPlanningState()
    })
    const second = planHotkeyCommand({
      commandId: 'media.rate-2',
      snapshot: snapshot({ metrics: { playbackRate: 2 } }),
      now: 400,
      state: first.state
    })
    expect(first.command).toMatchObject({ type: 'media.set-rate', value: 2 })
    expect(second.command).toMatchObject({ type: 'media.set-rate', value: 4 })
  })

  it('resets numeric accumulation after 300 ms or a different base', () => {
    const first = planHotkeyCommand({
      commandId: 'media.rate-2',
      snapshot: snapshot(),
      now: 0,
      state: createHotkeyPlanningState()
    })
    const expired = planHotkeyCommand({
      commandId: 'media.rate-2',
      snapshot: snapshot({ metrics: { playbackRate: 2 } }),
      now: 301,
      state: first.state
    })
    const switched = planHotkeyCommand({
      commandId: 'media.rate-3',
      snapshot: snapshot({ metrics: { playbackRate: 2 } }),
      now: 100,
      state: first.state
    })
    expect(expired.command).toMatchObject({ type: 'media.set-rate', value: 2 })
    expect(switched.command).toMatchObject({ type: 'media.set-rate', value: 3 })
  })

  it('clamps accumulated numeric rates to the maximum playback rate', () => {
    let state = createHotkeyPlanningState()
    let result = planHotkeyCommand({
      commandId: 'media.rate-4',
      snapshot: snapshot(),
      now: 0,
      state
    })
    state = result.state
    for (const now of [100, 200, 300, 400]) {
      result = planHotkeyCommand({ commandId: 'media.rate-4', snapshot: snapshot(), now, state })
      state = result.state
    }
    expect(result.command).toMatchObject({ type: 'media.set-rate', value: 16 })
  })

  it('resolves frozen defaults, explicit overrides, disabled mappings, and conflicts deterministically', () => {
    const bindings = resolveHotkeyBindings({
      Space: { commandId: 'media.toggle-play', disabled: true },
      KeyP: { commandId: 'media.toggle-play', disabled: false }
    })
    expect(bindings.find((binding) => binding.chord === 'Space')).toMatchObject({
      disabled: true,
      customized: true
    })
    expect(bindings.find((binding) => binding.chord === 'KeyP')).toMatchObject({
      commandId: 'media.toggle-play',
      disabled: false,
      customized: true
    })
    expect(findHotkeyConflict(bindings, 'ArrowLeft', 'media.seek-forward-5')).toMatchObject({
      commandId: 'media.seek-backward-5'
    })
    expect(findHotkeyConflict(bindings, 'KeyP', 'media.toggle-play')).toBeNull()
  })

  it('applies editable, focus, composition, disabled, and repeat policies before matching', () => {
    const interpreter = new HotkeyInterpreter()
    expect(interpreter.decide(baseEvent, { ...baseContext, editableTarget: true })).toMatchObject({
      reason: 'EDITABLE_TARGET'
    })
    expect(interpreter.decide({ ...baseEvent, isComposing: true }, baseContext)).toMatchObject({
      reason: 'COMPOSING'
    })
    expect(interpreter.decide(baseEvent, { ...baseContext, scope: 'player' })).toMatchObject({
      reason: 'PLAYER_NOT_FOCUSED'
    })
    expect(
      interpreter.decide({ ...baseEvent, repeat: true }, { ...baseContext, playerFocused: true })
    ).toMatchObject({ reason: 'REPEAT_BLOCKED' })
    expect(
      interpreter.decide(
        { ...baseEvent, code: 'ArrowRight', repeat: true },
        { ...baseContext, playerFocused: true }
      )
    ).toMatchObject({ matched: true, binding: { commandId: 'media.seek-forward-5' } })
    expect(
      interpreter.decide(baseEvent, {
        ...baseContext,
        bindings: { Space: { commandId: 'media.toggle-play', disabled: true } }
      })
    ).toMatchObject({ reason: 'BINDING_DISABLED' })
  })
})
