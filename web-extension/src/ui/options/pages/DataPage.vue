<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ImportPreview } from '../../../application/ui'
import BaseButton from '../../components/BaseButton.vue'
import ConfirmDialog from '../../components/ConfirmDialog.vue'
import MetricTile from '../../components/MetricTile.vue'
import OptionsPageHeader from '../../components/OptionsPageHeader.vue'
import SettingsPanel from '../../components/SettingsPanel.vue'
import StatusBanner from '../../components/StatusBanner.vue'
import { downloadTextFile } from '../../files/download-text-file'
import { useOptionsContext } from '../options-context'

type ResetScope = 'all' | 'global' | 'sites' | 'progress'

const MAX_IMPORT_BYTES = 262_144
const { application, snapshot, busy, error, locale, t, run } = useOptionsContext()
const fileInput = ref<HTMLInputElement | null>(null)
const importContent = ref<string | null>(null)
const importPreview = ref<ImportPreview | null>(null)
const importFilename = ref<string | null>(null)
const importError = ref<string | null>(null)
const importDialogOpen = ref(false)
const restoreDialogOpen = ref(false)
const pendingReset = ref<ResetScope | null>(null)

const settings = computed(() => snapshot.value?.settings.settings)
const latestBackup = computed(() => snapshot.value?.settings.latestBackup ?? null)

function formatDate(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (!Number.isFinite(date.getTime())) return t('common.none')
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function datedFilename(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${prefix}-${stamp}.json`
}

async function exportSettings(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const content = await application.exportSettings()
    downloadTextFile(content, datedFilename('h5player-settings'))
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'EXPORT_FAILED'
  } finally {
    busy.value = false
  }
}

async function chooseImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  importContent.value = null
  importPreview.value = null
  importFilename.value = file?.name ?? null
  importError.value = null
  if (!file) return
  if (file.size > MAX_IMPORT_BYTES) {
    importError.value = t('options.fileTooLarge')
    return
  }

  try {
    const content = await file.text()
    const preview = application.previewImport(content)
    if (!preview) {
      importError.value = t('options.invalidImport')
      return
    }
    importContent.value = content
    importPreview.value = preview
  } catch {
    importError.value = t('options.invalidImport')
  }
}

function clearImport(): void {
  importContent.value = null
  importPreview.value = null
  importFilename.value = null
  importError.value = null
  importDialogOpen.value = false
  if (fileInput.value) fileInput.value.value = ''
}

async function confirmImport(): Promise<void> {
  const content = importContent.value
  importDialogOpen.value = false
  if (!content) return
  const imported = await run(() => application.importSettings(content))
  if (imported) clearImport()
}

function resetLabel(scope: ResetScope): string {
  const labels: Record<ResetScope, string> = {
    all: t('options.resetAll'),
    global: t('options.resetGlobal'),
    sites: t('options.resetSites'),
    progress: t('options.resetProgress')
  }
  return labels[scope]
}

function resetDescription(scope: ResetScope): string {
  const descriptions: Record<ResetScope, string> = {
    all: t('options.resetAllDescription'),
    global: t('options.resetGlobalDescription'),
    sites: t('options.resetSitesDescription'),
    progress: t('options.resetProgressDescription')
  }
  return descriptions[scope]
}

function backupReasonLabel(
  reason: 'migration' | 'corrupt-recovery' | 'import' | 'rollback' | 'reset'
): string {
  switch (reason) {
    case 'migration':
      return t('options.backupReason.migration')
    case 'corrupt-recovery':
      return t('options.backupReason.corrupt-recovery')
    case 'import':
      return t('options.backupReason.import')
    case 'rollback':
      return t('options.backupReason.rollback')
    case 'reset':
      return t('options.backupReason.reset')
  }
}

async function confirmReset(): Promise<void> {
  const scope = pendingReset.value
  pendingReset.value = null
  if (scope) await run(() => application.resetSettings(scope))
}

async function restoreBackup(): Promise<void> {
  const backupId = latestBackup.value?.backupId
  restoreDialogOpen.value = false
  if (backupId) await run(() => application.restoreBackup(backupId))
}
</script>

<template>
  <div class="options-page">
    <OptionsPageHeader
      index="04"
      :title="t('options.dataTitle')"
      :description="t('options.dataDescription')"
    />

    <StatusBanner
      class="page-notice"
      tone="warning"
      :title="t('options.dataSafety')"
      :detail="t('options.dataWarning')"
    />

    <div v-if="settings" class="metrics-row">
      <MetricTile
        accent
        :label="t('options.revision', { value: '' })"
        :value="String(settings.revision)"
      />
      <MetricTile
        :label="t('options.siteRules')"
        :value="String(Object.keys(settings.data.sites).length)"
      />
      <MetricTile
        :label="t('options.progressRecords')"
        :value="String(Object.keys(settings.data.progress).length)"
      />
    </div>

    <div class="panel-stack">
      <SettingsPanel
        :title="t('options.exportSettings')"
        :description="t('options.exportDescription')"
      >
        <div class="action-row">
          <div class="action-copy">
            <strong>JSON · Schema {{ settings?.schemaVersion ?? '—' }}</strong>
            <span>{{ t('options.exportPrivacy') }}</span>
          </div>
          <BaseButton kind="primary" :disabled="busy" @click="exportSettings">
            {{ t('common.download') }}
          </BaseButton>
        </div>
      </SettingsPanel>

      <SettingsPanel
        :title="t('options.importSettings')"
        :description="t('options.importDescription')"
      >
        <label class="file-picker">
          <input
            ref="fileInput"
            type="file"
            accept="application/json,.json"
            :disabled="busy"
            @change="chooseImport"
          />
          <span>{{ t('options.chooseImportFile') }}</span>
          <small>{{ importFilename ?? t('options.noFileSelected') }}</small>
        </label>

        <StatusBanner
          v-if="importError"
          class="inline-notice"
          tone="danger"
          :title="t('options.invalidImport')"
          :detail="importError"
        />

        <div v-if="importPreview" class="import-preview">
          <div class="preview-heading">
            <div>
              <span>{{ t('options.importPreview') }}</span>
              <strong>{{ importFilename }}</strong>
            </div>
            <BaseButton kind="primary" :disabled="busy" @click="importDialogOpen = true">
              {{ t('options.confirmImport') }}
            </BaseButton>
          </div>
          <dl>
            <div>
              <dt>{{ t('options.importVersion', { value: importPreview.formatVersion }) }}</dt>
              <dd>{{ formatDate(importPreview.exportedAt) }}</dd>
            </div>
            <div>
              <dt>{{ t('options.importSites', { value: importPreview.siteRuleCount }) }}</dt>
              <dd>{{ t('options.importLocale', { value: importPreview.locale }) }}</dd>
            </div>
            <div>
              <dt>{{ t('options.importProgress', { value: importPreview.progressCount }) }}</dt>
              <dd>
                {{ t('options.importHotkeys', { value: importPreview.hotkeyOverrideCount }) }}
              </dd>
            </div>
          </dl>
        </div>
      </SettingsPanel>

      <SettingsPanel
        :title="t('options.resetCenter')"
        :description="t('options.resetCenterDescription')"
      >
        <div class="reset-grid">
          <button
            v-for="scope in ['global', 'sites', 'progress', 'all'] as const"
            :key="scope"
            type="button"
            :disabled="busy"
            @click="pendingReset = scope"
          >
            <strong>{{ resetLabel(scope) }}</strong>
            <span>{{ resetDescription(scope) }}</span>
          </button>
        </div>
      </SettingsPanel>

      <SettingsPanel
        :title="t('options.restoreBackup')"
        :description="t('options.backupDescription')"
      >
        <div v-if="latestBackup" class="backup-card">
          <div>
            <span>{{ t('options.backupReason') }}</span>
            <strong>{{ backupReasonLabel(latestBackup.reason) }}</strong>
            <code>{{ formatDate(latestBackup.createdAt) }} · {{ latestBackup.backupId }}</code>
          </div>
          <BaseButton :disabled="busy" @click="restoreDialogOpen = true">
            {{ t('options.restoreBackup') }}
          </BaseButton>
        </div>
        <div v-else class="empty-backup">{{ t('options.noBackup') }}</div>
      </SettingsPanel>
    </div>

    <ConfirmDialog
      :open="importDialogOpen"
      :title="t('options.confirmImportTitle')"
      :description="t('options.confirmImportDescription')"
      :confirm-label="t('common.import')"
      :cancel-label="t('common.cancel')"
      :busy="busy"
      @cancel="importDialogOpen = false"
      @confirm="confirmImport"
    >
      {{ importFilename }}
    </ConfirmDialog>

    <ConfirmDialog
      :open="pendingReset !== null"
      :title="pendingReset ? resetLabel(pendingReset) : t('common.reset')"
      :description="pendingReset ? resetDescription(pendingReset) : t('options.dataWarning')"
      :confirm-label="t('common.reset')"
      :cancel-label="t('common.cancel')"
      :busy="busy"
      danger
      @cancel="pendingReset = null"
      @confirm="confirmReset"
    />

    <ConfirmDialog
      :open="restoreDialogOpen"
      :title="t('options.restoreBackupTitle')"
      :description="t('options.restoreBackupDescription')"
      :confirm-label="t('options.restoreBackup')"
      :cancel-label="t('common.cancel')"
      :busy="busy"
      @cancel="restoreDialogOpen = false"
      @confirm="restoreBackup"
    />
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--h5-space-3);
}

.panel-stack {
  display: grid;
  gap: var(--h5-space-5);
}

.action-row,
.preview-heading,
.backup-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--h5-space-4);
}

.action-copy,
.preview-heading > div,
.backup-card > div {
  display: grid;
  gap: var(--h5-space-1);
}

.action-copy span,
.preview-heading span,
.backup-card span {
  color: var(--h5-text-muted);
  font-size: 12px;
}

.file-picker {
  display: grid;
  min-height: 96px;
  place-items: center;
  align-content: center;
  gap: var(--h5-space-1);
  border: 1px dashed var(--h5-border);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
  cursor: pointer;
  text-align: center;
}

.file-picker:hover {
  border-color: var(--h5-accent);
}

.file-picker input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.file-picker span {
  color: var(--h5-accent-strong);
  font-weight: 700;
}

.file-picker small {
  color: var(--h5-text-faint);
}

.file-picker:has(input:focus-visible) {
  outline: 3px solid var(--h5-focus);
  outline-offset: 3px;
}

.inline-notice,
.import-preview {
  margin-top: var(--h5-space-4);
}

.import-preview {
  padding: var(--h5-space-4);
  border: 1px solid rgb(123 199 182 / 0.35);
  border-radius: var(--h5-radius-sm);
  background: rgb(123 199 182 / 0.055);
}

dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--h5-space-2);
  margin: var(--h5-space-4) 0 0;
}

dl div {
  display: grid;
  gap: 2px;
  padding: var(--h5-space-3);
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
}

dt {
  color: var(--h5-text);
  font-size: 12px;
  font-weight: 650;
}

dd {
  margin: 0;
  color: var(--h5-text-faint);
  font-size: 11px;
}

.reset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--h5-space-3);
}

.reset-grid button {
  display: grid;
  min-height: 92px;
  gap: var(--h5-space-1);
  padding: var(--h5-space-4);
  border: 1px solid var(--h5-border-soft);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
  color: var(--h5-text);
  cursor: pointer;
  text-align: left;
}

.reset-grid button:hover:not(:disabled) {
  border-color: var(--h5-danger);
}

.reset-grid button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.reset-grid span {
  color: var(--h5-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.backup-card code {
  overflow-wrap: anywhere;
  color: var(--h5-text-faint);
  font-family: var(--h5-font-mono);
  font-size: 10px;
}

.empty-backup {
  min-height: 72px;
  display: grid;
  place-items: center;
  color: var(--h5-text-faint);
}

@media (max-width: 700px) {
  .metrics-row,
  dl,
  .reset-grid {
    grid-template-columns: 1fr;
  }

  .action-row,
  .preview-heading,
  .backup-card {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
