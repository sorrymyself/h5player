<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PopupApplication, PopupSnapshot } from '../../application/ui'
import type { MediaCommand } from '../../domain/command'
import type { PlaybackRateWriteScope } from '../../application/playback'
import BaseButton from '../components/BaseButton.vue'
import BaseToggle from '../components/BaseToggle.vue'
import MetricTile from '../components/MetricTile.vue'
import StatusBanner from '../components/StatusBanner.vue'
import { formatNumber, formatPercent, translate, type Locale, type MessageKey } from '../i18n'

const props = defineProps<{ application: PopupApplication }>()
const snapshot = ref<PopupSnapshot | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const busy = ref(false)
const error = ref<string | null>(null)
const playbackRateScope = ref<PlaybackRateWriteScope>('site')
const abortController = new AbortController()

const locale = computed<Locale>(
  () => snapshot.value?.settings.settings.data.global.ui.locale ?? 'zh-CN'
)
const t = (key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string =>
  translate(locale.value, key, params)

const activeMedia = computed(() => {
  const media = snapshot.value?.media
  if (!media?.activeMediaId) return null
  return media.media.find((item) => item.id === media.activeMediaId) ?? null
})

const playbackPolicy = computed(() => snapshot.value?.site.activePlaybackPolicy ?? null)

const policySourceLabel = computed(() => {
  const source = playbackPolicy.value?.source
  if (!source) return t('policy.unresolved')
  return t(`policy.source.${source}`)
})

const statusKey = computed<MessageKey>(() => {
  const reason = snapshot.value?.site.reason
  const map: Partial<Record<NonNullable<typeof reason>, MessageKey>> = {
    'no-active-tab': 'status.noActiveTab',
    'restricted-page': 'status.restricted',
    'permission-required': 'status.permissionRequired',
    'extension-disabled': 'status.extensionDisabled',
    'site-disabled': 'status.siteDisabled',
    'temporarily-disabled': 'status.temporaryDisabled',
    'no-media': 'status.noMedia',
    'iframe-media': 'status.iframeMedia',
    'initialization-failed': 'status.initializationFailed',
    none: 'status.ready'
  }
  return reason ? (map[reason] ?? 'status.unavailable') : 'status.connecting'
})

const statusTone = computed<'success' | 'warning' | 'danger' | 'info'>(() => {
  const reason = snapshot.value?.site.reason
  if (reason === 'none') return 'success'
  if (reason === 'initialization-failed') return 'danger'
  if (reason && reason !== 'no-media') return 'warning'
  return 'info'
})

const emptyHintKey = computed<MessageKey>(() =>
  snapshot.value?.site.reason === 'iframe-media' ? 'popup.iframeMediaHint' : 'popup.noMediaHint'
)

function applyTheme(value: PopupSnapshot): void {
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

async function load(): Promise<void> {
  state.value = 'loading'
  error.value = null
  try {
    const value = await props.application.load({ signal: abortController.signal })
    snapshot.value = value
    applyTheme(value)
    state.value = 'ready'
  } catch (caught) {
    if (!abortController.signal.aborted) {
      error.value = caught instanceof Error ? caught.message : 'UNKNOWN'
      state.value = 'error'
    }
  }
}

async function perform(operation: () => Promise<PopupSnapshot>): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const value = await operation()
    snapshot.value = value
    applyTheme(value)
  } catch (caught) {
    if (!abortController.signal.aborted) {
      error.value = caught instanceof Error ? caught.message : 'UNKNOWN'
    }
  } finally {
    busy.value = false
  }
}

async function execute(command: MediaCommand, rateScope?: PlaybackRateWriteScope): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const result = await props.application.execute(command, {
      signal: abortController.signal,
      ...(rateScope === undefined ? {} : { playbackRateScope: rateScope })
    })
    if (!result.result.ok) error.value = result.result.error.code
    snapshot.value = props.application.current()
  } catch (caught) {
    if (!abortController.signal.aborted) {
      error.value = caught instanceof Error ? caught.message : 'TARGET_UNAVAILABLE'
    }
  } finally {
    busy.value = false
  }
}

async function toggleTemporaryDisabled(): Promise<void> {
  const current = snapshot.value
  if (!current) return
  await perform(() =>
    props.application.setTemporaryDisabled(!current.site.temporaryDisabled, {
      signal: abortController.signal
    })
  )
}

async function togglePageUiHidden(): Promise<void> {
  const current = snapshot.value
  if (!current) return
  await perform(() =>
    props.application.setPageUiHidden(!current.site.pageUiHidden, {
      signal: abortController.signal
    })
  )
}

onMounted(() => void load())
onBeforeUnmount(() => abortController.abort())
</script>

<template>
  <main class="popup-shell" aria-labelledby="popup-title">
    <header class="brand-header">
      <div>
        <p class="kicker">{{ t('app.kicker') }}</p>
        <h1 id="popup-title">{{ t('app.name') }}</h1>
      </div>
      <span class="signal" :class="{ 'is-ready': state === 'ready' }" aria-hidden="true" />
    </header>

    <div class="grid-line" aria-hidden="true" />

    <p v-if="state === 'loading'" class="loading-line" role="status">
      {{ t('common.loading') }}
    </p>

    <template v-else-if="snapshot">
      <StatusBanner
        data-testid="phase-status"
        :tone="statusTone"
        :title="t(statusKey)"
        :detail="snapshot.site.tab?.hostname ?? t('popup.accessHint')"
      />

      <section v-if="activeMedia" class="media-deck" aria-labelledby="media-title">
        <div class="media-heading">
          <div>
            <span class="eyebrow">{{ t('popup.currentPage') }}</span>
            <h2 id="media-title" data-testid="active-media">
              {{ activeMedia.kind === 'audio' ? t('popup.audio') : t('popup.video') }} ·
              {{ activeMedia.state === 'active' ? t('popup.playing') : t('popup.paused') }}
            </h2>
          </div>
          <span class="adapter-chip">{{ activeMedia.adapterId }}</span>
        </div>

        <div class="meter-row" aria-hidden="true">
          <span v-for="index in 18" :key="index" :style="{ height: `${6 + (index % 5) * 3}px` }" />
        </div>

        <div class="metrics-grid">
          <MetricTile
            accent
            :label="t('popup.speed')"
            :value="`${formatNumber(activeMedia.metrics.playbackRate, locale)}×`"
          />
          <MetricTile
            :label="t('popup.volume')"
            :value="formatPercent(activeMedia.metrics.volume, locale)"
            :detail="activeMedia.metrics.muted ? t('popup.muted') : undefined"
          />
        </div>

        <div class="policy-strip" data-testid="playback-policy">
          <span>{{ t('policy.effectiveSource') }} · {{ policySourceLabel }}</span>
          <span>
            {{
              playbackPolicy?.protectAgainstSiteReset
                ? t('policy.resetProtectionOn')
                : t('policy.resetProtectionOff')
            }}
          </span>
        </div>

        <label class="rate-scope-control">
          <span id="playback-rate-scope-label">{{ t('popup.rateScope') }}</span>
          <select
            v-model="playbackRateScope"
            aria-labelledby="playback-rate-scope-label"
            :disabled="busy"
          >
            <option value="site">{{ t('scope.site') }}</option>
            <option value="page">{{ t('scope.page') }}</option>
            <option value="media">{{ t('scope.media') }}</option>
          </select>
          <small>{{ t(`scope.${playbackRateScope}Hint`) }}</small>
        </label>

        <div class="controls-grid" :aria-label="t('a11y.mediaControls')">
          <BaseButton
            kind="primary"
            class="play-button"
            :disabled="busy"
            @click="
              execute({
                type: activeMedia.state === 'active' ? 'media.pause' : 'media.play',
                mediaId: activeMedia.id
              })
            "
          >
            {{ activeMedia.state === 'active' ? t('popup.pause') : t('popup.play') }}
          </BaseButton>
          <BaseButton
            :disabled="busy || !activeMedia.capabilities.seek"
            @click="execute({ type: 'media.seek', mediaId: activeMedia.id, deltaSeconds: -10 })"
          >
            {{ t('popup.seekBack') }}
          </BaseButton>
          <BaseButton
            :disabled="busy || !activeMedia.capabilities.seek"
            @click="execute({ type: 'media.seek', mediaId: activeMedia.id, deltaSeconds: 10 })"
          >
            {{ t('popup.seekForward') }}
          </BaseButton>
          <BaseButton
            :disabled="busy || !activeMedia.capabilities.playbackRate"
            @click="
              execute(
                { type: 'media.adjust-rate', mediaId: activeMedia.id, delta: -0.1 },
                playbackRateScope
              )
            "
          >
            {{ t('popup.rateDown') }}
          </BaseButton>
          <BaseButton
            :disabled="busy || !activeMedia.capabilities.playbackRate"
            @click="
              execute(
                { type: 'media.adjust-rate', mediaId: activeMedia.id, delta: 0.1 },
                playbackRateScope
              )
            "
          >
            {{ t('popup.rateUp') }}
          </BaseButton>
          <BaseButton
            :disabled="busy || !activeMedia.capabilities.volume"
            @click="execute({ type: 'media.adjust-volume', mediaId: activeMedia.id, delta: -0.05 })"
          >
            {{ t('popup.volumeDown') }}
          </BaseButton>
          <BaseButton
            :disabled="busy || !activeMedia.capabilities.volume"
            @click="execute({ type: 'media.adjust-volume', mediaId: activeMedia.id, delta: 0.05 })"
          >
            {{ t('popup.volumeUp') }}
          </BaseButton>
          <BaseButton
            :disabled="busy || !activeMedia.capabilities.mute"
            @click="execute({ type: 'media.toggle-mute', mediaId: activeMedia.id })"
          >
            {{ activeMedia.metrics.muted ? t('popup.unmute') : t('popup.mute') }}
          </BaseButton>
        </div>
      </section>

      <section v-else class="empty-deck" aria-labelledby="empty-title">
        <span class="empty-icon" aria-hidden="true">◫</span>
        <div>
          <h2 id="empty-title">{{ t(statusKey) }}</h2>
          <p>{{ t(emptyHintKey) }}</p>
        </div>
      </section>

      <section class="access-panel" aria-labelledby="access-title">
        <div class="section-heading">
          <h2 id="access-title">{{ t('popup.siteAccess') }}</h2>
          <span class="permission-state">{{ snapshot.site.permission }}</span>
        </div>

        <div v-if="snapshot.site.permission === 'missing'" class="permission-actions">
          <p>{{ t('popup.accessHint') }}</p>
          <BaseButton
            kind="primary"
            :disabled="busy || !snapshot.permissionPattern"
            @click="
              perform(() =>
                props.application.requestCurrentSiteAccess({ signal: abortController.signal })
              )
            "
          >
            {{ t('popup.allowCurrent') }}
          </BaseButton>
          <BaseButton
            :disabled="busy"
            @click="
              perform(() =>
                props.application.requestAllSitesAccess({ signal: abortController.signal })
              )
            "
          >
            {{ t('popup.allowAll') }}
          </BaseButton>
        </div>

        <template v-else-if="snapshot.site.permission === 'granted'">
          <BaseToggle
            :model-value="snapshot.site.enabled"
            :label="t('popup.siteEnabled')"
            :disabled="busy"
            @update:model-value="
              perform(() =>
                props.application.setSiteEnabled($event, { signal: abortController.signal })
              )
            "
          />
          <div class="access-actions">
            <BaseButton kind="quiet" size="sm" :disabled="busy" @click="togglePageUiHidden">
              {{
                snapshot.site.pageUiHidden
                  ? t('mediaControls.restorePage')
                  : t('mediaControls.hidePage')
              }}
            </BaseButton>
            <BaseButton kind="quiet" size="sm" :disabled="busy" @click="toggleTemporaryDisabled">
              {{
                snapshot.site.temporaryDisabled
                  ? t('popup.temporaryEnable')
                  : t('popup.temporaryDisable')
              }}
            </BaseButton>
            <BaseButton
              kind="danger"
              size="sm"
              :disabled="busy || !snapshot.permissionPattern"
              @click="
                perform(() =>
                  props.application.revokeCurrentSiteAccess({ signal: abortController.signal })
                )
              "
            >
              {{ t('popup.revokeCurrent') }}
            </BaseButton>
          </div>
        </template>
      </section>

      <p v-if="error" class="error-line" role="alert">
        {{
          error === 'PERMISSION_DENIED'
            ? t('popup.permissionDenied')
            : t('popup.commandFailed', { code: error })
        }}
      </p>

      <footer class="popup-footer">
        <a href="/options.html" target="_blank">{{ t('common.openOptions') }}</a>
        <span>{{ t('popup.revision', { value: snapshot.settings.settings.revision }) }}</span>
        <span>{{ t('common.version', { value: snapshot.ping.extensionVersion }) }}</span>
      </footer>
    </template>

    <StatusBanner
      v-else
      tone="danger"
      :title="t('status.unavailable')"
      :detail="error ?? undefined"
    />
  </main>
</template>

<style scoped>
.popup-shell {
  position: relative;
  width: 380px;
  min-height: 520px;
  padding: 18px;
  overflow: hidden;
  background:
    radial-gradient(circle at 92% 4%, rgb(239 157 77 / 0.16), transparent 32%),
    linear-gradient(160deg, var(--h5-bg-elevated), var(--h5-bg));
}

.popup-shell::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(rgb(255 255 255 / 0.018) 1px, transparent 1px);
  background-size: 100% 6px;
  content: '';
}

.brand-header,
.media-heading,
.section-heading,
.popup-footer,
.access-actions {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--h5-space-3);
}

.kicker,
.eyebrow {
  margin: 0 0 2px;
  color: var(--h5-accent);
  font-family: var(--h5-font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-family: var(--h5-font-display);
  font-size: 21px;
  letter-spacing: 0.035em;
}

h2 {
  margin-bottom: 0;
  font-size: 14px;
}

.signal {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--h5-text-faint);
  box-shadow: 0 0 0 6px rgb(115 131 127 / 0.1);
}

.signal.is-ready {
  background: var(--h5-success);
  box-shadow:
    0 0 0 6px rgb(155 213 143 / 0.1),
    0 0 14px rgb(155 213 143 / 0.45);
}

.grid-line {
  height: 1px;
  margin: var(--h5-space-4) 0;
  background: linear-gradient(90deg, var(--h5-accent), var(--h5-border-soft) 35%, transparent);
}

.loading-line {
  color: var(--h5-text-muted);
}

.media-deck,
.empty-deck,
.access-panel {
  position: relative;
  margin-top: var(--h5-space-3);
  padding: var(--h5-space-4);
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-md);
  background: rgb(29 40 46 / 0.82);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.035);
  backdrop-filter: blur(12px);
}

:global(:root[data-theme='light']) .media-deck,
:global(:root[data-theme='light']) .empty-deck,
:global(:root[data-theme='light']) .access-panel {
  background: rgb(255 253 247 / 0.88);
}

.adapter-chip,
.permission-state {
  padding: 3px 7px;
  border: 1px solid var(--h5-border);
  border-radius: 999px;
  color: var(--h5-text-muted);
  font-family: var(--h5-font-mono);
  font-size: 9px;
  text-transform: uppercase;
}

.meter-row {
  display: flex;
  height: 24px;
  align-items: end;
  gap: 3px;
  margin: var(--h5-space-3) 0;
  opacity: 0.65;
}

.meter-row span {
  width: 3px;
  border-radius: 2px;
  background: linear-gradient(var(--h5-accent), var(--h5-teal));
}

.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--h5-space-2);
}

.policy-strip {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 10px;
  margin-top: var(--h5-space-2);
  color: var(--h5-text-muted);
  font-family: var(--h5-font-mono);
  font-size: 10px;
}

.rate-scope-control {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 5px 10px;
  margin-top: var(--h5-space-3);
  color: var(--h5-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.rate-scope-control select {
  min-height: 34px;
  width: 100%;
  padding: 0 9px;
  border: 1px solid var(--h5-border);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
  color: var(--h5-text);
}

.rate-scope-control small {
  grid-column: 1 / -1;
  color: var(--h5-text-faint);
  font-weight: 500;
  line-height: 1.45;
}

.controls-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--h5-space-2);
  margin-top: var(--h5-space-3);
}

.play-button {
  grid-column: 1 / -1;
}

.empty-deck {
  display: flex;
  align-items: center;
  gap: var(--h5-space-4);
}

.empty-deck p,
.permission-actions p {
  margin: 4px 0 0;
  color: var(--h5-text-muted);
  font-size: 12px;
}

.empty-icon {
  color: var(--h5-accent);
  font-family: var(--h5-font-display);
  font-size: 36px;
}

.permission-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--h5-space-2);
  margin-top: var(--h5-space-3);
}

.permission-actions p {
  grid-column: 1 / -1;
}

.access-actions {
  align-items: stretch;
  margin-top: var(--h5-space-2);
}

.error-line {
  position: relative;
  margin: var(--h5-space-3) 0 0;
  color: var(--h5-danger);
  font-size: 12px;
}

.popup-footer {
  margin-top: var(--h5-space-4);
  color: var(--h5-text-faint);
  font-family: var(--h5-font-mono);
  font-size: 9px;
}

.popup-footer a {
  color: var(--h5-accent-strong);
  font-family: var(--h5-font-body);
  font-size: 11px;
  font-weight: 700;
  text-decoration: none;
}
</style>
