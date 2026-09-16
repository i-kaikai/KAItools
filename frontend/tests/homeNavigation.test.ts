// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { desktopApi } from '@/api/desktopApi'
import { defaultFileManagerState } from '@/api/fileManagerStorage'
import { defaultNotesState } from '@/api/notesStorage'
import { normalizeRecentToolIds, useAppStore } from '@/stores/app'
import { homeTool } from '@/tools/registry'

describe('home navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('keeps the home tab as a direct workspace without stage state', () => {
    const app = useAppStore()
    app.tabs = [
      { id: 'home-tab', toolId: 'home', title: '首页', pinned: false, state: homeTool.initialState() },
      { id: 'json-tab', toolId: 'json', title: 'JSON', pinned: false, state: {} },
    ]
    app.activeTabId = 'home-tab'

    expect(app.activeTab?.state).toEqual({})

    app.activateTab('json-tab')
    app.activateTab('home-tab')

    expect(app.activeTabId).toBe('home-tab')
    expect(app.activeTab?.state).toEqual({})
  })

  it('opens the existing home tab through the sidebar tool action', () => {
    const app = useAppStore()
    app.tabs = [
      { id: 'home-tab', toolId: 'home', title: '首页', pinned: false, state: homeTool.initialState() },
    ]

    app.openTool('home', '首页', homeTool.initialState(), true)

    expect(app.activeTabId).toBe('home-tab')
    expect(app.activeTab?.state).toEqual({})
  })

  it('keeps a most-recent tool history after tabs close', () => {
    const app = useAppStore()
    app.tabs = [{ id: 'home-tab', toolId: 'home', title: '首页', pinned: false, state: {} }]

    app.openTool('json', 'JSON', {})
    const jsonTabId = app.activeTabId
    app.openTool('cron', 'Crontab', {})
    app.activateTab(jsonTabId)
    app.closeTabs(app.tabs.filter((tab) => tab.toolId !== 'home').map((tab) => tab.id))
    app.openTool('home', '首页', homeTool.initialState(), true)

    expect(app.tabs).toHaveLength(1)
    expect(app.settings.recentToolIds).toEqual(['json', 'cron'])
  })

  it('filters invalid and duplicate tool IDs while restoring history', () => {
    expect(normalizeRecentToolIds(['json', 'json', 'home', 'unknown', 'cron', 1])).toEqual(['json', 'cron'])
  })

  it('restores open tools, their state, and the active tab after a page refresh', async () => {
    const app = useAppStore()
    app.tabs = [
      { id: 'home-tab', toolId: 'home', title: '首页', pinned: false, state: {} },
      { id: 'json-tab', toolId: 'json', title: 'JSON', pinned: false, state: { input: '{"restored":true}' } },
      { id: 'cron-tab', toolId: 'cron', title: 'Crontab', pinned: true, state: { expression: '0 9 * * 1-5' } },
    ]
    app.activeTabId = 'cron-tab'
    app.flushSessionWorkspace()

    const initial = await desktopApi.loadState()
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    vi.spyOn(desktopApi, 'loadState').mockResolvedValue(initial)
    vi.spyOn(desktopApi, 'loadNotes').mockResolvedValue({ ok: true, data: defaultNotesState() })
    vi.spyOn(desktopApi, 'loadFileManager').mockResolvedValue({ ok: true, data: defaultFileManagerState() })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))

    setActivePinia(createPinia())
    const restored = useAppStore()
    await restored.bootstrap({})

    expect(restored.tabs.map((tab) => tab.toolId)).toEqual(['home', 'json', 'cron'])
    expect(restored.tabs.find((tab) => tab.id === 'json-tab')?.state).toEqual({ input: '{"restored":true}' })
    expect(restored.activeTabId).toBe('cron-tab')
  })
})
