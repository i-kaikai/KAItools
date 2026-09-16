// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { isArchivableTool, sanitizeFileManager } from '@/api/fileManagerStorage'

describe('file manager storage', () => {
  it('keeps valid local files and drops corrupt folder references', () => {
    const state = sanitizeFileManager({
      schemaVersion: 99,
      folders: [
        { id: 'reports', parentId: null, name: '接口记录', createdAt: '2026-09-16T00:00:00.000Z', updatedAt: '2026-09-16T00:00:00.000Z' },
        { id: 'invalid-parent', parentId: 'missing', name: '无效目录', createdAt: '2026-09-16T00:00:00.000Z', updatedAt: '2026-09-16T00:00:00.000Z' },
      ],
      files: [
        {
          id: 'request-1', folderId: 'reports', title: 'GET users', toolId: 'api-client', payloadVersion: 1,
          state: { method: 'GET', url: 'https://api.example.test/users', authorization: 'demo-value' }, attachments: [],
          createdAt: '2026-09-16T00:00:00.000Z', updatedAt: '2026-09-16T00:00:00.000Z',
        },
        {
          id: 'bad-file', folderId: 'missing', title: '无效文件', toolId: 'api-client', payloadVersion: 1,
          state: {}, attachments: [], createdAt: '2026-09-16T00:00:00.000Z', updatedAt: '2026-09-16T00:00:00.000Z',
        },
      ],
    })

    expect(state.schemaVersion).toBe(1)
    expect(state.folders.find((folder) => folder.id === 'invalid-parent')?.parentId).toBeNull()
    expect(state.files).toHaveLength(1)
    expect(state.files[0]?.state).toMatchObject({ authorization: 'demo-value' })
  })

  it('only permits persistent tools in the archive library', () => {
    expect(isArchivableTool('api-client')).toBe(true)
    expect(isArchivableTool('flowchart')).toBe(true)
    expect(isArchivableTool('file-manager')).toBe(false)
    expect(isArchivableTool('clipboard-history')).toBe(false)
    expect(isArchivableTool('notes')).toBe(true)
  })
})
