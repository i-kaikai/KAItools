import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const qaDir = resolve(import.meta.dirname, '../../../build/qa')

test.beforeAll(() => mkdirSync(qaDir, { recursive: true }))

async function openSqlTool(page: Page): Promise<void> {
  const shortcut = page.locator('.tool-nav').getByRole('button', { name: 'SQL 美化与转换', exact: true })
  if (await shortcut.count()) {
    await shortcut.first().click()
    return
  }
  await page.getByRole('button', { name: '搜索工具' }).click()
  await page.getByLabel('输入工具名称、用途或关键词').fill('SQL 美化与转换')
  await page.getByRole('dialog', { name: '搜索工具' }).getByRole('option').filter({ hasText: 'SQL 美化与转换' }).first().click()
}

async function expectNoSqlLayoutOverlap(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('.tool-header > div:first-child')?.getBoundingClientRect()
    const toolbar = document.querySelector<HTMLElement>('.tool-header .toolbar')?.getBoundingClientRect()
    const report = document.querySelector<HTMLElement>('.sql-conversion-report')?.getBoundingClientRect()
    const split = document.querySelector<HTMLElement>('.editor-split')?.getBoundingClientRect()
    const overlaps = (left?: DOMRect, right?: DOMRect) => Boolean(left && right && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top)
    return {
      titleToolbar: overlaps(title, toolbar),
      reportEditors: overlaps(report, split),
      documentWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
    }
  })
  expect(layout.titleToolbar).toBe(false)
  expect(layout.reportEditors).toBe(false)
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
}

test('converts MySQL to Oracle locally and remains usable across viewports', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await openSqlTool(page)

  await page.getByLabel('源数据库', { exact: true }).selectOption('mysql')
  await page.getByLabel('目标数据库', { exact: true }).selectOption('oracle')
  await page.getByLabel('SQL 输入').fill("select `id`, ifnull(name, '') from `users` order by id limit 5, 10")

  const output = page.getByLabel('SQL 格式化结果')
  await expect(output).toContainText('NVL')
  await expect(output).toContainText('OFFSET 5 ROWS')
  await expect(output).toContainText('FETCH FIRST 10 ROWS ONLY')
  await expect(page.locator('.sql-conversion-report')).toContainText('分页语法')
  await expect(page.getByRole('heading', { name: 'SQL 美化与转换' })).toBeVisible()
  await expectNoSqlLayoutOverlap(page)
  await page.screenshot({ path: resolve(qaDir, 'sql-converter-desktop.png'), fullPage: true })

  await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'))
  await expectNoSqlLayoutOverlap(page)
  await page.screenshot({ path: resolve(qaDir, 'sql-converter-dark.png'), fullPage: true })
  await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'light'))

  await page.setViewportSize({ width: 900, height: 700 })
  await expectNoSqlLayoutOverlap(page)
  await page.screenshot({ path: resolve(qaDir, 'sql-converter-compact.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoSqlLayoutOverlap(page)
  await page.screenshot({ path: resolve(qaDir, 'sql-converter-mobile.png'), fullPage: true })

  await page.getByRole('button', { name: '交换源与目标数据库' }).click()
  await expect(page.getByLabel('源数据库', { exact: true })).toHaveValue('oracle')
  await expect(page.getByLabel('目标数据库', { exact: true })).toHaveValue('mysql')
  await expect.poll(async () => (await output.locator('.cm-line').allTextContents()).join(' ')).toMatch(/LIMIT\s+10\s+OFFSET\s+5/)
  await expect(output).toContainText('IFNULL')
})

test('converts representative PostgreSQL, SQL Server and Oracle DDL in the UI', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await openSqlTool(page)

  const source = page.getByLabel('源数据库', { exact: true })
  const target = page.getByLabel('目标数据库', { exact: true })
  const input = page.getByLabel('SQL 输入')
  const output = page.getByLabel('SQL 格式化结果')
  await expect(source.locator('option')).toHaveCount(7)
  const options = await source.locator('option').evaluateAll((elements) => elements.map((element) => ({
    label: element.textContent,
    value: (element as HTMLOptionElement).value,
  })))
  expect(options).toEqual([
    { label: '标准 SQL', value: 'standard' },
    { label: 'MySQL', value: 'mysql' },
    { label: 'MariaDB', value: 'mariadb' },
    { label: 'PostgreSQL', value: 'postgresql' },
    { label: 'Oracle', value: 'oracle' },
    { label: 'SQL Server', value: 'sqlserver' },
    { label: 'SQLite', value: 'sqlite' },
  ])

  const cases = [
    {
      source: 'postgresql',
      target: 'mysql',
      sql: 'CREATE TABLE users (id BIGSERIAL PRIMARY KEY, enabled BOOLEAN);',
      expected: /BIGINT\s+AUTO_INCREMENT\s+PRIMARY KEY[\s\S]*TINYINT\(1\)/i,
    },
    {
      source: 'sqlserver',
      target: 'sqlite',
      sql: 'CREATE TABLE users (id BIGINT IDENTITY(1,1) PRIMARY KEY, enabled BIT);',
      expected: /INTEGER\s+PRIMARY KEY\s+AUTOINCREMENT[\s\S]*enabled\s+INTEGER/i,
    },
    {
      source: 'oracle',
      target: 'postgresql',
      sql: 'CREATE TABLE users (id NUMBER(19) GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name VARCHAR2(80));',
      expected: /DECIMAL\(19\)[\s\S]*GENERATED BY DEFAULT AS IDENTITY[\s\S]*VARCHAR\(80\)/i,
    },
  ]

  for (const item of cases) {
    await source.selectOption(item.source)
    await target.selectOption(item.target)
    await input.fill(item.sql)
    await expect.poll(async () => (await output.locator('.cm-line').allTextContents()).join(' ')).toMatch(item.expected)
    await expect(page.locator('.sql-conversion-report')).toContainText('已转换')
  }
})
