import { expect, test, type Locator, type Page } from '@playwright/test'

async function openTool(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+K')
  const search = page.locator('.tool-search-dialog input[type="search"]')
  await expect(search).toBeVisible()
  await search.fill(query)
  await page.locator('.tool-search-results [role="option"]').filter({ hasText: query }).first().click()
}

function longText(prefix: string, lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => `${prefix} line ${String(index + 1).padStart(3, '0')} ${'x'.repeat(72)}`).join('\n')
}

async function readProgress(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    const scroller = element as HTMLElement
    const range = scroller.scrollHeight - scroller.clientHeight
    return range > 0 ? scroller.scrollTop / range : 0
  })
}

async function setProgress(target: Locator, progress: number): Promise<void> {
  await target.evaluate((element, value) => {
    const scroller = element as HTMLElement
    scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) * value)
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
  }, progress)
}

test('text comparison synchronizes scroll progress in both directions without changing horizontal position', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await openTool(page, '文本比较')

  const editors = page.locator('.editor-split .cm-scroller')
  const contents = page.locator('.editor-split .cm-content')
  await contents.nth(0).fill(`${longText('left', 220)}\n${'left-wide-column '.repeat(32)}`)
  await contents.nth(1).fill(`${longText('right', 360)}\n${'right-wide-column '.repeat(32)}`)
  await expect(editors).toHaveCount(2)

  await editors.nth(1).evaluate((element) => {
    const content = element.querySelector<HTMLElement>('.cm-content')
    if (content) content.style.minWidth = '2400px'
  })
  await expect.poll(() => editors.nth(1).evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await editors.nth(1).evaluate((element) => { (element as HTMLElement).scrollLeft = 24 })
  await setProgress(editors.nth(0), 0.64)
  const leftProgress = await readProgress(editors.nth(0))
  await expect.poll(() => readProgress(editors.nth(1))).toBeCloseTo(leftProgress, 2)
  await expect.poll(() => editors.nth(1).evaluate((element) => (element as HTMLElement).scrollLeft)).toBe(24)

  await setProgress(editors.nth(1), 0.29)
  const rightProgress = await readProgress(editors.nth(1))
  await expect.poll(() => readProgress(editors.nth(0))).toBeCloseTo(rightProgress, 2)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.split-separator')).toHaveAttribute('aria-orientation', 'horizontal')
  await setProgress(editors.nth(0), 0.71)
  const compactLeftProgress = await readProgress(editors.nth(0))
  await expect.poll(() => readProgress(editors.nth(1))).toBeCloseTo(compactLeftProgress, 2)
})

test('HTML source and same-origin preview synchronize scroll progress in both directions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await openTool(page, 'HTML 转 PDF')

  const sourceContent = page.locator('.document-editor-panel .cm-content')
  const sourceScroller = page.locator('.document-editor-panel .cm-scroller')
  const html = `<!doctype html><html><body>${Array.from({ length: 240 }, (_, index) => `<p>Preview line ${index + 1}: ${'content '.repeat(12)}</p>`).join('')}</body></html>`
  await sourceContent.fill(html)

  const preview = page.frameLocator('.document-preview-panel iframe')
  await expect(preview.getByText('Preview line 240:')).toBeAttached()
  await expect.poll(async () => sourceScroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect.poll(async () => preview.locator('html').evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement
    return scroller.scrollHeight > scroller.clientHeight
  })).toBe(true)

  await setProgress(sourceScroller, 0.57)
  const sourceProgress = await readProgress(sourceScroller)
  await expect.poll(() => preview.locator('html').evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement
    const range = scroller.scrollHeight - scroller.clientHeight
    return range > 0 ? scroller.scrollTop / range : 0
  })).toBeCloseTo(sourceProgress, 2)

  await preview.locator('html').evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement
    scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) * 0.23)
    window.dispatchEvent(new Event('scroll'))
  })
  const previewProgress = await preview.locator('html').evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement
    const range = scroller.scrollHeight - scroller.clientHeight
    return range > 0 ? scroller.scrollTop / range : 0
  })
  await expect.poll(() => readProgress(sourceScroller)).toBeCloseTo(previewProgress, 2)
})
