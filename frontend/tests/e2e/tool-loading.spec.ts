import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const qaDir = resolve(import.meta.dirname, '../../../build/qa')

test.beforeAll(() => mkdirSync(qaDir, { recursive: true }))

test('shows a loading state while a tool module is still downloading', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'KAITools' })).toBeVisible()

  await page.route('**/assets/JsonTool-*.js', async (route) => {
    await new Promise<void>((resolve) => setTimeout(resolve, 650))
    await route.continue()
  })

  const expandSidebar = page.getByRole('button', { name: '展开侧栏' })
  if (await expandSidebar.count()) await expandSidebar.click()
  await page.locator('.tool-nav').getByRole('button', { name: 'JSON', exact: true }).click()

  await expect(page.getByRole('status', { name: '正在装载工具' })).toBeVisible()
  await expect(page.locator('.tool-loading-state')).toBeVisible()
  await page.screenshot({ path: resolve(qaDir, `tool-loading-light-${testInfo.project.name}.png`), fullPage: true })

  await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'))
  await expect(page.locator('.tool-loading-state')).toBeVisible()
  await page.screenshot({ path: resolve(qaDir, `tool-loading-dark-${testInfo.project.name}.png`), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.tool-loading-state')).toBeVisible()
  await page.screenshot({ path: resolve(qaDir, `tool-loading-mobile-${testInfo.project.name}.png`), fullPage: true })
  await expect(page.getByRole('heading', { name: 'JSON' })).toBeVisible()
})
