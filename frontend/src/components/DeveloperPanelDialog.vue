<script setup lang="ts">
import { CheckCircle2, CircleAlert, Code2, LoaderCircle, RotateCcw, Server, TerminalSquare, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { desktopApi } from '@/api/desktopApi'
import { checkLocalService, DEFAULT_LOCAL_API_ORIGIN, resolveLocalServiceOrigin } from '@/api/remoteApi'
import { isWebRuntime } from '@/runtime'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const toast = useToastStore()
const origin = ref(DEFAULT_LOCAL_API_ORIGIN)
const useLocalApi = ref(false)
const connectionState = ref<'idle' | 'checking' | 'ready' | 'error'>('idle')
const connectionMessage = ref('尚未检测本地服务')
const validOrigin = computed(() => resolveLocalServiceOrigin(origin.value))

watch(() => props.open, (open) => {
  if (!open) return
  origin.value = app.backendConnection.localApiOrigin
  useLocalApi.value = app.backendConnection.useLocalApi
  connectionState.value = 'idle'
  connectionMessage.value = '尚未检测本地服务'
}, { immediate: true })

function saveAddress(): boolean {
  const resolved = validOrigin.value
  if (!resolved) {
    connectionState.value = 'error'
    connectionMessage.value = '仅允许 localhost、127.0.0.1 或 [::1]，地址不能包含 /api、路径或参数。'
    return false
  }
  app.setBackendConnection({ schemaVersion: 1, localApiOrigin: resolved, useLocalApi: useLocalApi.value })
  origin.value = resolved
  connectionMessage.value = useLocalApi.value ? '本机开发服务已作为当前接口保存' : '本机开发服务地址已保存，当前仍使用服务器'
  return true
}

async function testConnection(): Promise<void> {
  if (!saveAddress() || !validOrigin.value) return
  connectionState.value = 'checking'
  connectionMessage.value = '正在检测 /api/health…'
  const result = await checkLocalService(validOrigin.value)
  if (result.ok) {
    connectionState.value = 'ready'
    connectionMessage.value = `服务已就绪 · ${result.data.status}`
  } else {
    connectionState.value = 'error'
    connectionMessage.value = result.error.message
  }
}

function resetAddress(): void {
  origin.value = DEFAULT_LOCAL_API_ORIGIN
  saveAddress()
}

async function openDevtools(): Promise<void> {
  if (isWebRuntime) {
    toast.show('网页环境请使用浏览器 F12 打开开发者工具', 'error')
    return
  }
  const result = await desktopApi.openDeveloperTools()
  if (!result.ok) toast.show(result.error.message, 'error')
}

async function disableDeveloperMode(): Promise<void> {
  const saved = await app.setDeveloperModeEnabled(false)
  if (!saved) return
  toast.show('开发者模式已关闭')
  emit('close')
}
</script>

<template>
  <div v-if="open" class="developer-panel-backdrop" @pointerdown.self="emit('close')">
    <section class="developer-panel-dialog" role="dialog" aria-modal="true" aria-labelledby="developer-panel-title">
      <header><div><span><Code2 :size="14" />DEVELOPER MODE</span><h2 id="developer-panel-title">开发者模式</h2><p>本地服务调试与运行时诊断，仅保存在当前设备。</p></div><button type="button" aria-label="关闭开发者模式面板" @click="emit('close')"><X :size="18" /></button></header>
      <section class="developer-service-section">
        <div class="developer-section-heading"><Server :size="17" /><span><strong>本地后端服务</strong><small>客户端固定追加 <code>/api</code></small></span></div>
        <label class="developer-local-service-toggle"><input v-model="useLocalApi" type="checkbox" @change="saveAddress" /><span><strong>使用本机服务覆盖服务器</strong><small>仅当前设备的开发者模式生效；关闭后立即恢复 <code>https://tools.imkai.top</code>。</small></span></label>
        <label>服务地址<input v-model="origin" inputmode="url" autocomplete="off" placeholder="http://127.0.0.1:8080" /><small>只允许本机回环地址，不要填写 <code>/api</code>。</small></label>
        <div class="developer-connection-status" :class="connectionState" role="status" aria-live="polite"><LoaderCircle v-if="connectionState === 'checking'" :size="15" /><CheckCircle2 v-else-if="connectionState === 'ready'" :size="15" /><CircleAlert v-else :size="15" /><span>{{ connectionMessage }}</span></div>
        <div class="developer-service-actions"><button class="command-button subtle" type="button" @click="resetAddress"><RotateCcw :size="14" />恢复默认</button><button class="command-button subtle" type="button" @click="saveAddress">保存地址</button><button class="command-button" type="button" :disabled="connectionState === 'checking'" @click="testConnection"><Server :size="14" />测试连接</button></div>
      </section>
      <section class="developer-runtime-section">
        <div class="developer-section-heading"><TerminalSquare :size="17" /><span><strong>运行时工具</strong><small>{{ isWebRuntime ? 'Browser' : 'WebView2' }}</small></span></div>
        <dl><div><dt>当前 API</dt><dd>{{ app.apiOrigin }}/api</dd></div><div><dt>默认服务器</dt><dd>https://tools.imkai.top/api</dd></div><div><dt>WebView2</dt><dd>{{ isWebRuntime ? '浏览器环境' : app.runtime?.webview2 ?? '检测中' }}</dd></div><div><dt>数据目录</dt><dd :title="app.runtime?.dataDirectory">{{ app.runtime?.dataDirectory ?? '加载中' }}</dd></div></dl>
        <button class="command-button secondary" type="button" @click="openDevtools"><TerminalSquare :size="15" />{{ isWebRuntime ? '浏览器请使用 F12' : '打开 WebView2 DevTools' }}</button>
      </section>
      <footer><button class="developer-disable-button" type="button" @click="disableDeveloperMode">退出开发者模式</button><button class="command-button" type="button" @click="emit('close')">完成</button></footer>
    </section>
  </div>
</template>
