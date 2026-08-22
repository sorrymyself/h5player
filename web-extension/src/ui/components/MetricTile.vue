<script setup lang="ts">
defineProps<{
  label: string
  value: string
  detail?: string | undefined
  accent?: boolean
}>()
</script>

<template>
  <div class="metric-tile" :class="{ 'is-accent': accent }">
    <span class="metric-label">{{ label }}</span>
    <strong class="metric-value">{{ value }}</strong>
    <span v-if="detail" class="metric-detail">{{ detail }}</span>
  </div>
</template>

<style scoped>
.metric-tile {
  display: grid;
  min-width: 0;
  gap: 2px;
  padding: var(--h5-space-3);
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
}

.metric-label,
.metric-detail {
  color: var(--h5-text-faint);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.metric-value {
  color: var(--h5-text);
  font-family: var(--h5-font-display);
  font-size: 22px;
  letter-spacing: 0.02em;
}

.is-accent {
  border-color: rgb(239 157 77 / 0.55);
  background:
    linear-gradient(135deg, rgb(239 157 77 / 0.18), transparent 70%), var(--h5-bg-elevated);
}

.is-accent .metric-value {
  color: var(--h5-accent-strong);
}
</style>
