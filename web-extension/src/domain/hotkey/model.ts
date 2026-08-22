import * as z from 'zod/mini'

export const HOTKEY_COMMAND_IDS = [
  'media.toggle-play',
  'media.seek-backward-5',
  'media.seek-forward-5',
  'media.seek-backward-30',
  'media.seek-forward-30',
  'media.volume-down',
  'media.volume-up',
  'media.volume-down-20',
  'media.volume-up-20',
  'media.gain-down',
  'media.gain-up',
  'media.rate-down',
  'media.rate-up',
  'media.rate-reset',
  'media.rate-1',
  'media.rate-2',
  'media.rate-3',
  'media.rate-4',
  'media.toggle-mute',
  'media.fullscreen-native',
  'media.fullscreen-web',
  'media.picture-in-picture',
  'media.capture',
  'media.download',
  'media.flip-horizontal',
  'media.flip-vertical',
  'media.zoom-out',
  'media.zoom-in',
  'media.reset-transform',
  'media.pan-left',
  'media.pan-right',
  'media.pan-up',
  'media.pan-down',
  'media.step-frame-forward',
  'media.step-frame-backward',
  'media.brightness-down',
  'media.brightness-up',
  'media.contrast-down',
  'media.contrast-up',
  'media.saturation-down',
  'media.saturation-up',
  'media.hue-down',
  'media.hue-up',
  'media.blur-down',
  'media.blur-up',
  'media.reset-all',
  'media.rotate',
  'media.play-next',
  'settings.toggle-restore-progress'
] as const

export const hotkeyCommandIdSchema = z.enum(HOTKEY_COMMAND_IDS)

export const HOTKEY_MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const

const supportedCodePattern =
  /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(?:Left|Right|Up|Down)|Space|Enter)$/
const canonicalChordPattern =
  /^(?:(?:Ctrl|Alt|Shift|Meta)\+)*(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(?:Left|Right|Up|Down)|Space|Enter)$/

const reservedBrowserShortcuts = new Set([
  'Ctrl+KeyL',
  'Ctrl+KeyN',
  'Ctrl+KeyR',
  'Ctrl+KeyT',
  'Ctrl+KeyW',
  'Ctrl+Shift+KeyT',
  'Meta+KeyL',
  'Meta+KeyN',
  'Meta+KeyR',
  'Meta+KeyT',
  'Meta+KeyW',
  'Meta+Shift+KeyT'
])

export const hotkeyChordSchema = z.string().check(
  z.minLength(1),
  z.maxLength(64),
  z.regex(canonicalChordPattern),
  z.refine((value) => !reservedBrowserShortcuts.has(value))
)

export type HotkeyCommandId = z.infer<typeof hotkeyCommandIdSchema>
export type HotkeyChord = z.infer<typeof hotkeyChordSchema>
export type HotkeyModifier = (typeof HOTKEY_MODIFIERS)[number]

export type HotkeyBinding = Readonly<{
  commandId: HotkeyCommandId
  disabled: boolean
}>

export type HotkeyBindingMap = Readonly<Record<string, HotkeyBinding>>

export type KeyboardChordInput = Readonly<{
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}>

export type HotkeyValidationErrorCode =
  'EMPTY' | 'MODIFIER_ONLY' | 'UNSUPPORTED_KEY' | 'RESERVED_BROWSER_SHORTCUT'

export type HotkeyValidationResult =
  | { readonly ok: true; readonly chord: HotkeyChord }
  | { readonly ok: false; readonly code: HotkeyValidationErrorCode }

function canonicalCode(code: string): string | null {
  const trimmed = code.trim()
  if (supportedCodePattern.test(trimmed)) return trimmed

  const lower = trimmed.toLowerCase()
  if (/^[a-z]$/.test(lower)) return `Key${lower.toUpperCase()}`
  if (/^[0-9]$/.test(lower)) return `Digit${lower}`
  const numpad = lower.match(/^numpad([0-9])$/)
  if (numpad) return `Numpad${numpad[1]}`

  const aliases: Readonly<Record<string, string>> = {
    space: 'Space',
    spacebar: 'Space',
    enter: 'Enter',
    return: 'Enter',
    arrowleft: 'ArrowLeft',
    left: 'ArrowLeft',
    arrowright: 'ArrowRight',
    right: 'ArrowRight',
    arrowup: 'ArrowUp',
    up: 'ArrowUp',
    arrowdown: 'ArrowDown',
    down: 'ArrowDown'
  }
  return aliases[lower] ?? null
}

function canonicalModifier(value: string): HotkeyModifier | null {
  switch (value.trim().toLowerCase()) {
    case 'ctrl':
    case 'control':
      return 'Ctrl'
    case 'alt':
    case 'option':
      return 'Alt'
    case 'shift':
      return 'Shift'
    case 'meta':
    case 'cmd':
    case 'command':
      return 'Meta'
    default:
      return null
  }
}

export function validateHotkeyChord(value: string): HotkeyValidationResult {
  const trimmed = value.trim()
  if (!trimmed) return { ok: false, code: 'EMPTY' }

  const parts = trimmed
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return { ok: false, code: 'EMPTY' }

  const code = canonicalCode(parts.at(-1) ?? '')
  if (!code) {
    const modifierOnly = parts.every((part) => canonicalModifier(part) !== null)
    return { ok: false, code: modifierOnly ? 'MODIFIER_ONLY' : 'UNSUPPORTED_KEY' }
  }

  const modifiers = new Set<HotkeyModifier>()
  for (const part of parts.slice(0, -1)) {
    const modifier = canonicalModifier(part)
    if (!modifier) return { ok: false, code: 'UNSUPPORTED_KEY' }
    modifiers.add(modifier)
  }

  const chord = [...HOTKEY_MODIFIERS.filter((modifier) => modifiers.has(modifier)), code].join('+')
  if (reservedBrowserShortcuts.has(chord)) {
    return { ok: false, code: 'RESERVED_BROWSER_SHORTCUT' }
  }
  const parsed = hotkeyChordSchema.safeParse(chord)
  if (!parsed.success) return { ok: false, code: 'UNSUPPORTED_KEY' }
  return { ok: true, chord: parsed.data }
}

export function keyboardEventToChord(input: KeyboardChordInput): HotkeyValidationResult {
  const modifiers: HotkeyModifier[] = []
  if (input.ctrlKey) modifiers.push('Ctrl')
  if (input.altKey) modifiers.push('Alt')
  if (input.shiftKey) modifiers.push('Shift')
  if (input.metaKey) modifiers.push('Meta')
  return validateHotkeyChord([...modifiers, input.code].join('+'))
}

export function displayHotkeyChord(chord: HotkeyChord, platform: 'mac' | 'other'): string {
  const parts = chord.split('+')
  const key = parts.at(-1) ?? chord
  const keyLabels: Readonly<Record<string, string>> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    Enter: 'Enter'
  }
  const keyLabel = key.startsWith('Key')
    ? key.slice(3)
    : key.startsWith('Digit')
      ? key.slice(5)
      : key.startsWith('Numpad')
        ? `Numpad ${key.slice(6)}`
        : (keyLabels[key] ?? key)

  if (platform === 'mac') {
    const modifierLabels: Readonly<Record<string, string>> = {
      Ctrl: '⌃',
      Alt: '⌥',
      Shift: '⇧',
      Meta: '⌘'
    }
    return `${parts
      .slice(0, -1)
      .map((part) => modifierLabels[part] ?? part)
      .join('')}${keyLabel}`
  }

  return [...parts.slice(0, -1), keyLabel].join('+')
}
