import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const qaDir = resolve(import.meta.dirname, '../../../build/qa')
const appVersion = readFileSync(resolve(import.meta.dirname, '../../../VERSION'), 'utf8').trim()

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
      appRect: (() => {
        const rect = document.querySelector('#app')?.getBoundingClientRect()
        return rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null
      })(),
      documentFits:
        document.body.scrollWidth <= window.innerWidth &&
        document.body.scrollHeight <= window.innerHeight &&
        (document.querySelector('#app')?.scrollWidth ?? 0) <= window.innerWidth &&
        (document.querySelector('#app')?.scrollHeight ?? 0) <= window.innerHeight &&
        Math.abs((document.querySelector('#app')?.getBoundingClientRect().top ?? Infinity)) <= 1 &&
        Math.abs((document.querySelector('#app')?.getBoundingClientRect().bottom ?? -Infinity) - window.innerHeight) <= 1,
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
      homePage: stateFor('.home-page'),
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
  if (scrollState.homePage) {
    expect(scrollState.homePage.overflowX).toBe('hidden')
    expect(scrollState.homePage.overflowY).toBe('auto')
    expect(scrollState.homePage.scrollbarColor).not.toBe('auto')
  }
  if (scrollState.workbench) {
    expect(scrollState.workbench.overflowX).toBe('visible')
    expect(scrollState.workbench.overflowY).toBe('visible')
  }
}

async function openWorkspaceTool(page: Page, name: string): Promise<void> {
  const shortcut = page.locator('.tool-nav').getByRole('button', { name, exact: true })
  if (await shortcut.count()) {
    await shortcut.first().click()
    return
  }

  await page.getByRole('button', { name: '搜索工具' }).click()
  const dialog = page.getByRole('dialog', { name: '搜索工具' })
  const input = page.getByLabel('输入工具名称、用途或关键词')
  await expect(dialog).toBeVisible()
  await input.fill(name)
  await input.press('Enter')
  await expect(dialog).toBeHidden()
}

test('sidebar active tool uses a restrained dark selection in both themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const expandSidebar = page.getByRole('button', { name: '展开侧栏' })
  if (await expandSidebar.count()) await expandSidebar.click()
  await openWorkspaceTool(page, 'Java 转义')

  const activeTool = page.locator('.tool-nav-row.active')
  await expect(activeTool).toContainText('Java 转义')
  await expect(activeTool).toHaveCSS('background-color', 'rgb(53, 38, 77)')
  await expect(activeTool).toHaveCSS('color', 'rgb(243, 237, 255)')
  await page.screenshot({ path: resolve(qaDir, `sidebar-active-light-${testInfo.project.name}.png`), fullPage: true })

  await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'))
  await expect(activeTool).toHaveCSS('background-color', 'rgb(43, 33, 65)')
  await expect(activeTool).toHaveCSS('color', 'rgb(240, 234, 255)')
  await page.screenshot({ path: resolve(qaDir, `sidebar-active-dark-${testInfo.project.name}.png`), fullPage: true })
})

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
  { width: 2560, height: 1440, name: 'qhd' },
  { width: 3440, height: 1440, name: 'ultrawide' },
  { width: 3840, height: 2160, name: '4k' },
]) {
  test(`home and JSON workspace ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'KAITools' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.particle-field')).toHaveAttribute('data-ready', 'true')
    await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'workbench')
    await expect(page.locator('.app-shell')).toHaveClass(/home-active/)
    await expect(page.locator('.home-launchpad')).toBeVisible()
    await expect(page.locator('.home-next .home-title-block h1')).toHaveCSS('font-size', '42px')
    const bottomControls = await page.evaluate(() => {
      const visibleHeight = window.visualViewport?.height ?? window.innerHeight
      const launchpad = document.querySelector('.home-launchpad')?.getBoundingClientRect()
      const theme = document.querySelector('.sidebar-footer')?.getBoundingClientRect()
      return { visibleHeight, launchpadTop: launchpad?.top ?? Infinity, themeBottom: theme?.bottom ?? Infinity }
    })
    expect(bottomControls.launchpadTop).toBeLessThan(bottomControls.visibleHeight)
    expect(bottomControls.themeBottom).toBeLessThanOrEqual(bottomControls.visibleHeight)
    await assertScrollContainers(page)
    const homeTopbarColor = await page.locator('.tab-strip').evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(homeTopbarColor).toBe('rgb(11, 14, 18)')
    const particleFrame = await sampleParticleCanvas(page)
    expect(particleFrame.brightPixels).toBeGreaterThan(20)
    expect(particleFrame.colorRange).toBeGreaterThan(30)
    await assertViewportIntegrity(page)
    if (viewport.width <= 2048) await page.screenshot({ path: resolve(qaDir, `home-launchpad-${viewport.name}-light.png`), fullPage: true })

    await expect(page.locator('.home-content')).toBeVisible()
    if (viewport.width >= 1600) {
      const widthUsage = await page.evaluate(() => {
        const content = document.querySelector('.home-content')?.getBoundingClientRect()
        const workspace = document.querySelector('.workspace')?.getBoundingClientRect()
        return content && workspace ? content.width / workspace.width : 0
      })
      expect(widthUsage).toBeGreaterThan(0.98)
    }
    await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'workbench')
    await expect(page.locator('.home-launchpad')).toBeVisible()
    await expect(page.locator('.home-pinned-note')).toBeVisible()
    await expect(page.locator('.home-pinned-note')).toContainText('关于 KAITools')
    const launchpadLayout = await page.evaluate(() => {
      const launchpad = document.querySelector('.home-launchpad')?.getBoundingClientRect()
      const launchpadCopy = document.querySelector('.home-launchpad-copy')?.getBoundingClientRect()
      const deck = document.querySelector('.home-next-deck')?.getBoundingClientRect()
      const pinnedNote = document.querySelector('.home-pinned-note')?.getBoundingClientRect()
      const home = document.querySelector('.home-page')?.getBoundingClientRect()
      const workspace = document.querySelector('.workspace')?.getBoundingClientRect()
      return {
        launchpadHeight: launchpad?.height ?? Infinity,
        copyHeight: launchpadCopy?.height ?? Infinity,
        copyWidth: launchpadCopy?.width ?? 0,
        deckHeight: deck?.height ?? Infinity,
        deckWidth: deck?.width ?? 0,
        pinnedNoteHeight: pinnedNote?.height ?? Infinity,
        pinnedNoteWidth: pinnedNote?.width ?? 0,
        scrollbarRightDelta: Math.abs((home?.right ?? 0) - (workspace?.right ?? Infinity)),
      }
    })
    if (viewport.width >= 1200) {
      expect(Math.abs(launchpadLayout.copyHeight - launchpadLayout.deckHeight)).toBeLessThanOrEqual(2)
      expect(Math.abs(launchpadLayout.copyHeight - launchpadLayout.pinnedNoteHeight)).toBeLessThanOrEqual(2)
      expect(launchpadLayout.deckWidth / launchpadLayout.copyWidth).toBeGreaterThan(1.75)
      expect(launchpadLayout.deckWidth / launchpadLayout.copyWidth).toBeLessThan(2.25)
      expect(launchpadLayout.pinnedNoteWidth / launchpadLayout.copyWidth).toBeGreaterThan(.9)
      expect(launchpadLayout.pinnedNoteWidth / launchpadLayout.copyWidth).toBeLessThan(1.1)
      expect(launchpadLayout.scrollbarRightDelta).toBeLessThanOrEqual(1)
    }
    const openPinnedNote = page.getByRole('button', { name: '打开笔记', exact: true })
    await expect(openPinnedNote).toHaveCSS('background-color', 'rgb(27, 24, 48)')
    await openPinnedNote.hover()
    await expect(openPinnedNote.locator('.home-pinned-note-action-icon')).not.toHaveCSS('transform', 'none')
    await expect(page.locator('.home-active-module')).toHaveCount(0)
    await expect(page.locator('.home-shortcut-grid')).toHaveCount(0)
    await expect(page.locator('.home-tool-card')).toHaveCount(6)
    await expect(page.locator('.home-category-group')).toHaveCount(5)
    const currentDate = page.locator('.home-current-date')
    await expect(currentDate).toBeVisible()
    await expect(currentDate).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/)
    await expect(currentDate).toHaveText(/^\d{4}年\d{1,2}月\d{1,2}日 · 星期[一二三四五六日]$/)
    await expect(currentDate).toHaveCSS('font-size', '13px')
    await assertScrollContainers(page)
    await assertViewportIntegrity(page)
    if (viewport.width <= 2048) await page.screenshot({ path: resolve(qaDir, `home-workbench-${viewport.name}-light.png`), fullPage: true })

    await page.locator('.home-tool-card[data-tool="json"]').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'JSON' })).toBeVisible()
    await expect(page.getByLabel('JSON 输入')).toBeVisible()
    await expect(page.getByText('语法有效')).toBeVisible()
    await assertViewportIntegrity(page)
    if (viewport.width <= 2048) await page.screenshot({ path: resolve(qaDir, `json-${viewport.name}-light.png`), fullPage: true })

    await page.getByRole('button', { name: '首页', exact: true }).click()
    await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'workbench')
    await page.getByRole('button', { name: '跟随系统' }).click()
    await page.getByRole('button', { name: '浅色' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await assertViewportIntegrity(page)
    if (viewport.width <= 2048) await page.screenshot({ path: resolve(qaDir, `home-workbench-${viewport.name}-dark.png`), fullPage: true })
  })
}

test('homepage surfaces local workspace overview, four system metrics, and an aligned collapsed rail', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('/')
  await expect(page.locator('.home-workspace-overview')).toBeVisible()
  await expect(page.locator('.home-overview-stat-grid > div')).toHaveCount(6)
  await expect(page.locator('.home-session-tools')).toBeVisible()
  await expect(page.locator('.home-local-mode-card')).toBeVisible()
  await expect(page.locator('.home-pinned-note-content p')).toBeVisible()
  await expect(page.getByRole('region', { name: '系统状态', exact: true })).toBeVisible()
  await expect(page.locator('.system-status-hero strong')).toBeVisible()
  await expect(page.locator('.system-status-metrics > div')).toHaveCount(4)
  await expect(page.locator('.system-status-metrics')).toContainText(/CPU/)
  await expect(page.locator('.system-status-metrics')).toContainText(/内存/)
  await expect(page.locator('.system-status-metrics')).toContainText(/电量/)
  await expect(page.locator('.system-status-metrics')).toContainText(/工作区数据/)

  const shell = page.locator('.app-shell')
  if (!await shell.evaluate((element) => element.classList.contains('sidebar-collapsed'))) {
    await page.getByLabel('收起侧栏').click()
  }
  const alignment = await page.locator('.app-sidebar').evaluate((sidebar) => {
    const center = sidebar.getBoundingClientRect().left + sidebar.getBoundingClientRect().width / 2
    const buttons = [...sidebar.querySelectorAll<HTMLElement>('.tool-nav-main')]
    return buttons.map((button) => Math.abs(button.getBoundingClientRect().left + button.getBoundingClientRect().width / 2 - center))
  })
  expect(Math.max(...alignment)).toBeLessThanOrEqual(1)
  mkdirSync(qaDir, { recursive: true })
  await page.screenshot({ path: resolve(qaDir, 'home-workbench-density.png'), fullPage: true })
})

test('desktop system status renders percentage progress for CPU, memory, and battery', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'web', 'The web build intentionally reports browser-scoped metrics.')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.evaluate(() => {
    window.pywebview = {
      api: {
        get_system_status: async () => ({
          ok: true,
          data: {
            capturedAt: '2026-08-28T12:00:00Z',
            runtime: 'desktop',
            system: {
              platform: 'Windows 11', logicalCores: 16, cpuName: 'Test CPU', cpuUsagePercent: 5.7,
              memoryTotalBytes: 16 * 1024 ** 3, memoryAvailableBytes: 3.424 * 1024 ** 3, memoryUsagePercent: 78.6,
              powerSource: 'battery', powerPercent: 100, powerCharging: true,
            },
            application: { webview2: 'Test WebView2', dataDirectory: 'C:\\KAITools\\data', dataDirectoryBytes: 1024, trayHidden: false, clipboard: { enabled: true, count: 0, maxEntries: 100 } },
          },
        }),
      },
    }
  })

  await page.getByRole('button', { name: '刷新系统状态' }).click()
  const metrics = page.locator('.system-status-metrics')
  await expect(metrics).toContainText('5.7%')
  await expect(metrics).toContainText('78.6%')
  await expect(metrics).toContainText('100%')
  await expect(metrics.getByRole('progressbar')).toHaveCount(3)
  await expect(metrics.getByRole('progressbar', { name: 'CPU' })).toHaveAttribute('aria-valuenow', '5.7')
  await expect(metrics.getByRole('progressbar', { name: '内存' })).toHaveAttribute('aria-valuenow', '78.6')
  mkdirSync(qaDir, { recursive: true })
  await page.screenshot({ path: resolve(qaDir, 'system-status-percentages.png'), fullPage: true })
})

test('visible Home refreshes local metrics every second and service status every 30 seconds', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'web', 'The desktop bridge supplies controlled local system samples.')
  await page.clock.install({ time: new Date('2026-08-28T12:00:00Z') })
  let healthChecks = 0
  await page.route('**/api/health', (route) => {
    healthChecks += 1
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { status: 'ready' } }) })
  })
  await page.goto('/')
  await page.evaluate(() => {
    let samples = 0
    window.pywebview = {
      api: {
        get_system_status: async () => {
          samples += 1
          document.documentElement.dataset.systemStatusSamples = String(samples)
          return {
            ok: true,
            data: {
              capturedAt: new Date().toISOString(), runtime: 'desktop',
              system: { platform: 'Windows 11', logicalCores: 16, cpuName: 'Test CPU', cpuUsagePercent: 5, memoryTotalBytes: 16, memoryAvailableBytes: 8, memoryUsagePercent: 50, powerSource: 'battery', powerPercent: 90, powerCharging: false },
              application: { webview2: 'Test WebView2', dataDirectory: 'C:\\KAITools\\data', dataDirectoryBytes: 0, trayHidden: false, clipboard: { enabled: true, count: 0, maxEntries: 100 } },
            },
          }
        },
      },
    }
  })
  await expect.poll(() => healthChecks).toBeGreaterThanOrEqual(1)
  const initialHealthChecks = healthChecks

  await page.clock.fastForward(30_000)
  await expect.poll(async () => Number(await page.locator('html').getAttribute('data-system-status-samples'))).toBeGreaterThanOrEqual(30)
  expect(healthChecks - initialHealthChecks).toBe(1)
})

test('default desktop height keeps the calculator compact and homepage shows current session tools', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: '超级计算器', exact: true }).click()
  const calculatorLayout = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>('.workspace')
    return {
      workspaceFits: (workspace?.scrollHeight ?? 0) <= (workspace?.clientHeight ?? 0) + 1,
    }
  })
  expect(calculatorLayout.workspaceFits).toBe(true)

  await page.getByRole('button', { name: '首页', exact: true }).click()
  const sessionIconSpacing = await page.locator('.home-session-tool-grid').evaluate((list) => {
    const row = list.querySelector<HTMLElement>('button')
    const icon = row?.querySelector<SVGElement>('svg')
    const text = row?.querySelector<HTMLElement>('span')
    if (!row || !icon || !text) return null
    return text.getBoundingClientRect().left - icon.getBoundingClientRect().right
  })
  if (sessionIconSpacing !== null) expect(sessionIconSpacing).toBeGreaterThanOrEqual(8)

  await page.getByRole('button', { name: '笔记', exact: true }).click()
  await page.getByRole('button', { name: '首页', exact: true }).click()
  await expect(page.locator('.home-session-tool-grid')).toContainText('笔记')
  await page.screenshot({ path: resolve(qaDir, 'home-workspace-overview.png'), fullPage: true })
})

test('notes use one collapsible tree and leave the editor available by default', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await openWorkspaceTool(page, '笔记')

  const workspace = page.locator('.notes-workspace')
  await expect(workspace).toBeVisible()
  await expect(page.locator('.notes-tree-panel')).toBeVisible()
  await expect(page.locator('.notes-list-panel')).toHaveCount(0)
  await expect(page.getByLabel('Markdown 笔记内容')).toBeVisible()
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveClass(/active/)
  await expect(page.getByText('关于 KAITools', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '文件夹', exact: true }).click()
  const dialog = page.locator('.notes-dialog')
  await dialog.locator('input').fill('接口设计')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.notes-tree-panel').getByRole('button', { name: '接口设计', exact: true })).toBeVisible()

  await page.locator('.notes-toolbar').getByRole('button', { name: '新建笔记', exact: true }).click()
  await expect(page.getByLabel('笔记标题')).toHaveValue('未命名笔记')
  await page.getByLabel('Markdown 笔记内容').fill('# 临时笔记')
  await expect(page.getByLabel('Markdown 笔记内容')).toContainText('# 临时笔记')

  await page.getByRole('button', { name: '收起笔记树' }).click()
  await expect(page.locator('.notes-tree-panel')).toBeHidden()
  await page.getByRole('button', { name: '展开笔记树' }).click()
  await expect(page.locator('.notes-tree-panel')).toBeVisible()
  await assertViewportIntegrity(page)
})

test('restores an account from the persistent refresh cookie after reload', async ({ page }) => {
  await page.context().addCookies([{
    name: 'KAITOOLS_REFRESH',
    value: 'persisted-refresh-cookie',
    url: 'https://tools.imkai.top/api/auth',
    httpOnly: true,
    sameSite: 'None',
    secure: true,
  }])
  let refreshCalls = 0
  await page.route('**/api/auth/token/refresh', async (route) => {
    const origin = route.request().headers().origin ?? ''
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } })
      return
    }
    refreshCalls += 1
    expect(route.request().headers().cookie ?? '').toContain('KAITOOLS_REFRESH=persisted-refresh-cookie')
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ ok: true, data: { accessToken: 'memory-only-token', expiresAt: '2030-01-01T00:00:00Z', user: { id: '00000000-0000-0000-0000-000000000001', email: 'persisted@example.test', displayName: '持久化账户', emailVerified: true } } }),
    })
  })

  await page.goto('/')
  await expect(page.locator('.workspace-topbar .account-entry')).toContainText('持久化账户')
  await page.reload()
  await expect(page.locator('.workspace-topbar .account-entry')).toContainText('持久化账户')
  expect(refreshCalls).toBeGreaterThanOrEqual(2)
})

test('homepage card manager adds a local tool card and opens its tool', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: '展开侧栏' }).click()
  await page.getByRole('button', { name: '管理首页卡片' }).click()
  const dialog = page.getByRole('dialog', { name: '管理首页卡片' })
  await expect(dialog).toBeVisible()
  const dialogLayer = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('.app-sidebar')
    const backdrop = document.querySelector<HTMLElement>('.dashboard-card-backdrop')
    return {
      sidebarZ: Number(getComputedStyle(sidebar!).zIndex),
      backdropZ: Number(getComputedStyle(backdrop!).zIndex),
      viewportWidth: window.innerWidth,
      backdropWidth: backdrop?.getBoundingClientRect().width ?? 0,
    }
  })
  expect(dialogLayer.backdropZ).toBeGreaterThan(dialogLayer.sidebarZ)
  expect(dialogLayer.backdropWidth).toBe(dialogLayer.viewportWidth)
  await expect(dialog.locator('.dashboard-card-list-items > div')).toHaveCount(6)
  await dialog.getByRole('radio', { name: '连续旋转' }).click()
  await expect(dialog.getByRole('radio', { name: '连续旋转' })).toHaveAttribute('aria-checked', 'true')
  await dialog.locator('.dashboard-card-catalog-items').getByRole('button', { name: /JSON/ }).first().click()
  await dialog.getByLabel('标题').fill('快捷 JSON')
  await dialog.getByLabel('描述').fill('格式化接口数据')
  await dialog.getByRole('slider', { name: '连续旋转速度' }).fill('22')
  await dialog.getByRole('radio', { name: '逐卡切换' }).click()
  await dialog.getByRole('slider', { name: '逐卡停留时间' }).fill('2400')
  await dialog.getByRole('radio', { name: '连续旋转' }).click()
  await dialog.getByRole('button', { name: '保存首页卡片' }).click()
  await expect(dialog).toBeHidden()
  const card = page.locator('.home-tool-card[data-tool="json"]')
  await expect(card).toBeVisible()
  await expect(card).toContainText('快捷 JSON')
  await page.reload()
  await expect(page.locator('.home-tool-card[data-tool="json"]')).toContainText('快捷 JSON')
  await page.getByRole('button', { name: '管理首页卡片' }).click()
  await expect(page.getByRole('dialog', { name: '管理首页卡片' }).getByRole('radio', { name: '连续旋转' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('slider', { name: '连续旋转速度' })).toHaveValue('22')
  await expect(page.getByRole('slider', { name: '逐卡停留时间' })).toHaveValue('2400')
  await page.getByRole('button', { name: '关闭首页卡片管理' }).click()
  await expect(page.locator('.home-tool-orbit')).toHaveAttribute('data-carousel-mode', 'classic')
  const classicCard = page.locator('.home-tool-card[data-front]').first()
  const classicTransform = await classicCard.evaluate((card) => getComputedStyle(card).transform)
  await page.waitForTimeout(350)
  await expect.poll(() => classicCard.evaluate((card) => getComputedStyle(card).transform)).not.toBe(classicTransform)
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'JSON' })).toBeVisible()
})

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

  await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'workbench')
  const carousel = page.locator('.home-tool-orbit')
  await expect(carousel).toHaveAttribute('data-orbit-layout', /^(compact|landscape)$/)
  await carousel.hover({ position: { x: 12, y: 12 } })
  await page.waitForTimeout(200)
  await expect(page.locator('.home-tool-card[data-front]')).toHaveCount(1)
  const frontCard = page.locator('.home-tool-card[data-front]').first()
  await expect(frontCard).toHaveCSS('will-change', 'auto')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const frontToolBeforePause = await frontCard.getAttribute('data-tool')
  const activeIndexBeforeAutoStep = Number(await carousel.getAttribute('data-active-index'))
  const transformWhilePaused = await frontCard.evaluate((card) => getComputedStyle(card).transform)
  await page.waitForTimeout(3_300)
  await expect.poll(() => frontCard.evaluate((card) => getComputedStyle(card).transform)).toBe(transformWhilePaused)
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(3_300)
  await expect(page.locator('.home-tool-card[data-front]').first()).not.toHaveAttribute('data-tool', frontToolBeforePause ?? '')
  const activeIndexAfterAutoStep = Number(await carousel.getAttribute('data-active-index'))
  expect((activeIndexAfterAutoStep - activeIndexBeforeAutoStep + 6) % 6).toBe(5)
  const carouselAppearance = await carousel.evaluate((orbit) => {
    const cards = [...orbit.querySelectorAll<HTMLElement>('.home-tool-card')]
    return {
      cardCount: orbit.dataset.cardCount,
      radius: Number(orbit.dataset.ringRadius),
      opacities: cards.map((card) => ({ front: card.hasAttribute('data-front'), value: Number.parseFloat(getComputedStyle(card).opacity) })),
      perspective: getComputedStyle(orbit).perspective,
    }
  })
  expect(carouselAppearance.cardCount).toBe('6')
  expect(carouselAppearance.radius).toBeGreaterThan(0)
  expect(carouselAppearance.perspective).not.toBe('none')
  expect(carouselAppearance.opacities.find((card) => card.front)?.value).toBeGreaterThan(0.9)
  expect(Math.min(...carouselAppearance.opacities.map((card) => card.value))).toBeLessThan(0.7)
  const frontTool = await frontCard.getAttribute('data-tool')
  await frontCard.hover({ position: { x: 120, y: 50 } })
  await expect(page.locator('.particle-field')).toHaveAttribute('data-active-tool', frontTool ?? 'json')
  const transformBeforeWheel = await frontCard.evaluate((card) => getComputedStyle(card).transform)
  // Hold manual motion during the assertion so the configurable auto-step timer
  // cannot race the deliberate wheel input.
  await carousel.dispatchEvent('pointerdown', { pointerId: 6, pointerType: 'mouse', clientX: 680, clientY: 280, button: 0 })
  await carousel.dispatchEvent('wheel', { deltaY: 480, deltaMode: 0 })
  await expect(carousel).toHaveAttribute('data-transitioning', 'true')
  await page.waitForTimeout(120)
  const transformAfterWheel = await frontCard.evaluate((card) => getComputedStyle(card).transform)
  expect(transformAfterWheel).not.toBe(transformBeforeWheel)
  await expect.poll(() => carousel.getAttribute('data-transitioning')).toBeNull()
  const activeIndexAfterWheel = Number(await carousel.getAttribute('data-active-index'))
  // A real wheel may begin during the tail of a previous motion, so verify the
  // user-visible card update rather than relying on an internal phase index.
  expect(activeIndexAfterWheel).not.toBeNaN()
  await carousel.dispatchEvent('pointerup', { pointerId: 6, pointerType: 'mouse', clientX: 680, clientY: 280, button: 0 })
  await expect.poll(() => carousel.getAttribute('data-transitioning')).toBeNull()

  await carousel.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 680, clientY: 280, button: 0 })
  await expect(carousel).toHaveAttribute('data-drag-active', 'true')
  const transformBeforeTouch = await frontCard.evaluate((card) => getComputedStyle(card).transform)
  await carousel.dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: 500, clientY: 282, buttons: 1 })
  await expect.poll(
    () => frontCard.evaluate((card) => getComputedStyle(card).transform),
    { timeout: 400 },
  ).not.toBe(transformBeforeTouch)
  await carousel.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: 500, clientY: 282, button: 0 })
  await expect(carousel).not.toHaveAttribute('data-drag-active', 'true')
  await page.mouse.move(2, 2)
  await expect(page.locator('.particle-field')).not.toHaveAttribute('data-active-tool', frontTool ?? 'json')

  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await page.getByRole('tab', { name: '首页' }).click()
  await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'workbench')
  await page.getByRole('button', { name: '首页', exact: true }).click()
  await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'workbench')
})

test('application settings apply local performance, workspace and editor preferences', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await page.getByRole('button', { name: '固定标签' }).click()
  await page.getByRole('tab', { name: '首页' }).click()
  await page.getByRole('button', { name: '应用设置' }).click()
  const dialog = page.getByRole('dialog', { name: '应用设置' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('系统状态自动刷新')).toHaveValue('1')
  await expect(dialog.getByRole('radio', { name: '高质量', exact: true })).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('radio', { name: '均衡', exact: true }).click()
  await expect(page.locator('.particle-field')).toHaveAttribute('data-quality', 'balanced')
  await dialog.getByLabel('减少动态效果').check()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
  const carousel = page.locator('.home-tool-orbit')
  const indexBeforeReducedWait = await carousel.getAttribute('data-active-index')
  await page.waitForTimeout(2_000)
  await expect(carousel).toHaveAttribute('data-active-index', indexBeforeReducedWait ?? '0')
  await dialog.getByLabel('编辑器字号').selectOption('16')
  await dialog.getByLabel('自动换行').uncheck()
  await dialog.getByRole('radio', { name: '默认收起', exact: true }).click()
  await dialog.getByLabel('恢复固定标签').uncheck()
  const capture = dialog.getByRole('button', { name: '录入全局唤起快捷键' })
  if (testInfo.project.name === 'web') {
    await expect(capture).toBeDisabled()
    await expect(dialog.getByRole('status')).toContainText('网页环境由浏览器管理系统快捷键')
  } else {
    await capture.click()
    await page.keyboard.press('Control+Alt+F8')
    await expect(capture).toContainText('Ctrl + Alt + F8')
    await expect(dialog.getByRole('status')).toContainText('保存后立即生效')
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.waitForTimeout(420)
  await page.reload()
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
  await expect(page.locator('.workspace-tab[data-tool="json"]')).toHaveCount(0)
  await expect(page.locator('.particle-field')).toHaveAttribute('data-quality', 'balanced')
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  const editor = page.getByLabel('JSON 输入')
  await expect(editor).toHaveCSS('font-size', '16px')
  await expect(editor).toHaveCSS('white-space', 'pre')
  await page.getByRole('button', { name: '应用设置' }).click()
  const reopened = page.getByRole('dialog', { name: '应用设置' })
  await reopened.getByRole('radio', { name: '关闭', exact: true }).click()
  await expect(page.locator('.particle-field')).toHaveCount(0)
  await expect(page.locator('.particle-canvas')).toHaveCount(0)
})

test('application settings remain usable at the compact desktop minimum', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.goto('/')
  await page.getByRole('button', { name: '应用设置' }).click()
  const dialog = page.getByRole('dialog', { name: '应用设置' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radiogroup', { name: '背景粒子' })).toBeVisible()
  await expect(dialog.getByLabel('编辑器字号')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保存并启用' })).toBeVisible()
  await assertViewportIntegrity(page)
})

test('top-right language menu keeps locale names native and persists locally', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  const languageTrigger = page.getByRole('button', { name: '选择界面语言' })
  await expect(languageTrigger).toContainText('简体中文')
  const placement = await page.locator('.workspace-topbar').evaluate((topbar) => {
    const language = topbar.querySelector<HTMLElement>('.language-menu-trigger')?.getBoundingClientRect()
    const account = topbar.querySelector<HTMLElement>('.account-entry')?.getBoundingClientRect()
    return { language, account }
  })
  expect(placement.language).not.toBeNull()
  expect(placement.account).not.toBeNull()
  expect(placement.language!.right).toBeLessThanOrEqual(placement.account!.left + 1)

  await languageTrigger.click()
  const menu = page.getByRole('menu', { name: '选择界面语言' })
  await expect(menu.getByRole('menuitemradio', { name: '简体中文' })).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'false')
  await page.locator('.tab-strip').click()
  await expect(menu).toBeHidden()

  await languageTrigger.click()
  await menu.getByRole('menuitemradio', { name: 'English' }).click()

  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await expect(page.getByText('Choose a tool and continue your work.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Select interface language' })).toContainText('English')
  await page.getByRole('button', { name: 'Select interface language' }).click()
  const englishMenu = page.getByRole('menu', { name: 'Select interface language' })
  await expect(englishMenu.getByRole('menuitemradio', { name: '简体中文' })).toHaveAttribute('aria-checked', 'false')
  await expect(englishMenu.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
  await page.locator('.tab-strip').click()
  await page.getByRole('button', { name: 'Application settings' }).click()
  const settingsDialog = page.getByRole('dialog', { name: 'Application settings' })
  await expect(settingsDialog.getByRole('radio', { name: '简体中文' })).toBeVisible()
  await expect(settingsDialog.getByRole('radio', { name: 'English' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('devtoolkit.browser.state.v1')?.includes('en-US') ?? false)).toBe(true)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await expect(page.getByText('Choose a tool and continue your work.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Select interface language' })).toContainText('English')
})

test('expanded sidebar shows complete application and WebView2 versions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.goto('/')
  const expandSidebar = page.getByRole('button', { name: '展开侧栏' })
  if (await expandSidebar.count()) await expandSidebar.click()

  const runtime = page.locator('.brand-row .sidebar-runtime')
  const version = runtime.locator('.runtime-version')
  const environment = runtime.locator(':scope > small')
  await expect(version).toContainText(`v${appVersion}`)
  await environment.evaluate((element) => { element.textContent = 'WebView2 139.0.3405.125' })

  const measurements = await runtime.evaluate((element) => {
    const environment = element.querySelector<HTMLElement>(':scope > small')
    return {
      runtime: { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth },
      environment: environment ? { clientWidth: environment.clientWidth, scrollWidth: environment.scrollWidth } : null,
    }
  })
  expect(measurements.runtime.scrollWidth, JSON.stringify(measurements)).toBeLessThanOrEqual(measurements.runtime.clientWidth + 1)
  expect(measurements.environment).not.toBeNull()
  expect(measurements.environment?.scrollWidth, JSON.stringify(measurements)).toBeLessThanOrEqual((measurements.environment?.clientWidth ?? 0) + 1)
  const placement = await page.locator('.app-sidebar').evaluate((sidebar) => {
    const brand = sidebar.querySelector<HTMLElement>('.brand-row')?.getBoundingClientRect()
    const runtime = sidebar.querySelector<HTMLElement>('.sidebar-runtime')?.getBoundingClientRect()
    const home = sidebar.querySelector<HTMLElement>('.sidebar-home')?.getBoundingClientRect()
    const footer = sidebar.querySelector<HTMLElement>('.sidebar-footer')?.getBoundingClientRect()
    return { brand, runtime, home, footer }
  })
  expect(placement.brand).not.toBeNull()
  expect(placement.runtime).not.toBeNull()
  expect(placement.home).not.toBeNull()
  expect(placement.footer).not.toBeNull()
  expect(placement.runtime!.top).toBeGreaterThan(placement.brand!.top)
  expect(placement.runtime!.bottom).toBeLessThanOrEqual(placement.brand!.bottom)
  expect(placement.runtime!.bottom).toBeLessThanOrEqual(placement.home!.top)
  expect(placement.runtime!.top).toBeLessThan(placement.footer!.top)
  await assertViewportIntegrity(page)

  mkdirSync(qaDir, { recursive: true })
  await page.screenshot({ path: resolve(qaDir, `sidebar-runtime-${testInfo.project.name || 'desktop'}.png`), fullPage: true })
})

test('Escape hides the desktop shell through the fixed tray bridge', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'web', 'The browser build intentionally has no tray bridge.')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.evaluate(() => {
    window.pywebview = {
      api: {
        hide_to_tray: async () => {
          document.documentElement.dataset.trayBridgeCalled = 'true'
          return { ok: true, data: null }
        },
      },
    }
  })
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-tray-bridge-called', 'true')
})

test('calculator and system status remain usable in the local workbench', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const systemStatus = page.getByRole('region', { name: '系统状态', exact: true })
  await expect(systemStatus).toBeVisible()
  await page.getByRole('button', { name: '刷新系统状态' }).click()
  await expect(systemStatus).toContainText(/同步服务/)

  await page.getByRole('button', { name: '超级计算器', exact: true }).click()
  await page.getByLabel('科学计算表达式').fill('sqrt(2)^2 + sin(pi / 2)')
  await page.getByRole('button', { name: '计算', exact: true }).click()
  await expect(page.locator('.calculator-result-stage code')).toHaveText('3')
  await page.getByRole('radio', { name: '程序员', exact: true }).click()
  await page.getByLabel('程序员输入整数').fill('FF')
  await page.getByLabel('程序员输入进制').selectOption('16')
  await expect(page.locator('.calculator-base-grid code').nth(2)).toHaveText('255')
  await page.getByRole('radio', { name: '金融/日期', exact: true }).click()
  await page.getByLabel('本金金额').fill('100')
  await page.getByLabel('年利率').fill('10')
  await page.getByLabel('期数').fill('2')
  await expect(page.locator('.calculator-inline-result code')).toHaveText('121')
  await page.getByRole('radio', { name: '工程', exact: true }).click()
  await expect(page.locator('.calculator-inline-result code')).toHaveText('-2')

  await page.getByRole('radio', { name: '科学', exact: true }).click()
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await expect(page.getByRole('button', { name: '清空', exact: true })).toHaveCSS('color', 'rgb(25, 27, 31)')
  mkdirSync(qaDir, { recursive: true })
  await page.screenshot({ path: resolve(qaDir, 'calculator-workbench-light.png'), fullPage: true })
})

test('clipboard history remains discoverable but desktop-only in the web build', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'web', 'Desktop build exercises the real clipboard bridge.')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.context().route('https://gitee.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Desktop download</title>' }))
  await page.goto('/')
  await page.getByRole('button', { name: '剪切板历史', exact: true }).click()
  await expect(page.getByText('剪切板历史仅 Windows 桌面版可用')).toBeVisible()
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: '下载 Windows 桌面版' }).click()
  const popup = await popupPromise
  await popup.waitForURL('https://gitee.com/i-_-kaikai/kaitools/releases')
  await popup.close()
})

test('ring geometry stays compact across card counts and viewports', async ({ page }) => {
  const toolIds = ['json', 'java', 'timestamp', 'base64-text', 'cron', 'notes', 'json-diff', 'json-java', 'base64-image', 'base64-file', 'sql', 'yaml', 'xml', 'text-diff', 'text-stats', 'regex', 'hosts', 'md5']
  const scenarios = [
    { count: 1, viewport: { width: 960, height: 640 } },
    { count: 2, viewport: { width: 1280, height: 800 } },
    { count: 3, viewport: { width: 1920, height: 1080 } },
    { count: 6, viewport: { width: 3440, height: 1440 } },
    { count: toolIds.length, viewport: { width: 390, height: 844 } },
  ]

  await page.goto('/')
  for (const scenario of scenarios) {
    await page.setViewportSize(scenario.viewport)
    const cards = toolIds.slice(0, scenario.count).map((toolId, index) => ({
      id: `geometry-${toolId}`,
      toolId,
      title: toolId,
      description: toolId,
      accentColor: '#35d0a7',
      sortOrder: index,
      enabled: true,
    }))
    await page.evaluate((dashboardCards) => {
      localStorage.setItem('devtoolkit.browser.state.v1', JSON.stringify({ dashboardCards }))
    }, { schemaVersion: 1, carouselMode: 'step', classicRotationSpeed: 16, stepIntervalMs: 1600, cards })
    await page.reload()
    const carousel = page.locator('.home-tool-orbit')
    await expect(page.locator('.home-tool-card')).toHaveCount(scenario.count)
    const geometry = await carousel.evaluate((orbit) => {
      const stage = orbit.getBoundingClientRect()
      const cards = [...orbit.querySelectorAll<HTMLElement>('.home-tool-card')].map((card) => {
        const rect = card.getBoundingClientRect()
        return {
          front: card.hasAttribute('data-front'),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          center: rect.left + rect.width / 2,
          width: rect.width,
        }
      })
      const front = cards.find((card) => card.front)
      if (!front) return null
      const left = cards.filter((card) => card.center < front.center - 1).sort((a, b) => b.center - a.center)[0]
      const right = cards.filter((card) => card.center > front.center + 1).sort((a, b) => a.center - b.center)[0]
      return {
        cardCount: Number(orbit.dataset.cardCount),
        radius: Number(orbit.dataset.ringRadius),
        frontWithinStage: front.left >= stage.left - 1 && front.right <= stage.right + 1 && front.top >= stage.top - 1 && front.bottom <= stage.bottom + 1,
        neighborGap: Math.max(0, ...(left ? [front.left - left.right] : []), ...(right ? [right.left - front.right] : [])),
        frontWidth: front.width,
      }
    })
    expect(geometry).not.toBeNull()
    expect(geometry?.cardCount).toBe(scenario.count)
    expect(geometry?.frontWithinStage).toBe(true)
    if (scenario.count === 1) expect(geometry?.radius).toBe(0)
    else expect(geometry?.radius).toBeGreaterThan(0)
    if (scenario.count >= 3) expect(geometry?.neighborGap).toBeLessThanOrEqual((geometry?.frontWidth ?? 0) * 0.25)
  }
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
  await page.getByRole('button', { name: '浅色' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: resolve(qaDir, 'json-graph-desktop-dark.png'), fullPage: true })
})

test('new conversion, formatting and analysis tools produce results', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  await openWorkspaceTool(page, 'Base64 文本')
  await page.getByLabel('Base64 文本输入').fill('你好')
  await expect(page.getByLabel('Base64 文本结果')).toContainText('5L2g5aW9')

  await openWorkspaceTool(page, 'SQL 美化')
  await page.getByLabel('SQL 输入').fill('select id,name from users where enabled=1')
  await expect(page.getByLabel('SQL 格式化结果')).toContainText('SELECT')

  await openWorkspaceTool(page, 'JSON 对比')
  await expect(page.getByLabel('JSON 差异结果')).toHaveCount(0)
  await expect(page.getByLabel('左侧 JSON').locator('.cm-diff-mark-removed')).toBeVisible()
  await expect(page.getByLabel('右侧 JSON').locator('.cm-diff-mark-added')).toBeVisible()
  await expect(page.getByLabel('左侧 JSON').locator('.cm-diff-mark-removed')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  await openWorkspaceTool(page, '文本比较')
  await expect(page.getByLabel('文本差异结果')).toHaveCount(0)
  await expect(page.getByLabel('左侧文本').locator('.cm-diff-mark-removed')).toBeVisible()
  await expect(page.getByLabel('右侧文本').locator('.cm-diff-mark-added')).toBeVisible()

  await openWorkspaceTool(page, '文本统计')
  await page.getByLabel('文本统计输入').fill('你好 KAITools')
  await expect(page.getByLabel('文本统计结果')).toContainText('UTF-8 字节')
  await assertViewportIntegrity(page)
})

test('all tools render and remain usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  for (const tool of ['JSON / JavaBean', 'Java 转义', '日期转换', 'Base64 图片', 'Base64 文件', 'Crontab 生成器', 'YAML 美化', 'XML 格式化', '文本比较', 'Hosts', '哈希摘要']) {
    await openWorkspaceTool(page, tool)
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
  await page.screenshot({ path: resolve(qaDir, 'home-launchpad-mobile-light.png'), fullPage: true })

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
    await openWorkspaceTool(page, item.tool)
    await page.getByLabel(item.inputLabel).fill(item.input)
    const output = page.getByLabel(item.outputLabel)
    await expect(output).toContainText(item.generated)
    await output.fill(`edited ${item.tool}`)
    await expect(output).toContainText(`edited ${item.tool}`)
    await expect(page.getByRole('separator', { name: '调整左右编辑区域大小' })).toBeVisible()
  }

  await openWorkspaceTool(page, 'Java 转义')
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
  await expect(page.locator('.home-launchpad')).toBeVisible()
  const collapsedCenters = await page.locator('.app-sidebar').evaluate((sidebar) => {
    const selectors = ['.sidebar-home', '.sidebar-search-button', '.tool-nav-row .tool-nav-main', '.sidebar-manage-row .tool-nav-main']
    return selectors.map((selector) => {
      const rect = sidebar.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
      return rect ? rect.left + rect.width / 2 : -1
    })
  })
  expect(Math.max(...collapsedCenters) - Math.min(...collapsedCenters)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: resolve(qaDir, 'repository-entry-sidebar-collapsed-light.png'), fullPage: true })
  const sidebarPopupPromise = page.waitForEvent('popup')
  await sidebarLink.click()
  const sidebarPopup = await sidebarPopupPromise
  await sidebarPopup.waitForURL('https://gitee.com/i-_-kaikai/kaitools')
  await sidebarPopup.close()
  const githubSidebarPopupPromise = page.waitForEvent('popup')
  await githubSidebarLink.click()
  const githubSidebarPopup = await githubSidebarPopupPromise
  await githubSidebarPopup.waitForURL('https://github.com/i-kaikai/KAItools')
  await githubSidebarPopup.close()

  await page.getByRole('button', { name: '展开侧栏' }).click()
  await expect(sidebarLink).toBeVisible()
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-collapsed/)
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'repository-entry-sidebar-expanded-light.png'), fullPage: true })

  await page.getByRole('button', { name: '首页', exact: true }).click()
  await expect(page.locator('.particle-field')).toHaveAttribute('data-stage', 'workbench')
  const homeRepositoryLink = page.locator('.home-system').getByRole('button', { name: '打开 Gitee 仓库' })
  const githubHomeRepositoryLink = page.locator('.home-system').getByRole('button', { name: '打开 GitHub 仓库' })
  await expect(homeRepositoryLink).toContainText('i-_-kaikai/kaitools')
  await expect(githubHomeRepositoryLink).toContainText('i-kaikai/KAItools')
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
  await githubHomePopup.waitForURL('https://github.com/i-kaikai/KAItools')
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

  await page.getByRole('button', { name: '展开侧栏' }).click()
  const sidebarInput = page.getByLabel('筛选工具')
  await expect(page.locator('.tool-search > svg')).toHaveCount(0)
  await expect(page.locator('.tool-search .tool-search-open svg')).toHaveCount(1)
  await expect(page.locator('.tool-search kbd')).toHaveText('Ctrl K')
  await sidebarInput.fill('日期')
  await expect(page.locator('.tool-nav-row')).toHaveCount(1)
  await expect(page.locator('.tool-nav-row')).toContainText('日期转换')
  await expect(page.getByRole('dialog', { name: '搜索工具' })).toBeHidden()
  await page.screenshot({ path: resolve(qaDir, 'sidebar-inline-search-desktop-light.png'), fullPage: true })
  await page.locator('.tool-search-open').click()

  const dialog = page.getByRole('dialog', { name: '搜索工具' })
  const input = page.getByLabel('输入工具名称、用途或关键词')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('transition-duration', '0s')
  await input.fill('定时')
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect(page.getByRole('option')).toContainText('生成并校验 Cron 表达式')
  await expect(page.getByRole('option')).toContainText('开发辅助')
  await page.screenshot({ path: resolve(qaDir, 'tool-search-desktop-light.png'), fullPage: true })
  await input.press('Enter')
  await expect(page.getByRole('heading', { name: 'Crontab 生成器' })).toBeVisible()
  await expect(dialog).toBeHidden()

  await page.keyboard.press('Control+k')
  await input.fill('没有这个工具')
  await expect(page.getByText('没有找到匹配工具')).toBeVisible()
  await expect(page.getByText('可以尝试“格式化”“日期”“编码”等关键词')).toBeVisible()
  await input.press('Escape')
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: '收起侧栏' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.sidebar-search-button').click()
  await expect(dialog).toBeVisible()
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'tool-search-mobile-light.png'), fullPage: true })
})

test('editor selection highlights only the real partial range above semantic marks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await openWorkspaceTool(page, 'Java 转义')
  const editor = page.getByLabel('Java 转义输入')
  await editor.fill('alpha alpha alpha')
  await editor.click()
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('Shift+ArrowRight')
  const selection = editor.locator('..').locator('.cm-selectionLayer .cm-selectionBackground')
  await expect(selection).toHaveCount(1)
  const selectionVisual = await selection.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, background: getComputedStyle(element).backgroundColor, zIndex: getComputedStyle(element.parentElement!).zIndex }
  })
  expect(selectionVisual.width).toBeGreaterThan(20)
  expect(selectionVisual.width).toBeLessThan(80)
  expect(selectionVisual.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(Number(selectionVisual.zIndex)).toBeGreaterThanOrEqual(4)
  const matchMarkers = editor.locator('.cm-selectionMatch')
  if (await matchMarkers.count()) await expect(matchMarkers.first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  await openWorkspaceTool(page, '文本比较')
  const diffEditor = page.getByLabel('左侧文本')
  await diffEditor.fill('alpha alpha alpha')
  await diffEditor.click()
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('Shift+ArrowRight')
  await expect(diffEditor.locator('..').locator('.cm-selectionLayer .cm-selectionBackground')).toHaveCount(1)
  await expect(diffEditor.locator('.cm-diff-mark-removed').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('editor search panel is localized and docks above code content', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'JSON', exact: true }).click()

  const editor = page.getByLabel('JSON 输入')
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('ready\nready\nready')
  await page.keyboard.press('Control+f')

  const panel = page.locator('.code-editor .cm-panel.cm-search').filter({ has: page.locator('input[name=search]') })
  const status = panel.locator('.cm-search-status')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveCSS('position', 'relative')
  await expect(status).toHaveText('输入关键词')
  await expect(panel.getByLabel('替换为')).toBeVisible()
  await expect(panel.getByRole('button', { name: '上一个' })).toBeVisible()
  await expect(panel.getByRole('button', { name: '下一个' })).toBeVisible()
  await expect(panel.getByRole('button', { name: '全选匹配项' })).toBeVisible()
  await expect(panel.getByLabel('区分大小写')).toBeVisible()
  await expect(panel.getByLabel('正则表达式')).toBeVisible()
  await expect(panel.getByLabel('全字匹配')).toBeVisible()

  await panel.locator('input[name=search]').fill('ready')
  await expect(status).toHaveText('未定位，共 3 个')
  await panel.getByRole('button', { name: '下一个' }).click()
  await expect(status).toHaveText('第 1 个，共 3 个')
  await panel.getByRole('button', { name: '下一个' }).click()
  await expect(status).toHaveText('第 2 个，共 3 个')
  await panel.getByRole('button', { name: '上一个' }).click()
  await expect(status).toHaveText('第 1 个，共 3 个')
  await panel.getByRole('button', { name: '上一个' }).click()
  await expect(status).toHaveText('第 3 个，共 3 个')

  await panel.locator('input[name=search]').fill('missing')
  await expect(status).toHaveText('无匹配项')
  await expect(panel.getByRole('button', { name: '下一个' })).toBeDisabled()
  await expect(panel.getByRole('button', { name: '替换', exact: true })).toBeDisabled()

  await panel.getByLabel('正则表达式').check()
  await panel.locator('input[name=search]').fill('[')
  await expect(status).toHaveText('正则表达式无效')
  await expect(panel.getByRole('button', { name: '全选匹配项' })).toBeDisabled()
  await panel.getByLabel('正则表达式').uncheck()
  await panel.locator('input[name=search]').fill('ready')
  await expect(status).toHaveText('第 3 个，共 3 个')

  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\nready')
  await expect(status).toHaveText('未定位，共 4 个')

  await panel.getByLabel('替换为').fill('就绪')
  await panel.getByRole('button', { name: '全部替换' }).click()
  await expect(editor).toContainText('就绪')
  const panelBox = await panel.boundingBox()
  const firstLineBox = await editor.locator('.cm-line').first().boundingBox()
  expect(panelBox).not.toBeNull()
  expect(firstLineBox).not.toBeNull()
  expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeLessThanOrEqual((firstLineBox?.y ?? 0) + 1)
  await assertViewportIntegrity(page)
  await page.screenshot({ path: resolve(qaDir, 'editor-search-count-light.png'), fullPage: true })

  await panel.locator('input[name=search]').press('Escape')
  await expect(panel).toBeHidden()
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

test('account entry remains fixed at the top right and detects the configured service', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.context().route('https://tools.imkai.top/api/health', (route) => route.fulfill({
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '', 'access-control-allow-credentials': 'true' },
    body: JSON.stringify({ ok: true, data: { status: 'ready', mode: 'api' } }),
  }))
  await page.goto('/')
  const accountEntry = page.locator('.workspace-topbar .account-entry')
  await expect(accountEntry).toBeVisible()
  await expect(accountEntry).toContainText('本地模式')
  await accountEntry.click()
  const dialog = page.getByRole('dialog', { name: '账户与同步' })
  await expect(dialog).toBeVisible()
  const email = dialog.getByLabel('邮箱')
  await expect(email).toBeEnabled()
  await email.fill('local@example.test')
  await expect(email).toHaveValue('local@example.test')
  await expect(dialog.getByPlaceholder('http://127.0.0.1:8080')).toHaveCount(0)
  await expect(dialog).toContainText('LOCAL-FIRST')
  const bounds = await dialog.evaluate((element) => element.getBoundingClientRect())
  expect(bounds.right).toBeLessThanOrEqual(1280)
  expect(bounds.top).toBeGreaterThanOrEqual(48)
  await assertViewportIntegrity(page)
})

test('developer mode unlocks from the version and exposes local service tools', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.route('**/api/health', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { status: 'ready', mode: 'api' } }),
  }))
  await page.goto('/')
  await page.getByRole('button', { name: '展开侧栏' }).click()
  const version = page.locator('.runtime-version')
  await expect(version).toBeVisible()
  if (testInfo.project.name === 'web') {
    await expect(version).not.toContainText('DEV')
    for (let click = 0; click < 6; click += 1) await version.click()
    await expect(page.getByRole('dialog', { name: '开发者模式' })).toHaveCount(0)
    await version.click()
  } else {
    await version.click()
  }
  const dialog = page.getByRole('dialog', { name: '开发者模式' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('http://127.0.0.1:8080')).toBeEditable()
  await dialog.getByRole('button', { name: '测试连接' }).click()
  await expect(dialog.getByRole('status')).toContainText('服务已就绪 · ready')
  if (testInfo.project.name === 'web') {
    await expect(dialog).toContainText('浏览器请使用 F12')
    await dialog.getByRole('button', { name: '完成' }).click()
    await page.reload()
    const expandSidebar = page.getByRole('button', { name: '展开侧栏' })
    if (await expandSidebar.count()) await expandSidebar.click()
    await expect(page.locator('.runtime-version')).toContainText('DEV')
  } else {
    await expect(dialog).toContainText('打开 WebView2 DevTools')
  }
})

test('binary Base64 tools and hash digest support both directions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  await openWorkspaceTool(page, 'Base64 图片')
  const imageEncodedOutput = page.getByLabel('图片 Base64 编码结果')
  await expect(imageEncodedOutput).toBeVisible()
  await page.evaluate(() => {
    const image = new File(
      [Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J1bQAAAAASUVORK5CYII='), (value) => value.charCodeAt(0))],
      'clipboard-image.png',
    )
    const clipboard = new DataTransfer()
    clipboard.items.add(image)
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: clipboard })
    window.dispatchEvent(paste)
  })
  await expect(imageEncodedOutput).toContainText('iVBORw0KGgo')
  await page.getByRole('radio', { name: 'Base64 转图片' }).click()
  await page.getByLabel('图片 Base64 输入').fill('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J1bQAAAAASUVORK5CYII=')
  await expect(page.getByAltText('Base64 解码预览')).toBeVisible()

  await openWorkspaceTool(page, 'Base64 文件')
  await page.getByRole('radio', { name: 'Base64 转文件' }).click()
  await page.getByLabel('文件 Base64 输入').fill('aGVsbG8=')
  await expect(page.getByText('5 字节，可下载还原')).toBeVisible()

  await openWorkspaceTool(page, '哈希摘要')
  await page.getByLabel('哈希算法').selectOption('sha256')
  await page.getByLabel('哈希文本输入').fill('abc')
  await expect(page.getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', { exact: true })).toBeVisible()
  await assertViewportIntegrity(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await openWorkspaceTool(page, 'Base64 图片')
  await page.getByRole('radio', { name: '图片转 Base64' }).click()
  await page.getByRole('button', { name: '清空当前内容' }).click()
  await expect(page.getByText('选择或直接粘贴图片，生成 Base64')).toBeVisible()
  await assertViewportIntegrity(page)
})

test('local account panel connects and registers against the test service', async ({ page }) => {
  test.skip(process.env.KAITOOLS_LOCAL_INTEGRATION !== 'true', 'Requires a locally configured PostgreSQL-backed KAITools API service.')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: '展开侧栏' }).click()
  await page.locator('.runtime-version').click()
  const developerDialog = page.getByRole('dialog', { name: '开发者模式' })
  await developerDialog.getByLabel('使用本机服务覆盖服务器').check()
  await developerDialog.getByRole('button', { name: '测试连接' }).click()
  await expect(developerDialog).toContainText('服务已就绪')
  await developerDialog.getByRole('button', { name: '完成' }).click()
  await page.locator('.workspace-topbar .account-entry').click()
  const dialog = page.getByRole('dialog', { name: '账户与同步' })
  await dialog.getByRole('tab', { name: '注册' }).click()
  const email = `playwright-${Date.now()}@example.test`
  await dialog.getByLabel('邮箱').fill(email)
  await dialog.getByLabel('显示名称').fill('本地联调')
  await dialog.getByLabel('密码').fill('LocalTestingPass123')
  await dialog.getByRole('button', { name: '获取验证码' }).click()
  const codeMessage = dialog.locator('.account-auth-hint')
  await expect(codeMessage).toContainText('测试验证码')
  const code = (await codeMessage.textContent())?.match(/(\d{6})/)?.[1]
  expect(code).toBeTruthy()
  await dialog.getByPlaceholder('6 位验证码').fill(code!)
  await dialog.getByRole('button', { name: '注册并登录' }).click()
  await expect(dialog).toContainText('本地联调')
  await expect(page.locator('.workspace-topbar .account-entry')).toContainText('本地联调')
})
