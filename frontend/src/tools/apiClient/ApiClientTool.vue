<script setup lang="ts">
import { Activity, Braces, CircleDot, Copy, FolderArchive, Plus, Send, ShieldCheck, Square, Trash2 } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import ToolChainButton from '@/components/ToolChainButton.vue'
import { useToastStore } from '@/stores/toast'
import { buildRequestUrl, keyValuesToHeaders, normalizeApiKeyValues, readApiResponse, type ApiKeyValue, type ApiResponseSnapshot } from '@/utils/apiDebugger'
import { copyText } from '@/utils/clipboard'

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

interface ApiClientState {
  method: ApiMethod
  url: string
  params: ApiKeyValue[]
  headers: ApiKeyValue[]
  split: number
}

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{
  'update:state': [state: Record<string, unknown>]
  archive: [payload: { title: string; state: Record<string, unknown> }]
}>()
const toast = useToastStore()
const methods: ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
const validMethods = new Set<ApiMethod>(methods)

function apiMethod(value: unknown): ApiMethod {
  return typeof value === 'string' && validMethods.has(value as ApiMethod) ? value as ApiMethod : 'GET'
}

const model = reactive<ApiClientState>({
  method: apiMethod(props.state.method),
  url: typeof props.state.url === 'string' ? props.state.url : '',
  params: normalizeApiKeyValues(props.state.params, true),
  headers: normalizeApiKeyValues(props.state.headers, true),
  split: typeof props.state.split === 'number' ? props.state.split : 48,
})
const body = ref(typeof props.state.body === 'string' ? props.state.body : '')
const authorization = ref(typeof props.state.authorization === 'string' ? props.state.authorization : '')
const authorizationScheme = ref<'bearer' | 'basic' | 'raw'>(props.state.authorizationScheme === 'basic' || props.state.authorizationScheme === 'raw' ? props.state.authorizationScheme : 'bearer')
const fileManagerFileId = typeof props.state.__fileManagerFileId === 'string' ? props.state.__fileManagerFileId : ''
const savedName = ref('')
const busy = ref(false)
const error = ref('')
const response = ref<ApiResponseSnapshot | null>(null)
const responseBody = ref('')
let controller: AbortController | null = null

function currentRequestState(): Record<string, unknown> {
  return {
    ...model,
    params: normalizeApiKeyValues(model.params),
    headers: normalizeApiKeyValues(model.headers, true),
    body: body.value,
    authorization: authorization.value,
    authorizationScheme: authorizationScheme.value,
    ...(fileManagerFileId ? { __fileManagerFileId: fileManagerFileId } : {}),
  }
}

watch([model, body, authorization, authorizationScheme], () => emit('update:state', currentRequestState()), { deep: true, immediate: true })

const canSendBody = computed(() => !['GET', 'HEAD'].includes(model.method))
const responseSummary = computed(() => response.value
  ? `${response.value.status} ${response.value.statusText || ''} · ${response.value.elapsedMs} ms · ${response.value.size.toLocaleString()} B`
  : '发送请求后将在此显示响应')
const responseState = computed(() => {
  if (busy.value) return 'pending'
  if (error.value) return 'error'
  if (!response.value) return 'idle'
  return response.value.status >= 400 ? 'error' : 'success'
})
const responseStateLabel = computed(() => {
  if (busy.value) return '发送中'
  if (error.value) return '请求失败'
  if (!response.value) return '等待响应'
  return `${response.value.status} ${response.value.statusText || '完成'}`
})
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

function saveToFileManager(): void {
  const name = savedName.value.trim() || `${model.method} ${model.url || '未命名请求'}`
  if (!model.url.trim()) {
    toast.show('请先填写请求地址', 'error')
    return
  }
  emit('archive', { title: name, state: currentRequestState() })
  savedName.value = ''
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
      <div class="api-title">
        <span class="api-title-mark" aria-hidden="true"><Braces :size="19" /></span>
        <div>
          <div class="api-eyebrow"><span>HTTP WORKBENCH</span><i></i><span>LOCAL</span></div>
          <h1>API 调试台</h1>
          <p :class="{ error }">{{ error || '仅在发送时访问目标地址；手动保存后可在文件管理器中恢复这份请求。' }}</p>
        </div>
      </div>
      <div class="toolbar api-header-actions">
        <IconButton v-if="busy" :icon="Square" label="取消请求" danger @click="cancel" />
        <ToolChainButton :value="responseBody" source-name="API 响应" />
        <IconButton :icon="Trash2" label="清空当前请求" :disabled="!model.url && !body && !responseBody" @click="clear" />
      </div>
    </header>

    <div class="api-request-deck" :class="{ invalid: !!error }">
      <div class="api-request-line">
        <label class="api-method-field"><span>METHOD</span><select v-model="model.method" aria-label="请求方法"><option v-for="method in methods" :key="method" :value="method">{{ method }}</option></select></label>
        <label class="api-address-field"><span>请求地址</span><input v-model="model.url" aria-label="请求地址" autocomplete="url" spellcheck="false" placeholder="https://api.example.com/v1/resource" @keydown.enter.prevent="send" /></label>
        <button class="command-button primary api-send-button" type="button" :disabled="busy" @click="send"><Send :size="16" />{{ busy ? '请求中' : '发送' }}</button>
      </div>
      <div class="api-request-meta">
        <span>请求会直接从当前设备发起，不会经过 KAITools 服务。</span>
        <span class="api-request-state" :class="responseState"><i></i>{{ responseStateLabel }}</span>
      </div>
    </div>

    <div class="api-save-strip">
      <span class="api-archive-mark" title="将当前请求配置保存到文件管理器"><FolderArchive :size="15" /></span>
      <div class="api-save-form">
        <input v-model="savedName" aria-label="保存请求名称" maxlength="80" placeholder="为当前请求命名（可选）" @keydown.enter.prevent="saveToFileManager" />
        <button class="command-button secondary api-archive-button" type="button" aria-label="归档到文件管理器" @click="saveToFileManager"><FolderArchive :size="15" />归档</button>
      </div>
    </div>

    <div class="api-workbench">
      <aside class="api-request-config" aria-label="请求配置">
      <section class="api-config-section">
        <header><div class="api-config-title"><CircleDot :size="14" /><div><strong>查询参数</strong><small>随 URL 一起发送</small></div></div><button type="button" @click="addEntry(model.params)"><Plus :size="14" />添加参数</button></header>
        <div v-if="model.params.length" class="api-key-values">
          <div v-for="(entry, index) in model.params" :key="index">
            <input v-model="entry.enabled" :aria-label="`启用查询参数 ${index + 1}`" type="checkbox" />
            <input v-model="entry.key" :aria-label="`查询参数 ${index + 1} 名称`" placeholder="名称" spellcheck="false" />
            <input v-model="entry.value" :aria-label="`查询参数 ${index + 1} 值`" placeholder="值" spellcheck="false" />
            <IconButton :icon="Trash2" :label="`删除查询参数 ${index + 1}`" size="small" @click="removeEntry(model.params, index)" />
          </div>
        </div>
        <p v-else>未添加参数；地址中已有的查询项会保持不变。</p>
      </section>

      <section class="api-config-section">
        <header><div class="api-config-title"><Braces :size="14" /><div><strong>请求 Header</strong><small>请求元数据</small></div></div><button type="button" @click="addEntry(model.headers)"><Plus :size="14" />添加 Header</button></header>
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

      <section class="api-config-section api-authorization">
        <header><div class="api-config-title"><ShieldCheck :size="14" /><div><strong>请求认证</strong><small>手动归档后可原样恢复</small></div></div></header>
        <div><select v-model="authorizationScheme" aria-label="认证方式"><option value="bearer">Bearer Token</option><option value="basic">Basic</option><option value="raw">原始 Authorization</option></select><input v-model="authorization" aria-label="认证值" type="password" autocomplete="off" spellcheck="false" placeholder="认证值" /></div>
      </section>
      </aside>

    <ResizableSplit v-model="model.split" label="调整请求与响应区域大小" class="api-editor-split">
      <template #left>
        <div class="editor-panel api-body-panel">
          <div class="panel-label"><span class="api-panel-title"><Braces :size="14" />请求 Body</span><small v-if="!canSendBody">{{ model.method }} 请求发送时会忽略 Body</small><small v-else>JSON / Text</small></div>
          <CodeEditor v-model="body" label="请求 Body" />
        </div>
      </template>
      <template #right>
        <div class="editor-panel api-response-panel" :class="{ invalid: !!error }">
          <div class="panel-label"><span class="api-panel-title"><Activity :size="14" />响应内容</span><span class="api-response-status" :class="responseState"><CircleDot :size="11" />{{ responseStateLabel }}</span><small>{{ responseSummary }}</small></div>
          <CodeEditor v-model="responseBody" label="API 响应内容" />
          <footer>
            <span>{{ response?.contentType || '响应 Header 将在请求完成后显示' }}</span>
            <IconButton :icon="Copy" label="复制响应内容" size="small" :disabled="!responseBody" @click="copyResponse" />
          </footer>
          <details v-if="responseHeaders" class="api-response-headers"><summary>响应 Header</summary><pre>{{ responseHeaders }}</pre></details>
        </div>
      </template>
    </ResizableSplit>
    </div>
  </section>
</template>
