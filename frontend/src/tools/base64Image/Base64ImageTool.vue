<script setup lang="ts">
import { Copy, Download, ImageUp, Trash2 } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { bytesToBase64, bytesToBlob, bytesToDataUrl, parseImageBase64 } from '@/utils/base64'
import { copyText } from '@/utils/clipboard'

type ImageParseResult = { data: { mimeType: string; bytes: Uint8Array } | null; error: string }

const imageMimeTypesByExtension: Record<string, string> = {
  avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', ico: 'image/x-icon', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp',
}

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const picker = ref<HTMLInputElement | null>(null)
// Legacy tabs stored one Data URL. Treat it as decode input so preview, copy, and download stay available.
const legacyDataUrl = !('mode' in props.state) && !('sourceDataUrl' in props.state) && typeof props.state.dataUrl === 'string'
  ? props.state.dataUrl
  : ''
const model = useToolState(
  legacyDataUrl ? { ...props.state, base64: legacyDataUrl, mode: 'decode' } : props.state,
  {
    sourceDataUrl: '',
    base64: '',
    mode: 'encode' as 'encode' | 'decode',
    outputFormat: 'base64' as 'base64' | 'data-url',
    fileName: 'image.png',
    mimeType: 'image/png',
    split: 50,
  },
  (state) => emit('update:state', state),
)

function parseImage(value: string, fallbackMimeType: string): ImageParseResult {
  if (!value.trim()) return { data: null, error: '' }
  try {
    return { data: parseImageBase64(value, fallbackMimeType), error: '' }
  } catch (cause) {
    return { data: null, error: cause instanceof Error ? cause.message : '图片解码失败' }
  }
}

const source = computed(() => parseImage(model.sourceDataUrl, model.mimeType))
const decoded = computed(() => parseImage(model.base64, model.mimeType))
const encodedOutput = computed(() => {
  if (!source.value.data) return ''
  const { bytes, mimeType } = source.value.data
  return model.outputFormat === 'data-url' ? bytesToDataUrl(bytes, mimeType) : bytesToBase64(bytes)
})
const decodedDataUrl = computed(() => decoded.value.data ? bytesToDataUrl(decoded.value.data.bytes, decoded.value.data.mimeType) : '')
const activeError = computed(() => model.mode === 'encode' ? source.value.error : decoded.value.error)
const status = computed(() => {
  if (activeError.value) return activeError.value
  const data = model.mode === 'encode' ? source.value.data : decoded.value.data
  if (!data) return model.mode === 'encode' ? '选择或直接粘贴图片，生成 Base64' : '粘贴 Base64 或 Data URL，预览并下载图片'
  return `${data.mimeType} · ${data.bytes.length.toLocaleString()} 字节`
})
const activeValue = computed(() => model.mode === 'encode' ? encodedOutput.value : model.base64)

function imageMimeType(file: File): string | undefined {
  if (file.type.startsWith('image/')) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  return extension ? imageMimeTypesByExtension[extension] : undefined
}

async function importImage(file: File): Promise<void> {
  const mimeType = imageMimeType(file)
  if (!mimeType) {
    toast.show('请选择图片文件', 'error')
    return
  }
  model.fileName = file.name || `pasted-image.${mimeType.split('/')[1] || 'png'}`
  model.mimeType = mimeType
  model.sourceDataUrl = bytesToDataUrl(new Uint8Array(await file.arrayBuffer()), mimeType)
}

async function selectFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await importImage(file)
}

function onPaste(event: ClipboardEvent): void {
  if (model.mode !== 'encode') return
  const clipboard = event.clipboardData
  const item = Array.from(clipboard?.items ?? []).find((candidate) => candidate.type.startsWith('image/'))
  const file = item?.getAsFile() ?? Array.from(clipboard?.files ?? []).find((candidate) => Boolean(imageMimeType(candidate)))
  if (!file) return
  event.preventDefault()
  void importImage(file)
}

function download(): void {
  if (!decoded.value.data) return
  const url = URL.createObjectURL(bytesToBlob(decoded.value.data.bytes, decoded.value.data.mimeType))
  const link = document.createElement('a')
  link.href = url
  link.download = model.fileName || 'image'
  link.click()
  URL.revokeObjectURL(url)
}

async function copy(): Promise<void> {
  await copyText(activeValue.value)
  toast.show(model.mode === 'encode' ? '图片 Base64 已复制' : 'Base64 内容已复制', 'success')
}

function clear(): void {
  if (model.mode === 'encode') model.sourceDataUrl = ''
  else model.base64 = ''
}

onMounted(() => window.addEventListener('paste', onPaste))
onBeforeUnmount(() => window.removeEventListener('paste', onPaste))
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div>
        <h1>Base64 图片</h1>
        <p :class="{ error: activeError }">{{ status }}</p>
      </div>
      <div class="toolbar">
        <SegmentedControl :model-value="model.mode" label="转换方向" :options="[{ value: 'encode', label: '图片转 Base64' }, { value: 'decode', label: 'Base64 转图片' }]" @update:model-value="model.mode = $event as 'encode' | 'decode'" />
        <SegmentedControl v-if="model.mode === 'encode'" :model-value="model.outputFormat" label="图片 Base64 输出格式" :options="[{ value: 'base64', label: 'Base64' }, { value: 'data-url', label: 'Data URL' }]" @update:model-value="model.outputFormat = $event as 'base64' | 'data-url'" />
        <input ref="picker" class="visually-hidden" type="file" accept="image/*" @change="selectFile" />
        <IconButton v-if="model.mode === 'encode'" :icon="ImageUp" label="选择或粘贴图片" @click="picker?.click()" />
        <IconButton :icon="Copy" label="复制 Base64" :disabled="!activeValue || !!activeError" @click="copy" />
        <IconButton v-if="model.mode === 'decode'" :icon="Download" label="下载图片" :disabled="!decoded.data" @click="download" />
        <IconButton :icon="Trash2" label="清空当前内容" :disabled="!activeValue" @click="clear" />
      </div>
    </header>
    <div class="file-meta-band">
      <label>图片文件名<input v-model="model.fileName" aria-label="图片文件名" /></label>
      <label>图片 MIME 类型<input v-model="model.mimeType" aria-label="图片 MIME 类型" placeholder="image/png" /></label>
    </div>
    <ResizableSplit v-model="model.split">
      <template #left>
        <div v-if="model.mode === 'encode'" class="media-preview" :class="{ invalid: source.error }">
          <div class="panel-label">图片输入</div>
          <img v-if="source.data" :src="model.sourceDataUrl" alt="待编码图片预览" />
          <div v-else class="empty-state"><ImageUp :size="28" /><span>选择图片，或在此页面直接粘贴图片文件</span></div>
        </div>
        <div v-else class="editor-panel" :class="{ invalid: decoded.error }">
          <div class="panel-label">Base64 或 Data URL</div>
          <CodeEditor v-model="model.base64" label="图片 Base64 输入" />
        </div>
      </template>
      <template #right>
        <div v-if="model.mode === 'encode'" class="editor-panel">
          <div class="panel-label">{{ model.outputFormat === 'base64' ? 'Base64 编码结果' : 'Base64 Data URL' }}</div>
          <CodeEditor :model-value="encodedOutput" readonly label="图片 Base64 编码结果" @update:model-value="() => undefined" />
        </div>
        <div v-else class="media-preview" :class="{ invalid: decoded.error }">
          <div class="panel-label">图片预览</div>
          <img v-if="decoded.data" :src="decodedDataUrl" alt="Base64 解码预览" />
          <div v-else class="empty-state"><ImageUp :size="28" /><span>粘贴 Base64 或 Data URL 后在这里预览</span></div>
        </div>
      </template>
    </ResizableSplit>
  </section>
</template>
