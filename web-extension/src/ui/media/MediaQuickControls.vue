<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MediaSnapshot } from '../../domain/media'
import type { MediaPlaybackPolicyState } from '../../domain/playback'
import type { MediaFeedbackEvent } from '../../application/feedback'
import type { PlaybackRateWriteScope } from '../../application/playback'
import type { MediaCommand } from '../../domain/command'
import {
  formatMediaNumber as formatNumber,
  translateMedia as translate,
  type MediaLocale as Locale
} from './media-messages'
import { formatMediaFeedback } from './media-feedback-text'

const INITIAL_TRIGGER_VISIBLE_MS = 3_000
const INTERACTION_TRIGGER_VISIBLE_MS = 2_000

const props = withDefaults(
  defineProps<{
    media: MediaSnapshot
    policy: MediaPlaybackPolicyState | null
    feedback: MediaFeedbackEvent | null
    locale: Locale
    theme?: 'system' | 'light' | 'dark'
    compact?: boolean
    controlsVisible?: boolean
    audioGainEnabled?: boolean
  }>(),
  {
    theme: 'system',
    compact: false,
    controlsVisible: true,
    audioGainEnabled: false
  }
)

const emit = defineEmits<{
  command: [command: MediaCommand, playbackRateScope?: PlaybackRateWriteScope]
  cancelDownload: []
  hideMedia: [focusTarget: HTMLMediaElement | null]
  hidePage: [focusTarget: HTMLMediaElement | null]
}>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const expanded = ref(false)
const triggerVisible = ref(true)
const pointerInside = ref(false)
const focusInside = ref(false)
const suppressFocusExpand = ref(false)
const scope = ref<PlaybackRateWriteScope>('site')
const rateValues = [1, 1.25, 1.5, 2, 3] as const
const gainValues = [1, 2, 3, 4, 6] as const
const panelId = `h5p-media-tools-${String(props.media.id).replace(/[^a-z0-9-]/gi, '-')}`
let visibilityTimer: ReturnType<typeof globalThis.setTimeout> | null = null

const panelExpanded = computed(() => expanded.value && props.controlsVisible)
const rateLabel = computed(() => `${formatNumber(props.media.metrics.playbackRate, props.locale)}×`)
const feedbackLabel = computed(() =>
  props.feedback === null ? rateLabel.value : formatMediaFeedback(props.feedback, props.locale)
)
const rateFeedback = computed(() => {
  const commandId = props.feedback?.commandId
  return (
    commandId === 'media.set-rate' ||
    commandId === 'media.adjust-rate' ||
    commandId === 'playback.policy' ||
    props.feedback?.messageKey.startsWith('feedback.playback-rate')
  )
})
const downloadQueued = computed(
  () =>
    props.feedback?.commandId === 'media.download' &&
    props.feedback.messageKey === 'feedback.downloadQueued'
)
const triggerLabel = computed(() => (rateFeedback.value ? rateLabel.value : feedbackLabel.value))
const policyLabel = computed(() => {
  if (!props.policy) return ''
  return `${translate(props.locale, `policy.source.${props.policy.source}`)} · ${translate(
    props.locale,
    props.policy.protectAgainstSiteReset ? 'policy.protected' : 'policy.unprotected'
  )}`
})

function clearVisibilityTimer(): void {
  if (visibilityTimer === null) return
  globalThis.clearTimeout(visibilityTimer)
  visibilityTimer = null
}

function showTrigger(): void {
  clearVisibilityTimer()
  triggerVisible.value = true
}

function scheduleTriggerHide(delayMs: number): void {
  clearVisibilityTimer()
  if (pointerInside.value || focusInside.value || panelExpanded.value) return
  visibilityTimer = globalThis.setTimeout(() => {
    visibilityTimer = null
    if (pointerInside.value || focusInside.value || panelExpanded.value) return
    triggerVisible.value = false
  }, delayMs)
}

function openFromPointer(): void {
  pointerInside.value = true
  showTrigger()
  if (props.controlsVisible) expanded.value = true
}

function openFromFocus(): void {
  showTrigger()
  if (suppressFocusExpand.value) {
    suppressFocusExpand.value = false
    return
  }
  focusInside.value = true
  if (props.controlsVisible) expanded.value = true
}

function collapse(restoreFocus = false): void {
  expanded.value = false
  if (restoreFocus) {
    suppressFocusExpand.value = true
    void nextTick(() => trigger.value?.focus())
  }
}

function closeFromPointer(): void {
  pointerInside.value = false
  collapse()
  scheduleTriggerHide(INTERACTION_TRIGGER_VISIBLE_MS)
}

function handleFocusOut(event: FocusEvent): void {
  const nextTarget = event.relatedTarget
  if (nextTarget instanceof Node && root.value?.contains(nextTarget)) return
  focusInside.value = false
  collapse()
  scheduleTriggerHide(INTERACTION_TRIGGER_VISIBLE_MS)
}

function handleDocumentPointerDown(): void {
  pointerInside.value = false
  focusInside.value = false
  suppressFocusExpand.value = false
  collapse()
  scheduleTriggerHide(INTERACTION_TRIGGER_VISIBLE_MS)
}

function handleRootPointerDown(): void {
  pointerInside.value = true
  showTrigger()
}

function handleTabBoundary(event: KeyboardEvent): void {
  if (!panelExpanded.value || event.key !== 'Tab') return
  const focusable = root.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
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

function toggleExpanded(): void {
  showTrigger()
  if (pointerInside.value) {
    expanded.value = true
    return
  }
  expanded.value = !expanded.value
  if (expanded.value) clearVisibilityTimer()
  else scheduleTriggerHide(INTERACTION_TRIGGER_VISIBLE_MS)
}

function togglePlay(): void {
  emit('command', {
    type: props.media.state === 'active' ? 'media.pause' : 'media.play',
    mediaId: props.media.id
  })
}

function setRate(value: number): void {
  emit('command', { type: 'media.set-rate', mediaId: props.media.id, value }, scope.value)
}

function setGain(value: number): void {
  emit('command', { type: 'media.set-gain', mediaId: props.media.id, value })
}

function seek(deltaSeconds: number): void {
  emit('command', { type: 'media.seek', mediaId: props.media.id, deltaSeconds })
}

function toggleMute(): void {
  emit('command', { type: 'media.toggle-mute', mediaId: props.media.id })
}

function cancelPendingDownload(): void {
  collapse()
  emit('cancelDownload')
}

function mediaFocusTarget(): HTMLMediaElement | null {
  const rootNode = root.value?.getRootNode()
  if (!(rootNode instanceof ShadowRoot)) return null
  const hostParent = rootNode.host.parentElement
  if (hostParent instanceof HTMLMediaElement) return hostParent
  const previous = rootNode.host.previousElementSibling
  if (previous instanceof HTMLMediaElement) return previous
  return null
}

function hideMediaControls(): void {
  collapse()
  emit('hideMedia', mediaFocusTarget())
}

function hidePageControls(): void {
  collapse()
  emit('hidePage', mediaFocusTarget())
}

watch(
  () => props.feedback,
  (event) => {
    if (event === null) return
    showTrigger()
    if (!pointerInside.value && !focusInside.value) {
      scheduleTriggerHide(INTERACTION_TRIGGER_VISIBLE_MS)
    }
  }
)
watch(
  () => props.media.state,
  (state, previousState) => {
    if (state !== 'paused' || previousState === 'paused') return
    pointerInside.value = false
    focusInside.value = false
    suppressFocusExpand.value = false
    collapse()
    scheduleTriggerHide(INTERACTION_TRIGGER_VISIBLE_MS)
  }
)
watch(
  () => props.controlsVisible,
  (visible) => {
    if (visible) return
    collapse()
    if (props.feedback === null) scheduleTriggerHide(INTERACTION_TRIGGER_VISIBLE_MS)
  }
)

onMounted(() => {
  globalThis.document.addEventListener('pointerdown', handleDocumentPointerDown)
  scheduleTriggerHide(INITIAL_TRIGGER_VISIBLE_MS)
})
onBeforeUnmount(() => {
  clearVisibilityTimer()
  globalThis.document.removeEventListener('pointerdown', handleDocumentPointerDown)
})
</script>

<template>
  <div
    ref="root"
    class="media-tools"
    :class="[
      `theme-${theme}`,
      {
        'is-expanded': panelExpanded,
        'is-compact': compact,
        'is-dormant': !triggerVisible,
        'has-feedback': feedback !== null,
        [`is-feedback-${feedback?.tone ?? 'neutral'}`]: feedback !== null
      }
    ]"
    @pointerdown.stop="handleRootPointerDown"
    @mouseleave="closeFromPointer"
    @focusin="openFromFocus"
    @focusout="handleFocusOut"
    @keydown.esc.prevent.stop="collapse(true)"
    @keydown.tab="handleTabBoundary"
  >
    <div
      v-if="controlsVisible"
      class="media-tools__trigger-hitbox"
      data-testid="media-rate-hitbox"
      @mouseenter="openFromPointer"
    >
      <button
        ref="trigger"
        type="button"
        class="media-tools__trigger"
        :aria-expanded="panelExpanded"
        :aria-controls="panelId"
        :aria-label="`${translate(locale, 'mediaControls.open')}: ${feedbackLabel}`"
        :title="feedbackLabel"
        @click="toggleExpanded"
      >
        <span class="media-tools__rate-label">{{ triggerLabel }}</span>
        <span class="media-tools__sr-status" role="status" aria-live="polite">{{
          feedbackLabel
        }}</span>
      </button>
    </div>
    <div
      v-else-if="feedback"
      class="media-tools__trigger media-tools__status"
      :class="`is-${feedback.tone}`"
      role="status"
      aria-live="polite"
      :title="feedbackLabel"
    >
      <span class="media-tools__rate-label">{{ triggerLabel }}</span>
    </div>

    <div
      v-if="controlsVisible && panelExpanded"
      :id="panelId"
      class="media-tools__panel"
      role="toolbar"
      :aria-label="translate(locale, 'a11y.mediaControls')"
    >
      <div
        class="media-tools__transport"
        role="group"
        :aria-label="translate(locale, 'popup.play')"
      >
        <button
          type="button"
          class="media-tools__primary-action"
          :aria-label="translate(locale, media.state === 'active' ? 'popup.pause' : 'popup.play')"
          :title="translate(locale, media.state === 'active' ? 'popup.pause' : 'popup.play')"
          @click="togglePlay"
        >
          <span aria-hidden="true">{{ media.state === 'active' ? 'Ⅱ' : '▶' }}</span>
        </button>
        <button
          type="button"
          :aria-label="translate(locale, 'popup.seekBack')"
          :title="translate(locale, 'popup.seekBack')"
          :disabled="!media.capabilities.seek"
          @click="seek(-10)"
        >
          −10
        </button>
        <button
          type="button"
          :aria-label="translate(locale, 'popup.seekForward')"
          :title="translate(locale, 'popup.seekForward')"
          :disabled="!media.capabilities.seek"
          @click="seek(10)"
        >
          +10
        </button>
        <button
          type="button"
          :aria-label="translate(locale, media.metrics.muted ? 'popup.unmute' : 'popup.mute')"
          :title="translate(locale, media.metrics.muted ? 'popup.unmute' : 'popup.mute')"
          :aria-pressed="media.metrics.muted"
          :disabled="!media.capabilities.mute"
          @click="toggleMute"
        >
          <span aria-hidden="true">{{ media.metrics.muted ? '🔇' : '🔊' }}</span>
        </button>
      </div>

      <div class="media-tools__section" role="group" :aria-label="translate(locale, 'popup.speed')">
        <span class="media-tools__section-label" aria-hidden="true">{{
          translate(locale, 'popup.speed')
        }}</span>
        <div class="rate-options">
          <button
            v-for="value in rateValues"
            :key="value"
            type="button"
            :class="{ 'is-current': Math.abs(media.metrics.playbackRate - value) < 0.01 }"
            @click="setRate(value)"
          >
            {{ value }}×
          </button>
        </div>
      </div>

      <div
        v-if="audioGainEnabled && media.capabilities.audioGain"
        class="media-tools__section"
        role="group"
        :aria-label="translate(locale, 'popup.audioGain')"
      >
        <span class="media-tools__section-label" aria-hidden="true">{{
          translate(locale, 'popup.audioGain')
        }}</span>
        <div class="rate-options">
          <button
            v-for="value in gainValues"
            :key="value"
            type="button"
            :class="{ 'is-current': Math.abs((media.metrics.gain ?? 1) - value) < 0.01 }"
            @click="setGain(value)"
          >
            {{ value }}×
          </button>
        </div>
      </div>

      <div class="media-tools__settings-row">
        <label class="media-tools__scope">
          <span class="media-tools__sr-only">{{ translate(locale, 'popup.rateScope') }}</span>
          <select v-model="scope" :aria-label="translate(locale, 'popup.rateScope')">
            <option value="site">{{ translate(locale, 'scope.site') }}</option>
            <option value="page">{{ translate(locale, 'scope.page') }}</option>
            <option value="media">{{ translate(locale, 'scope.media') }}</option>
          </select>
        </label>
        <div
          class="media-tools__utility"
          role="group"
          :aria-label="translate(locale, 'mediaControls.open')"
        >
          <button
            type="button"
            :aria-label="translate(locale, 'mediaControls.hideMedia')"
            :title="translate(locale, 'mediaControls.hideMedia')"
            @click="hideMediaControls"
          >
            <span aria-hidden="true">×</span>
          </button>
          <button
            type="button"
            :aria-label="translate(locale, 'mediaControls.hidePage')"
            :title="translate(locale, 'mediaControls.hidePage')"
            @click="hidePageControls"
          >
            <span aria-hidden="true">⊘</span>
          </button>
        </div>
      </div>

      <div v-if="policy" class="media-tools__policy" :title="policyLabel">
        <span class="media-tools__policy-dot" aria-hidden="true" />
        <span>{{ policyLabel }}</span>
      </div>
      <button
        v-if="downloadQueued"
        type="button"
        class="media-tools__cancel-download"
        @click="cancelPendingDownload"
      >
        {{ translate(locale, 'mediaControls.cancelDownload') }}
      </button>
    </div>
  </div>
</template>
