import { Document as DocxDocument, Packer, Paragraph, TextRun } from 'docx'
import { renderAsync } from 'docx-preview'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface PdfExportOptions {
  format: 'a4' | 'letter'
  margin: number
  orientation: 'portrait' | 'landscape'
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

function addLinks(pdf: jsPDF, element: HTMLElement, sliceHeight: number, contentWidth: number, margin: number): void {
  const bounds = element.getBoundingClientRect()
  if (!bounds.width) return
  const pageHeight = pdf.internal.pageSize.getHeight() - margin * 2
  element.querySelectorAll<HTMLElement>('a[href], [data-pdf-link]').forEach((link) => {
    const raw = link.dataset.pdfLink || link.getAttribute('href') || ''
    let url: URL
    try {
      url = new URL(raw, window.location.href)
      if (!['http:', 'https:'].includes(url.protocol)) return
    } catch {
      return
    }
    for (const rect of [...link.getClientRects()]) {
      const top = rect.top - bounds.top
      const pageIndex = Math.floor(top / sliceHeight)
      const localTop = top - pageIndex * sliceHeight
      if (pageIndex < 0 || localTop < 0 || rect.width <= 0 || rect.height <= 0) continue
      pdf.setPage(pageIndex + 1)
      pdf.link(
        margin + ((rect.left - bounds.left) / bounds.width) * contentWidth,
        margin + (localTop / sliceHeight) * pageHeight,
        (rect.width / bounds.width) * contentWidth,
        (rect.height / sliceHeight) * pageHeight,
        { url: url.href },
      )
    }
  })
}

export async function htmlElementToPdf(element: HTMLElement, options: PdfExportOptions): Promise<Blob> {
  const margin = Math.max(0, Math.min(72, options.margin))
  const canvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    logging: false,
    scale: Math.min(2, window.devicePixelRatio || 1),
    useCORS: false,
    windowHeight: element.scrollHeight,
    windowWidth: element.scrollWidth,
  })
  if (!canvas.width || !canvas.height) throw new Error('文档预览为空')
  const pdf = new jsPDF({ orientation: options.orientation, unit: 'pt', format: options.format, compress: true })
  const contentWidth = pdf.internal.pageSize.getWidth() - margin * 2
  const contentHeight = pdf.internal.pageSize.getHeight() - margin * 2
  if (contentWidth <= 0 || contentHeight <= 0) throw new Error('页边距没有留下可打印区域')
  const sliceHeight = Math.max(1, Math.floor((contentHeight / contentWidth) * canvas.width))
  for (let top = 0, pageIndex = 0; top < canvas.height; top += sliceHeight, pageIndex += 1) {
    const height = Math.min(sliceHeight, canvas.height - top)
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = height
    const context = slice.getContext('2d')
    if (!context) throw new Error('浏览器 Canvas 不可用')
    context.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height)
    if (pageIndex) pdf.addPage()
    pdf.addImage(slice.toDataURL('image/png'), 'PNG', margin, margin, contentWidth, (height / canvas.width) * contentWidth, undefined, 'FAST')
  }
  addLinks(pdf, element, sliceHeight / (canvas.width / element.getBoundingClientRect().width), contentWidth, margin)
  return pdf.output('blob')
}

export async function docxPagesToPdf(pages: HTMLElement[], options: PdfExportOptions): Promise<Blob> {
  const margin = Math.max(0, Math.min(72, options.margin))
  const pdf = new jsPDF({ orientation: options.orientation, unit: 'pt', format: options.format, compress: true })
  const contentWidth = pdf.internal.pageSize.getWidth() - margin * 2
  const contentHeight = pdf.internal.pageSize.getHeight() - margin * 2
  if (contentWidth <= 0 || contentHeight <= 0) throw new Error('页边距没有留下可打印区域')
  for (let index = 0; index < pages.length; index += 1) {
    const canvas = await html2canvas(pages[index]!, { backgroundColor: '#ffffff', logging: false, scale: Math.min(2, window.devicePixelRatio || 1), useCORS: false })
    if (index) pdf.addPage()
    const scale = Math.min(contentWidth / canvas.width, contentHeight / canvas.height)
    const width = canvas.width * scale
    const height = canvas.height * scale
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin + (contentWidth - width) / 2, margin, width, height, undefined, 'FAST')
  }
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
