<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import BaseButton from './BaseButton.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description: string
    confirmLabel: string
    cancelLabel: string
    danger?: boolean
    busy?: boolean
  }>(),
  { danger: false, busy: false }
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let returnFocus: HTMLElement | null = null

function closeDialog(): void {
  const element = dialog.value
  if (!element?.open) return
  element.close()
}

function cancel(): void {
  if (props.busy) return
  emit('cancel')
}

function handleNativeCancel(event: Event): void {
  event.preventDefault()
  cancel()
}

function handleClose(): void {
  if (props.open) emit('cancel')
  returnFocus?.focus()
  returnFocus = null
}

watch(
  () => props.open,
  async (open) => {
    await nextTick()
    const element = dialog.value
    if (!element) return
    if (open) {
      returnFocus =
        globalThis.document.activeElement instanceof HTMLElement
          ? globalThis.document.activeElement
          : null
      if (!element.open) {
        if (typeof element.showModal === 'function') element.showModal()
        else element.setAttribute('open', '')
      }
      element.querySelector<HTMLElement>('[data-dialog-cancel]')?.focus()
      return
    }
    closeDialog()
  },
  { immediate: true }
)

onBeforeUnmount(closeDialog)
</script>

<template>
  <dialog ref="dialog" class="confirm-dialog" @cancel="handleNativeCancel" @close="handleClose">
    <form method="dialog" @submit.prevent>
      <span class="dialog-mark" :class="{ 'is-danger': danger }" aria-hidden="true" />
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
      <div v-if="$slots['default']" class="dialog-detail">
        <slot />
      </div>
      <div class="dialog-actions">
        <BaseButton data-dialog-cancel :disabled="busy" @click="cancel">
          {{ cancelLabel }}
        </BaseButton>
        <BaseButton :kind="danger ? 'danger' : 'primary'" :disabled="busy" @click="emit('confirm')">
          {{ confirmLabel }}
        </BaseButton>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.confirm-dialog {
  width: min(460px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid var(--h5-border);
  border-radius: var(--h5-radius-md);
  background: var(--h5-bg-elevated);
  color: var(--h5-text);
  box-shadow: var(--h5-shadow);
}

.confirm-dialog::backdrop {
  background: rgb(4 8 10 / 0.72);
  backdrop-filter: blur(5px);
}

form {
  padding: var(--h5-space-6);
}

.dialog-mark {
  display: block;
  width: 44px;
  height: 5px;
  margin-bottom: var(--h5-space-5);
  border-radius: 999px;
  background: var(--h5-accent);
}

.dialog-mark.is-danger {
  background: var(--h5-danger);
}

h2,
p {
  margin: 0;
}

h2 {
  font-family: var(--h5-font-display);
  font-size: 24px;
}

p,
.dialog-detail {
  margin-top: var(--h5-space-3);
  color: var(--h5-text-muted);
  line-height: 1.65;
}

.dialog-detail {
  padding: var(--h5-space-3);
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg);
  font-family: var(--h5-font-mono);
  font-size: 11px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--h5-space-2);
  margin-top: var(--h5-space-6);
}
</style>
