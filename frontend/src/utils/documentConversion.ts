import { AlignmentType, Document as DocxDocument, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import { renderAsync } from 'docx-preview'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'

function ensurePdfWorker(): void {
  if (GlobalWorkerOptions.workerPort) return
  GlobalWorkerOptions.workerPort = new PdfWorker()
}

export interface PdfExportOptions {
  desktopLayout?: boolean
  desktopWidth?: number
  format: 'a4' | 'letter'
  margin: number
  orientation: 'portrait' | 'landscape'
}

const PAGE_SIZE_CSS_PIXELS = {
  a4: { height: 1122.52, width: 793.7 },
  letter: { height: 1056, width: 816 },
} as const

function scopeViewportMediaToScreen(documentValue: globalThis.Document): () => void {
  const changes: Array<{ media: MediaList; value: string }> = []
  const visited = new Set<CSSStyleSheet>()
  const explicitMediaType = /^(?:(?:not|only)\s+)?(?:all|print|screen|speech)\b/i
  const viewportFeature = /\(\s*(?:(?:min|max)-)?(?:width|height|aspect-ratio|orientation)\b/i

  function visitStyleSheet(styleSheet: CSSStyleSheet): void {
    if (visited.has(styleSheet)) return
    visited.add(styleSheet)
    let rules: CSSRuleList
    try {
      rules = styleSheet.cssRules
    } catch {
      return
    }
    for (const rule of [...rules]) {
      if (rule.type === CSSRule.IMPORT_RULE) {
        const imported = (rule as CSSImportRule).styleSheet
        if (imported) visitStyleSheet(imported)
      }
      if (rule.type === CSSRule.MEDIA_RULE) {
        const mediaRule = rule as CSSMediaRule
        const queries = Array.from({ length: mediaRule.media.length }, (_, index) => mediaRule.media.item(index))
          .filter((query): query is string => query !== null)
        let changed = false
        const next = queries.map((query) => {
          if (!viewportFeature.test(query) || explicitMediaType.test(query)) return query
          changed = true
          return `screen and ${query}`
        })
        if (changed) {
          changes.push({ media: mediaRule.media, value: mediaRule.media.mediaText })
          mediaRule.media.mediaText = next.join(', ')
        }
      }
      if ('cssRules' in rule) {
        for (const nested of [...(rule as CSSGroupingRule).cssRules]) {
          if (nested.type === CSSRule.IMPORT_RULE) {
            const imported = (nested as CSSImportRule).styleSheet
            if (imported) visitStyleSheet(imported)
          }
        }
      }
    }
  }

  for (const styleSheet of [...documentValue.styleSheets]) visitStyleSheet(styleSheet)
  return () => {
    for (const change of changes.reverse()) change.media.mediaText = change.value
  }
}

export interface ExtractedPdfText {
  characterCount: number
  lineCount: number
  pages: string[][]
}

function pageLines(items: TextItem[]): string[] {
  const lines: Array<{ items: Array<{ text: string; width: number; x: number }>; y: number }> = []
  const sorted = items
    .filter((item) => item.str.trim())
    .map((item) => ({ text: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: item.width ?? 0 }))
    .sort((left, right) => right.y - left.y || left.x - right.x)
  for (const item of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3)
    if (!line) {
      line = { y: item.y, items: [] }
      lines.push(line)
    }
    line.items.push(item)
  }
  return lines.sort((left, right) => right.y - left.y).map((line) => line.items
    .sort((left, right) => left.x - right.x)
    .reduce((text, item, index, values) => {
      if (!index) return item.text
      const previous = values[index - 1]
      return `${text}${previous && item.x - (previous.x + previous.width) > 2 ? ' ' : ''}${item.text}`
    }, ''))
}

export async function extractPdfText(file: File): Promise<ExtractedPdfText> {
  ensurePdfWorker()
  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loadingTask.promise
  const pages: string[][] = []
  try {
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index)
      const content = await page.getTextContent()
      pages.push(pageLines(content.items.filter((item): item is TextItem => 'str' in item && 'transform' in item)))
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }
  return {
    pages,
    lineCount: pages.reduce((count, page) => count + page.length, 0),
    characterCount: pages.flat().join('').length,
  }
}

export async function extractedTextToDocx(title: string, extracted: ExtractedPdfText): Promise<Blob> {
  const children: Paragraph[] = [new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 32 })] })]
  extracted.pages.forEach((page, pageIndex) => {
    if (pageIndex) children.push(new Paragraph({ children: [new TextRun({ text: `Page ${pageIndex + 1}`, bold: true, color: '6B7280' })], pageBreakBefore: true }))
    for (const line of page) children.push(new Paragraph({ text: line || ' ' }))
  })
  if (children.length === 1) children.push(new Paragraph({ text: '' }))
  return Packer.toBlob(new DocxDocument({ sections: [{ children }] }))
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('无法生成 PDF 页面图片'))
        return
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }, 'image/png')
  })
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function sliceRanges(total: number, nominalSize: number): Array<{ offset: number; size: number }> {
  const ranges: Array<{ offset: number; size: number }> = []
  const step = Math.max(1, nominalSize)
  for (let offset = 0; offset < total;) {
    let size = Math.min(step, total - offset)
    const remainder = total - offset - size
    if (remainder > 0 && remainder < step * 0.02) size += remainder
    ranges.push({ offset, size })
    offset += size
  }
  return ranges
}

export async function pdfPagesToImageDocx(file: File): Promise<Blob> {
  ensurePdfWorker()
  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loadingTask.promise
  const sections: ConstructorParameters<typeof DocxDocument>[0]['sections'][number][] = []
  try {
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index)
      const baseViewport = page.getViewport({ scale: 1 })
      const shortestEdge = Math.min(baseViewport.width, baseViewport.height)
      const longestEdge = Math.max(baseViewport.width, baseViewport.height)
      const renderScale = Math.min(2, 1_400 / shortestEdge, 16_000 / longestEdge)
      const viewport = page.getViewport({ scale: renderScale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器 Canvas 不可用')
      await page.render({ canvas, canvasContext: context, viewport }).promise
      const landscape = baseViewport.width > baseViewport.height
      const pageWidth = landscape ? 16_838 : 11_906
      const pageHeight = landscape ? 11_906 : 16_838
      const pageWidthPixels = pageWidth / 15
      const pageHeightPixels = pageHeight / 15
      const sliceWidth = landscape ? Math.max(1, Math.floor(canvas.height * pageWidthPixels / pageHeightPixels)) : canvas.width
      const sliceHeight = landscape ? canvas.height : Math.max(1, Math.floor(canvas.width * pageHeightPixels / pageWidthPixels))
      for (const horizontal of sliceRanges(canvas.width, sliceWidth)) {
        for (const vertical of sliceRanges(canvas.height, sliceHeight)) {
          const { offset: left, size: width } = horizontal
          const { offset: top, size: height } = vertical
          const slice = document.createElement('canvas')
          slice.width = width
          slice.height = height
          const sliceContext = slice.getContext('2d')
          if (!sliceContext) throw new Error('浏览器 Canvas 不可用')
          sliceContext.fillStyle = '#ffffff'
          sliceContext.fillRect(0, 0, width, height)
          sliceContext.drawImage(canvas, left, top, width, height, 0, 0, width, height)
          const imageScale = Math.min(pageWidthPixels / width, pageHeightPixels / height)
          sections.push({
            properties: {
              page: {
                margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 },
                size: { width: pageWidth, height: pageHeight },
              },
            },
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({
                type: 'png',
                data: await canvasToPng(slice),
                transformation: {
                  width: Math.max(1, Math.floor(width * imageScale)),
                  height: Math.max(1, Math.floor(height * imageScale)),
                },
              })],
              spacing: { before: 0, after: 0 },
            })],
          })
          await yieldToBrowser()
        }
      }
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }
  return Packer.toBlob(new DocxDocument({ sections }))
}

export interface PdfLayoutPreviewController {
  outputPages: number
  sourcePages: number
  destroy: () => void
}

export async function renderPdfLayoutPreview(file: File, container: HTMLElement): Promise<PdfLayoutPreviewController> {
  ensurePdfWorker()
  container.replaceChildren()
  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loadingTask.promise
  const pageDetails: Array<{
    pageNumber: number
    scale: number
    slices: Array<{ height: number; left: number; top: number; width: number; wrapper: HTMLDivElement }>
  }> = []
  let outputPages = 0
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index)
    const baseViewport = page.getViewport({ scale: 1 })
    const shortestEdge = Math.min(baseViewport.width, baseViewport.height)
    const longestEdge = Math.max(baseViewport.width, baseViewport.height)
    const scale = Math.min(1, 640 / shortestEdge, 8_000 / longestEdge)
    const viewport = page.getViewport({ scale })
    const canvasWidth = Math.max(1, Math.ceil(viewport.width))
    const canvasHeight = Math.max(1, Math.ceil(viewport.height))
    const landscape = baseViewport.width > baseViewport.height
    const pageRatio = landscape ? 841.89 / 595.28 : 595.28 / 841.89
    const sliceWidth = landscape ? Math.max(1, Math.floor(canvasHeight * pageRatio)) : canvasWidth
    const sliceHeight = landscape ? canvasHeight : Math.max(1, Math.floor(canvasWidth / pageRatio))
    const slices: Array<{ height: number; left: number; top: number; width: number; wrapper: HTMLDivElement }> = []
    for (const horizontal of sliceRanges(canvasWidth, sliceWidth)) {
      for (const vertical of sliceRanges(canvasHeight, sliceHeight)) {
        const { offset: left, size: width } = horizontal
        const { offset: top, size: height } = vertical
        const wrapper = document.createElement('div')
        wrapper.className = 'document-pdf-page loading'
        wrapper.dataset.pdfPage = String(index)
        wrapper.setAttribute('role', 'img')
        wrapper.setAttribute('aria-label', `PDF page ${outputPages + 1}`)
        wrapper.style.aspectRatio = `${width} / ${height}`
        container.append(wrapper)
        slices.push({ height, left, top, width, wrapper })
        outputPages += 1
      }
    }
    pageDetails.push({ pageNumber: index, scale, slices })
    page.cleanup()
    await yieldToBrowser()
  }

  let destroyed = false
  let released = false
  let observer: IntersectionObserver | null = null
  let queue = Promise.resolve()
  const queued = new Set<number>()
  const rendered = new Set<number>()

  function release(): void {
    if (released) return
    released = true
    observer?.disconnect()
    void loadingTask.destroy()
  }

  async function renderPage(detail: typeof pageDetails[number]): Promise<void> {
    if (destroyed || rendered.has(detail.pageNumber)) return
    const page = await pdf.getPage(detail.pageNumber)
    const viewport = page.getViewport({ scale: detail.scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(viewport.width))
    canvas.height = Math.max(1, Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器 Canvas 不可用')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    if (!destroyed) {
      for (const slice of detail.slices) {
        const preview = document.createElement('canvas')
        preview.width = slice.width
        preview.height = slice.height
        const previewContext = preview.getContext('2d')
        if (!previewContext) throw new Error('浏览器 Canvas 不可用')
        previewContext.fillStyle = '#ffffff'
        previewContext.fillRect(0, 0, slice.width, slice.height)
        previewContext.drawImage(canvas, slice.left, slice.top, slice.width, slice.height, 0, 0, slice.width, slice.height)
        slice.wrapper.replaceChildren(preview)
        slice.wrapper.classList.remove('loading')
        await yieldToBrowser()
      }
      rendered.add(detail.pageNumber)
    }
    page.cleanup()
    if (rendered.size === pageDetails.length) release()
  }

  function enqueue(pageNumber: number): void {
    if (destroyed || rendered.has(pageNumber) || queued.has(pageNumber)) return
    const detail = pageDetails[pageNumber - 1]
    if (!detail) return
    queued.add(pageNumber)
    queue = queue.then(() => renderPage(detail)).catch((error) => {
      for (const slice of detail.slices) slice.wrapper.classList.add('invalid')
      console.error('Unable to render PDF preview page', pageNumber, error)
    })
  }

  if (pageDetails[0]) await renderPage(pageDetails[0])
  if (!released && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) enqueue(Number((entry.target as HTMLElement).dataset.pdfPage))
      }
    }, { root: container, rootMargin: '700px 0px' })
    for (const detail of pageDetails) {
      if (rendered.has(detail.pageNumber)) continue
      for (const slice of detail.slices) observer.observe(slice.wrapper)
    }
  } else if (!released) {
    for (const detail of pageDetails.slice(1)) enqueue(detail.pageNumber)
  }

  return {
    outputPages,
    sourcePages: pdf.numPages,
    destroy() {
      if (destroyed) return
      destroyed = true
      observer?.disconnect()
      void queue.finally(release)
    },
  }
}

function points(value: string): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)pt\s*$/i.exec(value)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeDocxTableWidths(container: HTMLElement): number {
  let repaired = 0
  for (const table of container.querySelectorAll<HTMLTableElement>('table')) {
    const declaredWidth = points(table.style.width)
    if (declaredWidth === null || declaredWidth > 0) continue
    const columnWidths = [...table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col')]
      .map((column) => points(column.style.width))
    if (!columnWidths.length || columnWidths.some((width) => width === null || width <= 0)) continue
    const total = columnWidths.reduce<number>((sum, width) => sum + (width ?? 0), 0)
    if (total <= 0) continue
    table.style.width = `${Number(total.toFixed(3))}pt`
    repaired += 1
  }
  return repaired
}

export async function renderDocx(file: File, container: HTMLElement): Promise<HTMLElement[]> {
  container.replaceChildren()
  await renderAsync(file, container, container, {
    breakPages: true,
    ignoreFonts: false,
    ignoreHeight: false,
    ignoreWidth: false,
    renderEndnotes: true,
    renderFooters: true,
    renderFootnotes: true,
    renderHeaders: true,
    useBase64URL: true,
  })
  normalizeDocxTableWidths(container)
  const pages = [...container.querySelectorAll<HTMLElement>('.docx-wrapper > section')]
  return pages.length ? pages : [container]
}

export async function waitForDocumentResources(documentValue: globalThis.Document): Promise<void> {
  await documentValue.fonts?.ready
  await Promise.all([...documentValue.images].map(async (image) => {
    if (image.complete) {
      try { await image.decode() } catch { /* A broken image remains visible in the preview. */ }
      return
    }
    await new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => resolve(), { once: true })
    })
  }))
}

export async function printHtmlDocument(frame: HTMLIFrameElement, options: PdfExportOptions, outputName: string): Promise<void> {
  const documentValue = frame.contentDocument
  const windowValue = frame.contentWindow
  if (!documentValue?.body || !windowValue) throw new Error('HTML 预览尚未就绪')
  const margin = Math.max(0, Math.min(72, options.margin))
  let printStyle = documentValue.querySelector<HTMLStyleElement>('style[data-kaitools-document-print]')
  if (!printStyle) {
    printStyle = documentValue.createElement('style')
    printStyle.dataset.kaitoolsDocumentPrint = ''
    documentValue.head.append(printStyle)
  }
  const page = PAGE_SIZE_CSS_PIXELS[options.format]
  const paperWidth = options.orientation === 'landscape' ? page.height : page.width
  const desktopWidth = Math.max(800, Math.min(2_560, Math.round(options.desktopWidth ?? 1_440)))
  const printableWidth = paperWidth - margin * 2 * 96 / 72
  const desktopScale = Math.min(1, printableWidth / desktopWidth)
  const desktopCss = options.desktopLayout
    ? `html{width:auto!important;min-width:0!important;max-width:none!important;overflow:visible!important}body{width:${desktopWidth}px!important;min-width:${desktopWidth}px!important;max-width:${desktopWidth}px!important;overflow:visible!important;zoom:${Number(desktopScale.toFixed(6))}!important}`
    : 'html{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;scroll-behavior:auto!important}'
  printStyle.textContent = `@page{size:${options.format} ${options.orientation};margin:${margin}pt}@media print{${desktopCss}html{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;scroll-behavior:auto!important}*,*::before,*::after{animation:none!important;transition:none!important}}`
  await waitForDocumentResources(documentValue)
  const restoreMedia = options.desktopLayout ? scopeViewportMediaToScreen(documentValue) : () => undefined
  const previousTitle = documentValue.title
  documentValue.title = outputName.replace(/\.pdf$/i, '')
  try {
    windowValue.focus()
    windowValue.print()
  } finally {
    documentValue.title = previousTitle
    restoreMedia()
  }
}

export async function docxPagesToPdf(pages: HTMLElement[], options: PdfExportOptions): Promise<Blob> {
  const margin = Math.max(0, Math.min(72, options.margin))
  const pdf = new jsPDF({ orientation: options.orientation, unit: 'pt', format: options.format, compress: true })
  const contentWidth = pdf.internal.pageSize.getWidth() - margin * 2
  const contentHeight = pdf.internal.pageSize.getHeight() - margin * 2
  if (contentWidth <= 0 || contentHeight <= 0) throw new Error('页边距没有留下可打印区域')
  let outputPage = 0
  for (const page of pages) {
    const canvas = await html2canvas(page, { backgroundColor: '#ffffff', logging: false, scale: Math.min(2, window.devicePixelRatio || 1), useCORS: false })
    if (!canvas.width || !canvas.height) continue
    const sliceHeight = Math.max(1, Math.floor((contentHeight / contentWidth) * canvas.width))
    for (let top = 0; top < canvas.height; top += sliceHeight) {
      const height = Math.min(sliceHeight, canvas.height - top)
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = height
      const context = slice.getContext('2d')
      if (!context) throw new Error('浏览器 Canvas 不可用')
      context.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height)
      if (outputPage) pdf.addPage()
      const renderedHeight = Math.min(contentHeight, height / canvas.width * contentWidth)
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', margin, margin, contentWidth, renderedHeight, undefined, 'FAST')
      outputPage += 1
    }
  }
  if (!outputPage) throw new Error('Word 预览为空')
  return pdf.output('blob')
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }
    return btoa(binary)
  })
}

export function replaceExtension(fileName: string, extensionValue: string, fallback = 'document'): string {
  const base = fileName.trim().replace(/\.[^.]+$/, '').trim() || fallback
  return `${base}.${extensionValue.replace(/^\./, '')}`
}
