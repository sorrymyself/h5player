import {
  getHotkeyCommandDefinition,
  resolveHotkeyBindings,
  type ResolvedHotkeyBinding
} from './catalog'
import { keyboardEventToChord, type HotkeyBindingMap, type KeyboardChordInput } from './model'

export type HotkeyScope = 'page' | 'player'

export type HotkeyEventInput = KeyboardChordInput &
  Readonly<{
    repeat: boolean
    isComposing: boolean
  }>

export type HotkeyContext = Readonly<{
  enabled: boolean
  scope: HotkeyScope
  bindings: HotkeyBindingMap
  editableTarget: boolean
  playerFocused: boolean
}>

export type HotkeyIgnoreReason =
  | 'DISABLED'
  | 'COMPOSING'
  | 'EDITABLE_TARGET'
  | 'PLAYER_NOT_FOCUSED'
  | 'INVALID_CHORD'
  | 'UNBOUND'
  | 'BINDING_DISABLED'
  | 'REPEAT_BLOCKED'

export type HotkeyDecision =
  | { readonly matched: false; readonly reason: HotkeyIgnoreReason }
  | {
      readonly matched: true
      readonly binding: ResolvedHotkeyBinding
      readonly preventDefault: true
      readonly stopPropagation: true
    }

export class HotkeyInterpreter {
  decide(event: HotkeyEventInput, context: HotkeyContext): HotkeyDecision {
    if (!context.enabled) return { matched: false, reason: 'DISABLED' }
    if (event.isComposing) return { matched: false, reason: 'COMPOSING' }
    if (context.editableTarget) return { matched: false, reason: 'EDITABLE_TARGET' }
    if (context.scope === 'player' && !context.playerFocused) {
      return { matched: false, reason: 'PLAYER_NOT_FOCUSED' }
    }

    const chord = keyboardEventToChord(event)
    if (!chord.ok) return { matched: false, reason: 'INVALID_CHORD' }
    const binding = resolveHotkeyBindings(context.bindings).find(
      (candidate) => candidate.chord === chord.chord
    )
    if (!binding) return { matched: false, reason: 'UNBOUND' }
    if (binding.disabled) return { matched: false, reason: 'BINDING_DISABLED' }
    if (event.repeat && !getHotkeyCommandDefinition(binding.commandId).repeatable) {
      return { matched: false, reason: 'REPEAT_BLOCKED' }
    }

    return {
      matched: true,
      binding,
      preventDefault: true,
      stopPropagation: true
    }
  }
}
