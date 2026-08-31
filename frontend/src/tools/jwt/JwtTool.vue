<script setup lang="ts">
import { Copy, ShieldAlert, Trash2 } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { analyzeJwt, type JwtAnalysis } from '@/utils/jwt'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const input = ref('')
const split = ref(typeof props.state.split === 'number' ? props.state.split : 47)
const header = ref('')
const payload = ref('')
const analysis = ref<JwtAnalysis | null>(null)
const error = ref('')

watch(split, () => emit('update:state', { split: split.value }), { immediate: true })
watch(input, (value) => {
  if (!value.trim()) {
    analysis.value = null
    header.value = ''
    payload.value = ''
    error.value = ''
    return
  }
  try {
    const next = analyzeJwt(value)
    analysis.value = next
    header.value = next.headerText
    payload.value = next.payloadText
    error.value = ''
  } catch (cause) {
    analysis.value = null
    header.value = ''
    payload.value = ''
    error.value = cause instanceof Error ? cause.message : 'JWT 无法解析'
  }
})

const tokenAlgorithm = computed(() => typeof analysis.value?.header.alg === 'string' ? analysis.value.header.alg : '未声明')
const tokenType = computed(() => typeof analysis.value?.header.typ === 'string' ? analysis.value.header.typ : '未声明')

function timestampStatus(key: 'iat' | 'nbf' | 'exp', status: 'past' | 'current' | 'future'): string {
  if (key === 'exp') return status === 'future' ? '有效期内' : '已过期'
  if (key === 'nbf') return status === 'future' ? '尚未生效' : '已生效'
  return status === 'future' ? '未来时间' : '已签发'
}

async function copy(value: string, label: string): Promise<void> {
  await copyText(value)
  toast.show(`${label}已复制`, 'success')
}

function clear(): void {
  input.value = ''
}
</script>

<template>
  <section class="tool-page jwt-tool">
    <header class="tool-header">
      <div>
        <h1>JWT 分析器</h1>
        <p :class="{ error }">{{ error || 'Token 只在当前会话内解析；本工具不会校验签名或上传内容。' }}</p>
      </div>
      <div class="toolbar">
        <IconButton :icon="Copy" label="复制 JWT" :disabled="!input" @click="copy(input, 'JWT')" />
        <IconButton :icon="Trash2" label="清空 JWT" :disabled="!input" @click="clear" />
      </div>
    </header>

    <div class="jwt-summary" :class="{ invalid: !!error, ready: !!analysis }">
      <ShieldAlert :size="18" aria-hidden="true" />
      <div><strong>{{ analysis ? `算法 ${tokenAlgorithm} · 类型 ${tokenType}` : '等待 JWT 输入' }}</strong><small>{{ analysis ? (analysis.signaturePresent ? '已检测到签名段，未执行签名验证' : '签名段为空，不能作为有效凭据使用') : '粘贴三段式 JWT，例如 header.payload.signature' }}</small></div>
      <span v-if="analysis" :class="analysis.signaturePresent ? 'present' : 'missing'">{{ analysis.signaturePresent ? '签名段存在' : '缺少签名' }}</span>
    </div>

    <div v-if="analysis?.timestamps.length" class="jwt-timestamps" aria-label="JWT 时间声明">
      <div v-for="claim in analysis.timestamps" :key="claim.key" :class="claim.status"><span>{{ claim.label }}</span><strong>{{ claim.value }}</strong><small>{{ timestampStatus(claim.key, claim.status) }}</small></div>
    </div>

    <ResizableSplit v-model="split" label="调整 JWT 输入与解码结果区域大小">
      <template #left>
        <div class="editor-panel jwt-input-panel" :class="{ invalid: !!error }">
          <div class="panel-label"><span>JWT Token</span><small>仅内存</small></div>
          <CodeEditor v-model="input" label="JWT Token 输入" />
        </div>
      </template>
      <template #right>
        <div class="jwt-decoded-panels">
          <div class="editor-panel"><div class="panel-label"><span>Header</span><IconButton :icon="Copy" label="复制 JWT Header" size="small" :disabled="!header" @click="copy(header, 'JWT Header')" /></div><CodeEditor v-model="header" label="JWT Header" /></div>
          <div class="editor-panel"><div class="panel-label"><span>Payload</span><IconButton :icon="Copy" label="复制 JWT Payload" size="small" :disabled="!payload" @click="copy(payload, 'JWT Payload')" /></div><CodeEditor v-model="payload" label="JWT Payload" /></div>
        </div>
      </template>
    </ResizableSplit>
  </section>
</template>
