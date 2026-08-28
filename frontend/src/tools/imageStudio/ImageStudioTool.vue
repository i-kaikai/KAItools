<script setup lang="ts">
import { Crop, Download, ImageUp, RefreshCw, Trash2 } from '@lucide/vue'
import { computed, onBeforeUnmount, ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import FileDropzone from '@/components/FileDropzone.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { imageMimeType } from '@/utils/mediaFiles'

type OutputFormat = 'source' | 'image/png' | 'image/jpeg' | 'image/webp'

interface ImageInfo {
  name: string
  mimeType: string
  width: number
  height: number
  size: number
}

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const sourcePreview = ref('')
const outputPreview = ref('')
const sourceInfo = ref<ImageInfo | null>(null)
const outputInfo = ref<ImageInfo | null>(null)
const processing = ref(false)
const error = ref('')
const model = useToolState(
  props.state,
  {
    sourceName: '',
    outputName: '',
    cropX: 0,
    cropY: 0,
    cropWidth: 0,
    cropHeight: 0,
    targetWidth: 0,
    targetHeight: 0,
    lockAspect: true,
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

// File and Image stay outside persisted tool state; sourceInfo makes their readiness reactive for the UI.
const canProcess = computed(() => Boolean(sourceInfo.value && sourceFile && sourceImage))
const sourceDimensions = computed(() => sourceInfo.value ? `${sourceInfo.value.width} × ${sourceInfo.value.height}` : '')
const outputDimensions = computed(() => outputInfo.value ? `${outputInfo.value.width} × ${outputInfo.value.height}` : '')
const usesLosslessOutput = computed(() => model.outputFormat === 'source' || model.outputFormat === 'image/png')
const status = computed(() => {
  if (error.value) return error.value
  if (processing.value) return '正在本地处理图片…'
  if (!sourceInfo.value) return '选择图片后可裁剪、缩放、压缩或转换格式'
  if (!outputInfo.value) return `${sourceDimensions.value} · 调整参数后应用处理`
  const formatLabel = model.outputFormat === 'source' ? '原文件字节无损复制' : model.outputFormat === 'image/png' ? 'PNG 像素无损输出' : `质量 ${model.quality}%`
  return `${outputDimensions.value} · ${formatLabel}`
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number(value) || min)))
}

function extensionFor(mimeType: string): string {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/png' ? 'png' : 'bin'
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

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片编码失败')), mimeType, quality))
}

async function importImage(file: File): Promise<void> {
  const mimeType = imageMimeType(file)
  if (!mimeType) {
    toast.show('请选择图片文件', 'error')
    return
  }

  URL.revokeObjectURL(sourceUrl)
  URL.revokeObjectURL(outputUrl)
  sourceUrl = ''
  outputUrl = ''
  outputPreview.value = ''
  outputInfo.value = null
  sourceFile = file
  error.value = ''
  try {
    sourceImage = await loadImage(file)
    const width = sourceImage.naturalWidth
    const height = sourceImage.naturalHeight
    if (!width || !height || width * height > 67_108_864) throw new Error('图片过大，请选择 6700 万像素以内的文件')
    sourcePreview.value = sourceUrl
    sourceInfo.value = { name: file.name, mimeType, width, height, size: file.size }
    model.sourceName = file.name
    model.cropX = 0
    model.cropY = 0
    model.cropWidth = width
    model.cropHeight = height
    model.targetWidth = width
    model.targetHeight = height
    await processImage()
  } catch (cause) {
    sourceImage = null
    sourceInfo.value = null
    sourcePreview.value = ''
    error.value = cause instanceof Error ? cause.message : '图片加载失败'
  }
}

async function processImage(): Promise<void> {
  if (!sourceFile || !sourceImage || !sourceInfo.value) return
  processing.value = true
  error.value = ''
  try {
    if (model.outputFormat === 'source') {
      URL.revokeObjectURL(outputUrl)
      outputUrl = URL.createObjectURL(sourceFile)
      outputPreview.value = outputUrl
      outputInfo.value = { ...sourceInfo.value }
      model.outputName = sourceFile.name
      return
    }

    const cropX = clamp(model.cropX, 0, sourceInfo.value.width - 1)
    const cropY = clamp(model.cropY, 0, sourceInfo.value.height - 1)
    const cropWidth = clamp(model.cropWidth, 1, sourceInfo.value.width - cropX)
    const cropHeight = clamp(model.cropHeight, 1, sourceInfo.value.height - cropY)
    const targetWidth = clamp(model.targetWidth, 1, 8192)
    const targetHeight = model.lockAspect
      ? clamp(targetWidth * cropHeight / cropWidth, 1, 8192)
      : clamp(model.targetHeight, 1, 8192)
    if (targetWidth * targetHeight > 67_108_864) throw new Error('输出尺寸过大，请控制在 6700 万像素以内')

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法创建图片画布')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(sourceImage, cropX, cropY, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight)
    const blob = await canvasToBlob(canvas, model.outputFormat, model.outputFormat === 'image/png' ? undefined : clamp(model.quality, 1, 100) / 100)
    URL.revokeObjectURL(outputUrl)
    outputUrl = URL.createObjectURL(blob)
    outputPreview.value = outputUrl
    outputInfo.value = { name: outputName(sourceFile.name, model.outputFormat), mimeType: model.outputFormat, width: targetWidth, height: targetHeight, size: blob.size }
    model.outputName = outputInfo.value.name
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '图片处理失败'
  } finally {
    processing.value = false
  }
}

function resetCrop(): void {
  if (!sourceInfo.value) return
  model.cropX = 0
  model.cropY = 0
  model.cropWidth = sourceInfo.value.width
  model.cropHeight = sourceInfo.value.height
  model.targetWidth = sourceInfo.value.width
  model.targetHeight = sourceInfo.value.height
}

function download(): void {
  if (!outputPreview.value || !outputInfo.value) return
  const link = document.createElement('a')
  link.href = outputPreview.value
  link.download = model.outputName || outputInfo.value.name
  link.click()
}

function clear(): void {
  URL.revokeObjectURL(sourceUrl)
  URL.revokeObjectURL(outputUrl)
  sourceUrl = ''
  outputUrl = ''
  sourceFile = null
  sourceImage = null
  sourcePreview.value = ''
  outputPreview.value = ''
  sourceInfo.value = null
  outputInfo.value = null
  error.value = ''
  model.sourceName = ''
  model.outputName = ''
}

onBeforeUnmount(() => {
  URL.revokeObjectURL(sourceUrl)
  URL.revokeObjectURL(outputUrl)
})
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div><h1>图片工作台</h1><p :class="{ error }">{{ status }}</p></div>
      <div class="toolbar">
        <IconButton :icon="RefreshCw" label="应用图片处理" :disabled="!canProcess || processing" @click="processImage" />
        <IconButton :icon="Download" label="下载处理结果" :disabled="!outputPreview" @click="download" />
        <IconButton :icon="Trash2" label="清空图片" :disabled="!sourcePreview" @click="clear" />
      </div>
    </header>
    <div class="image-studio-controls" :class="{ disabled: !canProcess }">
      <label>输出格式<select v-model="model.outputFormat" aria-label="输出图片格式"><option value="source">保持原文件（字节无损）</option><option value="image/png">PNG（像素无损）</option><option value="image/jpeg">JPEG（有损压缩）</option><option value="image/webp">WebP（有损压缩）</option></select></label>
      <label>质量<input v-model.number="model.quality" aria-label="图片压缩质量" type="range" min="1" max="100" :disabled="usesLosslessOutput" /><output>{{ usesLosslessOutput ? '无损' : `${model.quality}%` }}</output></label>
      <label>裁剪 X<input v-model.number="model.cropX" aria-label="裁剪起点 X" type="number" min="0" :max="Math.max(0, (sourceInfo?.width ?? 1) - 1)" :disabled="model.outputFormat === 'source'" /></label>
      <label>裁剪 Y<input v-model.number="model.cropY" aria-label="裁剪起点 Y" type="number" min="0" :max="Math.max(0, (sourceInfo?.height ?? 1) - 1)" :disabled="model.outputFormat === 'source'" /></label>
      <label>裁剪宽<input v-model.number="model.cropWidth" aria-label="裁剪宽度" type="number" min="1" :disabled="model.outputFormat === 'source'" /></label>
      <label>裁剪高<input v-model.number="model.cropHeight" aria-label="裁剪高度" type="number" min="1" :disabled="model.outputFormat === 'source'" /></label>
      <label>输出宽<input v-model.number="model.targetWidth" aria-label="输出宽度" type="number" min="1" max="8192" :disabled="model.outputFormat === 'source'" /></label>
      <label>输出高<input v-model.number="model.targetHeight" aria-label="输出高度" type="number" min="1" max="8192" :disabled="model.lockAspect || model.outputFormat === 'source'" /></label>
      <label class="toggle-label"><input v-model="model.lockAspect" type="checkbox" :disabled="model.outputFormat === 'source'" /><span>锁定比例</span></label>
      <IconButton :icon="Crop" label="恢复完整图片" :disabled="!canProcess || model.outputFormat === 'source'" @click="resetCrop" />
    </div>
    <ResizableSplit v-model="model.split">
      <template #left>
        <div class="image-studio-preview"><div class="panel-label">原图{{ sourceDimensions ? ` · ${sourceDimensions}` : '' }}</div><template v-if="sourcePreview"><img :src="sourcePreview" alt="原始图片预览" /><button class="file-replace-action" type="button" @click="clear"><ImageUp :size="15" />清除并重新选择图片</button></template><FileDropzone v-else accept="image/*" label="图片工作台文件输入" prompt="拖入或粘贴图片文件" detail="点击选择，或聚焦后按 Ctrl+V" @file="importImage" /><footer v-if="sourceInfo">{{ sourceInfo.name }} · {{ sourceInfo.size.toLocaleString() }} 字节</footer></div>
      </template>
      <template #right>
        <div class="image-studio-preview"><div class="panel-label">处理结果{{ outputDimensions ? ` · ${outputDimensions}` : '' }}</div><img v-if="outputPreview" :src="outputPreview" alt="图片处理结果预览" /><div v-else class="empty-state"><Crop :size="30" /><span>调整参数后应用处理</span></div><footer v-if="outputInfo">{{ outputInfo.name }} · {{ outputInfo.size.toLocaleString() }} 字节</footer></div>
      </template>
    </ResizableSplit>
  </section>
</template>
