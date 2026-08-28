// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { localeOptions, messageKeys, setActiveLocale, t, translateForLocale } from '@/i18n'
import { useAppStore } from '@/stores/app'
import { defaultDashboardCards, localizeSystemDashboardCards } from '@/tools/home/dashboardCards'

describe('application localization', () => {
  afterEach(() => setActiveLocale('zh-CN'))

  it('keeps every shipped locale on the same message-key contract', () => {
    expect(messageKeys('en-US')).toEqual(messageKeys('zh-CN'))
  })

  it('switches document language and resolves localized messages', () => {
    setActiveLocale('en-US')

    expect(document.documentElement.lang).toBe('en-US')
    expect(t('settings.title')).toBe('Application settings')
    expect(translateForLocale('zh-CN', 'home.openedTools', { count: 2 })).toBe('已打开 2 个工具')
  })

  it('keeps locale choices in each language\'s own writing system', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      setActiveLocale(locale)
      expect(localeOptions.map((option) => option.nativeLabel)).toEqual(['简体中文', 'English'])
    }
  })

  it('updates stock Home cards while preserving custom card copy', () => {
    const cards = defaultDashboardCards('zh-CN')
    cards.cards[1]!.title = 'My custom Java tool'

    const localized = localizeSystemDashboardCards(cards, 'en-US')

    expect(localized.cards[0]).toMatchObject({ title: 'JSON', description: 'Format, minify, and graph JSON' })
    expect(localized.cards[1]!.title).toBe('My custom Java tool')
  })

  it('persists a locale-ready store state and retitles only stock workspace items', () => {
    setActivePinia(createPinia())
    const app = useAppStore()
    app.tabs = [{ id: 'home', toolId: 'home', title: '首页', pinned: false, state: {} }]

    app.setLocale('en-US')

    expect(app.settings.locale).toBe('en-US')
    expect(app.tabs[0]!.title).toBe('Home')
    expect(app.dashboardCards.cards[1]!.title).toBe('Java escape')
    expect(document.documentElement.lang).toBe('en-US')
  })
})
