<script setup lang="ts">
import { Copy, Hash, Trash2 } from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ToolChainButton from '@/components/ToolChainButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { hashAlgorithms, hashText, type HashAlgorithm, utf8ByteLength } from '@/utils/md5'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: '', algorithm: 'md5' as HashAlgorithm, uppercase: false }, (state) => emit('update:state', state))
const digest = ref('')
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
    if (currentRequest === requestId) digest.value = value
  } catch (cause) {
    if (currentRequest === requestId) {
      digest.value = ''
      error.value = cause instanceof Error ? cause.message : '摘要计算失败'
    }
  } finally {
    if (currentRequest === requestId) hashing.value = false
  }
}

watch(() => [model.input, model.algorithm, model.uppercase] as const, () => void updateDigest(), { immediate: true })
onBeforeUnmount(() => { requestId += 1 })

async function copyDigest(): Promise<void> {
  await copyText(digest.value)
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
        <ToolChainButton :value="digest" :source-name="model.algorithm.toUpperCase()" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.input" @click="model.input = ''" />
      </div>
    </header>
    <div class="single-editor-panel">
      <div class="panel-label">UTF-8 文本</div>
      <CodeEditor v-model="model.input" label="哈希文本输入" />
    </div>
    <div class="digest-output" :class="{ invalid: error }">
      <Hash :size="19" aria-hidden="true" />
      <code>{{ hashing ? '正在计算…' : digest }}</code>
      <IconButton :icon="Copy" label="复制摘要" :disabled="!digest || hashing || !!error" @click="copyDigest" />
    </div>
  </section>
</template>
