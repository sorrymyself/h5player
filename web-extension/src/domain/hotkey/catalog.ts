import type { MediaCommand } from '../command'
import type { MediaSnapshot } from '../media'
import {
  DEFAULT_VISUAL_STATE,
  clampVisualFilter,
  clampVisualZoom,
  type VisualFilterName
} from '../visual'
import type { HotkeyBindingMap, HotkeyChord, HotkeyCommandId } from './model'
import { hotkeyChordSchema, hotkeyCommandIdSchema } from './model'

export type HotkeyCommandDefinition = Readonly<{
  id: HotkeyCommandId
  labelKey: string
  category:
    | 'playback'
    | 'seek'
    | 'rate'
    | 'volume'
    | 'visual'
    | 'presentation'
    | 'capture'
    | 'navigation'
    | 'settings'
  repeatable: boolean
  action: 'media' | 'toggle-site-progress-restore'
  createCommand(snapshot: MediaSnapshot): MediaCommand
  supportsSnapshot?(snapshot: MediaSnapshot): boolean
}>

function definition(
  value: Omit<HotkeyCommandDefinition, 'action' | 'createCommand'> & {
    createCommand(snapshot: MediaSnapshot): MediaCommand
  }
): HotkeyCommandDefinition {
  return Object.freeze({ ...value, action: 'media' as const })
}

function settingsDefinition(
  value: Omit<HotkeyCommandDefinition, 'action' | 'createCommand'>
): HotkeyCommandDefinition {
  return Object.freeze({
    ...value,
    action: 'toggle-site-progress-restore' as const,
    createCommand() {
      throw new TypeError(`Hotkey command is not a media action: ${value.id}`)
    }
  })
}

function visualState(snapshot: MediaSnapshot) {
  return snapshot.visual ?? DEFAULT_VISUAL_STATE
}

function supports(capability: keyof MediaSnapshot['capabilities']) {
  return (snapshot: MediaSnapshot): boolean => Boolean(snapshot.capabilities[capability])
}

function visualFilterDefinition(
  id: HotkeyCommandId,
  labelKey: string,
  filter: VisualFilterName,
  delta: number
): HotkeyCommandDefinition {
  return definition({
    id,
    labelKey,
    category: 'visual',
    repeatable: true,
    supportsSnapshot: supports('visual'),
    createCommand: (snapshot) => ({
      type: 'media.set-filter',
      mediaId: snapshot.id,
      filter,
      value: clampVisualFilter(filter, visualState(snapshot).filters[filter] + delta)
    })
  })
}

export const HOTKEY_COMMAND_CATALOG: readonly HotkeyCommandDefinition[] = Object.freeze([
  definition({
    id: 'media.toggle-play',
    labelKey: 'hotkey.command.togglePlay',
    category: 'playback',
    repeatable: false,
    supportsSnapshot: supports('playback'),
    createCommand: (snapshot) => ({
      type: snapshot.state === 'active' ? 'media.pause' : 'media.play',
      mediaId: snapshot.id
    })
  }),
  definition({
    id: 'media.seek-backward-5',
    labelKey: 'hotkey.command.seekBackward5',
    category: 'seek',
    repeatable: true,
    supportsSnapshot: supports('seek'),
    createCommand: (snapshot) => ({
      type: 'media.seek',
      mediaId: snapshot.id,
      deltaSeconds: -5
    })
  }),
  definition({
    id: 'media.seek-forward-5',
    labelKey: 'hotkey.command.seekForward5',
    category: 'seek',
    repeatable: true,
    supportsSnapshot: supports('seek'),
    createCommand: (snapshot) => ({
      type: 'media.seek',
      mediaId: snapshot.id,
      deltaSeconds: 5
    })
  }),
  definition({
    id: 'media.seek-backward-30',
    labelKey: 'hotkey.command.seekBackward30',
    category: 'seek',
    repeatable: true,
    supportsSnapshot: supports('seek'),
    createCommand: (snapshot) => ({
      type: 'media.seek',
      mediaId: snapshot.id,
      deltaSeconds: -30
    })
  }),
  definition({
    id: 'media.seek-forward-30',
    labelKey: 'hotkey.command.seekForward30',
    category: 'seek',
    repeatable: true,
    supportsSnapshot: supports('seek'),
    createCommand: (snapshot) => ({
      type: 'media.seek',
      mediaId: snapshot.id,
      deltaSeconds: 30
    })
  }),
  definition({
    id: 'media.volume-down',
    labelKey: 'hotkey.command.volumeDown',
    category: 'volume',
    repeatable: true,
    supportsSnapshot: supports('volume'),
    createCommand: (snapshot) => ({
      type: 'media.adjust-volume',
      mediaId: snapshot.id,
      delta: -0.05
    })
  }),
  definition({
    id: 'media.volume-up',
    labelKey: 'hotkey.command.volumeUp',
    category: 'volume',
    repeatable: true,
    supportsSnapshot: supports('volume'),
    createCommand: (snapshot) => ({
      type: 'media.adjust-volume',
      mediaId: snapshot.id,
      delta: 0.05
    })
  }),
  definition({
    id: 'media.volume-down-20',
    labelKey: 'hotkey.command.volumeDown20',
    category: 'volume',
    repeatable: true,
    supportsSnapshot: supports('volume'),
    createCommand: (snapshot) => ({
      type: 'media.adjust-volume',
      mediaId: snapshot.id,
      delta: -0.2
    })
  }),
  definition({
    id: 'media.volume-up-20',
    labelKey: 'hotkey.command.volumeUp20',
    category: 'volume',
    repeatable: true,
    supportsSnapshot: supports('volume'),
    createCommand: (snapshot) => ({
      type: 'media.adjust-volume',
      mediaId: snapshot.id,
      delta: 0.2
    })
  }),
  definition({
    id: 'media.gain-down',
    labelKey: 'hotkey.command.gainDown',
    category: 'volume',
    repeatable: true,
    supportsSnapshot: supports('audioGain'),
    createCommand: (snapshot) => ({
      type: 'media.adjust-gain',
      mediaId: snapshot.id,
      delta: -1
    })
  }),
  definition({
    id: 'media.gain-up',
    labelKey: 'hotkey.command.gainUp',
    category: 'volume',
    repeatable: true,
    supportsSnapshot: supports('audioGain'),
    createCommand: (snapshot) => ({
      type: 'media.adjust-gain',
      mediaId: snapshot.id,
      delta: 1
    })
  }),
  definition({
    id: 'media.rate-down',
    labelKey: 'hotkey.command.rateDown',
    category: 'rate',
    repeatable: true,
    supportsSnapshot: supports('playbackRate'),
    createCommand: (snapshot) => ({
      type: 'media.adjust-rate',
      mediaId: snapshot.id,
      delta: -0.1
    })
  }),
  definition({
    id: 'media.rate-up',
    labelKey: 'hotkey.command.rateUp',
    category: 'rate',
    repeatable: true,
    supportsSnapshot: supports('playbackRate'),
    createCommand: (snapshot) => ({
      type: 'media.adjust-rate',
      mediaId: snapshot.id,
      delta: 0.1
    })
  }),
  ...([1, 2, 3, 4] as const).map((value) =>
    definition({
      id: `media.rate-${value}`,
      labelKey: `hotkey.command.rate${value}`,
      category: 'rate',
      repeatable: false,
      supportsSnapshot: supports('playbackRate'),
      createCommand: (snapshot) => ({
        type: 'media.set-rate',
        mediaId: snapshot.id,
        value
      })
    })
  ),
  definition({
    id: 'media.rate-reset',
    labelKey: 'hotkey.command.rateReset',
    category: 'rate',
    repeatable: false,
    supportsSnapshot: supports('playbackRate'),
    createCommand: (snapshot) => ({
      type: 'media.set-rate',
      mediaId: snapshot.id,
      value: 1
    })
  }),
  definition({
    id: 'media.toggle-mute',
    labelKey: 'hotkey.command.toggleMute',
    category: 'volume',
    repeatable: false,
    supportsSnapshot: supports('mute'),
    createCommand: (snapshot) => ({ type: 'media.toggle-mute', mediaId: snapshot.id })
  }),
  definition({
    id: 'media.fullscreen-native',
    labelKey: 'hotkey.command.fullscreenNative',
    category: 'presentation',
    repeatable: false,
    supportsSnapshot: (snapshot) =>
      snapshot.capabilities.fullscreenNative ?? snapshot.capabilities.fullscreen,
    createCommand: (snapshot) => ({
      type: 'media.toggle-fullscreen',
      mediaId: snapshot.id,
      mode: 'native'
    })
  }),
  definition({
    id: 'media.fullscreen-web',
    labelKey: 'hotkey.command.fullscreenWeb',
    category: 'presentation',
    repeatable: false,
    supportsSnapshot: (snapshot) =>
      snapshot.capabilities.fullscreenWeb ?? snapshot.capabilities.fullscreen,
    createCommand: (snapshot) => ({
      type: 'media.toggle-fullscreen',
      mediaId: snapshot.id,
      mode: 'web'
    })
  }),
  definition({
    id: 'media.picture-in-picture',
    labelKey: 'hotkey.command.pictureInPicture',
    category: 'presentation',
    repeatable: false,
    supportsSnapshot: supports('pictureInPicture'),
    createCommand: (snapshot) => ({
      type: 'media.toggle-picture-in-picture',
      mediaId: snapshot.id
    })
  }),
  definition({
    id: 'media.capture',
    labelKey: 'hotkey.command.capture',
    category: 'capture',
    repeatable: false,
    supportsSnapshot: supports('capture'),
    createCommand: (snapshot) => ({ type: 'media.capture', mediaId: snapshot.id })
  }),
  definition({
    id: 'media.download',
    labelKey: 'hotkey.command.download',
    category: 'capture',
    repeatable: false,
    supportsSnapshot: supports('downloadExperimental'),
    createCommand: (snapshot) => ({ type: 'media.download', mediaId: snapshot.id })
  }),
  settingsDefinition({
    id: 'settings.toggle-restore-progress',
    labelKey: 'hotkey.command.toggleRestoreProgress',
    category: 'settings',
    repeatable: false
  }),
  definition({
    id: 'media.flip-horizontal',
    labelKey: 'hotkey.command.flipHorizontal',
    category: 'visual',
    repeatable: false,
    supportsSnapshot: supports('visual'),
    createCommand: (snapshot) => ({
      type: 'media.toggle-flip',
      mediaId: snapshot.id,
      axis: 'horizontal'
    })
  }),
  definition({
    id: 'media.flip-vertical',
    labelKey: 'hotkey.command.flipVertical',
    category: 'visual',
    repeatable: false,
    supportsSnapshot: supports('visual'),
    createCommand: (snapshot) => ({
      type: 'media.toggle-flip',
      mediaId: snapshot.id,
      axis: 'vertical'
    })
  }),
  definition({
    id: 'media.zoom-out',
    labelKey: 'hotkey.command.zoomOut',
    category: 'visual',
    repeatable: true,
    supportsSnapshot: supports('visual'),
    createCommand: (snapshot) => ({
      type: 'media.set-zoom',
      mediaId: snapshot.id,
      value: clampVisualZoom(visualState(snapshot).zoom - 0.05)
    })
  }),
  definition({
    id: 'media.zoom-in',
    labelKey: 'hotkey.command.zoomIn',
    category: 'visual',
    repeatable: true,
    supportsSnapshot: supports('visual'),
    createCommand: (snapshot) => ({
      type: 'media.set-zoom',
      mediaId: snapshot.id,
      value: clampVisualZoom(visualState(snapshot).zoom + 0.05)
    })
  }),
  ...(
    [
      ['media.pan-left', 'hotkey.command.panLeft', -10, 0],
      ['media.pan-right', 'hotkey.command.panRight', 10, 0],
      ['media.pan-up', 'hotkey.command.panUp', 0, -10],
      ['media.pan-down', 'hotkey.command.panDown', 0, 10]
    ] as const
  ).map(([id, labelKey, deltaX, deltaY]) =>
    definition({
      id,
      labelKey,
      category: 'visual',
      repeatable: true,
      supportsSnapshot: supports('visual'),
      createCommand: (snapshot) => ({ type: 'media.pan', mediaId: snapshot.id, deltaX, deltaY })
    })
  ),
  definition({
    id: 'media.reset-transform',
    labelKey: 'hotkey.command.resetTransform',
    category: 'visual',
    repeatable: false,
    supportsSnapshot: supports('visual'),
    createCommand: (snapshot) => ({ type: 'media.reset-transform', mediaId: snapshot.id })
  }),
  definition({
    id: 'media.step-frame-forward',
    labelKey: 'hotkey.command.stepFrameForward',
    category: 'seek',
    repeatable: true,
    supportsSnapshot: (snapshot) =>
      snapshot.adapterId !== 'netflix' &&
      snapshot.capabilities.seek &&
      snapshot.capabilities.playback,
    createCommand: (snapshot) => ({ type: 'media.step-frame', mediaId: snapshot.id, frames: 1 })
  }),
  definition({
    id: 'media.step-frame-backward',
    labelKey: 'hotkey.command.stepFrameBackward',
    category: 'seek',
    repeatable: true,
    supportsSnapshot: (snapshot) => snapshot.capabilities.seek && snapshot.capabilities.playback,
    createCommand: (snapshot) => ({ type: 'media.step-frame', mediaId: snapshot.id, frames: -1 })
  }),
  visualFilterDefinition(
    'media.brightness-down',
    'hotkey.command.brightnessDown',
    'brightness',
    -0.1
  ),
  visualFilterDefinition('media.brightness-up', 'hotkey.command.brightnessUp', 'brightness', 0.1),
  visualFilterDefinition('media.contrast-down', 'hotkey.command.contrastDown', 'contrast', -0.1),
  visualFilterDefinition('media.contrast-up', 'hotkey.command.contrastUp', 'contrast', 0.1),
  visualFilterDefinition(
    'media.saturation-down',
    'hotkey.command.saturationDown',
    'saturation',
    -0.1
  ),
  visualFilterDefinition('media.saturation-up', 'hotkey.command.saturationUp', 'saturation', 0.1),
  visualFilterDefinition('media.hue-down', 'hotkey.command.hueDown', 'hue', -1),
  visualFilterDefinition('media.hue-up', 'hotkey.command.hueUp', 'hue', 1),
  visualFilterDefinition('media.blur-down', 'hotkey.command.blurDown', 'blur', -1),
  visualFilterDefinition('media.blur-up', 'hotkey.command.blurUp', 'blur', 1),
  definition({
    id: 'media.reset-all',
    labelKey: 'hotkey.command.resetAll',
    category: 'visual',
    repeatable: false,
    supportsSnapshot: supports('visual'),
    createCommand: (snapshot) => ({ type: 'media.reset-visual', mediaId: snapshot.id })
  }),
  definition({
    id: 'media.rotate',
    labelKey: 'hotkey.command.rotate',
    category: 'visual',
    repeatable: true,
    supportsSnapshot: supports('visual'),
    createCommand: (snapshot) => ({
      type: 'media.rotate',
      mediaId: snapshot.id,
      deltaDegrees: 90
    })
  }),
  definition({
    id: 'media.play-next',
    labelKey: 'hotkey.command.playNext',
    category: 'navigation',
    repeatable: false,
    supportsSnapshot: supports('next'),
    createCommand: (snapshot) => ({ type: 'media.play-next', mediaId: snapshot.id })
  })
])

const catalogById = new Map(HOTKEY_COMMAND_CATALOG.map((item) => [item.id, item]))

export const DEFAULT_HOTKEY_BINDINGS: Readonly<Record<HotkeyChord, HotkeyCommandId>> =
  Object.freeze({
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

export type ResolvedHotkeyBinding = Readonly<{
  chord: HotkeyChord
  commandId: HotkeyCommandId
  disabled: boolean
  customized: boolean
}>

export function getHotkeyCommandDefinition(commandId: HotkeyCommandId): HotkeyCommandDefinition {
  const item = catalogById.get(commandId)
  if (!item) throw new TypeError(`Unknown hotkey command: ${commandId}`)
  return item
}

export function resolveHotkeyBindings(
  overrides: HotkeyBindingMap
): readonly ResolvedHotkeyBinding[] {
  const resolved = new Map<HotkeyChord, ResolvedHotkeyBinding>()
  for (const [chord, commandId] of Object.entries(DEFAULT_HOTKEY_BINDINGS)) {
    const parsedChord = hotkeyChordSchema.safeParse(chord)
    if (!parsedChord.success) continue
    resolved.set(parsedChord.data, {
      chord: parsedChord.data,
      commandId,
      disabled: false,
      customized: false
    })
  }

  for (const [chord, binding] of Object.entries(overrides)) {
    const parsedChord = hotkeyChordSchema.safeParse(chord)
    const parsedCommand = hotkeyCommandIdSchema.safeParse(binding.commandId)
    if (!parsedChord.success || !parsedCommand.success) continue
    resolved.set(parsedChord.data, {
      chord: parsedChord.data,
      commandId: parsedCommand.data,
      disabled: binding.disabled,
      customized: true
    })
  }

  return Object.freeze(
    [...resolved.values()].sort((left, right) => left.chord.localeCompare(right.chord))
  )
}

export function findHotkeyConflict(
  bindings: readonly ResolvedHotkeyBinding[],
  chord: HotkeyChord,
  commandId: HotkeyCommandId
): ResolvedHotkeyBinding | null {
  return (
    bindings.find(
      (binding) => !binding.disabled && binding.chord === chord && binding.commandId !== commandId
    ) ?? null
  )
}
