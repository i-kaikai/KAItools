import { expect, test } from '@playwright/test'

test('date calculator is searchable and handles workdays, countdowns, and age details', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.keyboard.press('Control+k')
  const search = page.locator('.tool-search-dialog input[type="search"]')
  await search.fill('日期计算器')
  await page.getByRole('option').filter({ hasText: '日期计算器' }).click()
  await expect(page.getByRole('heading', { name: '日期计算器' })).toBeVisible()

  await page.route('https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2026.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      year: 2026,
      papers: ['https://www.gov.cn/zhengce/holiday-notice.htm'],
      days: [{ name: '补班', date: '2026-01-03', isOffDay: false }],
    }),
  }))
  await page.getByRole('textbox', { name: '开始日期' }).fill('2026-01-02')
  await page.getByRole('spinbutton', { name: '日期偏移量' }).fill('1')
  await page.getByRole('combobox', { name: '计算方式' }).selectOption('workdays')
  await expect(page.locator('.date-calculator-result code')).toHaveText('2026-01-03')
  await expect(page.getByText('数据来源', { exact: true })).toBeVisible()

  await page.getByRole('radio', { name: '日期倒计时' }).click()
  await page.getByRole('textbox', { name: '倒计时目标日期和时间' }).fill('2099-01-01T00:00')
  await expect(page.locator('.date-countdown-display')).toContainText('剩余')
  await expect(page.locator('.date-countdown-display strong').first()).not.toHaveText('0')

  await page.getByRole('radio', { name: '年龄与日期信息' }).click()
  await page.getByRole('textbox', { name: '出生日期' }).fill('2000-02-29')
  await page.getByRole('textbox', { name: '年龄截至日期' }).fill('2025-02-28')
  await expect(page.locator('.date-age-result')).toContainText('25 岁 0 个月 0 天')
  await expect(page.locator('.date-information-grid')).toContainText('闰年')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: '日期计算器' })).toBeVisible()
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
})
