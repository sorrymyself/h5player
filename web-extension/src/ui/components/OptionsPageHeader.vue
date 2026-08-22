<script setup lang="ts">
defineProps<{
  index: string
  title: string
  description: string
}>()
</script>

<template>
  <header class="page-header">
    <div class="title-lockup">
      <span class="page-index" aria-hidden="true">{{ index }}</span>
      <div>
        <h2>{{ title }}</h2>
        <p>{{ description }}</p>
      </div>
    </div>
    <div v-if="$slots['actions']" class="page-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  position: relative;
  z-index: 1;
  display: flex;
  max-width: 1040px;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--h5-space-6);
  margin-bottom: var(--h5-space-8);
}

.title-lockup {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: var(--h5-space-4);
  align-items: start;
}

.page-index {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgb(239 157 77 / 0.45);
  border-radius: var(--h5-radius-sm);
  background: rgb(239 157 77 / 0.1);
  color: var(--h5-accent-strong);
  font-family: var(--h5-font-mono);
  font-size: 11px;
  font-weight: 700;
}

h2,
p {
  margin: 0;
}

h2 {
  font-family: var(--h5-font-display);
  font-size: clamp(28px, 4vw, 42px);
  line-height: 1;
  letter-spacing: 0.025em;
}

p {
  max-width: 680px;
  margin-top: var(--h5-space-3);
  color: var(--h5-text-muted);
  font-size: 15px;
  line-height: 1.65;
}

.page-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--h5-space-2);
}

@media (max-width: 720px) {
  .page-header {
    flex-direction: column;
  }

  .page-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
