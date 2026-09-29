<script setup lang="ts">
import { Clipboard, Copy, Eye, EyeOff, FileText, Image, Pause, Play, RefreshCw, Search, Trash2 } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import DesktopOnlyState from '@/components/DesktopOnlyState.vue'
import IconButton from '@/components/IconButton.vue'
import { desktopApi } from '@/api/desktopApi'
import { isWebRuntime } from '@/runtime'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import type { ClipboardHistorySnapshot } from '@/types'

const app = useAppStore()
const toast = useToastStore()
const snapshot = ref<ClipboardHistorySnapshot | null>(null)
const query = ref('')
const kindFilter = ref<'all' | 'text' | 'image' | 'files'>('all')
const loading = ref(false)
const previews = ref<Record<string, string>>({})
const previewErrors = ref<Record<string, string>>({})
const loadingPreviews = ref<Record<string, boolean>>({})
const filterOptions = [
  { id: 'all', label: '全部' },
  { id: 'text', label: '文本' },
  { id: 'image', label: '图片' },
  { id: 'files', label: '文件/文件夹' },
] as const
let refreshTimer: number | undefined
const clipboardDateFormatter = new Intl.DateTimeFormat()

const historyItems = computed(() => snapshot.value?.items ?? [])
const counts = computed(() => ({
  all: historyItems.value.length,
  text: historyItems.value.filter((item) => item.kind === 'text').length,
  image: historyItems.value.filter((item) => item.kind === 'image').length,
  files: historyItems.value.filter((item) => item.kind === 'files').length,
}))

const items = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  return historyItems.value.filter((item) => {
    if (kindFilter.value !== 'all' && item.kind !== kindFilter.value) return false
    if (!normalized) return true
    if (item.kind === 'text') return item.text.toLocaleLowerCase().includes(normalized)
    if (item.kind === 'files') return item.files.some((name) => name.toLocaleLowerCase().includes(normalized))
    return '图片 image png dib'.includes(normalized)
  })
})

function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180)
}

async function refresh(): Promise<void> {
  if (isWebRuntime || loading.value) return
  loading.value = true
  const result = await desktopApi.getClipboardHistory()
  if (result.ok) {
    snapshot.value = result.data
    const imageIds = new Set(result.data.items.filter((item) => item.kind === 'image').map((item) => item.id))
    const next = { ...previews.value }
    for (const id of Object.keys(next)) {
      if (!imageIds.has(id)) delete next[id]
    }
    previews.value = next
  }
  else toast.show(result.error.message, 'error')
  loading.value = false
}

function formatCreatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : clipboardDateFormatter.format(date)
}

function stopPolling(): void {
  window.clearInterval(refreshTimer)
  refreshTimer = undefined
}

function startPolling(): void {
  stopPolling()
  if (isWebRuntime || document.hidden) return
  void refresh()
  refreshTimer = window.setInterval(() => { void refresh() }, 750)
}

function onVisibilityChange(): void {
  if (document.hidden) stopPolling()
  else startPolling()
}

function itemTitle(item: ClipboardHistorySnapshot['items'][number]): string {
  if (item.kind === 'text') return preview(item.text) || '空白文本'
  if (item.kind === 'image') return `图片 · ${formatBytes(item.imageBytes)}`
  const names = item.files.slice(0, 3).join('、')
  return `文件/文件夹 · ${names || `${item.files.length} 项`}${item.files.length > 3 ? ` 等 ${item.files.length} 项` : ''}`
}

function itemDetails(item: ClipboardHistorySnapshot['items'][number]): string {
  if (item.kind === 'text') return `${item.text.length.toLocaleString()} 字符${item.truncated ? ' · 已截断' : ''}`
  if (item.kind === 'image') return `${item.imageFormat.toUpperCase()} 图片`
  return `${item.files.length} 个文件或文件夹${item.truncated ? ' · 部分路径未记录' : ''}`
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
}

async function copy(item: ClipboardHistorySnapshot['items'][number]): Promise<void> {
  const result = await desktopApi.copyClipboardHistoryItem(item.id)
  if (result.ok) toast.show('已复制到系统剪切板')
  else toast.show(result.error.message, 'error')
}

async function togglePreview(item: Extract<ClipboardHistorySnapshot['items'][number], { kind: 'image' }>): Promise<void> {
  if (previews.value[item.id]) {
    const next = { ...previews.value }
    delete next[item.id]
    previews.value = next
    const errors = { ...previewErrors.value }
    delete errors[item.id]
    previewErrors.value = errors
    return
  }
  if (loadingPreviews.value[item.id]) return
  loadingPreviews.value = { ...loadingPreviews.value, [item.id]: true }
  try {
    const result = await desktopApi.getClipboardHistoryImage(item.id)
    if (result.ok) previews.value = { ...previews.value, [item.id]: result.data.dataUrl }
    else {
      previewErrors.value = { ...previewErrors.value, [item.id]: result.error.message }
      toast.show(result.error.message, 'error')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取图片失败'
    previewErrors.value = { ...previewErrors.value, [item.id]: message }
    toast.show(message, 'error')
  } finally {
    const next = { ...loadingPreviews.value }
    delete next[item.id]
    loadingPreviews.value = next
  }
}

function onPreviewError(itemId: string): void {
  const next = { ...previews.value }
  delete next[itemId]
  previews.value = next
  previewErrors.value = { ...previewErrors.value, [itemId]: '当前图片格式无法在页面中预览' }
}

async function remove(id: string): Promise<void> {
  const result = await desktopApi.deleteClipboardHistoryItem(id)
  if (!result.ok) toast.show(result.error.message, 'error')
  const next = { ...previews.value }
  delete next[id]
  previews.value = next
  const errors = { ...previewErrors.value }
  delete errors[id]
  previewErrors.value = errors
  await refresh()
}

async function clear(): Promise<void> {
  const result = await desktopApi.clearClipboardHistory()
  if (result.ok) {
    previews.value = {}
    previewErrors.value = {}
    await refresh()
  }
  else toast.show(result.error.message, 'error')
}

async function toggleMonitoring(): Promise<void> {
  const enabled = !(snapshot.value?.enabled ?? app.settings.clipboardMonitoringEnabled)
  await app.setClipboardMonitoringEnabled(enabled)
  await refresh()
}

onMounted(() => {
  if (isWebRuntime) return
  document.addEventListener('visibilitychange', onVisibilityChange)
  startPolling()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopPolling()
})
</script>

<template>
  <section class="tool-page clipboard-history-tool">
    <header class="tool-header clipboard-history-header">
      <div class="clipboard-history-title"><span class="clipboard-history-monitor" :class="{ paused: !snapshot?.enabled }"><Clipboard :size="18" /></span><div><small>{{ isWebRuntime ? 'DESKTOP ONLY' : snapshot?.enabled ? 'WINDOWS CLIPBOARD LISTENER' : 'CLIPBOARD LISTENER PAUSED' }}</small><h1>剪切板历史</h1><p>{{ isWebRuntime ? 'Windows 桌面限定能力' : snapshot?.enabled ? '启动时已采集当前剪切板，并持续记录后续复制内容' : '记录已暂停，历史内容仍保留在当前会话中' }}</p></div></div>
      <div v-if="!isWebRuntime" class="toolbar">
        <IconButton :icon="RefreshCw" label="刷新剪切板历史" :disabled="loading" @click="refresh" />
        <button class="command-button secondary" type="button" @click="toggleMonitoring"><Pause v-if="snapshot?.enabled" :size="15" /><Play v-else :size="15" />{{ snapshot?.enabled ? '暂停记录' : '恢复记录' }}</button>
        <IconButton :icon="Trash2" label="清空剪切板历史" :disabled="!snapshot?.items.length" danger @click="clear" />
      </div>
    </header>

    <DesktopOnlyState v-if="isWebRuntime" title="剪切板历史仅 Windows 桌面版可用" description="浏览器无法在后台持续监听系统剪切板。" />
    <template v-else>
      <nav class="clipboard-history-filters segmented-control" aria-label="按剪切板类型筛选">
        <button v-for="option in filterOptions" :key="option.id" type="button" :class="{ active: kindFilter === option.id }" :aria-pressed="kindFilter === option.id" @click="kindFilter = option.id">{{ option.label }}<span>{{ counts[option.id] }}</span></button>
      </nav>
      <label class="clipboard-history-search"><Search :size="16" /><input v-model="query" type="search" placeholder="搜索文本、文件或文件夹" aria-label="搜索剪切板历史" /><small>{{ items.length }} / {{ snapshot?.items.length ?? 0 }} 条</small></label>
      <div v-if="items.length" class="clipboard-history-list">
        <article v-for="item in items" :key="item.id">
          <span class="clipboard-history-index"><Clipboard v-if="item.kind === 'text'" :size="14" /><Image v-else-if="item.kind === 'image'" :size="14" /><FileText v-else :size="14" /></span>
          <div class="clipboard-history-content"><strong>{{ itemTitle(item) }}</strong><small>{{ formatCreatedAt(item.createdAt) }} · {{ itemDetails(item) }}</small><img v-if="item.kind === 'image' && previews[item.id]" class="clipboard-history-preview" :src="previews[item.id]" alt="剪切板图片预览" @error="onPreviewError(item.id)" /><small v-if="item.kind === 'image' && previewErrors[item.id]" class="clipboard-history-preview-error">{{ previewErrors[item.id] }}</small></div>
          <div><button v-if="item.kind === 'image'" class="clipboard-history-preview-button" type="button" :disabled="loadingPreviews[item.id]" @click="togglePreview(item)"><EyeOff v-if="previews[item.id]" :size="14" /><Eye v-else :size="14" />{{ loadingPreviews[item.id] ? '载入中' : previews[item.id] ? '收起' : '预览' }}</button><IconButton :icon="Copy" label="复制此条记录" size="small" @click="copy(item)" /><IconButton :icon="Trash2" label="删除此条记录" size="small" danger @click="remove(item.id)" /></div>
        </article>
      </div>
      <div v-else class="clipboard-history-empty"><Clipboard :size="24" /><strong>{{ !snapshot?.enabled ? '剪切板记录已暂停' : query ? '没有匹配的记录' : kindFilter === 'all' ? '尚未记录到剪切板内容' : `暂无${kindFilter === 'text' ? '文本' : kindFilter === 'image' ? '图片' : '文件'}记录` }}</strong></div>
    </template>
  </section>
</template>
