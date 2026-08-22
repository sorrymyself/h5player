<script setup lang="ts">
import { computed, ref } from 'vue'
import BaseButton from '../../components/BaseButton.vue'
import BaseToggle from '../../components/BaseToggle.vue'
import ConfirmDialog from '../../components/ConfirmDialog.vue'
import MetricTile from '../../components/MetricTile.vue'
import OptionsPageHeader from '../../components/OptionsPageHeader.vue'
import SettingsPanel from '../../components/SettingsPanel.vue'
import StatusBanner from '../../components/StatusBanner.vue'
import { useOptionsContext } from '../options-context'

const { application, snapshot, busy, t, run } = useOptionsContext()
const revokeDialogOpen = ref(false)
const pendingRemoval = ref<string | null>(null)
const playbackRateDrafts = ref<Record<string, string>>({})
const playbackRateErrors = ref<Record<string, boolean>>({})
const mouseLongPressDrafts = ref<Record<string, string>>({})
const mouseLongPressErrors = ref<Record<string, boolean>>({})

const grantedOrigins = computed(() => snapshot.value?.grantedOrigins ?? [])
const siteEntries = computed(() =>
  Object.entries(snapshot.value?.settings.settings.data.sites ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([origin, rule]) => {
      let hostname = origin
      try {
        hostname = new globalThis.URL(origin).hostname
      } catch {
        // Settings schema normally guarantees an origin; keep malformed legacy data displayable.
      }
      return {
        origin,
        rule,
        hostname,
        monogram: hostname.slice(0, 1).toUpperCase() || '?',
        playbackRate:
          rule.media?.defaultPlaybackRate ??
          snapshot.value?.settings.settings.data.global.media.defaultPlaybackRate ??
          1,
        inheritsPlaybackRate: rule.media?.defaultPlaybackRate === undefined,
        protectPlaybackRate:
          rule.policies?.protectPlaybackRate ??
          snapshot.value?.settings.settings.data.global.policies.protectPlaybackRate ??
          false,
        inheritsProtection: rule.policies?.protectPlaybackRate === undefined,
        downloadEnabled:
          rule.download?.enabled ??
          snapshot.value?.settings.settings.data.global.download?.enabled ??
          true,
        inheritsDownload: rule.download?.enabled === undefined,
        allowAcousticGain:
          rule.policies?.allowAcousticGain ??
          snapshot.value?.settings.settings.data.global.policies.allowAcousticGain ??
          false,
        inheritsAcousticGain: rule.policies?.allowAcousticGain === undefined,
        allowMouseLongPress:
          rule.policies?.allowMouseLongPress ??
          snapshot.value?.settings.settings.data.global.policies.allowMouseLongPress ??
          false,
        inheritsMouseLongPress: rule.policies?.allowMouseLongPress === undefined,
        mouseLongPressMs:
          rule.policies?.mouseLongPressMs ??
          snapshot.value?.settings.settings.data.global.policies.mouseLongPressMs ??
          600,
        inheritsMouseLongPressMs: rule.policies?.mouseLongPressMs === undefined,
        allowAutoplay:
          rule.policies?.allowAutoplay ??
          snapshot.value?.settings.settings.data.global.policies.allowAutoplay ??
          false,
        inheritsAutoplay: rule.policies?.allowAutoplay === undefined
      }
    })
)
const allSitesGranted = computed(() =>
  grantedOrigins.value.some(
    (origin) => origin === '<all_urls>' || origin === '*://*/*' || origin === 'http://*/*'
  )
)

async function requestAllSites(): Promise<void> {
  await run(() => application.requestAllSites())
}

async function revokeAllSites(): Promise<void> {
  revokeDialogOpen.value = false
  await run(() => application.revokeAllSites())
}

async function setSiteEnabled(origin: string, enabled: boolean): Promise<void> {
  await run(() => application.setSiteEnabled(origin, enabled))
}

async function setSitePlaybackRate(origin: string, raw: string): Promise<void> {
  playbackRateDrafts.value[origin] = raw
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0.1 || value > 16) {
    playbackRateErrors.value[origin] = true
    return
  }
  playbackRateErrors.value[origin] = false
  const saved = await run(() => application.setSitePlaybackRate(origin, value))
  if (saved) delete playbackRateDrafts.value[origin]
}

async function setSitePlaybackProtection(origin: string, enabled: boolean): Promise<void> {
  await run(() => application.setSitePlaybackProtection(origin, enabled))
}

async function restoreSitePlaybackRate(origin: string): Promise<void> {
  playbackRateErrors.value[origin] = false
  delete playbackRateDrafts.value[origin]
  await run(() => application.restoreSitePlaybackRate(origin))
}

async function restoreSitePlaybackProtection(origin: string): Promise<void> {
  await run(() => application.restoreSitePlaybackProtection(origin))
}

async function setSiteDownload(origin: string, enabled: boolean): Promise<void> {
  await run(() => application.setSiteDownloadEnabled(origin, enabled))
}

async function restoreSiteDownload(origin: string): Promise<void> {
  await run(() => application.restoreSiteDownload(origin))
}

async function setSiteExperimentalPolicy(
  origin: string,
  patch: {
    allowAcousticGain?: boolean
    allowMouseLongPress?: boolean
    mouseLongPressMs?: number
    allowAutoplay?: boolean
  }
): Promise<void> {
  await run(() => application.setSiteExperimentalPolicy(origin, patch))
}

async function restoreSiteExperimentalPolicy(
  origin: string,
  key: 'allowAcousticGain' | 'allowMouseLongPress' | 'mouseLongPressMs' | 'allowAutoplay'
): Promise<void> {
  await run(() => application.restoreSiteExperimentalPolicy(origin, key))
}

async function setSiteMouseLongPressMs(origin: string, raw: string): Promise<void> {
  mouseLongPressDrafts.value[origin] = raw
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 200 || value > 2_000) {
    mouseLongPressErrors.value[origin] = true
    return
  }
  mouseLongPressErrors.value[origin] = false
  const saved = await run(() =>
    application.setSiteExperimentalPolicy(origin, { mouseLongPressMs: value })
  )
  if (saved) delete mouseLongPressDrafts.value[origin]
}

async function removeSite(): Promise<void> {
  const origin = pendingRemoval.value
  pendingRemoval.value = null
  if (origin) await run(() => application.removeSite(origin))
}
</script>

<template>
  <div class="options-page">
    <OptionsPageHeader
      index="03"
      :title="t('options.sitesTitle')"
      :description="t('options.sitesDescription')"
    >
      <template #actions>
        <BaseButton kind="primary" :disabled="busy || allSitesGranted" @click="requestAllSites">
          {{ t('options.allowAllSites') }}
        </BaseButton>
        <BaseButton
          kind="danger"
          :disabled="busy || grantedOrigins.length === 0"
          @click="revokeDialogOpen = true"
        >
          {{ t('options.revokeAllSites') }}
        </BaseButton>
      </template>
    </OptionsPageHeader>

    <StatusBanner
      class="page-notice"
      :tone="grantedOrigins.length > 0 ? 'success' : 'warning'"
      :title="
        grantedOrigins.length > 0 ? t('options.siteAccessReady') : t('status.permissionRequired')
      "
      :detail="allSitesGranted ? t('options.allSitesGranted') : t('options.scopedSitesGranted')"
    />

    <div class="metrics-row">
      <MetricTile
        accent
        :label="t('options.grantedOrigins')"
        :value="String(grantedOrigins.length)"
        :detail="allSitesGranted ? t('options.permissionAll') : t('options.permissionScoped')"
      />
      <MetricTile
        :label="t('options.siteRules')"
        :value="String(siteEntries.length)"
        :detail="t('options.rulesStoredLocally')"
      />
    </div>

    <div class="panel-stack">
      <SettingsPanel
        :title="t('options.permissionScope')"
        :description="t('options.permissionScopeDescription')"
      >
        <ul v-if="grantedOrigins.length > 0" class="origin-list">
          <li v-for="origin in grantedOrigins" :key="origin">
            <span class="origin-signal" aria-hidden="true" />
            <code>{{ origin }}</code>
          </li>
        </ul>
        <div v-else class="empty-state">
          <span aria-hidden="true">∅</span>
          <p>{{ t('options.noGrantedOrigins') }}</p>
        </div>
      </SettingsPanel>

      <SettingsPanel :title="t('options.siteRules')" :description="t('options.sitePrivacyHint')">
        <div v-if="siteEntries.length > 0" class="site-rule-list">
          <article v-for="entry in siteEntries" :key="entry.origin" class="site-rule">
            <div class="site-identity">
              <span class="site-monogram" aria-hidden="true">{{ entry.monogram }}</span>
              <div>
                <strong>{{ entry.hostname }}</strong>
                <code>{{ entry.origin }}</code>
              </div>
            </div>
            <div class="site-actions">
              <div class="site-policy-field">
                <label :for="`site-playback-rate-${entry.origin}`">
                  {{ t('options.sitePlaybackRate') }}
                </label>
                <span class="site-policy-input">
                  <input
                    :id="`site-playback-rate-${entry.origin}`"
                    :value="playbackRateDrafts[entry.origin] ?? entry.playbackRate"
                    :name="`site-playback-rate-${entry.hostname}`"
                    type="number"
                    min="0.1"
                    max="16"
                    step="0.1"
                    inputmode="decimal"
                    autocomplete="off"
                    :aria-invalid="playbackRateErrors[entry.origin] ? 'true' : 'false'"
                    :aria-describedby="
                      playbackRateErrors[entry.origin]
                        ? `site-playback-rate-error-${entry.origin}`
                        : undefined
                    "
                    :disabled="busy"
                    @input="
                      playbackRateDrafts[entry.origin] = ($event.target as HTMLInputElement).value
                    "
                    @change="
                      setSitePlaybackRate(entry.origin, ($event.target as HTMLInputElement).value)
                    "
                  />
                  <small v-if="entry.inheritsPlaybackRate">{{ t('options.inheritsGlobal') }}</small>
                  <small
                    v-if="playbackRateErrors[entry.origin]"
                    :id="`site-playback-rate-error-${entry.origin}`"
                    class="site-policy-error"
                    role="alert"
                  >
                    {{ t('options.sitePlaybackRateError') }}
                  </small>
                  <BaseButton
                    v-if="!entry.inheritsPlaybackRate"
                    kind="quiet"
                    size="sm"
                    :disabled="busy"
                    @click="restoreSitePlaybackRate(entry.origin)"
                  >
                    {{ t('options.restoreGlobalPlaybackRate') }}
                  </BaseButton>
                </span>
              </div>
              <div class="site-protection-field">
                <BaseToggle
                  :model-value="entry.protectPlaybackRate"
                  :label="t('options.siteProtectRate')"
                  :description="
                    entry.inheritsProtection ? t('options.inheritsGlobalProtection') : undefined
                  "
                  :disabled="busy"
                  @update:model-value="setSitePlaybackProtection(entry.origin, $event)"
                />
                <BaseButton
                  v-if="!entry.inheritsProtection"
                  kind="quiet"
                  size="sm"
                  :disabled="busy"
                  @click="restoreSitePlaybackProtection(entry.origin)"
                >
                  {{ t('options.restoreGlobalProtection') }}
                </BaseButton>
              </div>
              <div class="site-protection-field">
                <BaseToggle
                  :model-value="entry.downloadEnabled"
                  :label="t('options.siteDownloadEnabled')"
                  :description="
                    entry.inheritsDownload ? t('options.inheritsGlobalDownload') : undefined
                  "
                  :disabled="busy"
                  @update:model-value="setSiteDownload(entry.origin, $event)"
                />
                <BaseButton
                  v-if="!entry.inheritsDownload"
                  kind="quiet"
                  size="sm"
                  :disabled="busy"
                  @click="restoreSiteDownload(entry.origin)"
                >
                  {{ t('options.restoreGlobalDownload') }}
                </BaseButton>
              </div>
              <div class="site-experimental-fields">
                <div class="site-protection-field">
                  <BaseToggle
                    :model-value="entry.allowAcousticGain"
                    :label="t('options.siteAllowAcousticGain')"
                    :description="
                      entry.inheritsAcousticGain
                        ? t('options.inheritsGlobalExperimentalPolicy')
                        : undefined
                    "
                    :disabled="busy"
                    @update:model-value="
                      setSiteExperimentalPolicy(entry.origin, { allowAcousticGain: $event })
                    "
                  />
                  <BaseButton
                    v-if="!entry.inheritsAcousticGain"
                    kind="quiet"
                    size="sm"
                    :disabled="busy"
                    @click="restoreSiteExperimentalPolicy(entry.origin, 'allowAcousticGain')"
                  >
                    {{ t('options.restoreGlobalExperimentalPolicy') }}
                  </BaseButton>
                </div>
                <div class="site-protection-field">
                  <BaseToggle
                    :model-value="entry.allowMouseLongPress"
                    :label="t('options.siteAllowMouseLongPress')"
                    :description="
                      entry.inheritsMouseLongPress
                        ? t('options.inheritsGlobalExperimentalPolicy')
                        : undefined
                    "
                    :disabled="busy"
                    @update:model-value="
                      setSiteExperimentalPolicy(entry.origin, { allowMouseLongPress: $event })
                    "
                  />
                  <BaseButton
                    v-if="!entry.inheritsMouseLongPress"
                    kind="quiet"
                    size="sm"
                    :disabled="busy"
                    @click="restoreSiteExperimentalPolicy(entry.origin, 'allowMouseLongPress')"
                  >
                    {{ t('options.restoreGlobalExperimentalPolicy') }}
                  </BaseButton>
                </div>
                <div class="site-policy-field">
                  <label :for="`site-mouse-long-press-${entry.origin}`">
                    {{ t('options.siteMouseLongPressMs') }}
                  </label>
                  <span class="site-policy-input">
                    <input
                      :id="`site-mouse-long-press-${entry.origin}`"
                      :value="mouseLongPressDrafts[entry.origin] ?? entry.mouseLongPressMs"
                      type="number"
                      min="200"
                      max="2000"
                      step="50"
                      inputmode="numeric"
                      :disabled="busy"
                      :aria-invalid="mouseLongPressErrors[entry.origin] ? 'true' : 'false'"
                      @input="
                        mouseLongPressDrafts[entry.origin] = (
                          $event.target as HTMLInputElement
                        ).value
                      "
                      @change="
                        setSiteMouseLongPressMs(
                          entry.origin,
                          ($event.target as HTMLInputElement).value
                        )
                      "
                    />
                    <small v-if="entry.inheritsMouseLongPressMs">
                      {{ t('options.inheritsGlobalExperimentalPolicy') }}
                    </small>
                    <small
                      v-if="mouseLongPressErrors[entry.origin]"
                      class="site-policy-error"
                      role="alert"
                    >
                      {{ t('options.mouseLongPressRange') }}
                    </small>
                    <BaseButton
                      v-if="!entry.inheritsMouseLongPressMs"
                      kind="quiet"
                      size="sm"
                      :disabled="busy"
                      @click="restoreSiteExperimentalPolicy(entry.origin, 'mouseLongPressMs')"
                    >
                      {{ t('options.restoreGlobalExperimentalPolicy') }}
                    </BaseButton>
                  </span>
                </div>
                <div class="site-protection-field">
                  <BaseToggle
                    :model-value="entry.allowAutoplay"
                    :label="t('options.siteAllowAutoplay')"
                    :description="
                      entry.inheritsAutoplay
                        ? t('options.inheritsGlobalExperimentalPolicy')
                        : undefined
                    "
                    :disabled="busy"
                    @update:model-value="
                      setSiteExperimentalPolicy(entry.origin, { allowAutoplay: $event })
                    "
                  />
                  <BaseButton
                    v-if="!entry.inheritsAutoplay"
                    kind="quiet"
                    size="sm"
                    :disabled="busy"
                    @click="restoreSiteExperimentalPolicy(entry.origin, 'allowAutoplay')"
                  >
                    {{ t('options.restoreGlobalExperimentalPolicy') }}
                  </BaseButton>
                </div>
              </div>
              <BaseToggle
                :model-value="entry.rule.enabled"
                :label="t('options.siteEnabled')"
                :disabled="busy"
                @update:model-value="setSiteEnabled(entry.origin, $event)"
              />
              <BaseButton
                kind="quiet"
                size="sm"
                :disabled="busy"
                @click="pendingRemoval = entry.origin"
              >
                {{ t('options.removeSite') }}
              </BaseButton>
            </div>
          </article>
        </div>
        <div v-else class="empty-state">
          <span aria-hidden="true">—</span>
          <p>{{ t('options.noSites') }}</p>
        </div>
      </SettingsPanel>
    </div>

    <ConfirmDialog
      :open="revokeDialogOpen"
      :title="t('options.revokeAllSitesTitle')"
      :description="t('options.revokeAllSitesDescription')"
      :confirm-label="t('options.revokeAllSites')"
      :cancel-label="t('common.cancel')"
      :busy="busy"
      danger
      @cancel="revokeDialogOpen = false"
      @confirm="revokeAllSites"
    />

    <ConfirmDialog
      :open="pendingRemoval !== null"
      :title="t('options.removeSiteTitle')"
      :description="t('options.removeSiteDescription')"
      :confirm-label="t('common.remove')"
      :cancel-label="t('common.cancel')"
      :busy="busy"
      danger
      @cancel="pendingRemoval = null"
      @confirm="removeSite"
    >
      {{ pendingRemoval }}
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.options-page {
  max-width: 1040px;
}

.page-notice,
.metrics-row {
  margin-bottom: var(--h5-space-5);
}

.metrics-row {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--h5-space-3);
}

.panel-stack {
  display: grid;
  gap: var(--h5-space-5);
}

.origin-list,
.site-rule-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.origin-list {
  display: grid;
  gap: var(--h5-space-2);
}

.origin-list li {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: var(--h5-space-3);
  padding: 0 var(--h5-space-3);
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
}

.origin-signal {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--h5-success);
  box-shadow: 0 0 0 4px rgb(155 213 143 / 0.1);
}

code {
  overflow-wrap: anywhere;
  color: var(--h5-text-muted);
  font-family: var(--h5-font-mono);
  font-size: 11px;
}

.site-rule + .site-rule {
  border-top: 1px solid var(--h5-border-soft);
}

.site-rule {
  display: flex;
  min-height: 82px;
  align-items: center;
  justify-content: space-between;
  gap: var(--h5-space-4);
  padding: var(--h5-space-3) 0;
}

.site-identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--h5-space-3);
}

.site-identity > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.site-monogram {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--h5-border);
  border-radius: 50%;
  color: var(--h5-accent-strong);
  font-family: var(--h5-font-display);
}

.site-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--h5-space-4);
}

.site-experimental-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  gap: var(--h5-space-3);
}

.site-policy-field {
  display: grid;
  gap: 5px;
  color: var(--h5-text-muted);
  font-size: 11px;
  font-weight: 650;
}

.site-policy-input {
  display: grid;
  justify-items: end;
  gap: 2px;
}

.site-protection-field {
  display: grid;
  justify-items: end;
}

.site-policy-input input {
  width: 82px;
  min-height: 36px;
  padding: 0 9px;
  border: 1px solid var(--h5-border);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
  color: var(--h5-accent-strong);
  font-family: var(--h5-font-mono);
}

.site-policy-input small {
  color: var(--h5-text-faint);
  font-size: 9px;
}

.site-policy-input .site-policy-error {
  max-width: 200px;
  color: var(--h5-danger);
  text-align: right;
}

.site-policy-input input[aria-invalid='true'] {
  border-color: var(--h5-danger);
}

.empty-state {
  display: grid;
  min-height: 126px;
  place-items: center;
  align-content: center;
  gap: var(--h5-space-2);
  color: var(--h5-text-faint);
  text-align: center;
}

.empty-state span {
  color: var(--h5-accent);
  font-family: var(--h5-font-display);
  font-size: 32px;
}

.empty-state p {
  margin: 0;
}

@media (max-width: 680px) {
  .metrics-row {
    grid-template-columns: 1fr;
  }

  .site-rule,
  .site-actions {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
