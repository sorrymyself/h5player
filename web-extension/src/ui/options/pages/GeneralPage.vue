<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import BaseButton from '../../components/BaseButton.vue'
import BaseToggle from '../../components/BaseToggle.vue'
import OptionsPageHeader from '../../components/OptionsPageHeader.vue'
import SettingsPanel from '../../components/SettingsPanel.vue'
import StatusBanner from '../../components/StatusBanner.vue'
import { formatPercent } from '../../i18n'
import { useOptionsContext } from '../options-context'

type GeneralDraft = {
  enabled: boolean
  overlayEnabled: boolean
  theme: 'system' | 'light' | 'dark'
  locale: 'zh-CN' | 'en-US'
  defaultPlaybackRate: number
  defaultVolume: number
  restoreProgress: boolean
  downloadEnabled: boolean
  protectPlaybackRate: boolean
  protectCurrentTime: boolean
  protectVolume: boolean
  allowExperimental: boolean
  allowAcousticGain: boolean
  allowMouseLongPress: boolean
  mouseLongPressMs: number
  allowAutoplay: boolean
  localLogLevel: 'error' | 'warn' | 'info' | 'debug'
  retainProgressDays: number
}

const { application, snapshot, busy, locale, t, run } = useOptionsContext()
const draft = reactive<GeneralDraft>({
  enabled: true,
  overlayEnabled: true,
  theme: 'system',
  locale: 'zh-CN',
  defaultPlaybackRate: 1,
  defaultVolume: 1,
  restoreProgress: false,
  downloadEnabled: true,
  protectPlaybackRate: true,
  protectCurrentTime: false,
  protectVolume: true,
  allowExperimental: false,
  allowAcousticGain: false,
  allowMouseLongPress: false,
  mouseLongPressMs: 600,
  allowAutoplay: false,
  localLogLevel: 'error',
  retainProgressDays: 30
})
const baseline = ref<GeneralDraft | null>(null)

function copyDraft(): GeneralDraft {
  return { ...draft }
}

function syncFromSnapshot(): void {
  const global = snapshot.value?.settings.settings.data.global
  if (!global) return
  Object.assign(draft, {
    enabled: global.enabled,
    overlayEnabled: global.ui.overlayEnabled,
    theme: global.ui.theme,
    locale: global.ui.locale,
    defaultPlaybackRate: global.media.defaultPlaybackRate,
    defaultVolume: global.media.defaultVolume,
    restoreProgress: global.media.restoreProgress,
    downloadEnabled: global.download?.enabled ?? true,
    protectPlaybackRate: global.policies.protectPlaybackRate,
    protectCurrentTime: global.policies.protectCurrentTime,
    protectVolume: global.policies.protectVolume,
    allowExperimental: global.policies.allowExperimental,
    allowAcousticGain: global.policies.allowAcousticGain ?? false,
    allowMouseLongPress: global.policies.allowMouseLongPress ?? false,
    mouseLongPressMs: global.policies.mouseLongPressMs ?? 600,
    allowAutoplay: global.policies.allowAutoplay ?? false,
    localLogLevel: global.diagnostics.localLogLevel,
    retainProgressDays: global.diagnostics.retainProgressDays
  })
  baseline.value = copyDraft()
}

const dirty = computed(
  () => baseline.value !== null && JSON.stringify(baseline.value) !== JSON.stringify(draft)
)
const valid = computed(
  () =>
    Number.isFinite(draft.defaultPlaybackRate) &&
    draft.defaultPlaybackRate >= 0.1 &&
    draft.defaultPlaybackRate <= 16 &&
    Number.isFinite(draft.defaultVolume) &&
    draft.defaultVolume >= 0 &&
    draft.defaultVolume <= 1 &&
    Number.isInteger(draft.mouseLongPressMs) &&
    draft.mouseLongPressMs >= 200 &&
    draft.mouseLongPressMs <= 2_000 &&
    Number.isInteger(draft.retainProgressDays) &&
    draft.retainProgressDays >= 0 &&
    draft.retainProgressDays <= 365
)

watch(
  () => snapshot.value?.settings.settings.revision,
  () => {
    if (!dirty.value) syncFromSnapshot()
  },
  { immediate: true }
)

async function save(): Promise<void> {
  if (!valid.value) return
  const saved = await run(() =>
    application.update({
      global: {
        enabled: draft.enabled,
        ui: {
          overlayEnabled: draft.overlayEnabled,
          theme: draft.theme,
          locale: draft.locale
        },
        media: {
          defaultPlaybackRate: draft.defaultPlaybackRate,
          defaultVolume: draft.defaultVolume,
          restoreProgress: draft.restoreProgress
        },
        download: { enabled: draft.downloadEnabled },
        policies: {
          protectPlaybackRate: draft.protectPlaybackRate,
          protectCurrentTime: draft.protectCurrentTime,
          protectVolume: draft.protectVolume,
          allowExperimental: draft.allowExperimental,
          allowAcousticGain: draft.allowAcousticGain,
          allowMouseLongPress: draft.allowMouseLongPress,
          mouseLongPressMs: draft.mouseLongPressMs,
          allowAutoplay: draft.allowAutoplay
        },
        diagnostics: {
          localLogLevel: draft.localLogLevel,
          retainProgressDays: draft.retainProgressDays
        }
      }
    })
  )
  if (saved) baseline.value = copyDraft()
}
</script>

<template>
  <div class="options-page">
    <OptionsPageHeader
      index="01"
      :title="t('options.generalTitle')"
      :description="t('options.generalDescription')"
    >
      <template #actions>
        <BaseButton :disabled="busy || !dirty" @click="syncFromSnapshot">
          {{ t('common.cancel') }}
        </BaseButton>
        <BaseButton kind="primary" :disabled="busy || !dirty || !valid" @click="save">
          {{ busy ? t('common.saving') : t('options.saveChanges') }}
        </BaseButton>
      </template>
    </OptionsPageHeader>

    <StatusBanner
      v-if="dirty"
      class="page-notice"
      tone="warning"
      :title="t('options.unsaved')"
      :detail="valid ? t('options.unsavedDescription') : t('options.validationError')"
    />
    <StatusBanner
      v-else-if="snapshot"
      class="page-notice"
      tone="success"
      :title="t('common.saved')"
      :detail="t('options.savedAtRevision', { value: snapshot.settings.settings.revision })"
    />

    <div class="panel-stack">
      <SettingsPanel
        :title="t('options.interface')"
        :description="t('options.interfaceDescription')"
      >
        <div class="toggle-list">
          <BaseToggle v-model="draft.enabled" :label="t('options.globalEnabled')" />
          <BaseToggle v-model="draft.overlayEnabled" :label="t('options.overlayEnabled')" />
        </div>
        <div class="field-grid">
          <label class="field-control">
            <span>{{ t('options.theme') }}</span>
            <select v-model="draft.theme">
              <option value="system">{{ t('options.themeSystem') }}</option>
              <option value="light">{{ t('options.themeLight') }}</option>
              <option value="dark">{{ t('options.themeDark') }}</option>
            </select>
          </label>
          <label class="field-control">
            <span>{{ t('options.locale') }}</span>
            <select v-model="draft.locale">
              <option value="zh-CN">{{ t('options.localeZh') }}</option>
              <option value="en-US">{{ t('options.localeEn') }}</option>
            </select>
          </label>
        </div>
      </SettingsPanel>

      <SettingsPanel
        :title="t('options.mediaDefaults')"
        :description="t('options.mediaDefaultsDescription')"
      >
        <p class="scope-guidance">
          {{
            locale === 'zh-CN'
              ? '全局默认仅在站点没有独立倍速策略时生效。页面控件默认“锁定本站”，也可显式选择“仅本页”或“仅当前媒体”，临时值不会写入设置。'
              : 'The global default applies when a site has no playback policy. Page controls default to this site, with explicit page-only and current-media temporary scopes.'
          }}
        </p>
        <div class="field-grid">
          <label class="field-control">
            <span>{{ t('options.defaultRate') }}</span>
            <input
              v-model.number="draft.defaultPlaybackRate"
              type="number"
              min="0.1"
              max="16"
              step="0.1"
              inputmode="decimal"
            />
            <small>{{ t('options.rateRange') }}</small>
          </label>
          <label class="field-control range-control">
            <span>{{ t('options.defaultVolume') }}</span>
            <input v-model.number="draft.defaultVolume" type="range" min="0" max="1" step="0.05" />
            <output>{{ formatPercent(draft.defaultVolume, locale) }}</output>
          </label>
        </div>
        <BaseToggle v-model="draft.restoreProgress" :label="t('options.restoreProgress')" />
      </SettingsPanel>

      <SettingsPanel
        :title="t('options.protection')"
        :description="t('options.protectionDescription')"
      >
        <div class="toggle-list">
          <BaseToggle v-model="draft.protectPlaybackRate" :label="t('options.protectRate')" />
          <BaseToggle v-model="draft.protectCurrentTime" :label="t('options.protectTime')" />
          <BaseToggle v-model="draft.protectVolume" :label="t('options.protectVolume')" />
          <BaseToggle
            v-model="draft.allowExperimental"
            :label="t('options.allowExperimental')"
            :description="t('options.allowExperimentalDescription')"
          />
          <BaseToggle
            v-model="draft.downloadEnabled"
            :label="t('options.downloadEnabled')"
            :description="t('options.downloadEnabledDescription')"
          />
          <BaseToggle
            v-model="draft.allowAcousticGain"
            :label="t('options.allowAcousticGain')"
            :description="t('options.allowAcousticGainDescription')"
          />
          <BaseToggle
            v-model="draft.allowMouseLongPress"
            :label="t('options.allowMouseLongPress')"
            :description="t('options.allowMouseLongPressDescription')"
          />
          <label class="field-control experimental-number">
            <span>{{ t('options.mouseLongPressMs') }}</span>
            <input
              v-model.number="draft.mouseLongPressMs"
              type="number"
              min="200"
              max="2000"
              step="50"
              inputmode="numeric"
              :disabled="!draft.allowMouseLongPress"
            />
            <small>{{ t('options.mouseLongPressRange') }}</small>
          </label>
          <BaseToggle
            v-model="draft.allowAutoplay"
            :label="t('options.allowAutoplay')"
            :description="t('options.allowAutoplayDescription')"
          />
        </div>
      </SettingsPanel>

      <SettingsPanel
        :title="t('options.localDiagnostics')"
        :description="t('options.localDiagnosticsDescription')"
      >
        <div class="field-grid">
          <label class="field-control">
            <span>{{ t('options.logLevel') }}</span>
            <select v-model="draft.localLogLevel">
              <option value="error">{{ t('options.logError') }}</option>
              <option value="warn">{{ t('options.logWarn') }}</option>
              <option value="info">{{ t('options.logInfo') }}</option>
              <option value="debug">{{ t('options.logDebug') }}</option>
            </select>
          </label>
          <label class="field-control">
            <span>{{ t('options.retainProgressDays') }}</span>
            <input
              v-model.number="draft.retainProgressDays"
              type="number"
              min="0"
              max="365"
              step="1"
              inputmode="numeric"
            />
            <small>{{ t('options.retainProgressRange') }}</small>
          </label>
        </div>
      </SettingsPanel>
    </div>
  </div>
</template>

<style scoped>
.options-page {
  max-width: 1040px;
}

.page-notice {
  margin-bottom: var(--h5-space-5);
}

.panel-stack {
  display: grid;
  gap: var(--h5-space-5);
}

.toggle-list > * + * {
  border-top: 1px solid var(--h5-border-soft);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--h5-space-4);
  margin-top: var(--h5-space-4);
}

.scope-guidance {
  margin: 0;
  color: var(--h5-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.experimental-number {
  padding: var(--h5-space-4) 0;
}

.field-control {
  display: grid;
  gap: var(--h5-space-2);
  color: var(--h5-text-muted);
  font-size: 12px;
  font-weight: 650;
}

.field-control select,
.field-control input[type='number'] {
  min-height: 44px;
  width: 100%;
  padding: 0 var(--h5-space-3);
  border: 1px solid var(--h5-border);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
  color: var(--h5-text);
}

.field-control small {
  color: var(--h5-text-faint);
  font-weight: 500;
}

.range-control {
  grid-template-columns: 1fr auto;
  align-items: center;
}

.range-control span {
  grid-column: 1 / -1;
}

.range-control input {
  width: 100%;
  accent-color: var(--h5-accent);
}

.range-control output {
  min-width: 48px;
  color: var(--h5-accent-strong);
  font-family: var(--h5-font-mono);
  text-align: right;
}

@media (max-width: 640px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
