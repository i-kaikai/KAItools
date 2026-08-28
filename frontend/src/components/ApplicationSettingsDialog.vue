<script setup lang="ts">
import { Clipboard, Globe2, Keyboard, MonitorDown, Palette, PanelLeft, RotateCcw, Sparkles, Type, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import SegmentedControl from '@/components/SegmentedControl.vue'
import { localeOptions as availableLocales, useI18n } from '@/i18n'
import { isWebRuntime } from '@/runtime'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import type { AppLocale, ParticleQuality, SidebarStartup, ThemeMode } from '@/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const toast = useToastStore()
const { t } = useI18n()
const hotkey = ref('Ctrl+Alt+K')
const capturing = ref(false)
const saving = ref(false)
const message = ref(t('settings.hotkey.initial'))

const localeOptions = computed(() => availableLocales.map((option) => ({ value: option.value, label: option.nativeLabel })))
const themeOptions = computed<Array<{ value: ThemeMode; label: string }>>(() => [
  { value: 'system', label: t('settings.theme.system') }, { value: 'light', label: t('settings.theme.light') }, { value: 'dark', label: t('settings.theme.dark') },
])
const particleOptions = computed<Array<{ value: ParticleQuality; label: string }>>(() => [
  { value: 'high', label: t('settings.particles.high') }, { value: 'balanced', label: t('settings.particles.balanced') }, { value: 'off', label: t('settings.particles.off') },
])
const sidebarStartupOptions = computed<Array<{ value: SidebarStartup; label: string }>>(() => [
  { value: 'remember', label: t('settings.sidebar.remember') }, { value: 'collapsed', label: t('settings.sidebar.collapsed') }, { value: 'expanded', label: t('settings.sidebar.expanded') },
])
const formattedHotkey = computed(() => hotkey.value.replaceAll('+', ' + '))

watch(() => props.open, (open) => {
  if (!open) return
  hotkey.value = app.settings.activationHotkey || 'Ctrl+Alt+K'
  capturing.value = false
  message.value = isWebRuntime
    ? t('settings.hotkey.web')
    : t('settings.hotkey.initial')
}, { immediate: true })

function normalizeKey(key: string): string | null {
  const value = key.toUpperCase()
  return /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/.test(value) ? value : null
}

function beginCapture(event: MouseEvent): void {
  if (isWebRuntime) return
  if (event.currentTarget instanceof HTMLButtonElement) event.currentTarget.focus()
  capturing.value = true
  message.value = t('settings.hotkey.instructions')
}

function captureHotkey(event: KeyboardEvent): void {
  if (!capturing.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    capturing.value = false
    message.value = t('settings.hotkey.cancelled')
    return
  }
  if (event.metaKey) {
    message.value = t('settings.hotkey.meta')
    return
  }
  const key = normalizeKey(event.key)
  if (!key || (!event.ctrlKey && !event.altKey)) {
    message.value = t('settings.hotkey.invalid')
    return
  }
  hotkey.value = [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key]
    .filter(Boolean)
    .join('+')
  capturing.value = false
  message.value = t('settings.hotkey.recorded', { hotkey: formattedHotkey.value })
}

async function saveHotkey(): Promise<void> {
  if (isWebRuntime || saving.value) return
  saving.value = true
  const saved = await app.setActivationHotkey(hotkey.value)
  saving.value = false
  if (!saved) {
    message.value = t('settings.hotkey.failed')
    return
  }
  message.value = t('settings.hotkey.active', { hotkey: formattedHotkey.value })
  toast.show(t('settings.hotkey.updated'))
}

function restoreHotkeyDefault(): void {
  hotkey.value = 'Ctrl+Alt+K'
  capturing.value = false
  message.value = t('settings.hotkey.default')
}
</script>

<template>
  <div v-if="open" class="application-settings-backdrop" @pointerdown.self="emit('close')">
    <section class="application-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="application-settings-title">
      <header>
        <div>
          <span><Sparkles :size="14" />APPLICATION SETTINGS</span>
          <h2 id="application-settings-title">{{ t('settings.title') }}</h2>
          <p>{{ t('settings.description') }}</p>
        </div>
        <button type="button" :aria-label="t('settings.close')" @click="emit('close')"><X :size="18" /></button>
      </header>

      <div class="application-settings-body">
        <section class="application-settings-section">
          <div class="application-settings-heading"><Globe2 :size="17" /><span><strong>{{ t('settings.language.title') }}</strong><small>{{ t('settings.language.description') }}</small></span></div>
          <div class="application-settings-option"><span><strong>{{ t('settings.language.label') }}</strong><small>{{ t('settings.language.description') }}</small></span><SegmentedControl :model-value="app.settings.locale" :label="t('settings.language.label')" :options="localeOptions" @update:model-value="app.setLocale($event as AppLocale)" /></div>
        </section>
        <section class="application-settings-section">
          <div class="application-settings-heading"><Palette :size="17" /><span><strong>{{ t('settings.appearance.title') }}</strong><small>{{ t('settings.appearance.description') }}</small></span></div>
          <div class="application-settings-option"><span><strong>{{ t('settings.theme.title') }}</strong><small>{{ t('settings.theme.description') }}</small></span><SegmentedControl :model-value="app.settings.theme" :label="t('settings.theme.title')" :options="themeOptions" @update:model-value="app.setTheme($event as ThemeMode)" /></div>
          <div class="application-settings-option"><span><strong>{{ t('settings.particles.title') }}</strong><small>{{ t('settings.particles.description') }}</small></span><SegmentedControl :model-value="app.settings.particleQuality" :label="t('settings.particles.title')" :options="particleOptions" @update:model-value="app.setParticleQuality($event as ParticleQuality)" /></div>
          <label class="application-settings-switch"><span><strong>{{ t('settings.motion.title') }}</strong><small>{{ t('settings.motion.description') }}</small></span><input :checked="app.settings.motionMode === 'reduced'" type="checkbox" :aria-label="t('settings.motion.title')" @change="app.setMotionMode(($event.target as HTMLInputElement).checked ? 'reduced' : 'system')" /></label>
        </section>

        <section class="application-settings-section">
          <div class="application-settings-heading"><Clipboard :size="17" /><span><strong>{{ t('settings.desktop.title') }}</strong><small>{{ t('settings.desktop.description') }}</small></span></div>
          <label class="application-settings-switch" :class="{ disabled: isWebRuntime }"><span><strong>{{ t('settings.clipboard.title') }}</strong><small>{{ isWebRuntime ? t('settings.clipboard.web') : t('settings.clipboard.desktop') }}</small></span><input :checked="app.settings.clipboardMonitoringEnabled" type="checkbox" :aria-label="t('settings.clipboard.title')" :disabled="isWebRuntime" @change="app.setClipboardMonitoringEnabled(($event.target as HTMLInputElement).checked)" /></label>
          <label class="application-settings-option"><span><strong>{{ t('settings.refresh.title') }}</strong><small>{{ t('settings.refresh.description') }}</small></span><select :value="app.settings.systemStatusRefreshSeconds" :aria-label="t('settings.refresh.title')" @change="app.setSystemStatusRefreshSeconds(Number(($event.target as HTMLSelectElement).value) as 0 | 1 | 30 | 60 | 300)"><option :value="0">{{ t('settings.refresh.manual') }}</option><option :value="1">{{ t('settings.refresh.seconds', { count: 1 }) }}</option><option :value="30">{{ t('settings.refresh.seconds', { count: 30 }) }}</option><option :value="60">{{ t('settings.refresh.seconds', { count: 60 }) }}</option><option :value="300">{{ t('settings.refresh.minutes', { count: 5 }) }}</option></select></label>
        </section>

        <section class="application-settings-section">
          <div class="application-settings-heading"><PanelLeft :size="17" /><span><strong>{{ t('settings.workspace.title') }}</strong><small>{{ t('settings.workspace.description') }}</small></span></div>
          <div class="application-settings-option"><span><strong>{{ t('settings.sidebar.title') }}</strong><small>{{ t('settings.sidebar.description') }}</small></span><SegmentedControl :model-value="app.settings.sidebarStartup" :label="t('settings.sidebar.title')" :options="sidebarStartupOptions" @update:model-value="app.setSidebarStartup($event as SidebarStartup)" /></div>
          <label class="application-settings-switch"><span><strong>{{ t('settings.restore.title') }}</strong><small>{{ t('settings.restore.description') }}</small></span><input :checked="app.settings.restorePinnedTabsOnLaunch" type="checkbox" :aria-label="t('settings.restore.title')" @change="app.setRestorePinnedTabsOnLaunch(($event.target as HTMLInputElement).checked)" /></label>
        </section>

        <section class="application-settings-section">
          <div class="application-settings-heading"><Type :size="17" /><span><strong>{{ t('settings.editor.title') }}</strong><small>{{ t('settings.editor.description') }}</small></span></div>
          <label class="application-settings-option"><span><strong>{{ t('settings.editor.fontSize.title') }}</strong><small>{{ t('settings.editor.fontSize.description') }}</small></span><select :value="app.settings.editorFontSize" :aria-label="t('settings.editor.fontSize.title')" @change="app.setEditorFontSize(Number(($event.target as HTMLSelectElement).value))"><option v-for="size in [12, 13, 14, 15, 16]" :key="size" :value="size">{{ size }} px</option></select></label>
          <label class="application-settings-switch"><span><strong>{{ t('settings.editor.wrap.title') }}</strong><small>{{ t('settings.editor.wrap.description') }}</small></span><input :checked="app.settings.editorLineWrapping" type="checkbox" :aria-label="t('settings.editor.wrap.title')" @change="app.setEditorLineWrapping(($event.target as HTMLInputElement).checked)" /></label>
        </section>

        <section class="application-settings-section">
          <div class="application-settings-heading"><MonitorDown :size="17" /><span><strong>{{ t('settings.hotkey.title') }}</strong><small>{{ t('settings.hotkey.description') }}</small></span></div>
          <button class="hotkey-capture" :class="{ capturing }" type="button" :disabled="isWebRuntime || saving" :aria-label="t('settings.hotkey.capture')" @click="beginCapture" @keydown="captureHotkey"><Keyboard :size="17" aria-hidden="true" /><strong>{{ formattedHotkey }}</strong><small>{{ capturing ? t('settings.hotkey.capturing') : t('settings.hotkey.edit') }}</small></button>
          <p class="application-settings-status" role="status">{{ message }}</p>
          <div class="application-settings-actions"><button class="command-button subtle" type="button" :disabled="isWebRuntime || saving" @click="restoreHotkeyDefault"><RotateCcw :size="14" />{{ t('settings.hotkey.restore') }}</button><button class="command-button" type="button" :disabled="isWebRuntime || saving" @click="saveHotkey">{{ saving ? t('settings.hotkey.saving') : t('settings.hotkey.save') }}</button></div>
        </section>

        <section class="application-settings-section application-minimize-hint"><Keyboard :size="16" /><span><strong>{{ t('settings.minimize.title') }}</strong><small>{{ t('settings.minimize.description', { key: 'Esc' }) }}</small></span></section>
      </div>
      <footer><button class="command-button" type="button" @click="emit('close')">{{ t('settings.done') }}</button></footer>
    </section>
  </div>
</template>
