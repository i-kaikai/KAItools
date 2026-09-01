<script setup lang="ts">
import { Download, FileArchive, FileText, LoaderCircle, Printer, Trash2, Upload } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import { desktopApi } from '@/api/desktopApi'
import CodeEditor from '@/components/CodeEditor.vue'
import FileDropzone from '@/components/FileDropzone.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import { useToolState } from '@/composables/useToolState'
import { t } from '@/i18n'
import { isWebRuntime } from '@/runtime'
import { useToastStore } from '@/stores/toast'
import type { DocumentConversionCapabilities, DocumentConversionEngine } from '@/types'
import {
  docxPagesToPdf,
  downloadBlob,
  extractPdfText,
  extractedTextToDocx,
  fileToBase64,
  pdfPagesToImageDocx,
  printHtmlDocument,
  renderDocx,
  renderPdfLayoutPreview,
  replaceExtension,
  type ExtractedPdfText,
  type PdfLayoutPreviewController,
  type PdfExportOptions,
} from '@/utils/documentConversion'
import { createStandaloneHtmlPackage, loadHtmlPackage, type HtmlPackage } from '@/utils/documentPackage'

type DocumentKind = 'html-pdf' | 'word-pdf' | 'pdf-word'

interface DocumentState extends Record<string, unknown> {
  characterCount: number
  format: 'a4' | 'letter'
  html: string
  kind: DocumentKind
  lineCount: number
  margin: number
  orientation: 'portrait' | 'landscape'
  pageCount: number
  pdfMode: 'editable' | 'layout'
  printViewport: 'desktop' | 'paper'
  printWidth: number
  sourceName: string
  split: number
}

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const defaultHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>KAITools 文档</title>
  <style>
    body { padding: 40px; font-family: "Microsoft YaHei", sans-serif; }
    h1 { color: #245f52; } .notice { padding: 16px; border-left: 4px solid #42b89f; background: #eef8f5; }
  </style>
</head>
<body>
  <h1>HTML 转 PDF</h1>
  <p class="notice">这里的 head 样式会保留到预览和导出的 PDF 中。</p>
</body>
</html>`
const kind = ['html-pdf', 'word-pdf', 'pdf-word'].includes(String(props.state.kind))
  ? props.state.kind as DocumentKind
  : 'html-pdf'
const model = useToolState<DocumentState>(props.state, {
  characterCount: 0,
  format: 'a4',
  html: kind === 'html-pdf' && typeof props.state.html === 'string' && props.state.html.trim() ? String(props.state.html) : defaultHtml,
  kind,
  lineCount: 0,
  margin: 36,
  orientation: 'portrait',
  pageCount: 0,
  pdfMode: 'editable',
  printViewport: 'desktop',
  printWidth: 1440,
  sourceName: '',
  split: 48,
}, (value) => emit('update:state', value))

const sourceFile = shallowRef<File | null>(null)
const extracted = shallowRef<ExtractedPdfText | null>(null)
const previewFrame = ref<HTMLIFrameElement | null>(null)
const docxPreview = ref<HTMLElement | null>(null)
const pdfLayoutPreview = ref<HTMLElement | null>(null)
const previewHtml = ref('')
const packageWarnings = ref<string[]>([])
const processing = ref(false)
const errorMessage = ref('')
const capabilities = ref<DocumentConversionCapabilities | null>(null)
const wordLongPageDetected = ref(false)
let htmlPackage: HtmlPackage = createStandaloneHtmlPackage(model.html)
let docxPages: HTMLElement[] = []
let pdfPreviewController: PdfLayoutPreviewController | null = null

const title = computed(() => t(`document.${kind}.title`))
const isHtml = computed(() => kind === 'html-pdf')
const isWord = computed(() => kind === 'word-pdf')
const sourceLabel = computed(() => t(isHtml.value ? 'document.source.html' : isWord.value ? 'document.source.docx' : 'document.source.pdf'))
const accept = computed(() => isHtml.value
  ? '.html,.htm,.zip,text/html,application/zip'
  : isWord.value
    ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : '.pdf,application/pdf')
const dropPrompt = computed(() => t(isHtml.value ? 'document.drop.html' : isWord.value ? 'document.drop.docx' : 'document.drop.pdf'))
const dropDetail = computed(() => t(isHtml.value ? 'document.drop.htmlDetail' : isWord.value ? 'document.drop.docxDetail' : 'document.drop.pdfDetail'))
const outputName = computed(() => isHtml.value
  ? replaceExtension(model.sourceName || 'document.html', 'pdf')
  : isWord.value
    ? replaceExtension(model.sourceName || 'word-document.docx', 'pdf')
    : replaceExtension(model.sourceName || 'converted-document.pdf', 'docx'))
const extractedText = computed(() => extracted.value?.pages.map((page) => page.join('\n')).join('\n\f\n') ?? '')
const nativeEngine = computed<DocumentConversionEngine | null>(() => isWord.value
  ? capabilities.value?.docxToPdf.preferred ?? null
  : kind === 'pdf-word'
    ? capabilities.value?.pdfToDocx.preferred ?? null
    : null)
const engineKey = computed(() => {
  if (nativeEngine.value === 'microsoft-word') return 'document.engine.word'
  if (nativeEngine.value === 'libreoffice') return 'document.engine.libreoffice'
  if (kind === 'pdf-word' && model.pdfMode === 'layout') return 'document.engine.layout'
  return isWord.value || isHtml.value ? 'document.engine.browser' : 'document.engine.text'
})
const notice = computed(() => nativeEngine.value
  ? `${t('document.status.ready')} · ${t(engineKey.value)}`
  : t(isHtml.value
    ? 'document.status.printNotice'
    : isWord.value
      ? wordLongPageDetected.value ? 'document.status.wordLongPageNotice' : 'document.status.browserNotice'
      : model.pdfMode === 'layout' ? 'document.status.layoutNotice' : 'document.status.textNotice'))
const status = computed(() => errorMessage.value
  || (processing.value ? t('document.status.processing')
    : packageWarnings.value.length ? t('document.packageWarnings', { count: packageWarnings.value.length })
      : model.sourceName ? `${model.sourceName} · ${t(engineKey.value)}` : t('document.status.ready')))
const canExport = computed(() => !processing.value && (isHtml.value ? Boolean(model.html.trim()) : Boolean(sourceFile.value)))
const exportOptions = computed<PdfExportOptions>(() => ({
  desktopLayout: isHtml.value && model.printViewport === 'desktop',
  desktopWidth: Number(model.printWidth) || 1440,
  format: model.format,
  orientation: model.orientation,
  margin: Number(model.margin) || 0,
}))

function disposePdfPreview(): void {
  pdfPreviewController?.destroy()
  pdfPreviewController = null
}

async function showPdfLayoutPreview(file: File): Promise<void> {
  disposePdfPreview()
  await nextTick()
  if (!pdfLayoutPreview.value) throw new Error('PDF 版式预览区域尚未就绪')
  pdfPreviewController = await renderPdfLayoutPreview(file, pdfLayoutPreview.value)
  model.pageCount = pdfPreviewController.sourcePages
  model.lineCount = 0
  model.characterCount = 0
}

async function extractSelectedPdf(file: File): Promise<void> {
  extracted.value = await extractPdfText(file)
  model.pageCount = extracted.value.pages.length
  model.lineCount = extracted.value.lineCount
  model.characterCount = extracted.value.characterCount
}

function refreshHtmlPreview(): void {
  if (!isHtml.value) return
  const prepared = htmlPackage.render(model.html)
  previewHtml.value = prepared.html
  packageWarnings.value = prepared.warnings
}

watch(() => model.html, refreshHtmlPreview, { immediate: true })

async function validSignature(file: File, signature: number[]): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, signature.length).arrayBuffer())
  return signature.every((value, index) => bytes[index] === value)
}

async function validateDocumentFile(file: File): Promise<void> {
  if (file.size > 50 * 1024 * 1024) throw new Error('文件不能超过 50 MiB')
  const suffix = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase()
  if (isWord.value) {
    if (suffix !== 'docx' || !await validSignature(file, [0x50, 0x4b])) throw new Error('请选择有效的 DOCX 文件')
  } else if (kind === 'pdf-word') {
    if (suffix !== 'pdf' || !await validSignature(file, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw new Error('请选择有效的 PDF 文件')
  }
}

async function importFile(file: File): Promise<void> {
  if (processing.value) return
  errorMessage.value = ''
  processing.value = true
  try {
    if (isHtml.value) {
      const nextPackage = await loadHtmlPackage(file)
      htmlPackage.dispose()
      htmlPackage = nextPackage
      model.sourceName = file.name
      model.html = nextPackage.source
      refreshHtmlPreview()
      return
    }
    await validateDocumentFile(file)
    disposePdfPreview()
    extracted.value = null
    sourceFile.value = file
    model.sourceName = file.name
    if (isWord.value) {
      await nextTick()
      if (!docxPreview.value) throw new Error('Word 预览区域尚未就绪')
      docxPages = await renderDocx(file, docxPreview.value)
      wordLongPageDetected.value = docxPages.some((page) => {
        const bounds = page.getBoundingClientRect()
        return bounds.width > 0 && bounds.height / bounds.width > 2
      })
      return
    }
    if (model.pdfMode === 'layout') {
      await showPdfLayoutPreview(file)
    } else {
      await extractSelectedPdf(file)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法读取文档'
    if (!isHtml.value) clear(false)
  } finally {
    processing.value = false
  }
}

function clear(resetError = true): void {
  if (resetError) errorMessage.value = ''
  packageWarnings.value = []
  disposePdfPreview()
  sourceFile.value = null
  extracted.value = null
  docxPages = []
  wordLongPageDetected.value = false
  model.sourceName = ''
  model.pageCount = 0
  model.lineCount = 0
  model.characterCount = 0
  if (docxPreview.value) docxPreview.value.replaceChildren()
  if (pdfLayoutPreview.value) pdfLayoutPreview.value.replaceChildren()
  if (isHtml.value) {
    htmlPackage.dispose()
    htmlPackage = createStandaloneHtmlPackage(defaultHtml)
    model.html = defaultHtml
    refreshHtmlPreview()
  }
}

async function changePdfMode(): Promise<void> {
  if (kind !== 'pdf-word') return
  const file = sourceFile.value
  if (!file) {
    disposePdfPreview()
    return
  }
  errorMessage.value = ''
  processing.value = true
  try {
    if (model.pdfMode === 'layout') {
      await showPdfLayoutPreview(file)
    } else {
      disposePdfPreview()
      if (!extracted.value) await extractSelectedPdf(file)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法生成 PDF 版式预览'
    toast.show(errorMessage.value, 'error')
  } finally {
    processing.value = false
  }
}

async function nativeConvert(file: File): Promise<boolean> {
  if (!nativeEngine.value || isWebRuntime) return false
  const payload = { fileName: file.name, dataBase64: await fileToBase64(file) }
  const result = isWord.value
    ? await desktopApi.convertDocxToPdf(payload)
    : await desktopApi.convertPdfToDocx(payload)
  if (!result.ok) throw new Error(result.error.message)
  if (result.data.cancelled) toast.show(t('document.toast.cancelled'))
  else toast.show(t('document.toast.saved'), 'success')
  return true
}

async function exportDocument(): Promise<void> {
  if (!canExport.value) return
  errorMessage.value = ''
  processing.value = true
  try {
    if (isHtml.value) {
      const frame = previewFrame.value
      if (!frame) throw new Error('HTML 预览尚未就绪')
      await printHtmlDocument(frame, exportOptions.value, outputName.value)
      toast.show(t('document.toast.printOpened'), 'success')
      return
    }
    const file = sourceFile.value
    if (!file) throw new Error(t('document.status.noFile'))
    if (await nativeConvert(file)) return
    if (isWord.value) {
      if (!docxPages.length) throw new Error('Word 预览为空')
      downloadBlob(await docxPagesToPdf(docxPages, exportOptions.value), outputName.value)
      toast.show(t('document.toast.pdfDownloaded'), 'success')
      return
    }
    if (model.pdfMode === 'layout') {
      downloadBlob(await pdfPagesToImageDocx(file), outputName.value)
    } else {
      if (!extracted.value) throw new Error('PDF 中没有可导出的文本')
      downloadBlob(await extractedTextToDocx(replaceExtension(file.name, '', 'converted-document').replace(/\.$/, ''), extracted.value), outputName.value)
    }
    toast.show(t('document.toast.docxDownloaded'), 'success')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '文档转换失败'
    toast.show(errorMessage.value, 'error')
  } finally {
    processing.value = false
  }
}

onMounted(async () => {
  if (isWebRuntime) return
  const result = await desktopApi.getDocumentConversionCapabilities()
  if (result.ok) capabilities.value = result.data
})

onBeforeUnmount(() => {
  htmlPackage.dispose()
  disposePdfPreview()
})
</script>

<template>
  <section class="tool-page document-conversion-tool">
    <header class="tool-header document-conversion-header">
      <div>
        <h1>{{ title }}</h1>
        <p :class="{ error: !!errorMessage }">{{ status }}</p>
      </div>
      <div class="toolbar">
        <template v-if="kind !== 'pdf-word'">
          <select v-model="model.format" class="compact-select" :aria-label="t('document.format')"><option value="a4">A4</option><option value="letter">Letter</option></select>
          <select v-if="isHtml" v-model="model.printViewport" class="compact-select" :aria-label="t('document.printLayout')"><option value="desktop">{{ t('document.printDesktop') }}</option><option value="paper">{{ t('document.printPaper') }}</option></select>
          <label v-if="isHtml && model.printViewport === 'desktop'" class="document-margin-control"><span>{{ t('document.printWidth') }}</span><input v-model.number="model.printWidth" class="compact-input document-print-width" type="number" min="800" max="2560" step="80" /></label>
          <select v-model="model.orientation" class="compact-select" :aria-label="t('document.orientation')"><option value="portrait">{{ t('document.portrait') }}</option><option value="landscape">{{ t('document.landscape') }}</option></select>
          <label class="document-margin-control"><span>{{ t('document.margin') }}</span><input v-model.number="model.margin" class="compact-input" type="number" min="0" max="72" step="1" /></label>
        </template>
        <select v-else v-model="model.pdfMode" class="compact-select" :aria-label="t('document.pdfMode')" :disabled="processing" @change="changePdfMode"><option value="editable">{{ t('document.pdfEditable') }}</option><option value="layout">{{ t('document.pdfLayout') }}</option></select>
        <IconButton :icon="isHtml ? Printer : Download" :label="t(kind === 'pdf-word' ? 'document.action.exportDocx' : isHtml ? 'document.action.printPdf' : 'document.action.exportPdf')" :disabled="!canExport" @click="exportDocument" />
        <IconButton :icon="Trash2" :label="t('document.action.clear')" :disabled="processing || (isHtml ? !model.sourceName && model.html === defaultHtml : !sourceFile)" danger @click="clear()" />
      </div>
    </header>

    <div class="document-engine-strip">
      <span><LoaderCircle v-if="processing" class="spinning" :size="14" /><FileText v-else :size="14" />{{ t(engineKey) }}</span>
      <small>{{ notice }}</small>
    </div>

    <ResizableSplit v-model="model.split" :label="`${title} 分栏`">
      <template #left>
        <div v-if="isHtml" class="editor-panel document-editor-panel" :class="{ invalid: !!errorMessage }">
          <div class="panel-label"><span>{{ sourceLabel }}</span><span v-if="model.sourceName" class="document-file-name"><FileArchive :size="13" />{{ model.sourceName }}</span></div>
          <div v-if="!model.sourceName" class="document-html-dropzone"><FileDropzone :accept="accept" :label="sourceLabel" :prompt="dropPrompt" :detail="dropDetail" :disabled="processing" @file="importFile" /></div>
          <CodeEditor v-model="model.html" label="HTML 文档内容" />
          <footer v-if="model.sourceName"><button class="file-replace-action" type="button" :disabled="processing" @click="clear()"><Upload :size="15" />{{ t('document.action.reselect') }}</button></footer>
        </div>
        <div v-else class="document-source-panel" :class="{ invalid: !!errorMessage }">
          <div class="panel-label">{{ sourceLabel }}</div>
          <div v-if="sourceFile" class="document-file-summary">
            <component :is="isWord ? FileText : FileArchive" :size="34" />
            <strong>{{ sourceFile.name }}</strong>
            <small>{{ sourceFile.size.toLocaleString() }} B<span v-if="kind === 'pdf-word'"> · {{ model.pageCount }} 页<span v-if="model.pdfMode === 'editable'"> · {{ model.lineCount }} 行</span></span></small>
            <button class="file-replace-action" type="button" :disabled="processing" @click="clear()"><Upload :size="15" />{{ t('document.action.reselect') }}</button>
          </div>
          <FileDropzone v-else :accept="accept" :label="sourceLabel" :prompt="dropPrompt" :detail="dropDetail" :disabled="processing" @file="importFile" />
        </div>
      </template>

      <template #right>
        <div v-if="kind === 'pdf-word' && model.pdfMode === 'editable'" class="editor-panel document-text-panel" :class="{ invalid: !!errorMessage }">
          <div class="panel-label">{{ t('document.extractedText') }}</div>
          <CodeEditor :model-value="extractedText" readonly label="PDF 提取文本" @update:model-value="() => undefined" />
          <footer><small>{{ t('document.status.textNotice') }}</small></footer>
        </div>
        <div v-else-if="kind === 'pdf-word'" class="document-preview-panel" :class="{ invalid: !!errorMessage }">
          <div class="panel-label"><span>{{ t('document.layoutPreview') }}</span><span class="document-file-name">{{ outputName }}</span></div>
          <div ref="pdfLayoutPreview" class="document-pdf-preview"><div v-if="!sourceFile" class="empty-state"><FileText :size="30" /><span>{{ dropPrompt }}</span></div></div>
        </div>
        <div v-else class="document-preview-panel" :class="{ invalid: !!errorMessage }">
          <div class="panel-label"><span>{{ t('document.preview') }}</span><span class="document-file-name">{{ outputName }}</span></div>
          <iframe v-if="isHtml" ref="previewFrame" :srcdoc="previewHtml" sandbox="allow-modals allow-same-origin" :title="t('document.preview')" />
          <div v-else ref="docxPreview" class="document-docx-preview"><div v-if="!sourceFile" class="empty-state"><FileText :size="30" /><span>{{ dropPrompt }}</span></div></div>
        </div>
      </template>
    </ResizableSplit>
  </section>
</template>
