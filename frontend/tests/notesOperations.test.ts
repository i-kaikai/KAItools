import { describe, expect, it } from 'vitest'

import { defaultNotesState } from '@/api/notesStorage'
import { createFolder, createNote, deleteNode, moveNote, noteTree, togglePinnedNote } from '@/tools/notes/notesOperations'

describe('notes operations', () => {
  it('creates a selected-folder note with a stable sibling sort order', () => {
    const initial = defaultNotesState()
    const withFolder = createFolder(initial, 'folder-api', 'kaitools-notebook', null, '接口')
    const next = createNote(withFolder, 'note-api', 'kaitools-notebook', 'folder-api', '接口约定')

    expect(next.notes.find((note) => note.id === 'note-api')).toMatchObject({ folderId: 'folder-api', sortOrder: 0 })
    expect(noteTree(next).find((node) => node.id === 'note-api')?.parentKey).toBe('folder:folder-api')
  })

  it('moves only sibling order without using timestamps as order', () => {
    let state = defaultNotesState()
    state = createNote(state, 'note-second', 'kaitools-notebook', null, '第二篇')
    const first = state.notes.find((note) => note.id === 'about-kaitools')!
    const second = state.notes.find((note) => note.id === 'note-second')!
    const next = moveNote(state, 'note-second', -1)

    expect(next.notes.find((note) => note.id === first.id)?.sortOrder).toBe(second.sortOrder)
    expect(next.notes.find((note) => note.id === second.id)?.sortOrder).toBe(first.sortOrder)
  })

  it('keeps a single globally pinned note', () => {
    let state = defaultNotesState()
    state = createNote(state, 'note-second', 'kaitools-notebook', null, '第二篇')
    expect(togglePinnedNote(state, 'note-second').notes.filter((note) => note.pinned).map((note) => note.id)).toEqual(['note-second'])
  })

  it('recursively deletes a folder and every nested note', () => {
    let state = defaultNotesState()
    state = createFolder(state, 'folder-parent', 'kaitools-notebook', null, '父目录')
    state = createFolder(state, 'folder-child', 'kaitools-notebook', 'folder-parent', '子目录')
    state = createNote(state, 'note-child', 'kaitools-notebook', 'folder-child', '嵌套笔记')
    const next = deleteNode(state, 'folder:folder-parent')

    expect(next.folders.map((folder) => folder.id)).not.toContain('folder-parent')
    expect(next.folders.map((folder) => folder.id)).not.toContain('folder-child')
    expect(next.notes.map((note) => note.id)).not.toContain('note-child')
  })
})
