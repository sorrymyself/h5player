<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import OverlayIcon from './OverlayIcon.vue'
import { getOverlayCopy, mediaKindLabel, playbackStateLabel, stateDetail, stateTitle } from './copy'
import {
  createOverlayEvent,
  type OverlayCapabilitiesViewModel,
  type OverlayControl,
  type OverlayEvent,
  type OverlayIntent,
  type OverlayIntentSource,
  type OverlayMediaViewModel,
  type OverlayState,
  type OverlayViewModel
} from './model'

const SEEK_STEP_SECONDS = 10
const RATE_STEP = 0.1
const ZOOM_STEP = 0.1
const MIN_RATE = 0.1
const MAX_RATE = 16
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4

const props = defineProps<{ model: OverlayViewModel }>()
const emit = defineEmits<{ intent: [event: OverlayEvent] }>()

const instanceId = useId()
const titleId = `${instanceId}-title`
const descriptionId = `${instanceId}-description`
const rateLabelId = `${instanceId}-rate-label`
const volumeLabelId = `${instanceId}-volume-label`
const visualLabelId = `${instanceId}-visual-label`
const panelRef = ref<HTMLElement | null>(null)
const playButtonRef = ref<HTMLButtonElement | null>(null)

const copy = computed(() => getOverlayCopy(props.model.locale))
const media = computed(() => props.model.media)
const effectiveState = computed<OverlayState>(() => {
  if (props.model.state === 'ready' && props.model.media === null) return 'empty'
  return props.model.state
})
const isReady = computed(() => effectiveState.value === 'ready' && media.value !== null)
const duration = computed(() => {
  const value = media.value?.durationSeconds
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null
})
const timelineValue = computed(() => {
  const current = media.value?.currentTimeSeconds ?? 0
  if (!Number.isFinite(current) || current < 0) return 0
  return duration.value === null ? current : Math.min(current, duration.value)
})
const timelineMax = computed(() => duration.value ?? 1)
const volumePercent = computed(() => Math.round(clamp(media.value?.volume ?? 0, 0, 1) * 100))
const zoomPercent = computed(() =>
  Math.round(clamp(media.value?.zoom ?? 1, MIN_ZOOM, MAX_ZOOM) * 100)
)

const capabilityByControl: Record<OverlayControl, keyof OverlayCapabilitiesViewModel> = {
  playback: 'playback',
  seek: 'seek',
  'playback-rate': 'playbackRate',
  volume: 'volume',
  visual: 'visual',
  fullscreen: 'fullscreen',
  'picture-in-picture': 'pictureInPicture',
  capture: 'capture',
  download: 'download'
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function formatTime(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '--:--'
  const totalSeconds = Math.floor(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${round(value, 2).toFixed(value % 1 === 0 ? 0 : 2)}×`
}

function isBusy(control: OverlayControl): boolean {
  return props.model.busyControls.includes(control)
}

function can(control: OverlayControl): boolean {
  if (!isReady.value) return false
  const capability = capabilityByControl[control]
  return props.model.capabilities[capability] && !isBusy(control)
}

function mediaOrNull(): OverlayMediaViewModel | null {
  return isReady.value ? media.value : null
}

function dispatch(intent: OverlayIntent): void {
  emit('intent', createOverlayEvent(intent))
}

function togglePlayback(source: OverlayIntentSource): boolean {
  const current = mediaOrNull()
  if (!current || !can('playback')) return false
  dispatch({
    type: current.playbackState === 'playing' ? 'media.pause' : 'media.play',
    mediaId: current.id,
    source
  })
  return true
}

function seekBy(deltaSeconds: number, source: OverlayIntentSource): boolean {
  const current = mediaOrNull()
  if (!current || !can('seek')) return false
  dispatch({ type: 'media.seek', mediaId: current.id, deltaSeconds, source })
  return true
}

function seekTo(event: Event): void {
  const current = mediaOrNull()
  if (!current || !can('seek')) return
  const target = Number((event.currentTarget as HTMLInputElement).value)
  if (!Number.isFinite(target)) return
  dispatch({
    type: 'media.seek-to',
    mediaId: current.id,
    valueSeconds: clamp(target, 0, Math.max(duration.value ?? target, 0)),
    source: 'control'
  })
}

function changeRate(delta: number): void {
  const current = mediaOrNull()
  if (!current || !can('playback-rate')) return
  dispatch({
    type: 'media.set-rate',
    mediaId: current.id,
    value: round(clamp(current.playbackRate + delta, MIN_RATE, MAX_RATE), 2),
    source: 'control'
  })
}

function setVolume(event: Event): void {
  const current = mediaOrNull()
  if (!current || !can('volume')) return
  const value = Number((event.currentTarget as HTMLInputElement).value) / 100
  if (!Number.isFinite(value)) return
  dispatch({
    type: 'media.set-volume',
    mediaId: current.id,
    value: clamp(value, 0, 1),
    source: 'control'
  })
}

function toggleMute(source: OverlayIntentSource): boolean {
  const current = mediaOrNull()
  if (!current || !can('volume') || !props.model.capabilities.mute) return false
  dispatch({ type: 'media.toggle-mute', mediaId: current.id, source })
  return true
}

function adjustZoom(delta: number): void {
  const current = mediaOrNull()
  if (!current || !can('visual')) return
  dispatch({ type: 'visual.adjust-zoom', mediaId: current.id, delta, source: 'control' })
}

function resetVisual(): void {
  const current = mediaOrNull()
  if (!current || !can('visual')) return
  dispatch({ type: 'visual.reset', mediaId: current.id, source: 'control' })
}

function toggleFullscreen(source: OverlayIntentSource): boolean {
  const current = mediaOrNull()
  if (!current || !can('fullscreen')) return false
  dispatch({ type: 'display.toggle-fullscreen', mediaId: current.id, source })
  return true
}

function togglePictureInPicture(source: OverlayIntentSource): boolean {
  const current = mediaOrNull()
  if (!current || !can('picture-in-picture')) return false
  dispatch({
    type: 'display.toggle-picture-in-picture',
    mediaId: current.id,
    source
  })
  return true
}

function requestCapture(): void {
  const current = mediaOrNull()
  if (!current || !can('capture')) return
  dispatch({ type: 'capture.request', mediaId: current.id, source: 'control' })
}

function requestDownload(): void {
  const current = mediaOrNull()
  if (!current || !can('download')) return
  dispatch({ type: 'download.request', mediaId: current.id, source: 'control' })
}

function close(): void {
  dispatch({ type: 'overlay.close', source: 'control' })
}

function retry(): void {
  dispatch({ type: 'overlay.retry', source: 'control' })
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.model.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    dispatch({ type: 'overlay.dismiss', source: 'shortcut' })
    return
  }
  // Native controls own their keyboard handling. Shortcuts only run while the
  // focus is on the presentation shell, which also keeps editable host fields safe.
  if (event.target !== event.currentTarget) return
  const key = event.key.toLowerCase()
  let handled = false
  if (key === 'k' || event.key === ' ') handled = togglePlayback('shortcut')
  else if (event.key === 'ArrowLeft') handled = seekBy(-SEEK_STEP_SECONDS, 'shortcut')
  else if (event.key === 'ArrowRight') handled = seekBy(SEEK_STEP_SECONDS, 'shortcut')
  else if (key === 'm') handled = toggleMute('shortcut')
  else if (key === 'f') handled = toggleFullscreen('shortcut')
  else if (key === 'p') handled = togglePictureInPicture('shortcut')
  if (handled) event.preventDefault()
}

function focusOverlay(): void {
  void nextTick(() => {
    if (!props.model.open) return
    if (isReady.value && can('playback')) playButtonRef.value?.focus()
    else panelRef.value?.focus()
  })
}

defineExpose({ focusOverlay })

watch(
  () => [props.model.open, props.model.state, props.model.media?.id] as const,
  ([open]) => {
    if (open) focusOverlay()
  }
)

onMounted(() => {
  if (props.model.open) focusOverlay()
})

function stateIcon(state: OverlayState): 'media' | 'retry' {
  return state === 'error' ? 'retry' : 'media'
}

function stateRole(state: OverlayState): 'status' | 'alert' {
  return state === 'error' ? 'alert' : 'status'
}
</script>

<template>
  <Transition name="overlay-rise">
    <section
      v-if="model.open"
      ref="panelRef"
      class="overlay-panel"
      :class="`is-${model.theme}`"
      role="dialog"
      aria-modal="false"
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId"
      :aria-busy="model.busyControls.length > 0"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div class="overlay-grain" aria-hidden="true" />
      <header class="overlay-header">
        <div class="overlay-title-block">
          <span class="overlay-kicker">{{ copy.kicker }}</span>
          <h2 :id="titleId">
            {{ media?.label ?? copy.panelLabel }}
          </h2>
          <p :id="descriptionId">
            <template v-if="media">
              {{ mediaKindLabel(copy, media.kind) }} ·
              {{ playbackStateLabel(copy, media.playbackState) }}
            </template>
            <template v-else>{{ copy.panelLabel }}</template>
          </p>
        </div>
        <div class="overlay-header-actions">
          <span class="overlay-signal" :class="`is-${effectiveState}`" aria-hidden="true" />
          <button
            class="overlay-icon-button"
            type="button"
            :aria-label="copy.close"
            :title="copy.close"
            @click="close"
          >
            <OverlayIcon name="close" />
          </button>
        </div>
      </header>

      <div class="overlay-rule" aria-hidden="true" />

      <div v-if="isReady && media" class="overlay-ready">
        <div class="overlay-meta-row">
          <span class="overlay-media-chip">
            <OverlayIcon name="media" />
            {{ mediaKindLabel(copy, media.kind) }}
          </span>
          <span class="overlay-state-chip" :class="`is-${media.playbackState}`">
            {{ playbackStateLabel(copy, media.playbackState) }}
          </span>
          <span v-if="model.notice" class="overlay-notice-inline" role="status">
            {{ model.notice.message }}
          </span>
        </div>

        <div class="overlay-timeline">
          <div class="overlay-time-row">
            <output :aria-label="copy.timeline">{{ formatTime(timelineValue) }}</output>
            <span class="overlay-time-divider" aria-hidden="true">/</span>
            <output>{{ duration === null ? copy.unknownDuration : formatTime(duration) }}</output>
          </div>
          <input
            class="overlay-range overlay-range-timeline"
            type="range"
            :min="0"
            :max="timelineMax"
            step="0.1"
            :value="timelineValue"
            :disabled="!can('seek') || duration === null"
            :aria-label="copy.timeline"
            :aria-valuetext="`${formatTime(timelineValue)} / ${duration === null ? copy.unknownDuration : formatTime(duration)}`"
            @input="seekTo"
          />
        </div>

        <div class="overlay-transport" role="group" :aria-label="copy.timeline">
          <button
            class="overlay-tool-button overlay-seek-button"
            type="button"
            :disabled="!can('seek')"
            :aria-label="copy.seekBack"
            :title="copy.seekBack"
            @click="seekBy(-SEEK_STEP_SECONDS, 'control')"
          >
            <OverlayIcon name="rewind" />
            <span>10</span>
          </button>
          <button
            ref="playButtonRef"
            class="overlay-play-button"
            type="button"
            :disabled="!can('playback')"
            :aria-label="media.playbackState === 'playing' ? copy.pause : copy.play"
            :title="media.playbackState === 'playing' ? copy.pause : copy.play"
            @click="togglePlayback('control')"
          >
            <OverlayIcon :name="media.playbackState === 'playing' ? 'pause' : 'play'" />
          </button>
          <button
            class="overlay-tool-button overlay-seek-button"
            type="button"
            :disabled="!can('seek')"
            :aria-label="copy.seekForward"
            :title="copy.seekForward"
            @click="seekBy(SEEK_STEP_SECONDS, 'control')"
          >
            <span>10</span>
            <OverlayIcon name="forward" />
          </button>
        </div>

        <div class="overlay-control-grid">
          <section class="overlay-control-card" :aria-labelledby="rateLabelId">
            <div class="overlay-card-heading">
              <span :id="rateLabelId">{{ copy.playbackRate }}</span>
              <output>{{ formatRate(media.playbackRate) }}</output>
            </div>
            <div class="overlay-stepper">
              <button
                class="overlay-step-button"
                type="button"
                :disabled="!can('playback-rate')"
                :aria-label="copy.rateDown"
                :title="copy.rateDown"
                @click="changeRate(-RATE_STEP)"
              >
                −
              </button>
              <span class="overlay-step-value" aria-hidden="true">×</span>
              <button
                class="overlay-step-button"
                type="button"
                :disabled="!can('playback-rate')"
                :aria-label="copy.rateUp"
                :title="copy.rateUp"
                @click="changeRate(RATE_STEP)"
              >
                +
              </button>
            </div>
          </section>

          <section
            class="overlay-control-card overlay-volume-card"
            :aria-labelledby="volumeLabelId"
          >
            <div class="overlay-card-heading">
              <span :id="volumeLabelId">{{ copy.volume }}</span>
              <output>{{ volumePercent }}%</output>
            </div>
            <div class="overlay-volume-row">
              <OverlayIcon :name="media.muted ? 'muted' : 'volume'" />
              <input
                class="overlay-range"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="volumePercent"
                :disabled="!can('volume')"
                :aria-label="copy.volume"
                :aria-valuetext="`${volumePercent}%`"
                @input="setVolume"
              />
              <button
                class="overlay-mute-button"
                type="button"
                :disabled="!can('volume') || !model.capabilities.mute"
                :aria-pressed="media.muted"
                :aria-label="media.muted ? copy.unmute : copy.mute"
                :title="media.muted ? copy.unmute : copy.mute"
                @click="toggleMute('control')"
              >
                {{ media.muted ? 'ON' : 'OFF' }}
              </button>
            </div>
          </section>

          <section class="overlay-control-card" :aria-labelledby="visualLabelId">
            <div class="overlay-card-heading">
              <span :id="visualLabelId">{{ copy.visual }}</span>
              <output>{{ zoomPercent }}%</output>
            </div>
            <div class="overlay-stepper">
              <button
                class="overlay-step-button"
                type="button"
                :disabled="!can('visual')"
                :aria-label="copy.zoomOut"
                :title="copy.zoomOut"
                @click="adjustZoom(-ZOOM_STEP)"
              >
                −
              </button>
              <button
                class="overlay-reset-button"
                type="button"
                :disabled="!can('visual')"
                :aria-label="copy.resetVisual"
                :title="copy.resetVisual"
                @click="resetVisual"
              >
                <OverlayIcon name="reset" />
              </button>
              <button
                class="overlay-step-button"
                type="button"
                :disabled="!can('visual')"
                :aria-label="copy.zoomIn"
                :title="copy.zoomIn"
                @click="adjustZoom(ZOOM_STEP)"
              >
                +
              </button>
            </div>
          </section>
        </div>

        <div class="overlay-utility-row" role="group" :aria-label="copy.visual">
          <button
            class="overlay-utility-button"
            type="button"
            :disabled="!can('fullscreen')"
            :aria-pressed="media.fullscreen"
            :aria-label="media.fullscreen ? copy.exitFullscreen : copy.fullscreen"
            :title="media.fullscreen ? copy.exitFullscreen : copy.fullscreen"
            @click="toggleFullscreen('control')"
          >
            <OverlayIcon name="fullscreen" />
            <span>{{ media.fullscreen ? copy.exitFullscreen : copy.fullscreen }}</span>
          </button>
          <button
            class="overlay-utility-button"
            type="button"
            :disabled="!can('picture-in-picture')"
            :aria-pressed="media.pictureInPicture"
            :aria-label="media.pictureInPicture ? copy.exitPictureInPicture : copy.pictureInPicture"
            :title="media.pictureInPicture ? copy.exitPictureInPicture : copy.pictureInPicture"
            @click="togglePictureInPicture('control')"
          >
            <OverlayIcon name="pip" />
            <span>{{
              media.pictureInPicture ? copy.exitPictureInPicture : copy.pictureInPicture
            }}</span>
          </button>
          <button
            class="overlay-utility-button"
            type="button"
            :disabled="!can('capture')"
            :aria-label="copy.capture"
            :title="copy.capture"
            @click="requestCapture"
          >
            <OverlayIcon name="camera" />
            <span>{{ copy.capture }}</span>
          </button>
          <button
            class="overlay-utility-button"
            type="button"
            :disabled="!can('download')"
            :aria-label="`${copy.download} · ${copy.experimental}`"
            :title="`${copy.download} · ${copy.experimental}`"
            @click="requestDownload"
          >
            <OverlayIcon name="download" />
            <span>{{ copy.download }}</span>
            <small>{{ copy.experimental }}</small>
          </button>
        </div>
      </div>

      <div
        v-else
        class="overlay-state"
        :class="`is-${effectiveState}`"
        :role="stateRole(effectiveState)"
      >
        <div class="overlay-state-icon" aria-hidden="true">
          <span v-if="effectiveState === 'loading'" class="overlay-spinner" />
          <OverlayIcon v-else :name="stateIcon(effectiveState)" />
        </div>
        <div class="overlay-state-copy">
          <h3>{{ stateTitle(copy, effectiveState) }}</h3>
          <p>{{ model.statusDetail || stateDetail(copy, effectiveState) }}</p>
        </div>
        <button
          v-if="effectiveState !== 'loading'"
          class="overlay-retry-button"
          type="button"
          :aria-label="copy.retry"
          :title="copy.retry"
          @click="retry"
        >
          <OverlayIcon name="retry" />
          <span>{{ copy.retry }}</span>
        </button>
      </div>

      <div
        v-if="model.notice && !isReady"
        class="overlay-notice"
        :class="`is-${model.notice.tone}`"
        role="status"
        aria-live="polite"
      >
        {{ model.notice.message }}
      </div>

      <footer class="overlay-footer">
        <span>{{ copy.keyboardHint }}</span>
        <span v-if="model.busyControls.length" class="overlay-busy" role="status">
          <span class="overlay-busy-dot" aria-hidden="true" />
          {{ copy.busy }}
        </span>
      </footer>
    </section>
  </Transition>
</template>
