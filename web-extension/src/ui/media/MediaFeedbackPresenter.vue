<script setup lang="ts">
import { computed } from 'vue'
import type { MediaFeedbackEvent } from '../../application/feedback'
import { formatMediaFeedback } from './media-feedback-text'
import type { MediaLocale as Locale } from './media-messages'

const props = withDefaults(
  defineProps<{
    event: MediaFeedbackEvent
    locale: Locale
    variant?: 'media' | 'page'
    theme?: 'system' | 'light' | 'dark'
  }>(),
  { variant: 'media', theme: 'system' }
)

const text = computed(() => formatMediaFeedback(props.event, props.locale))
</script>

<template>
  <p
    class="media-feedback"
    :class="[`is-${event.tone}`, `is-${variant}`, `is-kind-${event.kind}`, `theme-${theme}`]"
    :role="event.kind === 'error' ? 'alert' : 'status'"
    :aria-live="event.kind === 'error' ? 'assertive' : 'polite'"
  >
    {{ text }}
  </p>
</template>
