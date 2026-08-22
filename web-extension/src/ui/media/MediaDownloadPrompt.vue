<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import type { MediaDownloadPromptRequest, MediaDownloadPromptResult } from '../files/download-media'
import { translateMedia as translate, type MediaLocale as Locale } from './media-messages'

const props = withDefaults(
  defineProps<{
    request: MediaDownloadPromptRequest
    locale: Locale
    theme?: 'system' | 'light' | 'dark'
  }>(),
  { theme: 'system' }
)

const emit = defineEmits<{
  confirm: [result: MediaDownloadPromptResult]
  cancel: []
}>()

const dialog = ref<HTMLElement | null>(null)
const filenames = ref<string[]>([])

function resetFilenames(): void {
  filenames.value = props.request.artifacts.map((artifact) => artifact.suggestedFilename)
  void nextTick(() => dialog.value?.querySelector<HTMLInputElement>('input')?.focus())
}

function confirm(): void {
  emit('confirm', { filenames: [...filenames.value] })
}

function cancel(): void {
  emit('cancel')
}

function duplicateMessage(): string | null {
  if (props.request.duplicateState === 'downloading') {
    return translate(props.locale, 'mediaDownload.alreadyDownloading')
  }
  if (props.request.duplicateState === 'downloaded') {
    return translate(props.locale, 'mediaDownload.alreadyDownloaded')
  }
  return null
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = dialog.value?.querySelectorAll<HTMLElement>(
    'input:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )
  if (!focusable || focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (first === undefined || last === undefined) return
  if (event.shiftKey && globalThis.document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && globalThis.document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.request.id, resetFilenames, { immediate: true })
onMounted(() => dialog.value?.querySelector<HTMLInputElement>('input')?.focus())
</script>

<template>
  <div class="media-download-prompt" :class="`theme-${theme}`" @keydown="handleKeydown">
    <button
      type="button"
      class="media-download-prompt__backdrop"
      :aria-label="translate(locale, 'mediaDownload.cancel')"
      @click="cancel"
    />
    <section
      ref="dialog"
      class="media-download-prompt__dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`${request.id}-title`"
      :aria-describedby="duplicateMessage() === null ? undefined : `${request.id}-warning`"
    >
      <header class="media-download-prompt__header">
        <h2 :id="`${request.id}-title`">{{ translate(locale, 'mediaDownload.confirmTitle') }}</h2>
        <button
          type="button"
          class="media-download-prompt__close"
          :aria-label="translate(locale, 'mediaDownload.cancel')"
          :title="translate(locale, 'mediaDownload.cancel')"
          @click="cancel"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <p
        v-if="duplicateMessage()"
        :id="`${request.id}-warning`"
        class="media-download-prompt__warning"
        role="status"
      >
        {{ duplicateMessage() }}
      </p>

      <div class="media-download-prompt__files">
        <label
          v-for="(artifact, index) in request.artifacts"
          :key="`${request.id}-${index}`"
          class="media-download-prompt__file"
        >
          <span>
            {{
              request.artifacts.length === 1
                ? translate(locale, 'mediaDownload.filename')
                : translate(locale, 'mediaDownload.filenameIndexed', { value: index + 1 })
            }}
          </span>
          <input
            v-model="filenames[index]"
            type="text"
            maxlength="256"
            autocomplete="off"
            spellcheck="false"
            :aria-label="translate(locale, 'mediaDownload.filename')"
          />
        </label>
      </div>

      <footer class="media-download-prompt__actions">
        <button type="button" @click="cancel">
          {{ translate(locale, 'mediaDownload.cancel') }}
        </button>
        <button type="button" class="is-primary" @click="confirm">
          {{
            translate(
              locale,
              request.duplicateState === 'new'
                ? 'mediaDownload.download'
                : 'mediaDownload.downloadAgain'
            )
          }}
        </button>
      </footer>
    </section>
  </div>
</template>
