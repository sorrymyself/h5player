<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import type { OptionsApplication, OptionsSnapshot } from '../../application/ui'
import StatusBanner from '../components/StatusBanner.vue'
import { translate, type Locale, type MessageKey } from '../i18n'
import { optionsUiContextKey } from './options-context'

const props = defineProps<{ application: OptionsApplication }>()
const snapshot = ref<OptionsSnapshot | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const loading = ref(true)
const abortController = new AbortController()
let unsubscribe: (() => void) | null = null

const locale = computed<Locale>(
  () => snapshot.value?.settings.settings.data.global.ui.locale ?? 'zh-CN'
)
const t = (key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string =>
  translate(locale.value, key, params)

function applyTheme(value: OptionsSnapshot): void {
  const theme = value.settings.settings.data.global.ui.theme
  const resolved =
    theme === 'system'
      ? globalThis.matchMedia?.('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme
  globalThis.document.documentElement.dataset['theme'] = resolved
  globalThis.document.documentElement.lang = value.settings.settings.data.global.ui.locale
}

async function reload(): Promise<void> {
  loading.value = true
  try {
    const value = await props.application.load({ signal: abortController.signal })
    snapshot.value = value
    applyTheme(value)
    error.value = null
  } catch (caught) {
    if (!abortController.signal.aborted) {
      error.value = caught instanceof Error ? caught.message : 'UNKNOWN'
    }
  } finally {
    loading.value = false
  }
}

async function run(operation: () => Promise<OptionsSnapshot>): Promise<boolean> {
  busy.value = true
  error.value = null
  try {
    const value = await operation()
    snapshot.value = value
    applyTheme(value)
    return true
  } catch (caught) {
    if (!abortController.signal.aborted) {
      error.value = caught instanceof Error ? caught.message : 'UNKNOWN'
    }
    return false
  } finally {
    busy.value = false
  }
}

provide(optionsUiContextKey, {
  application: props.application,
  snapshot,
  busy,
  error,
  locale,
  t,
  reload,
  run
})

const navigation = computed(() => [
  { to: '/general', key: 'options.general' as const, glyph: '01' },
  { to: '/shortcuts', key: 'options.shortcuts' as const, glyph: '02' },
  { to: '/sites', key: 'options.sites' as const, glyph: '03' },
  { to: '/data', key: 'options.data' as const, glyph: '04' },
  { to: '/diagnostics', key: 'options.diagnostics' as const, glyph: '05' },
  { to: '/about', key: 'options.about' as const, glyph: '06' }
])

onMounted(() => {
  void reload()
  unsubscribe = props.application.subscribe(() => void reload())
})

onBeforeUnmount(() => {
  abortController.abort()
  unsubscribe?.()
  unsubscribe = null
})
</script>

<template>
  <div class="options-shell">
    <aside class="navigation-rail">
      <div class="brand-lockup">
        <p>{{ t('app.kicker') }}</p>
        <h1>{{ t('app.name') }}</h1>
        <span>{{ t('app.tagline') }}</span>
      </div>

      <nav :aria-label="t('a11y.mainNavigation')">
        <RouterLink v-for="item in navigation" :key="item.to" :to="item.to">
          <span class="nav-index" aria-hidden="true">{{ item.glyph }}</span>
          <span>{{ t(item.key) }}</span>
        </RouterLink>
      </nav>

      <div v-if="snapshot" class="build-card">
        <span>{{ t('options.phase', { value: snapshot.ping.phase }) }}</span>
        <strong>{{ t('common.version', { value: snapshot.ping.extensionVersion }) }}</strong>
        <small>
          {{
            t('options.protocol', {
              value: snapshot.ping.protocol,
              schema: snapshot.ping.settingsSchemaVersion
            })
          }}
        </small>
      </div>
    </aside>

    <main class="options-main">
      <div class="ambient-grid" aria-hidden="true" />
      <StatusBanner
        v-if="error"
        class="global-notice"
        tone="danger"
        :title="t('status.unavailable')"
        :detail="error"
      />
      <p v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</p>
      <RouterView v-else-if="snapshot" v-slot="{ Component }">
        <Transition name="route-shift" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
  </div>
</template>

<style scoped>
.options-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at 85% -10%, rgb(239 157 77 / 0.16), transparent 36%), var(--h5-bg);
}

.navigation-rail {
  position: fixed;
  z-index: 2;
  inset: 0 auto 0 0;
  display: flex;
  width: 264px;
  flex-direction: column;
  padding: 30px 22px 22px;
  border-right: 1px solid var(--h5-border-soft);
  background: linear-gradient(180deg, var(--h5-bg-elevated), var(--h5-bg));
}

.brand-lockup {
  padding: 0 10px 28px;
}

.brand-lockup p {
  margin: 0 0 5px;
  color: var(--h5-accent);
  font-family: var(--h5-font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
}

.brand-lockup h1 {
  margin: 0;
  font-family: var(--h5-font-display);
  font-size: 24px;
  letter-spacing: 0.04em;
}

.brand-lockup span {
  display: block;
  margin-top: 8px;
  color: var(--h5-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

nav {
  display: grid;
  gap: 4px;
}

nav a {
  display: grid;
  grid-template-columns: 28px 1fr;
  align-items: center;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--h5-radius-sm);
  color: var(--h5-text-muted);
  font-weight: 650;
  text-decoration: none;
  transition:
    color var(--h5-motion-fast) ease,
    border-color var(--h5-motion-fast) ease,
    transform var(--h5-motion-fast) ease;
}

nav a:hover {
  color: var(--h5-text);
  transform: translateX(2px);
}

nav a.router-link-active {
  border-color: rgb(239 157 77 / 0.45);
  background: linear-gradient(90deg, rgb(239 157 77 / 0.16), transparent);
  color: var(--h5-accent-strong);
}

.nav-index {
  color: var(--h5-text-faint);
  font-family: var(--h5-font-mono);
  font-size: 9px;
}

.build-card {
  display: grid;
  gap: 4px;
  margin-top: auto;
  padding: 14px;
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-sm);
  color: var(--h5-text-muted);
  font-family: var(--h5-font-mono);
  font-size: 10px;
}

.build-card strong {
  color: var(--h5-text);
}

.options-main {
  position: relative;
  min-height: 100vh;
  margin-left: 264px;
  padding: 52px clamp(28px, 6vw, 88px) 80px;
  overflow: hidden;
}

.ambient-grid {
  position: fixed;
  z-index: 0;
  inset: 0 0 0 264px;
  pointer-events: none;
  opacity: 0.5;
  background-image:
    linear-gradient(rgb(255 255 255 / 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 0.018) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: linear-gradient(to bottom, black, transparent 70%);
}

.global-notice,
.loading-state {
  position: relative;
  z-index: 1;
  max-width: 960px;
  margin-bottom: var(--h5-space-5);
}

.route-shift-enter-active,
.route-shift-leave-active {
  transition:
    opacity var(--h5-motion-base) ease,
    transform var(--h5-motion-base) ease;
}

.route-shift-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.route-shift-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 760px) {
  .navigation-rail {
    position: static;
    width: auto;
    min-height: auto;
  }

  nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .build-card {
    display: none;
  }

  .options-main {
    margin-left: 0;
    padding: 28px 18px 56px;
  }

  .ambient-grid {
    inset: 0;
  }
}
</style>
