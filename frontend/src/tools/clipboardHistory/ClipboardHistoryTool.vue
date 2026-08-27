<script setup lang="ts">
import { Clipboard, Copy, Pause, Play, RefreshCw, Search, Trash2 } from '@lucide/vue'
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
const loading = ref(false)
let refreshTimer: number | undefined

const items = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  return (snapshot.value?.items ?? []).filter((item) => !normalized || item.text.toLocaleLowerCase().includes(normalized))
})

function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180)
}

async function refresh(): Promise<void> {
  if (isWebRuntime || loading.value) return
  loading.value = true
  const result = await desktopApi.getClipboardHistory()
  if (result.ok) snapshot.value = result.data
  else toast.show(result.error.message, 'error')
  loading.value = false
}

async function copy(item: { text: string }): Promise<void> {
  const result = await desktopApi.copyText(item.text)
  if (result.ok) toast.show('已复制到系统剪切板')
  else toast.show(result.error.message, 'error')
}

async function remove(id: string): Promise<void> {
  const result = await desktopApi.deleteClipboardHistoryItem(id)
  if (!result.ok) toast.show(result.error.message, 'error')
  await refresh()
}

async function clear(): Promise<void> {
  const result = await desktopApi.clearClipboardHistory()
  if (result.ok) await refresh()
  else toast.show(result.error.message, 'error')
}

async function toggleMonitoring(): Promise<void> {
  const enabled = !(snapshot.value?.enabled ?? app.settings.clipboardMonitoringEnabled)
  await app.setClipboardMonitoringEnabled(enabled)
  await refresh()
}

onMounted(() => {
  if (isWebRuntime) return
  void refresh()
  refreshTimer = window.setInterval(() => { void refresh() }, 750)
})
onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <section class="tool-page clipboard-history-tool">
    <header class="tool-header clipboard-history-header">
      <div class="clipboard-history-title"><span class="clipboard-history-monitor" :class="{ paused: !snapshot?.enabled }"><Clipboard :size="18" /></span><div><small>{{ isWebRuntime ? 'DESKTOP ONLY' : snapshot?.enabled ? 'WINDOWS CLIPBOARD LISTENER' : 'CLIPBOARD LISTENER PAUSED' }}</small><h1>剪切板历史</h1><p>{{ isWebRuntime ? 'Windows 桌面限定能力' : snapshot?.enabled ? '启动时已采集当前文本，并持续记录后续复制内容' : '记录已暂停，历史内容仍保留在当前会话中' }}</p></div></div>
      <div v-if="!isWebRuntime" class="toolbar">
        <IconButton :icon="RefreshCw" label="刷新剪切板历史" :disabled="loading" @click="refresh" />
        <button class="command-button secondary" type="button" @click="toggleMonitoring"><Pause v-if="snapshot?.enabled" :size="15" /><Play v-else :size="15" />{{ snapshot?.enabled ? '暂停记录' : '恢复记录' }}</button>
        <IconButton :icon="Trash2" label="清空剪切板历史" :disabled="!snapshot?.items.length" danger @click="clear" />
      </div>
    </header>

    <DesktopOnlyState v-if="isWebRuntime" title="剪切板历史仅 Windows 桌面版可用" description="浏览器无法在后台持续监听系统剪切板。请使用桌面版记录和管理纯文本历史。" />
    <template v-else>
      <label class="clipboard-history-search"><Search :size="16" /><input v-model="query" type="search" placeholder="搜索剪切板文本" aria-label="搜索剪切板历史" /><small>{{ items.length }} / {{ snapshot?.items.length ?? 0 }} 条</small></label>
      <div v-if="items.length" class="clipboard-history-list">
        <article v-for="(item, index) in items" :key="item.id">
          <span class="clipboard-history-index">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="clipboard-history-content"><strong>{{ preview(item.text) || '空白文本' }}</strong><small>{{ new Date(item.createdAt).toLocaleString() }} · {{ item.text.length.toLocaleString() }} 字符{{ item.truncated ? ' · 已截断' : '' }}</small></div>
          <div><IconButton :icon="Copy" label="复制此条记录" size="small" @click="copy(item)" /><IconButton :icon="Trash2" label="删除此条记录" size="small" danger @click="remove(item.id)" /></div>
        </article>
      </div>
      <div v-else class="clipboard-history-empty"><Clipboard :size="24" /><strong>{{ snapshot?.enabled ? '尚未记录到纯文本剪切板内容' : '剪切板记录已暂停' }}</strong><span>图片、文件和非文本格式不会进入历史。</span></div>
    </template>
  </section>
</template>
