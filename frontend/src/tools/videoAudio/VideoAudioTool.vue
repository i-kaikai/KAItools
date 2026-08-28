<script setup lang="ts">
import { AudioLines, Download, FileAudio, FileUp, Pause, Play, Trash2 } from '@lucide/vue'
import { computed, onBeforeUnmount, ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { supportedAudioOutputFormats, type AudioOutputFormat } from '@/utils/videoAudio'

interface CapturableVideo extends HTMLVideoElement {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const picker = ref<HTMLInputElement | null>(null)
const sourceUrl = ref('')
const outputUrl = ref('')
const sourceName = ref('')
const sourceSize = ref(0)
const sourceDuration = ref(0)
const outputSize = ref(0)
const converting = ref(false)
const error = ref('')
const model = useToolState(props.state, { mimeType: '', outputName: '' }, (state) => emit('update:state', state))
const formats = ref<AudioOutputFormat[]>(typeof MediaRecorder === 'undefined' ? [] : supportedAudioOutputFormats(MediaRecorder.isTypeSupported))
if (!model.mimeType && formats.value[0]) model.mimeType = formats.value[0].mimeType
let activeVideo: CapturableVideo | null = null
let activeRecorder: MediaRecorder | null = null

const selectedFormat = computed(() => formats.value.find((format) => format.mimeType === model.mimeType) ?? formats.value[0])
const status = computed(() => {
  if (error.value) return error.value
  if (converting.value) return '正在按视频原时长提取音轨，请保持此标签页打开'
  if (outputUrl.value) return `${selectedFormat.value?.label ?? '音频'} · ${outputSize.value.toLocaleString()} 字节`
  if (sourceUrl.value) return `${sourceDuration.value ? `${Math.ceil(sourceDuration.value)} 秒` : '正在读取时长'} · 准备提取音轨`
  return formats.value.length ? '选择视频后在当前设备提取音频' : '当前浏览器不支持本地音频录制'
})

function revokeUrl(value: string): void {
  if (value) URL.revokeObjectURL(value)
}

function outputFileName(fileName: string, extension: string): string {
  return `${fileName.replace(/\.[^.]+$/, '') || 'video'}-audio.${extension}`
}

function waitFor(video: HTMLVideoElement, eventName: 'loadedmetadata' | 'ended'): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSuccess = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('视频无法解码或读取'))
    }
    const cleanup = () => {
      video.removeEventListener(eventName, onSuccess)
      video.removeEventListener('error', onError)
    }
    video.addEventListener(eventName, onSuccess, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

async function selectFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('video/')) {
    toast.show('请选择视频文件', 'error')
    return
  }
  stop()
  revokeUrl(sourceUrl.value)
  revokeUrl(outputUrl.value)
  sourceUrl.value = URL.createObjectURL(file)
  outputUrl.value = ''
  sourceName.value = file.name
  sourceSize.value = file.size
  sourceDuration.value = 0
  outputSize.value = 0
  model.outputName = outputFileName(file.name, selectedFormat.value?.extension ?? 'webm')
  error.value = ''
  const probe = document.createElement('video')
  probe.preload = 'metadata'
  const metadataLoaded = waitFor(probe, 'loadedmetadata')
  probe.src = sourceUrl.value
  try {
    await metadataLoaded
    sourceDuration.value = Number.isFinite(probe.duration) ? probe.duration : 0
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '视频读取失败'
  } finally {
    probe.removeAttribute('src')
    probe.load()
  }
}

async function convert(): Promise<void> {
  if (!sourceUrl.value || !selectedFormat.value || converting.value) return
  error.value = ''
  revokeUrl(outputUrl.value)
  outputUrl.value = ''
  outputSize.value = 0
  converting.value = true
  const video = document.createElement('video') as CapturableVideo
  activeVideo = video
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true

  try {
    const metadataLoaded = waitFor(video, 'loadedmetadata')
    video.src = sourceUrl.value
    await metadataLoaded
    const stream = video.captureStream?.() ?? video.mozCaptureStream?.()
    if (!stream) throw new Error('当前浏览器不支持从视频提取音轨，请使用新版 Chromium 或 Windows 桌面版')
    await video.play()
    const audioTracks = stream.getAudioTracks()
    if (!audioTracks.length) throw new Error('视频中没有可提取的音轨')

    const chunks: BlobPart[] = []
    const recorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType: selectedFormat.value.mimeType })
    activeRecorder = recorder
    await new Promise<void>((resolve, reject) => {
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data) })
      recorder.addEventListener('error', () => reject(new Error('音频编码失败')))
      recorder.addEventListener('stop', () => resolve(), { once: true })
      video.addEventListener('ended', () => { if (recorder.state !== 'inactive') recorder.stop() }, { once: true })
      recorder.start(1000)
    })
    const blob = new Blob(chunks, { type: selectedFormat.value.mimeType })
    if (!blob.size) throw new Error('未生成音频数据')
    outputUrl.value = URL.createObjectURL(blob)
    outputSize.value = blob.size
    model.outputName = outputFileName(sourceName.value, selectedFormat.value.extension)
    toast.show('视频音频提取完成', 'success')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '视频转音频失败'
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    activeVideo = null
    activeRecorder = null
    converting.value = false
  }
}

function stop(): void {
  activeVideo?.pause()
  if (activeRecorder && activeRecorder.state !== 'inactive') activeRecorder.stop()
}

function download(): void {
  if (!outputUrl.value) return
  const link = document.createElement('a')
  link.href = outputUrl.value
  link.download = model.outputName || outputFileName(sourceName.value, selectedFormat.value?.extension ?? 'webm')
  link.click()
}

function clear(): void {
  stop()
  revokeUrl(sourceUrl.value)
  revokeUrl(outputUrl.value)
  sourceUrl.value = ''
  outputUrl.value = ''
  sourceName.value = ''
  sourceSize.value = 0
  sourceDuration.value = 0
  outputSize.value = 0
  model.outputName = ''
  error.value = ''
}

onBeforeUnmount(clear)
</script>

<template>
  <section class="tool-page narrow-tool">
    <header class="tool-header">
      <div><h1>视频转音频</h1><p :class="{ error }">{{ status }}</p></div>
      <div class="toolbar">
        <select v-model="model.mimeType" class="compact-select" aria-label="音频输出格式" :disabled="converting || !formats.length"><option v-for="format in formats" :key="format.mimeType" :value="format.mimeType">{{ format.label }}</option></select>
        <input ref="picker" class="visually-hidden" type="file" accept="video/*" aria-label="视频文件选择" @change="selectFile" />
        <IconButton :icon="FileUp" label="选择视频" :disabled="converting" @click="picker?.click()" />
        <IconButton v-if="converting" :icon="Pause" label="停止提取" @click="stop" />
        <IconButton v-else :icon="Play" label="提取音频" :disabled="!sourceUrl || !formats.length" @click="convert" />
        <IconButton :icon="Download" label="下载音频" :disabled="!outputUrl" @click="download" />
        <IconButton :icon="Trash2" label="清空视频和音频" :disabled="!sourceUrl && !outputUrl" @click="clear" />
      </div>
    </header>
    <div class="video-audio-workspace">
      <section class="video-audio-source"><header><FileUp :size="17" /><span>源视频</span></header><div v-if="sourceUrl" class="video-audio-content"><strong>{{ sourceName }}</strong><small>{{ sourceSize.toLocaleString() }} 字节 · {{ sourceDuration ? `${Math.ceil(sourceDuration)} 秒` : '读取时长中' }}</small><video :src="sourceUrl" controls muted /></div><div v-else class="empty-state"><FileUp :size="30" /><span>选择视频文件后开始提取</span></div></section>
      <section class="video-audio-source"><header><AudioLines :size="17" /><span>音频结果</span></header><div v-if="outputUrl" class="video-audio-content"><strong>{{ model.outputName }}</strong><small>{{ outputSize.toLocaleString() }} 字节 · {{ selectedFormat?.label }}</small><audio :src="outputUrl" controls /></div><div v-else class="empty-state"><FileAudio :size="30" /><span>提取后可在这里播放和下载音频</span></div></section>
    </div>
  </section>
</template>
