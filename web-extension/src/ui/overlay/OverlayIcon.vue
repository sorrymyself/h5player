<script setup lang="ts">
export type OverlayIconName =
  | 'play'
  | 'pause'
  | 'rewind'
  | 'forward'
  | 'volume'
  | 'muted'
  | 'reset'
  | 'fullscreen'
  | 'pip'
  | 'camera'
  | 'download'
  | 'close'
  | 'retry'
  | 'media'

defineProps<{ name: OverlayIconName }>()
</script>

<template>
  <svg class="overlay-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path v-if="name === 'play'" d="m8 5 11 7-11 7V5Z" fill="currentColor" />
    <template v-else-if="name === 'pause'">
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
    </template>
    <template v-else-if="name === 'rewind'">
      <path d="m11 7-7 5 7 5V7Zm9 0-7 5 7 5V7Z" fill="currentColor" />
    </template>
    <template v-else-if="name === 'forward'">
      <path d="m4 7 7 5-7 5V7Zm9 0 7 5-7 5V7Z" fill="currentColor" />
    </template>
    <template v-else-if="name === 'volume'">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path
        d="M16 9.25a4 4 0 0 1 0 5.5M18.5 6.5a7.5 7.5 0 0 1 0 11"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </template>
    <template v-else-if="name === 'muted'">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="m16 9 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </template>
    <template v-else-if="name === 'reset'">
      <path
        d="M5.2 9A7 7 0 1 1 5 15.5"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path
        d="M5 4v5h5"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>
    <template v-else-if="name === 'fullscreen'">
      <path
        d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>
    <template v-else-if="name === 'pip'">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.8" />
      <rect x="11" y="11" width="8" height="6" rx="1" fill="currentColor" />
    </template>
    <template v-else-if="name === 'camera'">
      <path
        d="M4 8.5h4l1.5-2h5l1.5 2h4v10H4v-10Z"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <circle cx="12" cy="13.5" r="3" stroke="currentColor" stroke-width="1.8" />
    </template>
    <template v-else-if="name === 'download'">
      <path
        d="M12 4v10m-4-3 4 4 4-4M5 19h14"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>
    <template v-else-if="name === 'close'">
      <path
        d="m6 6 12 12M18 6 6 18"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </template>
    <template v-else-if="name === 'retry'">
      <path
        d="M19 8a7 7 0 1 0 .4 7"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path
        d="M19 4v4h-4"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>
    <template v-else>
      <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.8" />
      <path d="m10 9 5 3-5 3V9Z" fill="currentColor" />
    </template>
  </svg>
</template>
