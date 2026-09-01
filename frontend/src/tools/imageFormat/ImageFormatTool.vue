<script setup lang="ts">
import { Download, ImageUp, RefreshCw, Trash2 } from '@lucide/vue'
import { computed, onBeforeUnmount, ref } from 'vue'

import FileDropzone from '@/components/FileDropzone.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { imageMimeType } from '@/utils/mediaFiles'

type OutputFormat = 'image/png' | 'image/jpeg' | 'image/webp'

interface ImageInfo {
  name: string
  mimeType: string
  width: number
  height: number
  size: number
}

const MAX_PIXELS = 67_108_864
const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const sourcePreview = ref('')
const outputPreview = ref('')
const sourceInfo = ref<ImageInfo | null>(null)
const outputInfo = ref<ImageInfo | null>(null)
const processing = ref(false)
const error = ref('')
const appliedFormat = ref<OutputFormat | null>(null)
const appliedQuality = ref<number | null>(null)
const model = useToolState(
  props.state,
  {
    sourceName: '',
    outputName: '',
    outputFormat: 'image/png' as OutputFormat,
    quality: 90,
    split: 50,
  },
  (state) => emit('update:state', state),
)

let sourceFile: File | null = null
let sourceImage: HTMLImageElement | null = null
let sourceUrl = ''
let outputUrl = ''

const usesLossyOutput = computed(() => model.outputFormat !== 'image/png')
const sourceDimensions = computed(() => sourceInfo.value ? `${sourceInfo.value.width} x ${sourceInfo.value.height}` : '')
const outputDimensions = computed(() => outputInfo.value ? `${outputInfo.value.width} x ${outputInfo.value.height}` : '')
const optionsChanged = computed(() => Boolean(
  outputInfo.value
  && (appliedFormat.value !== model.outputFormat || (usesLossyOutput.value && appliedQuality.value !== model.quality)),
))
const canDownload = computed(() => Boolean(outputPreview.value && outputInfo.value && !optionsChanged.value))
const status = computed(() => {
  if (error.value) return error.value
  if (!sourceInfo.value) return '拖入、粘贴或选择图片后，在本机完成格式转换'
  if (processing.value) return '正在本机转换图片…'
  if (optionsChanged.value) return '输出选项已修改，点击转换图片格式后下载'
  if (outputInfo.value) return `${sourceDimensions.value} · 已转换为 ${formatLabel(outputInfo.value.mimeType)}`
  return `${sourceDimensions.value} · 选择输出格式后开始转换`
})

function formatLabel(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'JPEG'
  if (mimeType === 'image/webp') return 'WebP'
  if (mimeType === 'image/png') return 'PNG'
  return mimeType
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

function outputName(sourceName: string, mimeType: string): string {
  const base = sourceName.replace(/\.[^.]+$/, '') || 'image'
  return `${base}-converted.${extensionFor(mimeType)}`
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    sourceUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('浏览器无法读取该图片格式'))
    image.src = sourceUrl
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: OutputFormat, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob || blob.type !== mimeType) {
      reject(new Error(`${formatLabel(mimeType)} 格式在当前浏览器不可用`))
      return
    }
    resolve(blob)
  }, mimeType, quality))
}

function clearUrls(): void {
  URL.revokeObjectURL(sourceUrl)
  URL.revokeObjectURL(outputUrl)
  sourceUrl = ''
  outputUrl = ''
}

async function importImage(file: File): Promise<void> {
  const mimeType = imageMimeType(file)
  if (!mimeType) {
    toast.show('请选择图片文件', 'error')
    return
  }

  clear()
  sourceFile = file
  error.value = ''
  try {
    sourceImage = await loadImage(file)
    const { naturalWidth: width, naturalHeight: height } = sourceImage
    if (!width || !height || width * height > MAX_PIXELS) throw new Error('图片过大，请选择 6700 万像素以内的文件')
    sourcePreview.value = sourceUrl
    sourceInfo.value = { name: file.name, mimeType, width, height, size: file.size }
    model.sourceName = file.name
    await convertImage()
  } catch (cause) {
    clear()
    error.value = cause instanceof Error ? cause.message : '图片加载失败'
  }
}

async function convertImage(): Promise<void> {
  if (!sourceImage || !sourceFile || !sourceInfo.value || processing.value) return
  processing.value = true
  error.value = ''
  try {
    const canvas = document.createElement('canvas')
    canvas.width = sourceInfo.value.width
    canvas.height = sourceInfo.value.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法创建图片画布')
    if (model.outputFormat === 'image/jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height)
    const quality = usesLossyOutput.value ? Math.min(100, Math.max(1, Math.round(model.quality))) / 100 : undefined
    const blob = await canvasToBlob(canvas, model.outputFormat, quality)
    URL.revokeObjectURL(outputUrl)
    outputUrl = URL.createObjectURL(blob)
    outputPreview.value = outputUrl
    outputInfo.value = {
      name: outputName(sourceFile.name, model.outputFormat),
      mimeType: model.outputFormat,
      width: canvas.width,
      height: canvas.height,
      size: blob.size,
    }
    model.outputName = outputInfo.value.name
    appliedFormat.value = model.outputFormat
    appliedQuality.value = model.quality
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '图片转换失败'
  } finally {
    processing.value = false
  }
}

function download(): void {
  if (!canDownload.value || !outputInfo.value) return
  const link = document.createElement('a')
  link.href = outputPreview.value
  link.download = model.outputName || outputInfo.value.name
  link.click()
}

function clear(): void {
  clearUrls()
  sourceFile = null
  sourceImage = null
  sourcePreview.value = ''
  outputPreview.value = ''
  sourceInfo.value = null
  outputInfo.value = null
  appliedFormat.value = null
  appliedQuality.value = null
  error.value = ''
  model.sourceName = ''
  model.outputName = ''
}

onBeforeUnmount(clearUrls)
</script>

<template>
  <section class="tool-page image-format-tool">
    <header class="tool-header">
      <div><h1>图片格式转换</h1><p :class="{ error }">{{ status }}</p></div>
      <div class="toolbar">
        <IconButton :icon="RefreshCw" label="转换图片格式" :disabled="!sourcePreview || processing" @click="convertImage" />
        <IconButton :icon="Download" label="下载转换结果" :disabled="!canDownload" @click="download" />
        <IconButton :icon="Trash2" label="清空图片" :disabled="!sourcePreview" @click="clear" />
      </div>
    </header>

    <div class="image-format-controls" :class="{ disabled: !sourcePreview }">
      <label>输出格式<select v-model="model.outputFormat" aria-label="输出图片格式"><option value="image/png">PNG（无损）</option><option value="image/jpeg">JPEG（白色背景）</option><option value="image/webp">WebP（高压缩）</option></select></label>
      <label class="quality-control">质量<input v-model.number="model.quality" aria-label="图片转换质量" type="range" min="1" max="100" :disabled="!usesLossyOutput" /><output>{{ usesLossyOutput ? `${model.quality}%` : '无损' }}</output></label>
    </div>

    <ResizableSplit v-model="model.split" label="调整图片预览区域大小">
      <template #left>
        <div class="image-format-preview" :class="{ invalid: error }">
          <div class="panel-label">原始图片{{ sourceDimensions ? ` · ${sourceDimensions}` : '' }}</div>
          <template v-if="sourcePreview">
            <img :src="sourcePreview" alt="原始图片预览" />
            <button class="file-replace-action" type="button" @click="clear"><ImageUp :size="15" />清除并重新选择图片</button>
          </template>
          <FileDropzone v-else accept="image/*,.avif,.bmp,.gif,.ico,.tif,.tiff,.svg" label="图片格式转换文件输入" prompt="拖入或粘贴图片文件" detail="点击选择，或聚焦后按 Ctrl+V" @file="importImage" />
          <footer v-if="sourceInfo">{{ sourceInfo.name }} · {{ sourceInfo.mimeType }} · {{ sourceInfo.size.toLocaleString() }} 字节</footer>
        </div>
      </template>
      <template #right>
        <div class="image-format-preview" :class="{ invalid: error }">
          <div class="panel-label">转换结果{{ outputDimensions ? ` · ${outputDimensions}` : '' }}</div>
          <img v-if="outputPreview" :src="outputPreview" alt="转换后的图片预览" />
          <div v-else class="empty-state"><ImageUp :size="30" /><span>选择图片后自动生成转换结果</span></div>
          <footer v-if="outputInfo">{{ outputInfo.name }} · {{ formatLabel(outputInfo.mimeType) }} · {{ outputInfo.size.toLocaleString() }} 字节</footer>
        </div>
      </template>
    </ResizableSplit>
  </section>
</template>
