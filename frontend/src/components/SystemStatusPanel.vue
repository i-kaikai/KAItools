<script setup lang="ts">
import { Activity, BatteryCharging, BatteryMedium, Cpu, Database, Gauge, HardDrive, MonitorCog, RefreshCw, ShieldCheck, WifiOff } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { desktopApi } from '@/api/desktopApi'
import { formatDate, t } from '@/i18n'
import { checkService } from '@/api/remoteApi'
import { isWebRuntime } from '@/runtime'
import { useAppStore } from '@/stores/app'
import type { SystemStatusSnapshot } from '@/types'

type Detail = readonly [string, unknown]

const app = useAppStore()
const snapshot = ref<SystemStatusSnapshot | null>(null)
const serviceStatus = ref<'ready' | 'offline' | 'checking'>('checking')
const refreshing = ref(false)
let refreshTimer: number | undefined

function formatBytes(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return t('status.unavailable')
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return t('status.unavailable')
  if (typeof value === 'boolean') return value ? t('status.available') : t('status.unavailable')
  return String(value)
}

const runtimeTitle = computed(() => {
  if (snapshot.value?.runtime === 'desktop') return t('status.desktopReady')
  return snapshot.value?.system.online ? t('status.browserLocal') : t('status.browserOffline')
})
const runtimeDescription = computed(() => snapshot.value?.runtime === 'desktop'
  ? t('status.desktopDescription')
  : t('status.browserDescription'))
const capturedAt = computed(() => snapshot.value ? formatDate(new Date(snapshot.value.capturedAt), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : t('status.reading'))
const serviceLabel = computed(() => serviceStatus.value === 'ready' ? t('status.connected') : serviceStatus.value === 'checking' ? t('status.checking') : t('status.localMode'))

function compactCpuName(value: unknown): string {
  const source = formatValue(value)
  if (source === t('status.unavailable')) return source
  return source.replaceAll('(R)', '').replaceAll('(TM)', '').replace(/\s+/g, ' ').trim()
}

const primaryMetrics = computed((): Array<{ label: string; value: string; hint: string; icon: typeof Cpu }> => {
  const status = snapshot.value
  if (!status) return []
  if (status.runtime === 'desktop') {
    const powerSource = status.system.powerSource
    const powerPercent = status.system.powerPercent
    const powerCharging = status.system.powerCharging === true
    const batteryValue = powerSource === 'battery'
      ? typeof powerPercent === 'number' ? `${powerPercent}%` : t('status.battery')
      : powerSource === 'external' ? t('status.externalPower') : t('status.unavailable')
    const batteryHint = powerSource === 'battery' ? powerCharging ? t('status.charging') : t('status.onBattery') : powerSource === 'external' ? t('status.noBattery') : t('status.powerUnavailable')
    return [
      { label: t('status.cpu'), value: compactCpuName(status.system.cpuName), hint: t('status.processor'), icon: Cpu },
      { label: t('status.memory'), value: formatBytes(status.system.memoryAvailableBytes), hint: t('status.memoryTotal', { value: formatBytes(status.system.memoryTotalBytes) }), icon: Gauge },
      { label: t('status.power'), value: batteryValue, hint: batteryHint, icon: powerCharging ? BatteryCharging : BatteryMedium },
      { label: t('status.workspaceData'), value: formatBytes(status.application.dataDirectoryBytes), hint: t('status.managedDirectory'), icon: HardDrive },
    ]
  }
  return [
    { label: t('status.cpu'), value: t('status.unavailable'), hint: t('status.browserCpu'), icon: Cpu },
    { label: t('status.memory'), value: typeof status.system.deviceMemoryGiB === 'number' ? `${status.system.deviceMemoryGiB} GB` : t('status.unavailable'), hint: t('status.browserMemory'), icon: Gauge },
    { label: t('status.power'), value: t('status.unavailable'), hint: t('status.browserPower'), icon: BatteryMedium },
    { label: t('status.workspaceData'), value: formatBytes(status.application.storageUsageBytes), hint: t('status.quota', { value: formatBytes(status.application.storageQuotaBytes) }), icon: HardDrive },
  ]
})

const diagnostics = computed((): Detail[] => {
  const status = snapshot.value
  if (!status) return []
  if (status.runtime === 'desktop') {
    return [
      [t('status.system'), status.system.platform], ['WebView2', status.application.webview2],
      [t('status.syncService'), serviceLabel.value], [t('status.tray'), status.application.trayHidden ? t('status.hidden') : t('status.running')],
    ]
  }
  return [
    [t('status.browser'), status.system.browser], ['IndexedDB', status.application.indexedDbAvailable],
    [t('status.localStorage'), status.application.localStorageAvailable], [t('status.syncService'), serviceLabel.value],
  ]
})

async function refresh(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  serviceStatus.value = 'checking'
  const [statusResult, serviceResult] = await Promise.all([desktopApi.getSystemStatus(), checkService(app.apiOrigin)])
  if (statusResult.ok) snapshot.value = statusResult.data
  serviceStatus.value = serviceResult.ok ? 'ready' : 'offline'
  refreshing.value = false
}

function resetRefreshTimer(): void {
  window.clearInterval(refreshTimer)
  const seconds = app.settings.systemStatusRefreshSeconds
  if (seconds) refreshTimer = window.setInterval(() => { void refresh() }, seconds * 1000)
}

watch(() => app.settings.systemStatusRefreshSeconds, resetRefreshTimer)
onMounted(() => { void refresh(); resetRefreshTimer() })
onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <section class="system-status-panel" :data-runtime="isWebRuntime ? 'web' : 'desktop'" :data-service="serviceStatus" :aria-label="t('status.title')">
    <header class="system-status-header">
      <div><span><MonitorCog :size="17" />{{ t('status.title') }}</span><small>{{ snapshot ? t('status.updated', { time: capturedAt }) : t('status.reading') }}</small></div>
      <button class="icon-button small" type="button" :aria-label="t('status.refresh')" :disabled="refreshing" @click="refresh"><RefreshCw :size="15" :class="{ spinning: refreshing }" /></button>
    </header>
    <div class="system-status-hero">
      <span class="system-status-signal" :class="serviceStatus"><ShieldCheck v-if="serviceStatus === 'ready'" :size="20" /><Activity v-else :size="20" /></span>
      <div><strong>{{ runtimeTitle }}</strong><span>{{ runtimeDescription }}</span></div>
      <span class="system-status-service"><ShieldCheck v-if="serviceStatus === 'ready'" :size="13" /><WifiOff v-else :size="13" />{{ serviceLabel }}</span>
    </div>
    <div v-if="snapshot" class="system-status-metrics"><div v-for="metric in primaryMetrics" :key="metric.label"><component :is="metric.icon" :size="15" /><span><small>{{ metric.label }}</small><strong>{{ metric.value }}</strong><em>{{ metric.hint }}</em></span></div></div>
    <div v-else class="system-status-loading"><Database :size="16" /><span>{{ t('status.readingRuntime') }}</span></div>
    <dl v-if="snapshot" class="system-status-details"><div v-for="([label, value]) in diagnostics" :key="String(label)"><dt>{{ label }}</dt><dd :title="formatValue(value)">{{ formatValue(value) }}</dd></div></dl>
  </section>
</template>
