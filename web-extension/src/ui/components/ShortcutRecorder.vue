<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import {
  displayHotkeyChord,
  keyboardEventToChord,
  type HotkeyChord,
  type HotkeyValidationErrorCode
} from '../../domain/hotkey'

const props = defineProps<{
  chord?: HotkeyChord | undefined
  label: string
  recordLabel: string
  recordingLabel: string
  cancelHint: string
  emptyLabel: string
  error?: string | undefined
  disabled?: boolean
}>()

const emit = defineEmits<{
  recorded: [chord: HotkeyChord]
  invalid: [code: HotkeyValidationErrorCode]
  cancelled: []
}>()

const recording = ref(false)
const recorderButton = ref<HTMLButtonElement | null>(null)
const errorId = `${useId()}-shortcut-error`
const platform = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? 'mac' : 'other'
const renderedChord = computed(() =>
  props.chord ? displayHotkeyChord(props.chord, platform) : props.emptyLabel
)

async function startRecording(): Promise<void> {
  if (props.disabled) return
  recording.value = true
  await nextTick()
  recorderButton.value?.focus()
}

function stopRecording(cancelled: boolean): void {
  recording.value = false
  if (cancelled) emit('cancelled')
}

function handleKeydown(event: KeyboardEvent): void {
  if (!recording.value || event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    stopRecording(true)
    return
  }
  if (event.key === 'Tab') {
    stopRecording(true)
    return
  }

  event.preventDefault()
  event.stopPropagation()

  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
    emit('invalid', 'MODIFIER_ONLY')
    return
  }

  const result = keyboardEventToChord({
    code: event.code,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey
  })
  if (!result.ok) {
    emit('invalid', result.code)
    return
  }

  recording.value = false
  emit('recorded', result.chord)
}
</script>

<template>
  <div class="shortcut-recorder">
    <button
      ref="recorderButton"
      type="button"
      class="recorder-button"
      :class="{ 'is-recording': recording, 'has-error': error }"
      :disabled
      :aria-pressed="recording"
      :aria-label="`${recordLabel}: ${label}`"
      :aria-describedby="error ? errorId : undefined"
      @click="startRecording"
      @keydown="handleKeydown"
      @blur="recording && stopRecording(true)"
    >
      <kbd>{{ recording ? recordingLabel : renderedChord }}</kbd>
      <span>{{ recording ? cancelHint : recordLabel }}</span>
    </button>
    <p v-if="error" :id="errorId" class="recorder-error" role="alert">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.shortcut-recorder {
  display: grid;
  gap: var(--h5-space-1);
}

.recorder-button {
  display: inline-grid;
  min-width: 174px;
  min-height: 48px;
  grid-template-columns: minmax(70px, auto) 1fr;
  align-items: center;
  gap: var(--h5-space-3);
  padding: var(--h5-space-2) var(--h5-space-3);
  border: 1px solid var(--h5-border);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
  color: var(--h5-text-muted);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--h5-motion-fast) ease,
    background var(--h5-motion-fast) ease;
}

.recorder-button:hover:not(:disabled) {
  border-color: var(--h5-accent);
  background: var(--h5-surface-raised);
}

.recorder-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.recorder-button.is-recording {
  border-color: var(--h5-teal);
  background: rgb(123 199 182 / 0.08);
}

.recorder-button.has-error {
  border-color: var(--h5-danger);
}

kbd {
  color: var(--h5-accent-strong);
  font-family: var(--h5-font-mono);
  font-size: 12px;
  font-weight: 750;
  white-space: nowrap;
}

.recorder-button span {
  font-size: 11px;
  line-height: 1.3;
}

.recorder-error {
  max-width: 240px;
  margin: 0;
  color: var(--h5-danger);
  font-size: 11px;
}
</style>
