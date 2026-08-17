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
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollbarColor: style.scrollbarColor,
      }
    }
    return {
      sidebar: stateFor('.tool-nav'),
      tabs: stateFor('.tab-strip'),
      workbench: stateFor('.home-workbench'),
    }
  })

  expect(scrollState.sidebar).not.toBeNull()
  expect(scrollState.sidebar?.overflowX).toBe('hidden')
  expect(scrollState.sidebar?.scrollWidth).toBeLessThanOrEqual(scrollState.sidebar?.clientWidth ?? 0)
  expect(scrollState.sidebar?.scrollbarColor).not.toBe('auto')
  expect(scrollState.tabs).not.toBeNull()
  expect(scrollState.tabs?.overflowX).toBe('auto')
  expect(scrollState.tabs?.overflowY).toBe('hidden')
  expect(scrollState.tabs?.scrollHeight).toBeLessThanOrEqual(scrollState.tabs?.clientHeight ?? 0)
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
  { width: 2048, height: 1024, name: 'large' },
]) {
  test(`home and JSON workspace ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'KAITools' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.particle-field')).toHaveAttribute('data-ready', 'true')
    await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'hero')
    await expect(page.locator('.app-shell')).toHaveClass(/home-active/)
    await expect(page.getByRole('button', { name: '进入工具台' })).toBeVisible()
    await expect(page.locator('.home-orbit-copy')).toHaveCSS('opacity', '1')
    await expect(page.locator('.home-orbit-copy h1')).toHaveCSS('font-size', '38px')
    await expect(page.locator('.home-orbit-copy > small')).toHaveCSS('font-size', '10px')
    await expect(page.getByRole('button', { name: '进入工具台' })).toHaveCSS('height', '48px')
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
    await expect(page.locator('.home-content')).toBeVisible()
    if (viewport.name === 'large') {
      const widthUsage = await page.evaluate(() => {
        const content = document.querySelector('.home-content')?.getBoundingClientRect()
        const workspace = document.querySelector('.workspace')?.getBoundingClientRect()
        return content && workspace ? content.width / workspace.width : 0
      })
      expect(widthUsage).toBeGreaterThan(0.85)
    }
    await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'workbench')
    await expect(page.locator('.home-tool-card')).toHaveCount(16)
    await expect(page.locator('.home-category-group')).toHaveCount(5)
    const currentDate = page.locator('.home-current-date')
    await expect(currentDate).toBeVisible()
    await expect(currentDate).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/)
    await expect(currentDate).toHaveText(/^\d{4}年\d{1,2}月\d{1,2}日 · 星期[一二三四五六日]$/)
    await expect(currentDate).toHaveCSS('font-size', '12px')
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
  await expect(carousel).toHaveAttribute('data-orbit-layout', 'landscape')
  await carousel.hover({ position: { x: 12, y: 12 } })
  await page.waitForTimeout(200)
  await expect(page.locator('.home-tool-card[data-front]')).toHaveCount(1)
  const frontCard = page.locator('.home-tool-card[data-front]').first()
  const carouselAppearance = await carousel.evaluate((orbit) => {
    const orbitStyle = getComputedStyle(orbit)
    const cards = [...orbit.querySelectorAll<HTMLElement>('.home-tool-card')]
    return {
      maskImage: orbitStyle.maskImage || orbitStyle.webkitMaskImage,
      opacities: cards.map((card) => Number.parseFloat(getComputedStyle(card).opacity)),
      borderColors: cards.map((card) => getComputedStyle(card).borderColor),
      edgeAlphas: cards.map((card) => Number.parseFloat(
        getComputedStyle(card).getPropertyValue('--card-edge-alpha') || '1',
      )),
    }
  })
  expect(carouselAppearance.maskImage).toContain('linear-gradient')
  expect(Math.min(...carouselAppearance.opacities)).toBeGreaterThan(0.9)
  expect(new Set(carouselAppearance.borderColors).size).toBe(1)
  expect(Math.max(...carouselAppearance.edgeAlphas)).toBeGreaterThan(0.9)
  expect(Math.min(...carouselAppearance.edgeAlphas)).toBeLessThan(0.2)
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
  await page.waitForTimeout(32)
  const transformAfterTouch = await frontCard.evaluate((card) => getComputedStyle(card).transform)
  expect(transformAfterTouch).not.toBe(transformBeforeTouch)
  await carousel.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: 500, clientY: 282, button: 0 })
  await expect(carousel).not.toHaveAttribute('data-drag-active', 'true')
  await page.mouse.move(2, 2)
  await expect(page.locator('.particle-field')).not.toHaveAttribute('data-active-tool', frontTool ?? 'json')

  await page.getByRole('button', { name: '返回环星' }).click()
  await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'hero')
})

test('formatted JSON output remains editable and drives tree and graph views', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await page.getByLabel('JSON 格式化结果').fill('{"edited":true,"count":2,"meta":{"owner":"kai","active":true}}')
  await expect(page.getByLabel('JSON 格式化结果')).toContainText('edited')
  await page.getByRole('button', { name: '树视图' }).click()
  await expect(page.getByText('edited', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关系图' }).click()
  const graph = page.getByLabel('JSON 关系图')
  await expect(graph).toBeVisible()
  await expect(graph.locator('.json-graph-node')).toHaveCount(2)
  const rootCard = graph.locator('.json-graph-node').first()
  await expect(rootCard).toContainText('edited')
  await expect(rootCard).toContainText('count')
  await expect(rootCard).toContainText('meta')
  await expect(graph.getByText('$', { exact: true })).toHaveCount(0)

  await rootCard.click()
  const nodeDialog = page.getByRole('dialog', { name: '节点内容' })
  await expect(nodeDialog).toBeVisible()
  await expect(nodeDialog.getByText('$', { exact: true })).toBeVisible()
  await page.waitForTimeout(220)
  await page.screenshot({ path: resolve(qaDir, 'json-node-editor-desktop-light.png'), fullPage: true })
  await page.getByLabel('节点 JSON 内容').fill('{"edited":false,"count":9,"meta":{"owner":"kai","active":false}}')
  await page.getByRole('button', { name: '应用到结果' }).click()
  await expect(nodeDialog).toBeHidden()
  await expect(rootCard).toContainText('9')

  await graph.locator('.json-graph-node').nth(1).click()
  await expect(nodeDialog.getByText('$.meta', { exact: true })).toBeVisible()
  await page.getByLabel('节点 JSON 内容').fill('{"owner":"lee","active":true}')
  await page.getByRole('button', { name: '应用到结果' }).click()
  await expect(graph.locator('.json-graph-node').nth(1)).toContainText('lee')
  await page.getByRole('button', { name: '放大关系图' }).click()
  await expect(page.locator('.json-graph-toolbar')).toContainText('%')
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'json-graph-desktop-light.png'), fullPage: true })
  await page.getByRole('button', { name: '跟随系统' }).click()
  await page.getByRole('button', { name: '浅色主题' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: resolve(qaDir, 'json-graph-desktop-dark.png'), fullPage: true })
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
  await page.getByLabel('文本统计输入').fill('你好 KAITools')
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

test('web build persists local state without placeholder compliance details', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'web')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: '展开侧栏' }).click()
  await expect(page.getByText('浏览器 · 本地存储')).toBeVisible()
  await expect(page.locator('a[href="https://beian.miit.gov.cn/"]')).toHaveCount(0)

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
  await expect(page.getByRole('heading', { name: 'KAITools' })).toBeVisible()
  await expect(page.locator('a[href="https://beian.miit.gov.cn/"]')).toHaveCount(0)
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'home-orbit-mobile-light.png'), fullPage: true })

  await page.getByRole('button', { name: '进入工具台' }).click()
  await expect(page.locator('.home-tool-orbit')).toHaveAttribute('data-orbit-layout', 'portrait')
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
  await page.getByRole('button', { name: '展开侧栏' }).click()
  await page.getByRole('button', { name: '新建JSON标签' }).first().click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.getByRole('button', { name: '固定标签' }).last().click()
  await expect(page.getByRole('button', { name: '取消固定' })).toHaveCount(1)
  await page.getByRole('button', { name: '关闭标签' }).last().click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await assertViewportIntegrity(page)
})

test('all generated outputs remain editable and split panes can be resized', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const cases = [
    { tool: 'Base64 文本', inputLabel: 'Base64 文本输入', outputLabel: 'Base64 文本结果', input: 'hello', generated: 'aGVsbG8=' },
    { tool: 'Java 转义', inputLabel: 'Java 转义输入', outputLabel: 'Java 转义结果', input: 'hello\nworld', generated: '\\n' },
    { tool: 'JSON / JavaBean', inputLabel: 'JSON 转 JavaBean 输入', outputLabel: 'JSON JavaBean 转换结果', input: '{"name":"Kai"}', generated: 'class RootBean' },
    { tool: 'SQL 美化', inputLabel: 'SQL 输入', outputLabel: 'SQL 格式化结果', input: 'select id from users', generated: 'SELECT' },
    { tool: 'YAML 美化', inputLabel: 'YAML 输入', outputLabel: 'YAML 格式化结果', input: 'name: KAITools', generated: 'name' },
    { tool: 'XML 格式化', inputLabel: 'XML 输入', outputLabel: 'XML 格式化结果', input: '<root><name>kai</name></root>', generated: '<root>' },
  ]

  for (const item of cases) {
    await page.getByRole('button', { name: item.tool, exact: true }).click()
    await page.getByLabel(item.inputLabel).fill(item.input)
    const output = page.getByLabel(item.outputLabel)
    await expect(output).toContainText(item.generated)
    await output.fill(`edited ${item.tool}`)
    await expect(output).toContainText(`edited ${item.tool}`)
    await expect(page.getByRole('separator', { name: '调整左右编辑区域大小' })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Java 转义', exact: true }).click()
  const separator = page.getByRole('separator', { name: '调整左右编辑区域大小' })
  const leftPanel = page.locator('.editor-split > .editor-panel').first()
  const beforeWidth = (await leftPanel.boundingBox())!.width
  const separatorBox = (await separator.boundingBox())!
  await page.mouse.move(separatorBox.x + separatorBox.width / 2, separatorBox.y + separatorBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(separatorBox.x + 150, separatorBox.y + separatorBox.height / 2, { steps: 4 })
  await page.mouse.up()
  const afterWidth = (await leftPanel.boundingBox())!.width
  expect(afterWidth).toBeGreaterThan(beforeWidth + 100)
  await separator.press('ArrowLeft')
  await separator.dblclick()
  await expect(separator).toHaveAttribute('aria-valuenow', '50')
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'editable-resizable-split-desktop-light.png'), fullPage: true })
})

test('tab context menu closes current, right-side and all tool tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await page.getByRole('button', { name: 'Java 转义', exact: true }).click()
  await page.getByRole('button', { name: '日期转换', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(4)

  await page.getByRole('tab', { name: 'JSON' }).click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '标签页操作' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: '关闭当前' })).toBeEnabled()
  await page.screenshot({ path: resolve(qaDir, 'tab-context-menu-desktop-light.png'), fullPage: true })
  await menu.getByRole('menuitem', { name: '关闭右侧' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: 'JSON' })).toBeVisible()

  await page.getByRole('button', { name: 'Java 转义', exact: true }).click()
  await page.getByRole('tab', { name: 'Java 转义' }).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: '关闭所有' }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab', { name: '首页' })).toBeVisible()
  await assertViewportIntegrity(page)
})

test('Crontab supports raw expressions, field templates, time zones and run previews', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Crontab 生成器', exact: true }).click()

  const expression = page.getByLabel('Cron 表达式')
  await expression.fill('*/15 9-18 * * 1-5')
  await expect(page.getByText('VALID', { exact: true })).toBeVisible()
  await expect(page.getByLabel('分钟', { exact: true })).toHaveValue('*/15')
  await expect(page.getByLabel('小时', { exact: true })).toHaveValue('9-18')
  await page.getByLabel('Cron 时区').selectOption('Asia/Shanghai')
  await page.getByLabel('执行次数').selectOption('10')
  await expect(page.locator('.cron-runs li')).toHaveCount(10)

  await page.getByRole('button', { name: '工作日 09:00', exact: true }).click()
  await expect(expression).toHaveValue('0 9 * * 1-5')
  await expect(page.getByText('每个工作日 09:00 执行')).toBeVisible()
  await page.getByLabel('分钟快速设置').selectOption('*/5')
  await expect(expression).toHaveValue('*/5 9 * * 1-5')

  await expression.fill('0 0 9 * * 1-5')
  await expect(page.getByText('INVALID', { exact: true })).toBeVisible()
  await expect(page.getByText('标准 Crontab 表达式必须包含 5 个字段')).toBeVisible()
  await page.getByRole('button', { name: '每季度首日', exact: true }).click()
  await expect(page.getByText('VALID', { exact: true })).toBeVisible()
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'cron-workbench-desktop-light.png'), fullPage: true })
})

test('Gitee and GitHub repository entries use official icons and work from the workspace', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.context().route('https://gitee.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>KAITools Gitee</title>' }))
  await page.context().route('https://github.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>KAITools GitHub</title>' }))
  await page.goto('/')

  const sidebarLink = page.locator('.sidebar-footer').getByRole('button', { name: '打开 Gitee 仓库' })
  const githubSidebarLink = page.locator('.sidebar-footer').getByRole('button', { name: '打开 GitHub 仓库' })
  await expect(sidebarLink).toBeVisible()
  await expect(githubSidebarLink).toBeVisible()
  await expect(page.locator('.repository-brand-button img')).toHaveCount(2)
  await expect.poll(() => page.locator('.repository-brand-button img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
  await expect(page.locator('.particle-field')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('.home-orbit-copy')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: resolve(qaDir, 'repository-entry-sidebar-collapsed-light.png'), fullPage: true })
  const sidebarPopupPromise = page.waitForEvent('popup')
  await sidebarLink.click()
  const sidebarPopup = await sidebarPopupPromise
  await sidebarPopup.waitForURL('https://gitee.com/i-_-kaikai/kaitools')
  await sidebarPopup.close()
  const githubSidebarPopupPromise = page.waitForEvent('popup')
  await githubSidebarLink.click()
  const githubSidebarPopup = await githubSidebarPopupPromise
  await githubSidebarPopup.waitForURL('https://github.com/imxukai/KAItools')
  await githubSidebarPopup.close()

  await page.getByRole('button', { name: '展开侧栏' }).click()
  await expect(sidebarLink).toBeVisible()
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-collapsed/)
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'repository-entry-sidebar-expanded-light.png'), fullPage: true })

  await page.getByRole('button', { name: '首页', exact: true }).click()
  await page.getByRole('button', { name: '进入工具台' }).click()
  const homeRepositoryLink = page.locator('.home-system').getByRole('button', { name: '打开 Gitee 仓库' })
  const githubHomeRepositoryLink = page.locator('.home-system').getByRole('button', { name: '打开 GitHub 仓库' })
  await expect(homeRepositoryLink).toContainText('i-_-kaikai/kaitools')
  await expect(githubHomeRepositoryLink).toContainText('imxukai/KAItools')
  await expect(page.locator('.home-system .repository-brand-icon')).toHaveCount(2)
  await page.screenshot({ path: resolve(qaDir, 'repository-entry-home-light.png'), fullPage: true })
  const homePopupPromise = page.waitForEvent('popup')
  await homeRepositoryLink.click()
  const homePopup = await homePopupPromise
  await homePopup.waitForURL('https://gitee.com/i-_-kaikai/kaitools')
  await homePopup.close()
  const githubHomePopupPromise = page.waitForEvent('popup')
  await githubHomeRepositoryLink.click()
  const githubHomePopup = await githubHomePopupPromise
  await githubHomePopup.waitForURL('https://github.com/imxukai/KAItools')
  await githubHomePopup.close()

  await page.evaluate(() => {
    window.open = () => null
  })
  await githubHomeRepositoryLink.click()
  await expect(page.getByText('浏览器阻止了 GitHub 仓库窗口，请允许弹出窗口后重试')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(sidebarLink).toBeHidden()
  await expect(homeRepositoryLink).toBeVisible()
  await expect(githubHomeRepositoryLink).toBeVisible()
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'repository-entry-home-mobile-light.png'), fullPage: true })
})

test('tool search is localized, keyboard friendly and available while collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.goto('/')
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)

  await page.locator('.sidebar-search-button').click()
  const dialog = page.getByRole('dialog', { name: '搜索工具' })
  const input = page.getByLabel('输入工具名称、用途或关键词')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('transition-duration', '0s')
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
  await input.fill('定时')
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect(page.getByRole('option')).toContainText('定时任务表达式')
  await expect(page.getByRole('option')).toContainText('开发辅助')
  await page.screenshot({ path: resolve(qaDir, 'tool-search-desktop-light.png'), fullPage: true })
  await input.press('Enter')
  await expect(page.getByRole('heading', { name: 'Crontab 生成器' })).toBeVisible()
  await expect(dialog).toBeHidden()

  await page.keyboard.press('Control+k')
  await input.fill('没有这个工具')
  await expect(page.getByText('没有找到匹配工具')).toBeVisible()
  await expect(page.getByText('可以尝试“格式化”“日期”“编码”等中文关键词')).toBeVisible()
  await input.press('Escape')
  await expect(dialog).toBeHidden()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.sidebar-search-button').click()
  await expect(dialog).toBeVisible()
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'tool-search-mobile-light.png'), fullPage: true })
})

test('Java unescape formats JSON by default and keeps generated output editable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Java 转义', exact: true }).click()
  await page.getByRole('radio', { name: '反转义', exact: true }).click()

  const autoFormat = page.getByLabel('自动格式化 JSON')
  const input = page.getByLabel('Java 转义输入')
  const output = page.getByLabel('Java 转义结果')
  await expect(autoFormat).toBeChecked()
  await input.fill('{\\"name\\":\\"Kai\\",\\"count\\":9007199254740993}')
  await expect(output.locator('.cm-line')).toHaveCount(4)
  await expect(output.locator('.cm-line').nth(1)).toContainText('"name": "Kai"')
  await expect(output.locator('.cm-line').nth(2)).toContainText('9007199254740993')

  await output.fill('{"edited":true}')
  await expect(output).toContainText('{"edited":true}')
  await page.waitForTimeout(100)
  await expect(output).toContainText('{"edited":true}')

  await autoFormat.uncheck()
  await expect(output.locator('.cm-line')).toHaveCount(1)
  await expect(output).toContainText('{"name":"Kai","count":9007199254740993}')
  await output.fill('手动修改后的结果')
  await expect(output).toContainText('手动修改后的结果')
  await page.screenshot({ path: resolve(qaDir, 'java-unescape-json-editable-light.png'), fullPage: true })
})
