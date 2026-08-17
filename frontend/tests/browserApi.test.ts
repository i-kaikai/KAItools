import { beforeEach, describe, expect, it, vi } from 'vitest'

import { desktopApi, openRepositoryInBrowser, PROJECT_REPOSITORY_URL } from '@/api/desktopApi'
import type { ToolTab } from '@/types'

describe('browser API storage', () => {
  beforeEach(() => localStorage.clear())

  it('loads defaults and persists settings and pinned tabs', async () => {
    const initial = await desktopApi.loadState()
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    expect(initial.data.settings.theme).toBe('system')
    expect(initial.data.settings.sidebarCollapsed).toBe(true)
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
})
