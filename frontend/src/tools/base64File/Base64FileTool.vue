<script setup lang="ts">
import { Copy, Download, FileUp, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { base64ToBytes, bytesToBase64, bytesToBlob } from '@/utils/base64'
import { copyText } from '@/utils/clipboard'

type FileParseResult = { bytes: Uint8Array | null; error: string }

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const picker = ref<HTMLInputElement | null>(null)
// Before the directional UI, the single `base64` field represented a ready-to-download payload.
const hasLegacyPayload = !('mode' in props.state) && !('sourceBase64' in props.state)
  && typeof props.state.base64 === 'string' && props.state.base64.trim().length > 0
const model = useToolState(
  props.state,
  {
    sourceBase64: '',
    base64: '',
    mode: hasLegacyPayload ? 'decode' as const : 'encode' as const,
    fileName: 'decoded.bin',
    mimeType: 'application/octet-stream',
    split: 50,
  },
  (state) => emit('update:state', state),
)

const source = computed<FileParseResult>(() => {
  if (!model.sourceBase64) return { bytes: null, error: '' }
  try {
    return { bytes: base64ToBytes(model.sourceBase64), error: '' }
  } catch (cause) {
    return { bytes: null, error: cause instanceof Error ? cause.message : '文件编码失败' }
  }
})
const decoded = computed<FileParseResult>(() => {
  if (!model.base64) return { bytes: null, error: '' }
  try {
    return { bytes: base64ToBytes(model.base64), error: '' }
  } catch (cause) {
    return { bytes: null, error: cause instanceof Error ? cause.message : '文件解码失败' }
  }
})
const activeValue = computed(() => model.mode === 'encode' ? model.sourceBase64 : model.base64)
const activeResult = computed(() => model.mode === 'encode' ? source.value : decoded.value)
const status = computed(() => {
  if (activeResult.value.error) return activeResult.value.error
  if (activeResult.value.bytes) return `${activeResult.value.bytes.length.toLocaleString()} 字节${model.mode === 'decode' ? '，可下载还原' : '，可复制 Base64'}`
  return model.mode === 'encode' ? '选择任意文件，生成 Base64' : '粘贴 Base64，下载还原文件'
})

async function selectFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  model.fileName = file.name
  model.mimeType = file.type || 'application/octet-stream'
  model.sourceBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
}

function download(): void {
  if (!decoded.value.bytes) return
  const url = URL.createObjectURL(bytesToBlob(decoded.value.bytes, model.mimeType))
  const link = document.createElement('a')
  link.href = url
  link.download = model.fileName || 'decoded.bin'
  link.click()
  URL.revokeObjectURL(url)
}

async function copy(): Promise<void> {
  await copyText(activeValue.value)
  toast.show('Base64 内容已复制', 'success')
}

function clear(): void {
  if (model.mode === 'encode') model.sourceBase64 = ''
  else model.base64 = ''
}
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div>
        <h1>Base64 文件</h1>
        <p :class="{ error: activeResult.error }">{{ status }}</p>
      </div>
      <div class="toolbar">
        <SegmentedControl :model-value="model.mode" label="转换方向" :options="[{ value: 'encode', label: '文件转 Base64' }, { value: 'decode', label: 'Base64 转文件' }]" @update:model-value="model.mode = $event as 'encode' | 'decode'" />
        <input ref="picker" class="visually-hidden" type="file" @change="selectFile" />
        <IconButton v-if="model.mode === 'encode'" :icon="FileUp" label="选择文件" @click="picker?.click()" />
        <IconButton :icon="Copy" label="复制 Base64" :disabled="!activeValue || !!activeResult.error" @click="copy" />
        <IconButton v-if="model.mode === 'decode'" :icon="Download" label="下载还原文件" :disabled="!decoded.bytes" @click="download" />
        <IconButton :icon="Trash2" label="清空当前内容" :disabled="!activeValue" @click="clear" />
      </div>
    </header>
    <div class="file-meta-band">
      <label>文件名<input v-model="model.fileName" aria-label="还原文件名" /></label>
      <label>MIME 类型<input v-model="model.mimeType" aria-label="文件 MIME 类型" /></label>
    </div>
    <ResizableSplit v-model="model.split">
      <template #left>
        <div v-if="model.mode === 'encode'" class="file-transfer-panel">
          <div class="panel-label">待编码文件</div>
          <div v-if="source.bytes" class="file-transfer-body"><FileUp :size="30" /><strong>{{ model.fileName || '未命名文件' }}</strong><span>{{ model.mimeType }} · {{ source.bytes.length.toLocaleString() }} 字节</span></div>
          <div v-else class="empty-state"><FileUp :size="28" /><span>选择任意文件后生成 Base64</span></div>
        </div>
        <div v-else class="editor-panel" :class="{ invalid: decoded.error }">
          <div class="panel-label">Base64 内容</div>
          <CodeEditor v-model="model.base64" label="文件 Base64 输入" />
        </div>
      </template>
      <template #right>
        <div v-if="model.mode === 'encode'" class="editor-panel">
          <div class="panel-label">Base64 编码结果</div>
          <CodeEditor :model-value="model.sourceBase64" readonly label="文件 Base64 编码结果" @update:model-value="() => undefined" />
        </div>
        <div v-else class="file-transfer-panel" :class="{ invalid: decoded.error }">
          <div class="panel-label">还原文件</div>
          <div v-if="decoded.bytes" class="file-transfer-body"><Download :size="30" /><strong>{{ model.fileName || 'decoded.bin' }}</strong><span>{{ model.mimeType }} · {{ decoded.bytes.length.toLocaleString() }} 字节</span></div>
          <div v-else class="empty-state"><Download :size="28" /><span>粘贴 Base64 后下载还原文件</span></div>
        </div>
      </template>
    </ResizableSplit>
  </section>
</template>
