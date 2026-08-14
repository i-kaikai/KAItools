import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const qaDir = resolve(import.meta.dirname, '../../../build/qa')

async function assertViewportIntegrity(page: Page): Promise<void> {
  const integrity = await page.evaluate(() => {
    document.documentElement.classList.add('qa-measure')
    const visibleButtons = [...document.querySelectorAll<HTMLElement>('button')].filter((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    })
    const overflowingButtons = visibleButtons
      .filter((button) => button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1)
      .map((button) => ({
        label: button.getAttribute('aria-label') ?? button.textContent?.trim(),
        client: [button.clientWidth, button.clientHeight],
        scroll: [button.scrollWidth, button.scrollHeight],
      }))
    const result = {
      documentFits:
        document.body.scrollWidth <= window.innerWidth &&
        document.body.scrollHeight <= window.innerHeight &&
        (document.querySelector('#app')?.scrollWidth ?? 0) <= window.innerWidth &&
        (document.querySelector('#app')?.scrollHeight ?? 0) <= window.innerHeight,
      buttonsFit: overflowingButtons.length === 0,
      overflowingButtons,
      dimensions: {
        viewport: [window.innerWidth, window.innerHeight],
        html: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        body: [document.body.scrollWidth, document.body.scrollHeight],
        app: [document.querySelector('#app')?.scrollWidth, document.querySelector('#app')?.scrollHeight],
      },
    }
    document.documentElement.classList.remove('qa-measure')
    return result
  })
  expect(integrity.documentFits, JSON.stringify(integrity.dimensions)).toBe(true)
  expect(integrity.buttonsFit, JSON.stringify(integrity.overflowingButtons)).toBe(true)
}

async function assertScrollContainers(page: Page): Promise<void> {
  const scrollState = await page.evaluate(() => {
    const stateFor = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) return null
      const style = getComputedStyle(element)
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollbarColor: style.scrollbarColor,
      }
    }
    return {
      sidebar: stateFor('.tool-nav'),
      workbench: stateFor('.home-workbench'),
    }
  })

  expect(scrollState.sidebar).not.toBeNull()
  expect(scrollState.sidebar?.overflowX).toBe('hidden')
  expect(scrollState.sidebar?.scrollWidth).toBeLessThanOrEqual(scrollState.sidebar?.clientWidth ?? 0)
  expect(scrollState.sidebar?.scrollbarColor).not.toBe('auto')
  if (scrollState.workbench) {
    expect(scrollState.workbench.overflowX).toBe('hidden')
    expect(scrollState.workbench.overflowY).toBe('auto')
    expect(scrollState.workbench.scrollbarColor).not.toBe('auto')
  }
}

async function sampleParticleCanvas(page: Page): Promise<{ brightPixels: number; colorRange: number; hash: number }> {
  return page.locator('.particle-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) return { brightPixels: 0, colorRange: 0, hash: 0 }
    const pixels = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let brightPixels = 0
    let minLuminance = 255
    let maxLuminance = 0
    let hash = 17
    for (let index = 0; index < pixels.length; index += 64) {
      const red = pixels[index] ?? 0
      const green = pixels[index + 1] ?? 0
      const blue = pixels[index + 2] ?? 0
      const luminance = Math.round((red + green + blue) / 3)
      if (luminance > 36) brightPixels += 1
      minLuminance = Math.min(minLuminance, luminance)
      maxLuminance = Math.max(maxLuminance, luminance)
      hash = (hash * 33 + red * 3 + green * 5 + blue * 7 + index) % 2_147_483_647
    }
    return { brightPixels, colorRange: maxLuminance - minLuminance, hash }
  })
}

test.beforeAll(() => mkdirSync(qaDir, { recursive: true }))

for (const viewport of [
  { width: 960, height: 640, name: 'compact' },
  { width: 1280, height: 800, name: 'desktop' },
  { width: 1600, height: 900, name: 'wide' },
]) {
  test(`home and JSON workspace ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'DevToolkit' })).toBeVisible()
    await expect(page.locator('.particle-field')).toHaveAttribute('data-ready', 'true')
    await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'hero')
    await expect(page.locator('.app-shell')).toHaveClass(/home-active/)
    await expect(page.getByRole('button', { name: '进入工具台' })).toBeVisible()
    await expect(page.locator('.home-orbit-copy')).toHaveCSS('opacity', '1')
    const bottomControls = await page.evaluate(() => {
      const visibleHeight = window.visualViewport?.height ?? window.innerHeight
      const entry = document.querySelector('.home-enter-action')?.getBoundingClientRect()
      const theme = document.querySelector('.sidebar-footer')?.getBoundingClientRect()
      return { visibleHeight, entryBottom: entry?.bottom ?? Infinity, themeBottom: theme?.bottom ?? Infinity }
    })
    expect(bottomControls.entryBottom).toBeLessThanOrEqual(bottomControls.visibleHeight)
    expect(bottomControls.themeBottom).toBeLessThanOrEqual(bottomControls.visibleHeight)
    await assertScrollContainers(page)
    const homeTopbarColor = await page.locator('.tab-strip').evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(homeTopbarColor).toBe('rgb(11, 14, 18)')
    const particleFrame = await sampleParticleCanvas(page)
    expect(particleFrame.brightPixels).toBeGreaterThan(20)
    expect(particleFrame.colorRange).toBeGreaterThan(30)
    await assertViewportIntegrity(page)
    await page.screenshot({ path: resolve(qaDir, `home-orbit-${viewport.name}-light.png`), fullPage: true })

    await page.getByRole('button', { name: '进入工具台' }).click()
    await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'workbench')
    await expect(page.locator('.home-tool-card')).toHaveCount(16)
    await expect(page.locator('.home-category-group')).toHaveCount(5)
    await assertScrollContainers(page)
    await assertViewportIntegrity(page)
    await page.screenshot({ path: resolve(qaDir, `home-workbench-${viewport.name}-light.png`), fullPage: true })

    await page.locator('.home-tool-orbit').hover({ position: { x: 12, y: 12 } })
    await page.locator('.home-tool-card[data-tool="json"]').click()
    await expect(page.getByRole('heading', { name: 'JSON' })).toBeVisible()
    await expect(page.getByLabel('JSON 输入')).toBeVisible()
    await expect(page.getByText('语法有效')).toBeVisible()
    await assertViewportIntegrity(page)
    await page.screenshot({ path: resolve(qaDir, `json-${viewport.name}-light.png`), fullPage: true })

    await page.getByRole('button', { name: '首页', exact: true }).click()
    await page.getByRole('button', { name: '跟随系统' }).click()
    await page.getByRole('button', { name: '浅色主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await assertViewportIntegrity(page)
    await page.screenshot({ path: resolve(qaDir, `home-orbit-${viewport.name}-dark.png`), fullPage: true })
  })
}

test('particle planet and tool carousel render, move and respond to the wheel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.locator('.particle-field')).toHaveAttribute('data-ready', 'true')

  const firstFrame = await sampleParticleCanvas(page)
  expect(firstFrame.brightPixels).toBeGreaterThan(20)
  expect(firstFrame.colorRange).toBeGreaterThan(30)
  await page.waitForTimeout(350)
  const secondFrame = await sampleParticleCanvas(page)
  expect(secondFrame.hash).not.toBe(firstFrame.hash)

  await page.getByRole('button', { name: '进入工具台' }).click()
  await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'workbench')
  const carousel = page.locator('.home-tool-orbit')
  await carousel.hover({ position: { x: 12, y: 12 } })
  const frontCard = page.locator('.home-tool-card[data-front]').first()
  const frontTool = await frontCard.getAttribute('data-tool')
  await frontCard.hover({ position: { x: 120, y: 50 } })
  await expect(page.locator('.particle-field')).toHaveAttribute('data-active-tool', frontTool ?? 'json')
  const transformBeforeWheel = await frontCard.evaluate((card) => getComputedStyle(card).transform)
  await carousel.dispatchEvent('wheel', { deltaY: 480, deltaMode: 0 })
  await expect(carousel).toHaveAttribute('data-wheel-active', 'true')
  await page.waitForTimeout(120)
  const transformAfterWheel = await frontCard.evaluate((card) => getComputedStyle(card).transform)
  expect(transformAfterWheel).not.toBe(transformBeforeWheel)

  await carousel.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 680, clientY: 280, button: 0 })
  await expect(carousel).toHaveAttribute('data-drag-active', 'true')
  const transformBeforeTouch = await frontCard.evaluate((card) => getComputedStyle(card).transform)
  await carousel.dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: 500, clientY: 282, buttons: 1 })
  const transformAfterTouch = await frontCard.evaluate((card) => getComputedStyle(card).transform)
  expect(transformAfterTouch).not.toBe(transformBeforeTouch)
  await carousel.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: 500, clientY: 282, button: 0 })
  await expect(carousel).not.toHaveAttribute('data-drag-active', 'true')
  await page.mouse.move(2, 2)
  await expect(page.locator('.particle-field')).not.toHaveAttribute('data-active-tool', frontTool ?? 'json')

  await page.getByRole('button', { name: '返回环星' }).click()
  await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'hero')
})

test('formatted JSON output remains editable and drives tree view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await page.getByLabel('JSON 格式化结果').fill('{"edited": true, "count": 2}')
  await expect(page.getByLabel('JSON 格式化结果')).toContainText('edited')
  await page.getByRole('button', { name: '树视图' }).click()
  await expect(page.getByText('edited', { exact: true })).toBeVisible()
  await assertViewportIntegrity(page)
})

test('new conversion, formatting and analysis tools produce results', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  await page.getByRole('button', { name: 'Base64 文本', exact: true }).click()
  await page.getByLabel('Base64 文本输入').fill('你好')
  await expect(page.getByLabel('Base64 文本结果')).toContainText('5L2g5aW9')

  await page.getByRole('button', { name: 'SQL 美化', exact: true }).click()
  await page.getByLabel('SQL 输入').fill('select id,name from users where enabled=1')
  await expect(page.getByLabel('SQL 格式化结果')).toContainText('SELECT')

  await page.getByRole('button', { name: 'JSON 对比', exact: true }).click()
  await expect(page.getByLabel('JSON 差异结果')).toHaveCount(0)
  await expect(page.getByLabel('左侧 JSON').locator('.cm-diff-mark-removed')).toBeVisible()
  await expect(page.getByLabel('右侧 JSON').locator('.cm-diff-mark-added')).toBeVisible()

  await page.getByRole('button', { name: '文本比较', exact: true }).click()
  await expect(page.getByLabel('文本差异结果')).toHaveCount(0)
  await expect(page.getByLabel('左侧文本').locator('.cm-diff-mark-removed')).toBeVisible()
  await expect(page.getByLabel('右侧文本').locator('.cm-diff-mark-added')).toBeVisible()

  await page.getByRole('button', { name: '文本统计', exact: true }).click()
  await page.getByLabel('文本统计输入').fill('你好 DevToolkit')
  await expect(page.getByLabel('文本统计结果')).toContainText('UTF-8 字节')
  await assertViewportIntegrity(page)
})

test('all tools render and remain usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  for (const tool of ['JSON / JavaBean', 'Java 转义', '日期转换', 'Base64 图片', 'Base64 文件', 'Crontab 生成器', 'YAML 美化', 'XML 格式化', '文本比较', 'Hosts', 'MD5 摘要']) {
    await page.getByRole('button', { name: tool, exact: true }).click()
    await expect(page.getByRole('heading', { name: tool, exact: true })).toBeVisible()
    if (tool === '日期转换') {
      await page.getByLabel('日期、时间或时间戳').fill('2024年1月1日 08时00分00秒')
      await expect(page.getByText('1704067200', { exact: true })).toBeVisible()
    }
    await assertViewportIntegrity(page)
    if (tool === 'Hosts') {
      if (testInfo.project.name === 'web') {
        await expect(page.getByRole('heading', { name: '仅 Windows 桌面版可用' })).toBeVisible()
        await expect(page.getByLabel('本地 Hosts 文件内容')).toHaveCount(0)
      } else {
        await expect(page.getByLabel('本地 Hosts 文件内容')).toBeVisible()
      }
      await page.screenshot({ path: resolve(qaDir, 'hosts-desktop-light.png'), fullPage: true })
    }
  }
})

test('web build persists local state and renders compliance details', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'web')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByText('浏览器 · 本地存储')).toBeVisible()
  await expect(page.getByRole('link', { name: '京ICP备00000000号-1' })).toHaveAttribute(
    'href',
    'https://beian.miit.gov.cn/',
  )

  await page.getByRole('button', { name: '跟随系统' }).click()
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await page.getByRole('button', { name: '固定标签' }).last().click()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('devtoolkit.browser.state.v1') ?? ''))
    .toContain('"pinned":true')
  await page.reload()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '取消固定' })).toHaveCount(1)
})

test('web build remains usable on a mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'web')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'DevToolkit' })).toBeVisible()
  await expect(page.getByRole('link', { name: '京ICP备00000000号-1' })).toBeVisible()
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'home-orbit-mobile-light.png'), fullPage: true })

  await page.getByRole('button', { name: 'Hosts', exact: true }).click()
  await expect(page.getByRole('heading', { name: '仅 Windows 桌面版可用' })).toBeVisible()
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'hosts-mobile-light.png'), fullPage: true })

  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await expect(page.getByLabel('JSON 输入')).toBeVisible()
  await page.getByLabel('JSON 输入').fill('{"mobile":true}')
  await expect(page.getByText('语法有效')).toBeVisible()
  await assertViewportIntegrity(page)
})

test('tabs support pinning, creating and closing without layout shift', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.goto('/')
  await page.getByRole('button', { name: '新建JSON标签' }).first().click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.getByRole('button', { name: '固定标签' }).last().click()
  await expect(page.getByRole('button', { name: '取消固定' })).toHaveCount(1)
  await page.getByRole('button', { name: '关闭标签' }).last().click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await assertViewportIntegrity(page)
})
