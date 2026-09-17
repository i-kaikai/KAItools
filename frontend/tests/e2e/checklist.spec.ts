import { expect, test } from '@playwright/test'

async function openChecklist(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: '搜索工具' }).click()
  const dialog = page.getByRole('dialog', { name: '搜索工具' })
  await page.getByLabel('输入工具名称、用途或关键词').fill('清单工作台')
  await dialog.getByRole('option').filter({ hasText: '清单工作台' }).first().click()
  await expect(dialog).toBeHidden()
}

test('checklist supports local capture, completion, and multiple lists', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await openChecklist(page)
  await expect(page.getByRole('heading', { name: '清单工作台', exact: true })).toBeVisible()

  const quickAdd = page.locator('input[aria-label="添加清单条目"]')
  await quickAdd.fill('准备接口联调清单')
  await quickAdd.press('Enter')
  await expect(page.getByRole('button', { name: '准备接口联调清单', exact: true })).toBeVisible()

  await page.getByRole('checkbox', { name: '完成：准备接口联调清单' }).click()
  await expect(page.locator('.checklist-smart-nav')).toContainText('已完成')
  await page.locator('.checklist-smart-nav').getByRole('button', { name: /已完成/ }).click()
  await expect(page.getByRole('button', { name: '准备接口联调清单', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '新建清单', exact: true }).click()
  await page.getByLabel('新清单名称').fill('发布前检查')
  await page.getByRole('button', { name: '保存新清单' }).click()
  await expect(page.locator('.checklist-list-nav')).toContainText('发布前检查')

  await page.getByRole('button', { name: '批量导入', exact: true }).click()
  await page.getByLabel('批量导入内容').fill('- 核对部署环境\n[ ] 检查发布版本')
  await page.getByLabel('导入分类').selectOption('__new__')
  await page.getByLabel('新分类名称').fill('发布前')
  await page.getByRole('button', { name: '导入条目', exact: true }).click()
  await expect(page.getByRole('button', { name: '核对部署环境', exact: true })).toBeVisible()
  await expect(page.locator('.checklist-section')).toContainText('发布前')

  await page.getByRole('button', { name: '批量导入', exact: true }).click()
  await page.getByLabel('批量导入内容').fill('记录临时事项')
  await page.getByLabel('导入分类').selectOption('')
  await page.getByRole('button', { name: '导入条目', exact: true }).click()
  await expect(page.locator('.checklist-section-toggle strong', { hasText: '无分类' })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: '清单工作台', exact: true })).toBeVisible()
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight)
  expect(fits).toBe(true)
})
