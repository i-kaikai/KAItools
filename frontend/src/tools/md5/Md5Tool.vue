<script setup lang="ts">
import { Copy, RefreshCw, Trash2 } from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import ToolChainButton from '@/components/ToolChainButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { hashAlgorithms, hashText, type HashAlgorithm, utf8ByteLength } from '@/utils/md5'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: '', output: '', algorithm: 'md5' as HashAlgorithm, uppercase: false, split: 50 }, (state) => emit('update:state', state))
const error = ref('')
const hashing = ref(false)
const byteLength = computed(() => utf8ByteLength(model.input))
// Ignore a completed Web Crypto request once the user has changed its input or algorithm.
let requestId = 0

const algorithmOptions = hashAlgorithms.map((value) => ({ value, label: value === 'md5' ? 'MD5' : value.replace('sha', 'SHA-') }))

async function updateDigest(): Promise<void> {
  const currentRequest = ++requestId
  hashing.value = true
  error.value = ''
  try {
    const value = await hashText(model.input, model.algorithm, model.uppercase)
    if (currentRequest === requestId) model.output = value
  } catch (cause) {
    if (currentRequest === requestId) {
      model.output = ''
      error.value = cause instanceof Error ? cause.message : '摘要计算失败'
    }
  } finally {
    if (currentRequest === requestId) hashing.value = false
  }
}

watch(() => [model.input, model.algorithm, model.uppercase] as const, () => void updateDigest(), { immediate: true })
onBeforeUnmount(() => { requestId += 1 })

async function copyDigest(): Promise<void> {
  await copyText(model.output)
  toast.show(`${algorithmOptions.find((option) => option.value === model.algorithm)?.label ?? '哈希'} 摘要已复制`, 'success')
}
</script>

<template>
  <section class="tool-page narrow-tool">
    <header class="tool-header">
      <div>
        <h1>哈希摘要</h1>
        <p :class="{ error }">{{ error || (hashing ? '正在计算摘要…' : `${model.input.length.toLocaleString()} 字符 · ${byteLength.toLocaleString()} UTF-8 字节`) }}</p>
      </div>
      <div class="toolbar">
        <select v-model="model.algorithm" class="compact-select" aria-label="哈希算法">
          <option v-for="option in algorithmOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <label class="toggle-label">
          <input v-model="model.uppercase" type="checkbox" />
          <span>大写</span>
        </label>
        <ToolChainButton :value="model.output" :source-name="model.algorithm.toUpperCase()" />
      </div>
    </header>
    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel"><div class="panel-label">UTF-8 文本</div><CodeEditor v-model="model.input" label="哈希文本输入" /></div></template>
      <template #right><div class="editor-panel hash-result-panel" :class="{ invalid: error }"><div class="panel-label"><span>摘要结果</span><IconButton :icon="RefreshCw" label="恢复计算结果" size="small" :disabled="hashing" @click="updateDigest" /></div><CodeEditor v-model="model.output" label="哈希摘要结果" /></div></template>
    </ResizableSplit>
    <div class="hash-result-actions"><IconButton :icon="Copy" label="复制摘要" :disabled="!model.output || hashing || !!error" @click="copyDigest" /><IconButton :icon="Trash2" label="清空输入" :disabled="!model.input" @click="model.input = ''" /></div>
  </section>
</template>
