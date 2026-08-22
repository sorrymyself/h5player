<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { DiagnosticResponse } from '../../../application/diagnostics'
import BaseButton from '../../components/BaseButton.vue'
import MetricTile from '../../components/MetricTile.vue'
import OptionsPageHeader from '../../components/OptionsPageHeader.vue'
import SettingsPanel from '../../components/SettingsPanel.vue'
import StatusBanner from '../../components/StatusBanner.vue'
import { downloadTextFile } from '../../files/download-text-file'
import { useOptionsContext } from '../options-context'

const { application, busy, error, locale, t } = useOptionsContext()
const diagnostics = ref<DiagnosticResponse | null>(null)

const summary = computed(() => diagnostics.value?.summary ?? null)
const permissionInventory = computed(() => [
  ...(summary.value?.permissions.required ?? []),
  ...(summary.value?.permissions.origins ?? [])
])
const adapterInventory = computed(() => {
  const health = summary.value?.adapterHealth ?? []
  if (health.length > 0) {
    return health.map(
      (adapter) =>
        `${adapter.id}@${adapter.version} · ${adapter.status} · failures=${adapter.failureCount}`
    )
  }
  return summary.value?.adapters ?? []
})

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(value))
}

function datedFilename(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `h5player-diagnostics-${stamp}.json`
}

async function refresh(): Promise<DiagnosticResponse | null> {
  if (busy.value) return diagnostics.value
  busy.value = true
  error.value = null
  try {
    const response = await application.getDiagnostics()
    diagnostics.value = response
    return response
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'DIAGNOSTICS_FAILED'
    return null
  } finally {
    busy.value = false
  }
}

async function downloadDiagnostics(): Promise<void> {
  const response = diagnostics.value ?? (await refresh())
  if (response) downloadTextFile(response.json, datedFilename())
}

onMounted(() => void refresh())
</script>

<template>
  <div class="options-page">
    <OptionsPageHeader
      index="05"
      :title="t('options.diagnosticsTitle')"
      :description="t('options.diagnosticsDescription')"
    >
      <template #actions>
        <BaseButton :disabled="busy" @click="refresh">
          {{ t('options.refreshDiagnostics') }}
        </BaseButton>
        <BaseButton kind="primary" :disabled="busy || !diagnostics" @click="downloadDiagnostics">
          {{ t('options.downloadDiagnostics') }}
        </BaseButton>
      </template>
    </OptionsPageHeader>

    <StatusBanner
      class="page-notice"
      tone="success"
      :title="t('options.diagnosticsLocalOnly')"
      :detail="t('options.diagnosticsPrivacy')"
    />

    <p v-if="busy && !summary" class="loading-state" role="status">{{ t('common.loading') }}</p>

    <template v-if="summary">
      <div class="metrics-row">
        <MetricTile
          accent
          :label="t('options.browser')"
          :value="summary.browser.name"
          :detail="summary.browser.version"
        />
        <MetricTile
          :label="t('options.mediaDetected')"
          :value="String(summary.site.mediaCount)"
          :detail="summary.site.hostname ?? t('common.none')"
        />
        <MetricTile
          :label="t('options.recentEvents')"
          :value="String(summary.recentEvents.length)"
          :detail="t('options.revision', { value: summary.settings.revision })"
        />
        <MetricTile
          :label="t('options.build')"
          :value="summary.extensionVersion"
          :detail="summary.build"
        />
      </div>

      <div class="panel-stack">
        <SettingsPanel
          :title="t('options.runtimeSummary')"
          :description="t('options.generatedAt', { value: formatDate(summary.generatedAt) })"
        >
          <dl class="summary-grid">
            <div>
              <dt>{{ t('options.platform') }}</dt>
              <dd>{{ summary.browser.platform }}</dd>
            </div>
            <div>
              <dt>{{ t('options.permissionCount') }}</dt>
              <dd>{{ summary.permissions.origins.length }}</dd>
            </div>
            <div>
              <dt>{{ t('options.siteRules') }}</dt>
              <dd>{{ summary.settings.siteRuleCount }}</dd>
            </div>
            <div>
              <dt>{{ t('options.progressRecords') }}</dt>
              <dd>{{ summary.settings.progressCount }}</dd>
            </div>
            <div>
              <dt>{{ t('options.modules') }}</dt>
              <dd>{{ summary.modules.length }}</dd>
            </div>
            <div>
              <dt>{{ t('options.adapters') }}</dt>
              <dd>{{ summary.adapters.length }}</dd>
            </div>
          </dl>
          <div class="inventory-grid">
            <div>
              <h4>{{ t('options.permissions') }}</h4>
              <code v-for="permission in permissionInventory" :key="permission">{{
                permission
              }}</code>
            </div>
            <div>
              <h4>{{ t('options.modules') }}</h4>
              <code v-for="module in summary.modules" :key="module">{{ module }}</code>
            </div>
            <div>
              <h4>{{ t('options.adapters') }}</h4>
              <code v-for="adapter in adapterInventory" :key="adapter">{{ adapter }}</code>
              <span v-if="adapterInventory.length === 0">{{ t('common.none') }}</span>
            </div>
          </div>
        </SettingsPanel>

        <SettingsPanel
          :title="t('options.recentEvents')"
          :description="t('options.recentEventsDescription')"
        >
          <div v-if="summary.recentEvents.length > 0" class="event-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{{ t('options.eventTime') }}</th>
                  <th scope="col">{{ t('options.eventLevel') }}</th>
                  <th scope="col">{{ t('options.eventModule') }}</th>
                  <th scope="col">{{ t('options.eventCode') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(event, index) in summary.recentEvents"
                  :key="`${event.timestamp}-${event.eventCode}-${index}`"
                >
                  <td>{{ formatDate(event.timestamp) }}</td>
                  <td>
                    <span class="level-chip" :class="`is-${event.level}`">{{ event.level }}</span>
                  </td>
                  <td>
                    <code>{{ event.context }}/{{ event.module }}</code>
                  </td>
                  <td>
                    <code>{{ event.eventCode }}</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty-events">{{ t('options.noDiagnosticEvents') }}</div>
        </SettingsPanel>

        <SettingsPanel
          :title="t('options.diagnosticsPreview')"
          :description="t('options.diagnosticsPreviewDescription')"
        >
          <pre tabindex="0">{{ diagnostics?.json }}</pre>
        </SettingsPanel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.options-page {
  max-width: 1040px;
}

.page-notice,
.metrics-row,
.loading-state {
  margin-bottom: var(--h5-space-5);
}

.metrics-row {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--h5-space-3);
}

.loading-state {
  color: var(--h5-text-muted);
}

.panel-stack {
  display: grid;
  gap: var(--h5-space-5);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--h5-space-2);
  margin: 0;
}

.summary-grid div {
  padding: var(--h5-space-3);
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
}

dt {
  color: var(--h5-text-faint);
  font-size: 10px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

dd {
  margin: var(--h5-space-1) 0 0;
  color: var(--h5-text);
  font-family: var(--h5-font-display);
  font-size: 19px;
}

.inventory-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--h5-space-3);
  margin-top: var(--h5-space-4);
}

.inventory-grid > div {
  display: grid;
  align-content: start;
  gap: var(--h5-space-2);
  min-width: 0;
  padding: var(--h5-space-3);
  border-left: 2px solid var(--h5-border);
}

h4 {
  margin: 0;
  font-size: 12px;
}

code {
  overflow-wrap: anywhere;
  color: var(--h5-text-muted);
  font-family: var(--h5-font-mono);
  font-size: 10px;
}

.event-table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 680px;
  border-collapse: collapse;
}

th,
td {
  padding: var(--h5-space-3) var(--h5-space-2);
  border-bottom: 1px solid var(--h5-border-soft);
  text-align: left;
}

thead th {
  color: var(--h5-text-faint);
  font-family: var(--h5-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.level-chip {
  display: inline-block;
  min-width: 50px;
  padding: 2px 6px;
  border: 1px solid var(--h5-border);
  border-radius: 999px;
  color: var(--h5-text-muted);
  font-family: var(--h5-font-mono);
  font-size: 9px;
  text-align: center;
  text-transform: uppercase;
}

.level-chip.is-error {
  border-color: rgb(242 123 114 / 0.5);
  color: var(--h5-danger);
}

.level-chip.is-warn {
  border-color: rgb(243 201 105 / 0.5);
  color: var(--h5-warning);
}

pre {
  max-height: 520px;
  margin: 0;
  padding: var(--h5-space-4);
  overflow: auto;
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-sm);
  background: #0b1013;
  color: #c8d8d3;
  font-family: var(--h5-font-mono);
  font-size: 11px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

:global(:root[data-theme='light']) pre {
  background: #e8e4db;
  color: #263431;
}

.empty-events {
  display: grid;
  min-height: 92px;
  place-items: center;
  color: var(--h5-text-faint);
}

@media (max-width: 820px) {
  .metrics-row,
  .summary-grid,
  .inventory-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 540px) {
  .metrics-row,
  .summary-grid,
  .inventory-grid {
    grid-template-columns: 1fr;
  }
}
</style>
