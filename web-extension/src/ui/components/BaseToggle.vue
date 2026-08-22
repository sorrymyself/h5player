<script setup lang="ts">
defineProps<{
  modelValue: boolean
  label: string
  description?: string | undefined
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <label class="toggle-row" :class="{ 'is-disabled': disabled }">
    <span class="toggle-copy">
      <span class="toggle-label">{{ label }}</span>
      <span v-if="description" class="toggle-description">{{ description }}</span>
    </span>
    <input
      class="toggle-input"
      type="checkbox"
      :checked="modelValue"
      :disabled
      :aria-label="label"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb" /></span>
  </label>
</template>

<style scoped>
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--h5-space-4);
  min-height: 54px;
  cursor: pointer;
}

.toggle-copy {
  display: grid;
  gap: 2px;
}

.toggle-label {
  color: var(--h5-text);
  font-weight: 650;
}

.toggle-description {
  color: var(--h5-text-muted);
  font-size: 12px;
}

.toggle-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.toggle-track {
  display: inline-flex;
  width: 44px;
  height: 26px;
  flex: 0 0 auto;
  align-items: center;
  padding: 3px;
  border: 1px solid var(--h5-border);
  border-radius: 999px;
  background: var(--h5-bg-elevated);
  transition: background var(--h5-motion-fast) ease;
}

.toggle-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--h5-text-muted);
  box-shadow: 0 2px 4px rgb(0 0 0 / 0.25);
  transition:
    transform var(--h5-motion-fast) ease,
    background var(--h5-motion-fast) ease;
}

.toggle-input:checked + .toggle-track {
  border-color: var(--h5-accent);
  background: var(--h5-accent);
}

.toggle-input:checked + .toggle-track .toggle-thumb {
  transform: translateX(18px);
  background: var(--h5-accent-ink);
}

.toggle-input:focus-visible + .toggle-track {
  outline: 3px solid var(--h5-focus);
  outline-offset: 3px;
}

.is-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
