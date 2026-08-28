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
type MetricTone = 'normal' | 'warning' | 'danger' | 'neutral'

interface Metric {
  label: string
  value: string
  hint: string
  icon: typeof Cpu
  progress: number | null
  tone: MetricTone
}

const app = useAppStore()
const snapshot = ref<SystemStatusSnapshot | null>(null)
const serviceStatus = ref<'ready' | 'offline' | 'checking'>('checking')
const refreshingMetrics = ref(false)
const checkingService = ref(false)
let metricsRefreshTimer: number | undefined
let serviceRefreshTimer: number | undefined

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
const refreshing = computed(() => refreshingMetrics.value || checkingService.value)

function compactCpuName(value: unknown): string {
  const source = formatValue(value)
  if (source === t('status.unavailable')) return source
  return source.replaceAll('(R)', '').replaceAll('(TM)', '').replace(/\s+/g, ' ').trim()
}

function percent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
}

function formatPercent(value: unknown): string {
  const normalized = percent(value)
  if (normalized === null) return t('status.unavailable')
  return `${normalized % 1 === 0 ? normalized.toFixed(0) : normalized.toFixed(1)}%`
}

function toneForPercent(value: number | null, inverse = false): MetricTone {
  if (value === null) return 'neutral'
  const warning = inverse ? value <= 50 : value >= 65
  const danger = inverse ? value <= 20 : value >= 85
  if (danger) return 'danger'
  return warning ? 'warning' : 'normal'
}

function browserPressureMetric(status: SystemStatusSnapshot): Metric {
  const pressure = status.system.cpuPressure
  const logicalCores = status.system.logicalCores
  const pressureDetails: Record<string, { label: string; progress: number; tone: MetricTone }> = {
    nominal: { label: t('status.cpuPressureNominal'), progress: 25, tone: 'normal' },
    fair: { label: t('status.cpuPressureFair'), progress: 50, tone: 'warning' },
    serious: { label: t('status.cpuPressureSerious'), progress: 75, tone: 'warning' },
    critical: { label: t('status.cpuPressureCritical'), progress: 100, tone: 'danger' },
  }
  const detail = typeof pressure === 'string' ? pressureDetails[pressure] : undefined
  return {
    label: t('status.cpu'),
    value: detail?.label ?? t('status.unavailable'),
    hint: typeof logicalCores === 'number' ? t('status.browserCpuCores', { count: logicalCores }) : t('status.browserCpuUnavailable'),
    icon: Cpu,
    progress: detail?.progress ?? null,
    tone: detail?.tone ?? 'neutral',
  }
}

const primaryMetrics = computed((): Metric[] => {
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
    const memoryTotalBytes = status.system.memoryTotalBytes
    const memoryAvailableBytes = status.system.memoryAvailableBytes
    const memoryUsedBytes = typeof memoryTotalBytes === 'number' && typeof memoryAvailableBytes === 'number'
      ? Math.max(0, memoryTotalBytes - memoryAvailableBytes)
      : null
    const cpuUsagePercent = percent(status.system.cpuUsagePercent)
    const memoryUsagePercent = percent(status.system.memoryUsagePercent)
    const batteryPercent = powerSource === 'battery' ? percent(powerPercent) : null
    return [
      { label: t('status.cpu'), value: formatPercent(cpuUsagePercent), hint: compactCpuName(status.system.cpuName) === t('status.unavailable') ? t('status.cpuUsage') : compactCpuName(status.system.cpuName), icon: Cpu, progress: cpuUsagePercent, tone: toneForPercent(cpuUsagePercent) },
      { label: t('status.memory'), value: formatPercent(memoryUsagePercent), hint: t('status.memoryUsed', { used: formatBytes(memoryUsedBytes), total: formatBytes(memoryTotalBytes) }), icon: Gauge, progress: memoryUsagePercent, tone: toneForPercent(memoryUsagePercent) },
      { label: t('status.power'), value: batteryValue, hint: batteryHint, icon: powerCharging ? BatteryCharging : BatteryMedium, progress: batteryPercent, tone: toneForPercent(batteryPercent, true) },
      { label: t('status.workspaceData'), value: formatBytes(status.application.dataDirectoryBytes), hint: t('status.managedDirectory'), icon: HardDrive, progress: null, tone: 'neutral' },
    ]
  }
  const jsHeapUsagePercent = percent(status.system.jsHeapUsagePercent)
  const jsHeapUsedBytes = status.system.jsHeapUsedBytes
  const jsHeapLimitBytes = status.system.jsHeapLimitBytes
  const browserBatteryPercent = status.system.powerSource === 'battery' ? percent(status.system.powerPercent) : null
  const storageUsageBytes = status.application.storageUsageBytes
  const storageQuotaBytes = status.application.storageQuotaBytes
  const storageUsagePercent = typeof storageUsageBytes === 'number' && typeof storageQuotaBytes === 'number' && storageQuotaBytes > 0
    ? percent(storageUsageBytes / storageQuotaBytes * 100)
    : null
  return [
    browserPressureMetric(status),
    { label: t('status.browserJsHeap'), value: formatPercent(jsHeapUsagePercent), hint: jsHeapUsagePercent === null ? t('status.browserJsHeapUnavailable') : t('status.browserJsHeapUsage', { used: formatBytes(jsHeapUsedBytes), limit: formatBytes(jsHeapLimitBytes) }), icon: Gauge, progress: jsHeapUsagePercent, tone: toneForPercent(jsHeapUsagePercent) },
    { label: t('status.power'), value: formatPercent(browserBatteryPercent), hint: status.system.powerCharging === true ? t('status.charging') : browserBatteryPercent === null ? t('status.powerUnavailable') : t('status.onBattery'), icon: status.system.powerCharging === true ? BatteryCharging : BatteryMedium, progress: browserBatteryPercent, tone: toneForPercent(browserBatteryPercent, true) },
    { label: t('status.workspaceData'), value: formatBytes(storageUsageBytes), hint: t('status.storageUsed', { used: formatBytes(storageUsageBytes), quota: formatBytes(storageQuotaBytes) }), icon: HardDrive, progress: storageUsagePercent, tone: toneForPercent(storageUsagePercent) },
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

async function refreshMetrics(): Promise<void> {
  if (refreshingMetrics.value) return
  refreshingMetrics.value = true
  const statusResult = await desktopApi.getSystemStatus()
  if (statusResult.ok) snapshot.value = statusResult.data
  refreshingMetrics.value = false
}

async function refreshService(): Promise<void> {
  if (checkingService.value) return
  checkingService.value = true
  serviceStatus.value = 'checking'
  const serviceResult = await checkService(app.apiOrigin)
  serviceStatus.value = serviceResult.ok ? 'ready' : 'offline'
  checkingService.value = false
}

async function refresh(): Promise<void> {
  await Promise.all([refreshMetrics(), refreshService()])
}

function stopRefreshTimers(): void {
  window.clearInterval(metricsRefreshTimer)
  window.clearInterval(serviceRefreshTimer)
  metricsRefreshTimer = undefined
  serviceRefreshTimer = undefined
}

function resetRefreshTimers(): void {
  stopRefreshTimers()
  const visible = document.visibilityState === 'visible'
  desktopApi.setBrowserSystemStatusMonitoring(visible)
  if (!visible) return
  const seconds = app.settings.systemStatusRefreshSeconds
  if (seconds) metricsRefreshTimer = window.setInterval(() => { void refreshMetrics() }, seconds * 1000)
  serviceRefreshTimer = window.setInterval(() => { void refreshService() }, 30_000)
}

function onVisibilityChange(): void {
  resetRefreshTimers()
  if (document.visibilityState === 'visible') void refresh()
}

watch(() => app.settings.systemStatusRefreshSeconds, () => {
  resetRefreshTimers()
  if (document.visibilityState === 'visible') void refreshMetrics()
})
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  resetRefreshTimers()
  if (document.visibilityState === 'visible') void refresh()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopRefreshTimers()
  desktopApi.setBrowserSystemStatusMonitoring(false)
})
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
    <div v-if="snapshot" class="system-status-metrics"><div v-for="metric in primaryMetrics" :key="metric.label" :data-tone="metric.tone"><component :is="metric.icon" :size="15" /><span><small>{{ metric.label }}</small><strong>{{ metric.value }}</strong><em>{{ metric.hint }}</em><span v-if="metric.progress !== null" class="system-status-progress" role="progressbar" :aria-label="metric.label" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="metric.progress" :aria-valuetext="metric.value"><i :style="{ width: `${metric.progress}%` }" /></span></span></div></div>
    <div v-else class="system-status-loading"><Database :size="16" /><span>{{ t('status.readingRuntime') }}</span></div>
    <dl v-if="snapshot" class="system-status-details"><div v-for="([label, value]) in diagnostics" :key="String(label)"><dt>{{ label }}</dt><dd :title="formatValue(value)">{{ formatValue(value) }}</dd></div></dl>
  </section>
</template>
