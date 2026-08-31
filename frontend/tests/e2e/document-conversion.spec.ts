import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { jsPDF } from 'jspdf'
import JSZip from 'jszip'

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

test('HTML asset packages preserve local head styles and export a PDF without network assets', async ({ page }, testInfo) => {
  const zip = new JSZip()
  zip.file('index.html', `<!doctype html><html><head><link rel="stylesheet" href="assets/main.css"></head><body>
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
  await expect(notice).toHaveCSS('background-color', 'rgb(236, 253, 245)')
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(48)
  expect(externalRequests).toBe(0)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PDF' }).click()
  const download = await downloadPromise
  const target = testInfo.outputPath('site.pdf')
  await download.saveAs(target)
  expect((await readFile(target)).subarray(0, 5).toString('ascii')).toBe('%PDF-')
  await expect(page.locator('.toast.success')).toContainText('PDF 已生成')
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
    sections: [{ children: [new Paragraph({ children: [new TextRun({ text: 'KAITools Word compatibility', bold: true })] })] }],
  }))
  await page.goto('/')
  await openTool(page, 'Word 转 PDF')
  await dropBase64File(page, '.document-source-panel .file-dropzone', 'word.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx.toString('base64'))
  await expect(page.locator('.document-docx-preview')).toContainText('KAITools Word compatibility')
  const pdfDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PDF' }).click()
  const pdfDownload = await pdfDownloadPromise
  const pdfPath = testInfo.outputPath('word-compatibility.pdf')
  await pdfDownload.saveAs(pdfPath)
  expect((await readFile(pdfPath)).subarray(0, 5).toString('ascii')).toBe('%PDF-')

  const sourcePdf = new jsPDF()
  sourcePdf.text('KAITools PDF compatibility', 24, 28)
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
  await expect(page.getByRole('button', { name: '导出 PDF' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('document-mobile.png'), fullPage: true })
})
