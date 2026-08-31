<script setup lang="ts">
import { ClipboardCopy, Download, FileImage, RefreshCw, Trash2 } from '@lucide/vue'
import mermaid from 'mermaid'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { downloadBlob } from '@/utils/download'

type DiagramTheme = 'auto' | 'light' | 'dark'

const flowchartExample = `flowchart LR
  A[提交申请] --> B{信息完整?}
  B -- 是 --> C[进入审批]
  B -- 否 --> D[补充材料]
  D --> A
  C --> E[完成]`
const sequenceExample = `sequenceDiagram
  participant User as 用户
  participant App as KAITools
  participant API as 服务接口
  User->>App: 发送请求
  App->>API: HTTP Request
  API-->>App: Response
  App-->>User: 展示结果`

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(
  props.state,
  { source: flowchartExample, split: 46, theme: 'auto' as DiagramTheme },
  (state) => emit('update:state', state),
)
const svgMarkup = ref('')
const error = ref('')
const rendering = ref(false)
const exporting = ref(false)
let renderTimer = 0
let renderGeneration = 0
let themeObserver: MutationObserver | null = null

const currentTheme = computed<'default' | 'dark'>(() => {
  if (model.theme === 'dark') return 'dark'
  if (model.theme === 'light') return 'default'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
})

function scheduleRender(): void {
  window.clearTimeout(renderTimer)
  renderTimer = window.setTimeout(() => { void renderDiagram() }, 180)
}

async function renderDiagram(): Promise<void> {
  const source = model.source.trim()
  const generation = ++renderGeneration
  if (!source) {
    svgMarkup.value = ''
    error.value = '请输入 Mermaid 图表代码'
    return
  }
  rendering.value = true
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: currentTheme.value,
      fontFamily: '"Segoe UI Variable", "Segoe UI", sans-serif',
      flowchart: { htmlLabels: false, useMaxWidth: true },
    })
    const result = await mermaid.render(`kaitools-mermaid-${generation}`, source)
    if (generation !== renderGeneration) return
    svgMarkup.value = result.svg
    error.value = ''
  } catch (cause) {
    if (generation !== renderGeneration) return
    svgMarkup.value = ''
    error.value = cause instanceof Error ? cause.message.replace(/^Error:\s*/, '') : 'Mermaid 图表无法渲染'
  } finally {
    if (generation === renderGeneration) rendering.value = false
  }
}

function useExample(value: string): void {
  model.source = value
}

async function copySvg(): Promise<void> {
  await copyText(svgMarkup.value)
  toast.show('SVG 源码已复制', 'success')
}

function exportSvg(): void {
  downloadBlob(new Blob([svgMarkup.value], { type: 'image/svg+xml;charset=utf-8' }), 'diagram.svg')
  toast.show('SVG 已开始下载', 'success')
}

function svgSize(source: string): { width: number; height: number } {
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
  const viewBox = svg.getAttribute('viewBox')?.trim().split(/\s+/).map(Number)
  const viewBoxWidth = viewBox?.[2]
  const viewBoxHeight = viewBox?.[3]
  const width = Number.parseFloat(svg.getAttribute('width') ?? '') || (typeof viewBoxWidth === 'number' && Number.isFinite(viewBoxWidth) ? viewBoxWidth : 1200)
  const height = Number.parseFloat(svg.getAttribute('height') ?? '') || (typeof viewBoxHeight === 'number' && Number.isFinite(viewBoxHeight) ? viewBoxHeight : 800)
  return { width: Math.max(1, Math.min(2048, Math.ceil(width))), height: Math.max(1, Math.min(2048, Math.ceil(height))) }
}

async function exportPng(): Promise<void> {
  if (!svgMarkup.value || exporting.value) return
  exporting.value = true
  try {
    const blob = new Blob([svgMarkup.value], { type: 'image/svg+xml;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('SVG 图片无法加载'))
        image.src = objectUrl
      })
      const size = svgSize(svgMarkup.value)
      const scale = Math.min(2, 4096 / Math.max(size.width, size.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(size.width * scale)
      canvas.height = Math.round(size.height * scale)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前环境不支持 PNG 导出')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG 编码失败')), 'image/png'))
      downloadBlob(png, 'diagram.png')
      toast.show('PNG 已开始下载', 'success')
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch (cause) {
    toast.show(cause instanceof Error ? cause.message : 'PNG 导出失败', 'error')
  } finally {
    exporting.value = false
  }
}

function clear(): void {
  model.source = ''
}

watch(() => [model.source, model.theme, currentTheme.value], scheduleRender)

onMounted(() => {
  themeObserver = new MutationObserver(scheduleRender)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  scheduleRender()
})
onBeforeUnmount(() => {
  window.clearTimeout(renderTimer)
  themeObserver?.disconnect()
})
</script>

<template>
  <section class="tool-page mermaid-tool">
    <header class="tool-header">
      <div>
        <h1>Mermaid 流程图</h1>
        <p :class="{ error }">{{ error || '本地渲染流程图、时序图等 Mermaid 图表；图表代码和导出内容不会上传。' }}</p>
      </div>
      <div class="toolbar">
        <select v-model="model.theme" class="compact-select" aria-label="流程图主题"><option value="auto">跟随应用</option><option value="light">浅色图表</option><option value="dark">深色图表</option></select>
        <IconButton :icon="RefreshCw" label="重新渲染流程图" :disabled="rendering" @click="renderDiagram" />
        <IconButton :icon="ClipboardCopy" label="复制 SVG 源码" :disabled="!svgMarkup" @click="copySvg" />
        <IconButton :icon="Download" label="下载 SVG" :disabled="!svgMarkup" @click="exportSvg" />
        <IconButton :icon="FileImage" label="下载 PNG" :disabled="!svgMarkup || exporting" @click="exportPng" />
        <IconButton :icon="Trash2" label="清空流程图代码" :disabled="!model.source" @click="clear" />
      </div>
    </header>

    <div class="mermaid-example-strip">
      <span>快速开始</span>
      <button type="button" @click="useExample(flowchartExample)">流程图示例</button>
      <button type="button" @click="useExample(sequenceExample)">时序图示例</button>
      <small>{{ rendering ? '正在渲染…' : svgMarkup ? '渲染完成，可下载 SVG 或 PNG' : '等待可渲染的图表代码' }}</small>
    </div>

    <ResizableSplit v-model="model.split" label="调整流程图代码与预览区域大小">
      <template #left>
        <div class="editor-panel mermaid-source-panel" :class="{ invalid: !!error }">
          <div class="panel-label"><span>Mermaid 代码</span><small>支持 flowchart、sequenceDiagram、classDiagram 等语法</small></div>
          <CodeEditor v-model="model.source" label="Mermaid 图表代码" />
        </div>
      </template>
      <template #right>
        <div class="editor-panel mermaid-preview-panel" :class="{ invalid: !!error }">
          <div class="panel-label"><span>图表预览</span><small>{{ svgMarkup ? '可滚动查看' : '等待输入' }}</small></div>
          <div v-if="svgMarkup" class="mermaid-canvas" v-html="svgMarkup" />
          <div v-else class="mermaid-empty"><FileImage :size="28" aria-hidden="true" /><span>{{ error || '输入 Mermaid 代码后自动生成预览' }}</span></div>
        </div>
      </template>
    </ResizableSplit>
  </section>
</template>
