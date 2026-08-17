// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAppStore } from '@/stores/app'
import { homeTool } from '@/tools/registry'

describe('home navigation', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts on the orbit and opens the existing home tab in workbench mode', () => {
    const app = useAppStore()
    app.tabs = [
      { id: 'home-tab', toolId: 'home', title: '首页', pinned: false, state: homeTool.initialState() },
      { id: 'json-tab', toolId: 'json', title: 'JSON', pinned: false, state: {} },
    ]
    app.activeTabId = 'home-tab'

    expect(app.activeTab?.state.entered).toBe(false)

    app.activateTab('json-tab')
    app.activateTab('home-tab')

    expect(app.activeTabId).toBe('home-tab')
    expect(app.activeTab?.state.entered).toBe(true)
  })

  it('opens home in workbench mode through the sidebar tool action', () => {
    const app = useAppStore()
    app.tabs = [
      { id: 'home-tab', toolId: 'home', title: '首页', pinned: false, state: homeTool.initialState() },
    ]

    app.openTool('home', '首页', homeTool.initialState(), true)

    expect(app.activeTabId).toBe('home-tab')
    expect(app.activeTab?.state.entered).toBe(true)
  })
})
