<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import BaseButton from '../../components/BaseButton.vue'
import BaseToggle from '../../components/BaseToggle.vue'
import ConfirmDialog from '../../components/ConfirmDialog.vue'
import OptionsPageHeader from '../../components/OptionsPageHeader.vue'
import SettingsPanel from '../../components/SettingsPanel.vue'
import ShortcutRecorder from '../../components/ShortcutRecorder.vue'
import StatusBanner from '../../components/StatusBanner.vue'
import {
  HOTKEY_COMMAND_CATALOG,
  displayHotkeyChord,
  resolveHotkeyBindings,
  type HotkeyChord,
  type HotkeyCommandId,
  type HotkeyValidationErrorCode
} from '../../../domain/hotkey'
import { useOptionsContext } from '../options-context'
import type { MessageKey } from '../../i18n'

const { application, snapshot, busy, t, run } = useOptionsContext()
const rowErrors = reactive<Record<string, string>>({})
const restoreDialogOpen = ref(false)
const platform = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? 'mac' : 'other'

const rows = computed(() => {
  const overrides = snapshot.value?.settings.settings.data.global.hotkeys.bindings ?? {}
  const resolved = resolveHotkeyBindings(overrides)
  return HOTKEY_COMMAND_CATALOG.map((definition) => {
    const candidates = resolved.filter((binding) => binding.commandId === definition.id)
    return {
      definition,
      binding: candidates.find((candidate) => !candidate.disabled) ?? candidates[0] ?? null
    }
  })
})

const hotkeysEnabled = computed(
  () => snapshot.value?.settings.settings.data.global.hotkeys.enabled ?? false
)
const hotkeyScope = computed(
  () => snapshot.value?.settings.settings.data.global.hotkeys.scope ?? 'page'
)

function commandLabel(commandId: HotkeyCommandId): string {
  const definition = HOTKEY_COMMAND_CATALOG.find((item) => item.id === commandId)
  return definition ? t(definition.labelKey as MessageKey) : commandId
}

function validationMessage(
  code: HotkeyValidationErrorCode | 'INVALID_CHORD' | 'CONFLICT' | 'INVALID_COMMAND',
  conflict?: HotkeyCommandId
): string {
  if (code === 'RESERVED_BROWSER_SHORTCUT') return t('options.reservedShortcut')
  if (code === 'CONFLICT') {
    return t('options.conflict', { command: conflict ? commandLabel(conflict) : t('common.none') })
  }
  if (code === 'INVALID_COMMAND') return t('options.invalidCommand')
  if (code === 'MODIFIER_ONLY') return t('options.modifierOnly')
  return t('options.invalidShortcut')
}

function setRowError(commandId: HotkeyCommandId, message: string | undefined): void {
  if (message) rowErrors[commandId] = message
  else delete rowErrors[commandId]
}

async function assign(
  commandId: HotkeyCommandId,
  chord: HotkeyChord,
  previous?: HotkeyChord
): Promise<void> {
  if (busy.value) return
  setRowError(commandId, undefined)
  busy.value = true
  try {
    const result = await application.assignHotkey(commandId, chord, previous)
    if (result.ok) {
      snapshot.value = result.snapshot
      return
    }
    setRowError(commandId, validationMessage(result.code, result.conflictCommandId))
  } catch (caught) {
    setRowError(commandId, caught instanceof Error ? caught.message : t('status.unavailable'))
  } finally {
    busy.value = false
  }
}

async function toggleBinding(
  commandId: HotkeyCommandId,
  chord: HotkeyChord | undefined,
  disabled: boolean
): Promise<void> {
  if (!chord || busy.value) return
  setRowError(commandId, undefined)
  busy.value = true
  try {
    const result = await application.setHotkeyDisabled(chord, disabled)
    if (result.ok) {
      snapshot.value = result.snapshot
      return
    }
    setRowError(commandId, validationMessage(result.code, result.conflictCommandId))
  } catch (caught) {
    setRowError(commandId, caught instanceof Error ? caught.message : t('status.unavailable'))
  } finally {
    busy.value = false
  }
}

async function setEnabled(enabled: boolean): Promise<void> {
  await run(() => application.update({ global: { hotkeys: { enabled } } }))
}

async function setScope(scope: 'page' | 'player'): Promise<void> {
  await run(() => application.update({ global: { hotkeys: { scope } } }))
}

async function restoreDefaults(): Promise<void> {
  restoreDialogOpen.value = false
  await run(() => application.restoreHotkeyDefaults())
}
</script>

<template>
  <div class="options-page">
    <OptionsPageHeader
      index="02"
      :title="t('options.shortcutsTitle')"
      :description="t('options.shortcutsDescription')"
    >
      <template #actions>
        <BaseButton kind="danger" :disabled="busy" @click="restoreDialogOpen = true">
          {{ t('options.restoreShortcuts') }}
        </BaseButton>
      </template>
    </OptionsPageHeader>

    <StatusBanner
      class="page-notice"
      tone="info"
      :title="t('options.shortcutStatus')"
      :detail="t('options.shortcutStatusDescription')"
    />

    <div class="panel-stack">
      <SettingsPanel
        :title="t('options.shortcutPolicy')"
        :description="t('options.shortcutPolicyDescription')"
      >
        <BaseToggle
          :model-value="hotkeysEnabled"
          :label="t('options.hotkeysEnabled')"
          :disabled="busy"
          @update:model-value="setEnabled"
        />
        <label class="field-control">
          <span>{{ t('options.hotkeyScope') }}</span>
          <select
            :value="hotkeyScope"
            :disabled="busy"
            @change="setScope(($event.target as HTMLSelectElement).value as 'page' | 'player')"
          >
            <option value="page">{{ t('options.scopePage') }}</option>
            <option value="player">{{ t('options.scopePlayer') }}</option>
          </select>
        </label>
      </SettingsPanel>

      <SettingsPanel
        :title="t('options.shortcutsCore')"
        :description="t('options.shortcutsCoreDescription')"
      >
        <div class="table-scroll">
          <table :aria-label="t('a11y.hotkeyTable')">
            <thead>
              <tr>
                <th scope="col">{{ t('options.command') }}</th>
                <th scope="col">{{ t('options.shortcut') }}</th>
                <th scope="col">{{ t('options.shortcutState') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.definition.id">
                <th scope="row">
                  <span class="command-label">{{ t(row.definition.labelKey as MessageKey) }}</span>
                  <small v-if="row.definition.repeatable">{{ t('options.repeatable') }}</small>
                </th>
                <td>
                  <ShortcutRecorder
                    :chord="row.binding?.chord"
                    :label="t(row.definition.labelKey as MessageKey)"
                    :record-label="t('options.recordShortcut')"
                    :recording-label="t('options.recording')"
                    :cancel-hint="t('options.recordCancel')"
                    :empty-label="t('options.unassigned')"
                    :error="rowErrors[row.definition.id]"
                    :disabled="busy || !hotkeysEnabled"
                    @recorded="assign(row.definition.id, $event, row.binding?.chord)"
                    @invalid="setRowError(row.definition.id, validationMessage($event))"
                  />
                </td>
                <td>
                  <div class="state-cell">
                    <BaseToggle
                      v-if="row.binding"
                      :model-value="!row.binding.disabled"
                      :label="t('options.shortcutEnabled')"
                      :description="
                        row.binding.customized
                          ? t('options.customized')
                          : t('options.defaultBinding')
                      "
                      :disabled="busy || !hotkeysEnabled"
                      @update:model-value="
                        toggleBinding(row.definition.id, row.binding?.chord, !$event)
                      "
                    />
                    <span v-else class="unassigned-state">{{ t('options.unassigned') }}</span>
                    <span v-if="row.binding" class="canonical-chord">{{
                      displayHotkeyChord(row.binding.chord, platform)
                    }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SettingsPanel>
    </div>

    <ConfirmDialog
      :open="restoreDialogOpen"
      :title="t('options.restoreShortcutsTitle')"
      :description="t('options.restoreShortcutsDescription')"
      :confirm-label="t('common.reset')"
      :cancel-label="t('common.cancel')"
      :busy="busy"
      danger
      @cancel="restoreDialogOpen = false"
      @confirm="restoreDefaults"
    />
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

.field-control {
  display: grid;
  gap: var(--h5-space-2);
  margin-top: var(--h5-space-4);
  color: var(--h5-text-muted);
  font-size: 12px;
  font-weight: 650;
}

.field-control select {
  min-height: 44px;
  padding: 0 var(--h5-space-3);
  border: 1px solid var(--h5-border);
  border-radius: var(--h5-radius-sm);
  background: var(--h5-bg-elevated);
  color: var(--h5-text);
}

.table-scroll {
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
}

th,
td {
  padding: var(--h5-space-3) var(--h5-space-2);
  border-bottom: 1px solid var(--h5-border-soft);
  text-align: left;
  vertical-align: middle;
}

thead th {
  color: var(--h5-text-faint);
  font-family: var(--h5-font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

tbody th {
  width: 29%;
  font-weight: 650;
}

.command-label,
.state-cell {
  display: grid;
  gap: 3px;
}

tbody small,
.unassigned-state {
  color: var(--h5-text-faint);
  font-size: 11px;
  font-weight: 500;
}

.canonical-chord {
  color: var(--h5-text-faint);
  font-family: var(--h5-font-mono);
  font-size: 10px;
}

@media (max-width: 620px) {
  .panel-stack {
    gap: var(--h5-space-4);
  }
}
</style>
