<script setup lang="ts">
import { Clipboard, Copy, Download, ImageUp, QrCode, Trash2 } from '@lucide/vue'
import jsQR from 'jsqr'
import QRCodeGenerator from 'qrcode'
import { computed, ref, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import FileDropzone from '@/components/FileDropzone.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import ToolChainButton from '@/components/ToolChainButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyPngDataUrl, copyText } from '@/utils/clipboard'
import { imageMimeType } from '@/utils/mediaFiles'

type QrMode = 'generate' | 'decode'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const generating = ref(false)
const generationError = ref('')
const decodeError = ref('')
const decodePreview = ref('')
const model = useToolState(
  props.state,
  {
    mode: 'generate' as QrMode,
    text: 'https://tools.imkai.top',
    output: '',
    errorCorrection: 'M',
    size: 320,
    margin: 2,
    foreground: '#111827',
    background: '#ffffff',
    split: 50,
  },
  (state) => emit('update:state', state),
)

const activeError = computed(() => model.mode === 'generate' ? generationError.value : decodeError.value)
const status = computed(() => {
  if (activeError.value) return activeError.value
  if (model.mode === 'generate') return generating.value ? '正在生成二维码…' : '内容仅在当前设备处理，可复制或下载 PNG'
  return model.output ? '二维码内容已识别，可继续编辑或发送到其他工具' : '选择包含二维码的图片进行本地识别'
})

async function generate(): Promise<void> {
  const value = model.text.trim()
  if (!value) {
    model.output = ''
    generationError.value = ''
    return
  }
  generating.value = true
  generationError.value = ''
  try {
    model.output = await QRCodeGenerator.toDataURL(value, {
      errorCorrectionLevel: model.errorCorrection as 'L' | 'M' | 'Q' | 'H',
      width: Math.min(2048, Math.max(96, Number(model.size) || 320)),
      margin: Math.min(16, Math.max(0, Number(model.margin) || 0)),
      color: { dark: model.foreground || '#111827', light: model.background || '#ffffff' },
    })
  } catch (cause) {
    model.output = ''
    generationError.value = cause instanceof Error ? cause.message : '二维码生成失败'
  } finally {
    generating.value = false
  }
}

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片无法读取'))
    }
    image.src = url
  })
}

async function decodeImage(file: File): Promise<void> {
  if (!imageMimeType(file)) {
    toast.show('请选择包含二维码的图片', 'error')
    return
  }
  decodeError.value = ''
  model.output = ''
  try {
    const image = await readImage(file)
    if (image.naturalWidth * image.naturalHeight > 16_777_216) throw new Error('图片过大，请选择 1600 万像素以内的图片')
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('当前浏览器无法读取图片像素')
    context.drawImage(image, 0, 0)
    const result = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
    if (!result) throw new Error('未识别到二维码，请确认图片清晰且二维码完整')
    model.output = result.data
    decodePreview.value = canvas.toDataURL('image/png')
  } catch (cause) {
    decodePreview.value = ''
    decodeError.value = cause instanceof Error ? cause.message : '二维码识别失败'
  }
}

function download(): void {
  if (!model.output) return
  const link = document.createElement('a')
  link.href = model.output
  link.download = 'kaitools-qr.png'
  link.click()
}

async function copyContent(): Promise<void> {
  await copyText(model.mode === 'generate' ? model.text : model.output)
  toast.show(model.mode === 'generate' ? '二维码内容已复制' : '识别结果已复制', 'success')
}

async function copyImage(): Promise<void> {
  try {
    const target = await copyPngDataUrl(model.output)
    toast.show(target === 'desktop' ? '二维码图片已复制到 Windows 剪贴板' : '二维码图片已复制', 'success')
  } catch (cause) {
    toast.show(cause instanceof Error ? cause.message : '无法复制二维码图片，请下载 PNG', 'error')
  }
}

function clear(): void {
  if (model.mode === 'generate') model.text = ''
  else {
    model.output = ''
    decodePreview.value = ''
    decodeError.value = ''
  }
}

watch(
  () => [model.text, model.errorCorrection, model.size, model.margin, model.foreground, model.background] as const,
  () => { if (model.mode === 'generate') void generate() },
  { immediate: true },
)
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div><h1>二维码工具</h1><p :class="{ error: activeError }">{{ status }}</p></div>
      <div class="toolbar">
        <SegmentedControl :model-value="model.mode" label="二维码模式" :options="[{ value: 'generate', label: '生成二维码' }, { value: 'decode', label: '图片解码' }]" @update:model-value="model.mode = $event as QrMode" />
        <ToolChainButton v-if="model.mode === 'decode'" :value="model.output" source-name="二维码" />
        <IconButton v-if="model.mode === 'generate'" :icon="Clipboard" label="复制二维码图片" :disabled="!model.output" @click="copyImage" />
        <IconButton :icon="Copy" :label="model.mode === 'generate' ? '复制二维码内容' : '复制识别结果'" :disabled="!(model.mode === 'generate' ? model.text : model.output)" @click="copyContent" />
        <IconButton v-if="model.mode === 'generate'" :icon="Download" label="下载二维码 PNG" :disabled="!model.output" @click="download" />
        <IconButton :icon="Trash2" label="清空当前内容" :disabled="!(model.mode === 'generate' ? model.text : model.output)" @click="clear" />
      </div>
    </header>
    <div v-if="model.mode === 'generate'" class="qr-options">
      <label>纠错级别<select v-model="model.errorCorrection" aria-label="二维码纠错级别"><option value="L">L · 约 7%</option><option value="M">M · 约 15%</option><option value="Q">Q · 约 25%</option><option value="H">H · 约 30%</option></select></label>
      <label>尺寸<input v-model.number="model.size" aria-label="二维码尺寸" type="number" min="96" max="2048" step="8" /></label>
      <label>边距<input v-model.number="model.margin" aria-label="二维码边距" type="number" min="0" max="16" /></label>
      <label>前景色<input v-model="model.foreground" aria-label="二维码前景色" type="color" /></label>
      <label>背景色<input v-model="model.background" aria-label="二维码背景色" type="color" /></label>
    </div>
    <ResizableSplit v-model="model.split">
      <template #left>
        <div v-if="model.mode === 'generate'" class="editor-panel"><div class="panel-label">二维码内容</div><CodeEditor v-model="model.text" label="二维码内容" /></div>
        <div v-else class="qr-image-panel"><div class="panel-label">待识别图片</div><template v-if="decodePreview"><img :src="decodePreview" alt="二维码识别图片" /><button class="file-replace-action" type="button" @click="clear"><ImageUp :size="15" />清除并重新选择图片</button></template><FileDropzone v-else accept="image/*" label="二维码图片输入" prompt="拖入或粘贴二维码图片" detail="点击选择，或聚焦后按 Ctrl+V" @file="decodeImage" /></div>
      </template>
      <template #right>
        <div v-if="model.mode === 'generate'" class="qr-image-panel"><div class="panel-label">二维码预览</div><img v-if="model.output" :src="model.output" alt="二维码预览" /><div v-else class="empty-state"><QrCode :size="30" /><span>输入内容后生成二维码</span></div></div>
        <div v-else class="editor-panel" :class="{ invalid: decodeError }"><div class="panel-label">识别结果</div><CodeEditor v-model="model.output" label="二维码识别结果" /></div>
      </template>
    </ResizableSplit>
  </section>
</template>
