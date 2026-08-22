<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'info' | 'success' | 'warning' | 'danger'
    title: string
    detail?: string | undefined
  }>(),
  { tone: 'info', detail: '' }
)
</script>

<template>
  <div class="status-banner" :class="`is-${tone}`" role="status">
    <span class="status-mark" aria-hidden="true" />
    <span class="status-copy">
      <strong>{{ title }}</strong>
      <span v-if="detail">{{ detail }}</span>
    </span>
  </div>
</template>

<style scoped>
.status-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--h5-space-3);
  padding: var(--h5-space-3) var(--h5-space-4);
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-surface);
}

.status-mark {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--h5-teal);
  box-shadow: 0 0 0 4px rgb(123 199 182 / 0.12);
}

.status-copy {
  display: grid;
  gap: 2px;
}

.status-copy strong {
  font-size: 13px;
}

.status-copy span {
  color: var(--h5-text-muted);
  font-size: 12px;
}

.is-warning .status-mark {
  background: var(--h5-warning);
  box-shadow: 0 0 0 4px rgb(243 201 105 / 0.12);
}

.is-danger .status-mark {
  background: var(--h5-danger);
  box-shadow: 0 0 0 4px rgb(242 123 114 / 0.12);
}

.is-success .status-mark {
  background: var(--h5-success);
  box-shadow: 0 0 0 4px rgb(155 213 143 / 0.12);
}
</style>
