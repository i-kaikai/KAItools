<script setup lang="ts">
import { Copy, Plus, Save, Send, Square, Trash2, X } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import ToolChainButton from '@/components/ToolChainButton.vue'
import { useToastStore } from '@/stores/toast'
import { buildRequestUrl, isSensitiveHeader, keyValuesToHeaders, normalizeApiKeyValues, readApiResponse, type ApiKeyValue, type ApiResponseSnapshot } from '@/utils/apiDebugger'
import { copyText } from '@/utils/clipboard'

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

interface SavedRequest {
  id: string
  name: string
  method: ApiMethod
  url: string
  params: ApiKeyValue[]
  headers: ApiKeyValue[]
  body: string
}

interface ApiClientState {
  method: ApiMethod
  url: string
  params: ApiKeyValue[]
  headers: ApiKeyValue[]
  split: number
  savedRequests: SavedRequest[]
}

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const methods: ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
const validMethods = new Set<ApiMethod>(methods)

function apiMethod(value: unknown): ApiMethod {
  return typeof value === 'string' && validMethods.has(value as ApiMethod) ? value as ApiMethod : 'GET'
}

function requestId(): string {
  return crypto.randomUUID?.() ?? `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function redactBody(value: string): string {
  if (!value.trim()) return ''
  try {
    const redact = (item: unknown, key = ''): unknown => {
      if (/^(?:access_?token|refresh_?token|id_?token|token|password|client_?secret)$/i.test(key)) return '<redacted>'
      if (Array.isArray(item)) return item.map((entry) => redact(entry))
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]))
      return item
    }
    return JSON.stringify(redact(JSON.parse(value)), null, 2)
  } catch {
    return value.replace(/((?:access_?token|refresh_?token|id_?token|token|password|client_?secret)\s*[=:]\s*)([^&\s,"}]+)/gi, '$1<redacted>')
  }
}

function savedRequests(value: unknown): SavedRequest[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const request = item as Partial<SavedRequest>
    const name = typeof request.name === 'string' ? request.name.trim() : ''
    const url = typeof request.url === 'string' ? request.url.trim() : ''
    if (!name || !url) return []
    return [{
      id: typeof request.id === 'string' && request.id ? request.id : requestId(),
      name,
      method: apiMethod(request.method),
      url,
      params: normalizeApiKeyValues(request.params),
      headers: normalizeApiKeyValues(request.headers),
      body: redactBody(typeof request.body === 'string' ? request.body : ''),
    }]
  })
}

const model = reactive<ApiClientState>({
  method: apiMethod(props.state.method),
  url: typeof props.state.url === 'string' ? props.state.url : '',
  params: normalizeApiKeyValues(props.state.params, true),
  headers: normalizeApiKeyValues(props.state.headers),
  split: typeof props.state.split === 'number' ? props.state.split : 48,
  savedRequests: savedRequests(props.state.savedRequests),
})
const body = ref(typeof props.state.body === 'string' ? props.state.body : '')
const authorization = ref('')
const authorizationScheme = ref<'bearer' | 'basic' | 'raw'>('bearer')
const savedName = ref('')
const selectedSavedRequest = ref('')
const busy = ref(false)
const error = ref('')
const response = ref<ApiResponseSnapshot | null>(null)
const responseBody = ref('')
let controller: AbortController | null = null

watch(model, () => {
  emit('update:state', {
    ...model,
    params: normalizeApiKeyValues(model.params),
    headers: normalizeApiKeyValues(model.headers),
    savedRequests: model.savedRequests.map((request) => ({ ...request, params: normalizeApiKeyValues(request.params), headers: normalizeApiKeyValues(request.headers), body: redactBody(request.body) })),
  })
}, { deep: true, immediate: true })

const canSendBody = computed(() => !['GET', 'HEAD'].includes(model.method))
const responseSummary = computed(() => response.value
  ? `${response.value.status} ${response.value.statusText || ''} · ${response.value.elapsedMs} ms · ${response.value.size.toLocaleString()} B`
  : '发送请求后将在此显示响应')
const responseHeaders = computed(() => response.value?.headers.map((item) => `${item.key}: ${item.value}`).join('\n') ?? '')

function addEntry(target: ApiKeyValue[]): void {
  target.push({ key: '', value: '', enabled: true })
}

function removeEntry(target: ApiKeyValue[], index: number): void {
  target.splice(index, 1)
}

function authorizationValue(): string {
  const value = authorization.value.trim()
  if (!value) return ''
  if (authorizationScheme.value === 'raw') return value
  return `${authorizationScheme.value === 'basic' ? 'Basic' : 'Bearer'} ${value}`
}

function requestHeaders(): Headers {
  const headers = keyValuesToHeaders(model.headers)
  const auth = authorizationValue()
  if (auth) headers.set('authorization', auth)
  if (canSendBody.value && body.value.trim() && !headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8')
  return headers
}

async function send(): Promise<void> {
  error.value = ''
  response.value = null
  responseBody.value = ''
  let url: string
  try {
    url = buildRequestUrl(model.url, model.params)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '请求地址无效'
    return
  }

  busy.value = true
  controller = new AbortController()
  const startedAt = performance.now()
  try {
    const request = await fetch(url, {
      method: model.method,
      headers: requestHeaders(),
      body: canSendBody.value && body.value.trim() ? body.value : undefined,
      signal: controller.signal,
    })
    const snapshot = await readApiResponse(request, performance.now() - startedAt)
    response.value = snapshot
    responseBody.value = snapshot.body
    toast.show(`请求完成：${snapshot.status}`, snapshot.status >= 400 ? 'error' : 'success')
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') error.value = '请求已取消'
    else error.value = '请求未完成。请检查地址、网络、TLS 或浏览器 CORS 策略。'
  } finally {
    controller = null
    busy.value = false
  }
}

function cancel(): void {
  controller?.abort()
}

function saveCurrent(): void {
  const name = savedName.value.trim() || `${model.method} ${model.url || '未命名请求'}`
  const record: SavedRequest = {
    id: requestId(),
    name,
    method: model.method,
    url: model.url,
    params: normalizeApiKeyValues(model.params),
    headers: normalizeApiKeyValues(model.headers),
    body: redactBody(body.value),
  }
  if (!record.url.trim()) {
    toast.show('请先填写请求地址', 'error')
    return
  }
  model.savedRequests = [record, ...model.savedRequests.filter((item) => item.name !== record.name)].slice(0, 20)
  savedName.value = ''
  toast.show('请求已保存到当前工具工作区', 'success')
}

function loadSaved(value: string): void {
  const record = model.savedRequests.find((item) => item.id === value)
  selectedSavedRequest.value = ''
  if (!record) return
  model.method = record.method
  model.url = record.url
  model.params = record.params.map((item) => ({ ...item }))
  model.headers = record.headers.map((item) => ({ ...item }))
  body.value = record.body
  authorization.value = ''
  toast.show(`已载入 ${record.name}`, 'success')
}

function removeSaved(value: string): void {
  model.savedRequests = model.savedRequests.filter((item) => item.id !== value)
}

async function copyResponse(): Promise<void> {
  await copyText(responseBody.value)
  toast.show('响应内容已复制', 'success')
}

function clear(): void {
  model.url = ''
  model.params = []
  model.headers = []
  body.value = ''
  authorization.value = ''
  response.value = null
  responseBody.value = ''
  error.value = ''
}
</script>

<template>
  <section class="tool-page api-client-tool">
    <header class="tool-header">
      <div>
        <h1>API 调试台</h1>
        <p :class="{ error }">{{ error || '仅在发送时访问目标地址；认证值与敏感 Header 不会保存到工作区。' }}</p>
      </div>
      <div class="toolbar">
        <label class="api-saved-select">本地请求<select v-model="selectedSavedRequest" aria-label="载入本地请求" @change="loadSaved(selectedSavedRequest)"><option value="">选择已保存请求</option><option v-for="item in model.savedRequests" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <IconButton :icon="Save" label="保存当前请求" @click="saveCurrent" />
        <IconButton v-if="busy" :icon="Square" label="取消请求" danger @click="cancel" />
        <IconButton v-else :icon="Send" label="发送请求" @click="send" />
        <ToolChainButton :value="responseBody" source-name="API 响应" />
        <IconButton :icon="Trash2" label="清空当前请求" :disabled="!model.url && !body && !responseBody" @click="clear" />
      </div>
    </header>

    <div class="api-request-line">
      <select v-model="model.method" aria-label="请求方法"><option v-for="method in methods" :key="method" :value="method">{{ method }}</option></select>
      <input v-model="model.url" aria-label="请求地址" autocomplete="url" spellcheck="false" placeholder="https://api.example.com/v1/resource" @keydown.enter.prevent="send" />
      <button class="command-button primary" type="button" :disabled="busy" @click="send"><Send :size="16" />{{ busy ? '请求中' : '发送' }}</button>
    </div>

    <div class="api-request-config">
      <section>
        <header><strong>查询参数</strong><button type="button" @click="addEntry(model.params)"><Plus :size="14" />添加参数</button></header>
        <div v-if="model.params.length" class="api-key-values">
          <div v-for="(entry, index) in model.params" :key="index">
            <input v-model="entry.enabled" :aria-label="`启用查询参数 ${index + 1}`" type="checkbox" />
            <input v-model="entry.key" :aria-label="`查询参数 ${index + 1} 名称`" placeholder="名称" spellcheck="false" />
            <input v-model="entry.value" :aria-label="`查询参数 ${index + 1} 值`" placeholder="值" spellcheck="false" />
            <IconButton :icon="Trash2" :label="`删除查询参数 ${index + 1}`" size="small" @click="removeEntry(model.params, index)" />
          </div>
        </div>
        <p v-else>未添加参数；URL 中已有的查询项会保持不变。</p>
      </section>

      <section>
        <header><strong>请求 Header</strong><button type="button" @click="addEntry(model.headers)"><Plus :size="14" />添加 Header</button></header>
        <div v-if="model.headers.length" class="api-key-values">
          <div v-for="(entry, index) in model.headers" :key="index">
            <input v-model="entry.enabled" :aria-label="`启用 Header ${index + 1}`" type="checkbox" />
            <input v-model="entry.key" :aria-label="`Header ${index + 1} 名称`" placeholder="名称" spellcheck="false" />
            <input v-model="entry.value" :aria-label="`Header ${index + 1} 值`" placeholder="值" spellcheck="false" />
            <IconButton :icon="Trash2" :label="`删除 Header ${index + 1}`" size="small" @click="removeEntry(model.headers, index)" />
          </div>
        </div>
        <p v-else>可添加 Accept、Content-Type 等请求 Header。</p>
      </section>

      <section class="api-authorization">
        <header><strong>会话认证</strong><small>关闭或切换工具后清除</small></header>
        <div><select v-model="authorizationScheme" aria-label="认证方式"><option value="bearer">Bearer Token</option><option value="basic">Basic</option><option value="raw">原始 Authorization</option></select><input v-model="authorization" aria-label="认证值" type="password" autocomplete="off" spellcheck="false" placeholder="仅保存在当前会话内" /></div>
        <p v-if="model.headers.some((item) => isSensitiveHeader(item.key))">敏感 Header 的值不会随工具固定或保存。</p>
      </section>
    </div>

    <ResizableSplit v-model="model.split" label="调整请求与响应区域大小">
      <template #left>
        <div class="editor-panel api-body-panel">
          <div class="panel-label"><span>请求 Body</span><small v-if="!canSendBody">{{ model.method }} 请求不发送 Body</small></div>
          <CodeEditor v-model="body" label="请求 Body" :readonly="!canSendBody" />
        </div>
      </template>
      <template #right>
        <div class="editor-panel api-response-panel" :class="{ invalid: !!error }">
          <div class="panel-label"><span>响应内容</span><small>{{ responseSummary }}</small></div>
          <CodeEditor v-model="responseBody" label="API 响应内容" />
          <footer>
            <span>{{ response?.contentType || '响应 Header 将在请求完成后显示' }}</span>
            <IconButton :icon="Copy" label="复制响应内容" size="small" :disabled="!responseBody" @click="copyResponse" />
          </footer>
          <details v-if="responseHeaders" class="api-response-headers"><summary>响应 Header</summary><pre>{{ responseHeaders }}</pre></details>
        </div>
      </template>
    </ResizableSplit>

    <div class="api-save-strip">
      <input v-model="savedName" aria-label="保存请求名称" maxlength="80" placeholder="请求名称（可选）" @keydown.enter.prevent="saveCurrent" />
      <button class="command-button secondary" type="button" @click="saveCurrent"><Save :size="15" />保存本地请求</button>
      <div v-for="item in model.savedRequests" :key="item.id" class="api-saved-chip"><button type="button" @click="loadSaved(item.id)">{{ item.name }}</button><button type="button" :aria-label="`删除 ${item.name}`" @click="removeSaved(item.id)"><X :size="14" /></button></div>
    </div>
  </section>
</template>
