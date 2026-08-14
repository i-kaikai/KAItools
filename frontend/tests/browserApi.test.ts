import { beforeEach, describe, expect, it } from 'vitest'

import { desktopApi } from '@/api/desktopApi'
import type { ToolTab } from '@/types'

describe('browser API storage', () => {
  beforeEach(() => localStorage.clear())

  it('loads defaults and persists settings and pinned tabs', async () => {
    const initial = await desktopApi.loadState()
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    expect(initial.data.settings.theme).toBe('system')
    expect(initial.data.workspace.tabs).toEqual([])

    const tab: ToolTab = {
      id: 'json-pinned',
      toolId: 'json',
      title: 'JSON',
      pinned: true,
      state: { input: '{"ready":true}' },
    }
    await desktopApi.saveSettings({ settings: { ...initial.data.settings, theme: 'dark' } })
    await desktopApi.saveWorkspace([tab])

    const restored = await desktopApi.loadState()
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.data.settings.theme).toBe('dark')
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
})
