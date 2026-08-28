import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  desktopApi,
  GITHUB_REPOSITORY_URL,
  openGithubRepositoryInBrowser,
  openRepositoryInBrowser,
  PROJECT_REPOSITORY_URL,
} from '@/api/desktopApi'
import { APP_VERSION } from '@/version'
import type { DashboardCards, ToolTab } from '@/types'

describe('browser API storage', () => {
  beforeEach(() => localStorage.clear())

  it('loads defaults and persists settings and pinned tabs', async () => {
    const initial = await desktopApi.loadState()
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    expect(initial.data.runtime.version).toBe(APP_VERSION)
    expect(initial.data.settings.theme).toBe('system')
    expect(initial.data.settings.locale).toBe('zh-CN')
    expect(initial.data.settings.sidebarCollapsed).toBe(true)
    expect(initial.data.shortcutSync).toMatchObject({ accountId: null, mode: 'pending', pendingToolIds: null })
    expect(initial.data.dashboardCards.cards.map((card) => card.toolId)).toEqual(['json', 'java', 'timestamp', 'base64-text', 'cron', 'notes'])
    expect(initial.data.dashboardCards.carouselMode).toBe('step')
    expect(initial.data.dashboardCards.classicRotationSpeed).toBe(16)
    expect(initial.data.dashboardCards.stepIntervalMs).toBe(1600)
    expect(initial.data.settings.developerModeEnabled).toBe(false)
    expect(initial.data.settings.activationHotkey).toBe('Ctrl+Alt+K')
    expect(initial.data.settings).toMatchObject({
      locale: 'zh-CN',
      particleQuality: 'high',
      motionMode: 'system',
      sidebarStartup: 'remember',
      restorePinnedTabsOnLaunch: true,
      editorFontSize: 13,
      editorLineWrapping: true,
      clipboardMonitoringEnabled: true,
      systemStatusRefreshSeconds: 1,
      systemStatusRefreshMigrationVersion: 1,
    })
    expect(initial.data.workspace.tabs).toEqual([])

    const tab: ToolTab = {
      id: 'json-pinned',
      toolId: 'json',
      title: 'JSON',
      pinned: true,
      state: { input: '{"ready":true}' },
    }
    const dashboardCards: DashboardCards = {
      schemaVersion: 1,
      cards: [{ id: 'card-json', toolId: 'json', title: '快捷 JSON', description: '格式化接口数据', accentColor: '#35d0a7', sortOrder: 0, enabled: true }],
      carouselMode: 'classic',
      classicRotationSpeed: 22,
      stepIntervalMs: 2400,
    }
    await desktopApi.saveSettings({ settings: { ...initial.data.settings, theme: 'dark', locale: 'en-US' }, dashboardCards })
    await desktopApi.saveWorkspace([tab])

    const restored = await desktopApi.loadState()
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.data.settings.theme).toBe('dark')
    expect(restored.data.settings.locale).toBe('en-US')
    expect(restored.data.dashboardCards).toEqual(dashboardCards)
    expect(restored.data.workspace.tabs).toEqual([tab])
  })

  it('falls back to defaults when stored JSON is invalid', async () => {
    localStorage.setItem('devtoolkit.browser.state.v1', '{not-json')
    const result = await desktopApi.loadState()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.settings.theme).toBe('system')
    expect(result.data.workspace.tabs).toEqual([])
  })

  it('migrates an old loopback API setting into a disabled developer-only override', async () => {
    localStorage.setItem('devtoolkit.browser.state.v1', JSON.stringify({
      settings: { schemaVersion: 1, theme: 'dark', sidebarCollapsed: false, developerModeEnabled: false },
      backendConnection: { schemaVersion: 1, apiOrigin: 'http://127.0.0.1:8080' },
    }))

    const result = await desktopApi.loadState()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.backendConnection).toEqual({
      schemaVersion: 1,
      localApiOrigin: 'http://127.0.0.1:8080',
      useLocalApi: false,
    })
  })

  it('migrates missing preferences and clamps invalid editor settings', async () => {
    localStorage.setItem('devtoolkit.browser.state.v1', JSON.stringify({
      settings: { schemaVersion: 1, theme: 'dark', sidebarCollapsed: false, editorFontSize: 99, particleQuality: 'ultra' },
    }))

    const result = await desktopApi.loadState()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.settings).toMatchObject({
      locale: 'zh-CN',
      theme: 'dark',
      particleQuality: 'high',
      motionMode: 'system',
      editorFontSize: 13,
      editorLineWrapping: true,
    })
  })

  it('migrates the legacy manual refresh default once and preserves later manual choices', async () => {
    localStorage.setItem('devtoolkit.browser.state.v1', JSON.stringify({
      settings: { schemaVersion: 1, systemStatusRefreshSeconds: 0 },
    }))

    const migrated = await desktopApi.loadState()
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.data.settings).toMatchObject({ systemStatusRefreshSeconds: 1, systemStatusRefreshMigrationVersion: 1 })
    expect(JSON.parse(localStorage.getItem('devtoolkit.browser.state.v1') ?? '{}').settings).toMatchObject({ systemStatusRefreshSeconds: 1, systemStatusRefreshMigrationVersion: 1 })

    await desktopApi.saveSettings({ settings: { ...migrated.data.settings, systemStatusRefreshSeconds: 0 } })
    const manual = await desktopApi.loadState()
    expect(manual.ok).toBe(true)
    if (!manual.ok) return
    expect(manual.data.settings.systemStatusRefreshSeconds).toBe(0)
  })

  it('does not pretend that the browser can register a Windows global hotkey', async () => {
    const result = await desktopApi.setActivationHotkey('Ctrl+Alt+F8')

    expect(result).toEqual({ ok: false, error: { code: 'DESKTOP_ONLY', message: '全局唤起快捷键仅 Windows 桌面版可用' } })
  })

  it('provides detailed browser system status without a desktop bridge', async () => {
    const result = await desktopApi.getSystemStatus()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.runtime).toBe('web')
    expect(result.data.system).toHaveProperty('viewport')
    expect(result.data.system).toMatchObject({ cpuName: null, powerSource: 'unavailable', powerPercent: null })
    expect(result.data.application).toHaveProperty('indexedDbAvailable')
  })

  it('uses browser battery and JS heap data when the runtime exposes them', async () => {
    const batteryDescriptor = Object.getOwnPropertyDescriptor(navigator, 'getBattery')
    const memoryDescriptor = Object.getOwnPropertyDescriptor(performance, 'memory')
    Object.defineProperty(navigator, 'getBattery', { configurable: true, value: async () => ({ charging: true, level: 0.62 }) })
    Object.defineProperty(performance, 'memory', { configurable: true, value: { usedJSHeapSize: 128, jsHeapSizeLimit: 512 } })

    try {
      const result = await desktopApi.getSystemStatus()
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.system).toMatchObject({ powerSource: 'battery', powerPercent: 62, powerCharging: true, jsHeapUsedBytes: 128, jsHeapLimitBytes: 512, jsHeapUsagePercent: 25 })
    } finally {
      if (batteryDescriptor) Object.defineProperty(navigator, 'getBattery', batteryDescriptor)
      else delete (navigator as Navigator & { getBattery?: unknown }).getBattery
      if (memoryDescriptor) Object.defineProperty(performance, 'memory', memoryDescriptor)
      else delete (performance as Performance & { memory?: unknown }).memory
    }
  })

})

describe('project repository link', () => {
  it('opens a detached tab with a no-referrer navigation', () => {
    const append = vi.fn()
    const replace = vi.fn()
    const popup = {
      opener: window,
      document: {
        createElement: vi.fn(() => ({ name: '', content: '' })),
        head: { append },
      },
      location: { replace },
      close: vi.fn(),
    }
    const openWindow = vi.fn(() => popup) as unknown as typeof window.open

    const result = openRepositoryInBrowser(openWindow)

    expect(result).toEqual({ ok: true, data: undefined })
    expect(openWindow).toHaveBeenCalledWith('about:blank', '_blank')
    expect(popup.opener).toBeNull()
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ name: 'referrer', content: 'no-referrer' }))
    expect(replace).toHaveBeenCalledWith(PROJECT_REPOSITORY_URL)
  })

  it('reports when the browser blocks the new tab', () => {
    const result = openRepositoryInBrowser(() => null)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('OPEN_EXTERNAL_FAILED')
  })

  it('opens only the fixed GitHub repository URL', () => {
    const replace = vi.fn()
    const popup = {
      opener: window,
      document: {
        createElement: vi.fn(() => ({ name: '', content: '' })),
        head: { append: vi.fn() },
      },
      location: { replace },
      close: vi.fn(),
    }
    const openWindow = vi.fn(() => popup) as unknown as typeof window.open

    const result = openGithubRepositoryInBrowser(openWindow)

    expect(result).toEqual({ ok: true, data: undefined })
    expect(openWindow).toHaveBeenCalledWith('about:blank', '_blank')
    expect(popup.opener).toBeNull()
    expect(replace).toHaveBeenCalledWith(GITHUB_REPOSITORY_URL)
  })
})
