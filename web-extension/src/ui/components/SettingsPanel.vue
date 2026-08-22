<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description?: string | undefined
    compact?: boolean
  }>(),
  { description: '', compact: false }
)
</script>

<template>
  <section class="settings-panel" :class="{ 'is-compact': compact }">
    <header class="panel-header">
      <div>
        <h3>{{ title }}</h3>
        <p v-if="description">{{ description }}</p>
      </div>
      <div v-if="$slots['actions']" class="panel-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="panel-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.settings-panel {
  position: relative;
  z-index: 1;
  overflow: hidden;
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-md);
  background: linear-gradient(145deg, rgb(255 255 255 / 0.025), transparent 40%), var(--h5-surface);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.03);
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--h5-space-4);
  padding: var(--h5-space-5) var(--h5-space-6);
  border-bottom: 1px solid var(--h5-border-soft);
  background: linear-gradient(90deg, rgb(123 199 182 / 0.055), transparent 60%);
}

h3,
p {
  margin: 0;
}

h3 {
  font-family: var(--h5-font-display);
  font-size: 18px;
  letter-spacing: 0.025em;
}

p {
  max-width: 680px;
  margin-top: var(--h5-space-1);
  color: var(--h5-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--h5-space-2);
}

.panel-body {
  padding: var(--h5-space-5) var(--h5-space-6);
}

.is-compact .panel-header,
.is-compact .panel-body {
  padding: var(--h5-space-4);
}

@media (max-width: 620px) {
  .panel-header {
    flex-direction: column;
    padding: var(--h5-space-4);
  }

  .panel-body {
    padding: var(--h5-space-4);
  }

  .panel-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
