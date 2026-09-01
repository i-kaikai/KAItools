import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { jsPDF } from 'jspdf'
import JSZip from 'jszip'
import { getDocument as readPdf } from 'pdfjs-dist/legacy/build/pdf.mjs'

async function openTool(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+K')
  const search = page.locator('.tool-search-dialog input[type="search"]')
  await expect(search).toBeVisible()
  await search.fill(query)
  await page.locator('.tool-search-results [role="option"]').filter({ hasText: query }).first().click()
}

async function dropBase64File(page: Page, selector: string, fileName: string, mimeType: string, base64: string): Promise<void> {
  await page.locator(selector).evaluate((target, value) => {
    const bytes = Uint8Array.from(atob(value.base64), (character) => character.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], value.fileName, { type: value.mimeType }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, { fileName, mimeType, base64 })
}

test('HTML asset packages preserve local head styles and use native printing without network assets', async ({ page }, testInfo) => {
  const zip = new JSZip()
  zip.file('index.html', `<!doctype html><html><head><link rel="stylesheet" href="assets/main.css"><style>
    body { color: rgb(230, 237, 243); background: rgb(13, 17, 23); }
    main::before { content: ''; background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none"/></svg>'); }
    @media (max-width: 2000px) { main { grid-template-columns: 1fr; } }
  </style></head><body>
    <main><img id="logo" src="assets/mark.svg" alt="mark"><h1 id="title">LOCAL PACKAGE</h1><p id="notice">Nested CSS is active.</p></main>
  </body></html>`)
  zip.file('assets/main.css', '@import "nested.css"; body { padding: 28px; } #title { color: rgb(220, 38, 38); font-size: 38px; }')
  zip.file('assets/nested.css', '#notice { padding: 12px; background: rgb(236, 253, 245) url(https://document-assets.invalid/tracker.png); border-left: 5px solid rgb(5, 150, 105); }')
  zip.file('assets/mark.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="6" fill="#0f766e"/></svg>')
  const base64 = await zip.generateAsync({ type: 'base64' })
  let externalRequests = 0
  page.on('request', (request) => {
    if (request.url().startsWith('https://document-assets.invalid/')) externalRequests += 1
  })

  await page.goto('/')
  await openTool(page, 'HTML 转 PDF')
  await dropBase64File(page, '.document-html-dropzone .file-dropzone', 'site.zip', 'application/zip', base64)

  const preview = page.frameLocator('.document-preview-panel iframe')
  const title = preview.getByRole('heading', { name: 'LOCAL PACKAGE' })
  const notice = preview.getByText('Nested CSS is active.')
  const logo = preview.getByAltText('mark')
  await expect(title).toHaveCSS('color', 'rgb(220, 38, 38)')
  await expect(title).toHaveCSS('font-size', '38px')
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(13, 17, 23)')
  await expect(notice).toHaveCSS('background-color', 'rgb(236, 253, 245)')
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(48)
  expect(externalRequests).toBe(0)

  await preview.locator('html').evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.printInvoked = 'true'
      const mediaRule = [...document.styleSheets].flatMap((styleSheet) => [...styleSheet.cssRules])
        .find((rule): rule is CSSMediaRule => rule.type === CSSRule.MEDIA_RULE && (rule as CSSMediaRule).media.mediaText.includes('max-width'))
      document.documentElement.dataset.printMedia = mediaRule?.media.mediaText ?? ''
    }
  })
  await expect(page.getByLabel('打印布局')).toHaveValue('desktop')
  await expect(page.getByLabel('PC 宽度')).toHaveValue('1440')
  await page.getByRole('button', { name: '打印 / 保存 PDF' }).click()
  await expect(preview.locator('html')).toHaveAttribute('data-print-invoked', 'true')
  await expect(preview.locator('html')).toHaveAttribute('data-print-media', /screen and \(max-width: 2000px\)/)
  const restoredMedia = await preview.locator('html').evaluate(() => ([...document.styleSheets].flatMap((styleSheet) => [...styleSheet.cssRules])
    .find((rule) => rule.type === CSSRule.MEDIA_RULE && (rule as CSSMediaRule).media.mediaText.includes('max-width')) as CSSMediaRule | undefined)?.media.mediaText)
  expect(restoredMedia).toBe('(max-width: 2000px)')
  const printCss = await preview.locator('style[data-kaitools-document-print]').textContent()
  expect(printCss).toContain('@page{size:a4 portrait;margin:36pt}')
  expect(printCss).toContain('body{width:1440px!important')
  expect(printCss).toContain('zoom:0.484514!important')
  expect(printCss).toContain('print-color-adjust:exact')
  expect(printCss).toContain('animation:none!important')
  await expect(page.locator('.toast.success')).toContainText('另存为 PDF')
  await page.screenshot({ path: testInfo.outputPath('html-package-preview.png'), fullPage: true })
})

test('system status remains transparent above the particle field', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.particle-field')).toHaveAttribute('data-ready', 'true')
  const status = page.locator('.home-system')
  await status.scrollIntoViewIfNeeded()
  await expect(status).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.system-status-metrics')).toBeVisible()
  const layout = await status.evaluate((element) => {
    const style = getComputedStyle(element)
    const scrim = getComputedStyle(element, '::before')
    const rect = element.getBoundingClientRect()
    return { height: rect.height, width: rect.width, position: style.position, scrim: scrim.backgroundColor, zIndex: style.zIndex }
  })
  expect(layout.width).toBeGreaterThan(300)
  expect(layout.height).toBeGreaterThan(300)
  expect(layout.position).toBe('relative')
  expect(layout.zIndex).toBe('1')
  expect(layout.scrim).toBe('rgba(6, 9, 13, 0.62)')
  await page.screenshot({ path: testInfo.outputPath('transparent-system-status.png'), fullPage: true })
})

test('Web compatibility converts DOCX to PDF and PDF text to editable DOCX', async ({ page }, testInfo) => {
  const docx = await Packer.toBuffer(new Document({
    sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: 'KAITools Word compatibility', bold: true })] }),
      ...Array.from({ length: 120 }, (_, index) => new Paragraph({ text: `Browser pagination regression line ${index + 1}` })),
    ] }],
  }))
  await page.goto('/')
  await openTool(page, 'Word 转 PDF')
  await dropBase64File(page, '.document-source-panel .file-dropzone', 'word.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx.toString('base64'))
  await expect(page.locator('.document-docx-preview')).toContainText('KAITools Word compatibility')
  await expect(page.locator('.document-engine-strip small')).toContainText('自动切分页')
  const pdfDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PDF' }).click()
  const pdfDownload = await pdfDownloadPromise
  const pdfPath = testInfo.outputPath('word-compatibility.pdf')
  await pdfDownload.saveAs(pdfPath)
  const convertedPdf = await readFile(pdfPath)
  expect(convertedPdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  const pdfTask = readPdf({ data: new Uint8Array(convertedPdf) })
  const parsedPdf = await pdfTask.promise
  expect(parsedPdf.numPages).toBeGreaterThan(1)
  await pdfTask.destroy()

  const sourcePdf = new jsPDF({ unit: 'pt', format: [595, 2_000] })
  sourcePdf.text('KAITools PDF compatibility', 24, 28)
  sourcePdf.text('KAITools PDF compatibility middle', 24, 900)
  sourcePdf.text('KAITools PDF compatibility end', 24, 1_800)
  await openTool(page, 'PDF 转 Word')
  await dropBase64File(page, '.document-source-panel .file-dropzone', 'source.pdf', 'application/pdf', Buffer.from(sourcePdf.output('arraybuffer')).toString('base64'))
  await expect(page.locator('.document-text-panel .cm-content')).toContainText('KAITools PDF compatibility')
  const docxDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 DOCX' }).click()
  const docxDownload = await docxDownloadPromise
  const docxPath = testInfo.outputPath('pdf-compatibility.docx')
  await docxDownload.saveAs(docxPath)
  const converted = await JSZip.loadAsync(await readFile(docxPath))
  expect(await converted.file('word/document.xml')?.async('text')).toContain('KAITools PDF compatibility')

  await page.getByLabel('PDF 转 Word 模式').selectOption('layout')
  await expect(page.locator('.document-engine-strip small')).toContainText('不可编辑图片')
  await expect(page.locator('.document-text-panel')).toHaveCount(0)
  await expect(page.locator('.document-pdf-preview .document-pdf-page')).toHaveCount(3)
  await expect(page.locator('.document-pdf-preview canvas').first()).toBeVisible()
  const layoutDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 DOCX' }).click()
  const layoutDownload = await layoutDownloadPromise
  const layoutPath = testInfo.outputPath('pdf-layout.docx')
  await layoutDownload.saveAs(layoutPath)
  const layoutDocx = await JSZip.loadAsync(await readFile(layoutPath))
  expect(Object.keys(layoutDocx.files).some((name) => /^word\/media\/.+\.png$/.test(name))).toBe(true)
  const layoutXml = await layoutDocx.file('word/document.xml')?.async('text') ?? ''
  expect((layoutXml.match(/<w:drawing>/g) ?? [])).toHaveLength(3)
})

test('layout-first PDF preview creates a scrollable lazy page list', async ({ page }) => {
  const sourcePdf = new jsPDF({ unit: 'pt', format: [594.96, 841.92] })
  sourcePdf.text('Lazy preview page 1', 24, 28)
  for (let index = 2; index <= 12; index += 1) {
    sourcePdf.addPage()
    sourcePdf.text(`Lazy preview page ${index}`, 24, 28)
  }

  await page.goto('/')
  await openTool(page, 'PDF 转 Word')
  await page.getByLabel('PDF 转 Word 模式').selectOption('layout')
  await dropBase64File(page, '.document-source-panel .file-dropzone', 'lazy.pdf', 'application/pdf', Buffer.from(sourcePdf.output('arraybuffer')).toString('base64'))

  const preview = page.locator('.document-pdf-preview')
  const pages = preview.locator('.document-pdf-page')
  await expect(pages).toHaveCount(12)
  await expect(pages.first().locator('canvas')).toBeVisible()
  expect(await pages.locator('canvas').count()).toBeLessThan(12)
  const metrics = await preview.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)

  await preview.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(pages.last().locator('canvas')).toBeVisible()
})

test('document tools fit a mobile Web viewport without horizontal page overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await openTool(page, 'HTML 转 PDF')
  const integrity = await page.evaluate(() => ({
    body: document.body.scrollWidth <= document.body.clientWidth,
    document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    workspace: (() => {
      const element = document.querySelector<HTMLElement>('.workspace')
      return Boolean(element && element.scrollWidth <= element.clientWidth)
    })(),
  }))
  expect(integrity).toEqual({ body: true, document: true, workspace: true })
  await expect(page.getByRole('button', { name: '打印 / 保存 PDF' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('document-mobile.png'), fullPage: true })
})
