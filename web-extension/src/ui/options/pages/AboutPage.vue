<script setup lang="ts">
import { computed } from 'vue'
import MetricTile from '../../components/MetricTile.vue'
import OptionsPageHeader from '../../components/OptionsPageHeader.vue'
import SettingsPanel from '../../components/SettingsPanel.vue'
import StatusBanner from '../../components/StatusBanner.vue'
import { useOptionsContext } from '../options-context'

const { snapshot, t } = useOptionsContext()
const ping = computed(() => snapshot.value?.ping ?? null)
</script>

<template>
  <div class="options-page">
    <OptionsPageHeader
      index="06"
      :title="t('options.aboutTitle')"
      :description="t('options.aboutBody')"
    />

    <StatusBanner
      class="page-notice"
      tone="info"
      :title="t('options.parallelEvolution')"
      :detail="t('options.legacyUntouched')"
    />

    <div v-if="ping" class="metrics-row">
      <MetricTile accent :label="t('options.versionLabel')" :value="ping.extensionVersion" />
      <MetricTile :label="t('options.phaseLabel')" :value="String(ping.phase)" />
      <MetricTile :label="t('options.protocolLabel')" :value="String(ping.protocol)" />
      <MetricTile :label="t('options.schemaLabel')" :value="String(ping.settingsSchemaVersion)" />
    </div>

    <div class="panel-stack">
      <SettingsPanel
        :title="t('options.engineeringPrinciples')"
        :description="t('options.engineeringPrinciplesDescription')"
      >
        <div class="principle-grid">
          <article>
            <span aria-hidden="true">01</span>
            <h3>{{ t('options.principleIndependent') }}</h3>
            <p>{{ t('options.principleIndependentDescription') }}</p>
          </article>
          <article>
            <span aria-hidden="true">02</span>
            <h3>{{ t('options.principleLocal') }}</h3>
            <p>{{ t('options.principleLocalDescription') }}</p>
          </article>
          <article>
            <span aria-hidden="true">03</span>
            <h3>{{ t('options.principlePermission') }}</h3>
            <p>{{ t('options.principlePermissionDescription') }}</p>
          </article>
        </div>
      </SettingsPanel>

      <SettingsPanel
        :title="t('options.runtimeContract')"
        :description="t('options.runtimeContractDescription')"
      >
        <dl class="contract-list">
          <div>
            <dt>{{ t('options.requiredPermissions') }}</dt>
            <dd><code>storage</code><code>activeTab</code><code>scripting</code></dd>
          </div>
          <div>
            <dt>{{ t('options.optionalPermissions') }}</dt>
            <dd><code>&lt;all_urls&gt;</code></dd>
          </div>
          <div>
            <dt>{{ t('options.excludedCapabilities') }}</dt>
            <dd>{{ t('options.excludedCapabilitiesValue') }}</dd>
          </div>
          <div>
            <dt>{{ t('options.settingsAuthority') }}</dt>
            <dd><code>storage.local</code></dd>
          </div>
        </dl>
      </SettingsPanel>

      <SettingsPanel
        :title="t('options.previewNotice')"
        :description="t('options.previewNoticeDescription')"
      >
        <p class="closing-note">{{ t('options.previewClosing') }}</p>
      </SettingsPanel>
    </div>
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--h5-space-3);
}

.panel-stack {
  display: grid;
  gap: var(--h5-space-5);
}

.principle-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--h5-space-3);
}

.principle-grid article {
  min-height: 196px;
  padding: var(--h5-space-4);
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-sm);
  background:
    linear-gradient(155deg, rgb(239 157 77 / 0.1), transparent 45%), var(--h5-bg-elevated);
}

.principle-grid span {
  color: var(--h5-accent);
  font-family: var(--h5-font-mono);
  font-size: 10px;
  font-weight: 700;
}

.principle-grid h3 {
  margin: var(--h5-space-6) 0 var(--h5-space-2);
  font-family: var(--h5-font-display);
  font-size: 19px;
}

.principle-grid p,
.closing-note {
  margin: 0;
  color: var(--h5-text-muted);
  line-height: 1.65;
}

.contract-list {
  margin: 0;
}

.contract-list > div {
  display: grid;
  grid-template-columns: minmax(180px, 0.45fr) 1fr;
  gap: var(--h5-space-4);
  padding: var(--h5-space-3) 0;
  border-bottom: 1px solid var(--h5-border-soft);
}

.contract-list > div:last-child {
  border-bottom: 0;
}

dt {
  color: var(--h5-text-muted);
  font-size: 12px;
}

dd {
  display: flex;
  flex-wrap: wrap;
  gap: var(--h5-space-2);
  margin: 0;
  color: var(--h5-text);
}

code {
  padding: 2px 7px;
  border: 1px solid var(--h5-border);
  border-radius: 999px;
  color: var(--h5-teal);
  font-family: var(--h5-font-mono);
  font-size: 10px;
}

@media (max-width: 760px) {
  .metrics-row,
  .principle-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .metrics-row,
  .principle-grid,
  .contract-list > div {
    grid-template-columns: 1fr;
  }
}
</style>
