import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useAppStore } from '@/stores/app'
import { desktopApi } from '@/api/desktopApi'
import { normalizeChecklistState } from '@/utils/checklist'
import type { ToolTab } from '@/types'

describe('close prompt state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('defaults to selected workflow tools and detects edits against the tab baseline', () => {
    const app = useAppStore()
    const baseline = { title: '流程图', nodes: [], edges: [] }
    const tab: ToolTab = {
      id: 'flowchart-1',
      toolId: 'flowchart',
      title: '流程图画板',
      pinned: false,
      state: { ...baseline },
    }
    app.tabs = [tab]
    app.activeTabId = tab.id
    vi.useFakeTimers()
    app.setTabCloseBaseline(tab.id, baseline)

    expect(app.settings.closePromptMode).toBe('selected')
    expect(app.settings.closePromptToolIds).toEqual(['checklist', 'kanban', 'mermaid', 'flowchart'])
    expect(app.hasUnarchivedChanges(tab.id)).toBe(false)

    app.updateTabState(tab.id, { ...baseline, title: '已编辑流程图' })

    expect(app.hasUnarchivedChanges(tab.id)).toBe(true)
  })

  it('does not prompt for the checklist default or view-only changes', () => {
    const app = useAppStore()
    const state = normalizeChecklistState({}) as unknown as Record<string, unknown>
    const tab: ToolTab = {
      id: 'checklist-1',
      toolId: 'checklist',
      title: '清单工作台',
      pinned: false,
      state,
    }
    app.tabs = [tab]
    app.activeTabId = tab.id

    expect(app.hasUnarchivedChanges(tab.id)).toBe(false)
    app.updateTabState(tab.id, { ...state, query: '无结果的搜索' })
    expect(app.hasUnarchivedChanges(tab.id)).toBe(false)
  })

  it('keeps a clear operation dirty when it removes previously saved work', () => {
    vi.useFakeTimers()
    const app = useAppStore()
    app.openTool('mermaid', 'Mermaid 流程图', { source: 'flowchart LR\n  A --> B', split: 46, theme: 'auto' })
    const tab = app.activeTab!

    app.updateTabState(tab.id, { source: '', split: 46, theme: 'auto' })

    expect(app.hasUnarchivedChanges(tab.id)).toBe(true)
  })

  it('compares edited archived tabs with the current File Manager record', () => {
    const app = useAppStore()
    const state = { title: '已保存流程图', nodes: [], edges: [] }
    const tab: ToolTab = {
      id: 'flowchart-1',
      toolId: 'flowchart',
      title: '流程图画板',
      pinned: false,
      state: { ...state, __closeBaselineHash: 'baseline-hash', __fileManagerFileId: 'file-1' },
    }
    app.tabs = [tab]
    app.activeTabId = tab.id
    app.fileManager = {
      schemaVersion: 1,
      folders: [],
      files: [{
        id: 'file-1', folderId: null, title: '已保存流程图', toolId: 'flowchart', payloadVersion: 1,
        state, attachments: [], createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
      }],
    }

    expect(app.hasUnarchivedChanges(tab.id)).toBe(false)
    app.updateTabState(tab.id, { ...state, title: '新的流程图标题', __fileManagerFileId: 'file-1' })
    expect(app.hasUnarchivedChanges(tab.id)).toBe(true)
  })

  it('does not keep a failed archive in the File Manager state', async () => {
    const app = useAppStore()
    const save = vi.spyOn(desktopApi, 'saveFileManager').mockResolvedValue({
      ok: false,
      error: { code: 'STORAGE_WRITE_FAILED', message: '写入失败' },
    })

    const archived = await app.archiveToolState('flowchart', '流程图', { title: '流程图', nodes: [], edges: [] })

    expect(save).toHaveBeenCalledOnce()
    expect(archived).toBeNull()
    expect(app.fileManager.files).toEqual([])
  })
})
