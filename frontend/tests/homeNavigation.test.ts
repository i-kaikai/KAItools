// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAppStore } from '@/stores/app'
import { homeTool } from '@/tools/registry'

describe('home navigation', () => {
  beforeEach(() => setActivePinia(createPinia()))

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
})
