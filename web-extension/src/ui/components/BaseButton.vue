<script setup lang="ts">
withDefaults(
  defineProps<{
    kind?: 'primary' | 'secondary' | 'quiet' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
  }>(),
  { kind: 'secondary', size: 'md', disabled: false, type: 'button' }
)
</script>

<template>
  <button class="base-button" :class="[`is-${kind}`, `is-${size}`]" :disabled :type>
    <span class="button-label"><slot /></span>
  </button>
</template>

<style scoped>
.base-button {
  position: relative;
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: var(--h5-space-2);
  border: 1px solid transparent;
  border-radius: var(--h5-radius-sm);
  cursor: pointer;
  font-weight: 700;
  letter-spacing: 0.01em;
  transition:
    transform var(--h5-motion-fast) ease,
    background var(--h5-motion-fast) ease,
    border-color var(--h5-motion-fast) ease;
}

.base-button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.base-button:active:not(:disabled) {
  transform: translateY(1px);
}

.base-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.is-sm {
  min-height: 32px;
  padding: 0 var(--h5-space-3);
  font-size: 12px;
}

.is-md {
  padding: 0 var(--h5-space-4);
}

.is-lg {
  min-height: 48px;
  padding: 0 var(--h5-space-5);
}

.is-primary {
  background: var(--h5-accent);
  color: var(--h5-accent-ink);
  box-shadow: 0 8px 18px rgb(239 157 77 / 0.2);
}

.is-primary:hover:not(:disabled) {
  background: var(--h5-accent-strong);
}

.is-secondary {
  border-color: var(--h5-border);
  background: var(--h5-surface);
  color: var(--h5-text);
}

.is-secondary:hover:not(:disabled),
.is-quiet:hover:not(:disabled) {
  border-color: var(--h5-accent);
  background: var(--h5-surface-raised);
}

.is-quiet {
  border-color: transparent;
  background: transparent;
  color: var(--h5-text-muted);
}

.is-danger {
  border-color: rgb(242 123 114 / 0.5);
  background: rgb(242 123 114 / 0.12);
  color: var(--h5-danger);
}
</style>
