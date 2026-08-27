import type { NoteDocument, NotesState } from '@/types'

export type NotesTreeNode = {
  key: string
  parentKey: string | null
  kind: 'notebook' | 'folder' | 'note'
  id: string
  title: string
  pinned?: boolean
  sortOrder: number
}

function copy(state: NotesState): NotesState {
  // Pinia exposes reactive proxies; explicit object copies keep these pure operations clone-safe and testable.
  return {
    schemaVersion: state.schemaVersion,
    notebooks: state.notebooks.map((notebook) => ({ ...notebook })),
    folders: state.folders.map((folder) => ({ ...folder })),
    notes: state.notes.map((note) => ({ ...note })),
  }
}

function timestamp(): string {
  return new Date().toISOString()
}

function nextOrder(values: Array<{ sortOrder: number }>): number {
  return values.reduce((max, value) => Math.max(max, value.sortOrder), -1) + 1
}

function sortStable<T extends { sortOrder: number; createdAt: string; id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

export function noteTree(state: NotesState, query = ''): NotesTreeNode[] {
  const normalized = query.trim().toLocaleLowerCase()
  const noteMatches = new Set(state.notes
    .filter((note) => !normalized || `${note.title}\n${note.content}`.toLocaleLowerCase().includes(normalized))
    .map((note) => note.id))
  const visibleFolders = new Set<string>()
  const visibleNotebooks = new Set<string>()
  // A search match keeps its notebook and ancestor folders visible, preserving navigable context.
  for (const note of state.notes) {
    if (!noteMatches.has(note.id)) continue
    visibleNotebooks.add(note.notebookId)
    let folderId = note.folderId
    while (folderId) {
      visibleFolders.add(folderId)
      const folder = state.folders.find((item) => item.id === folderId)
      folderId = folder?.parentId ?? null
    }
  }
  const nodes: NotesTreeNode[] = []
  for (const notebook of sortStable(state.notebooks)) {
    if (normalized && !visibleNotebooks.has(notebook.id)) continue
    nodes.push({ key: `notebook:${notebook.id}`, parentKey: null, kind: 'notebook', id: notebook.id, title: notebook.name, sortOrder: notebook.sortOrder })
    for (const folder of sortStable(state.folders.filter((item) => item.notebookId === notebook.id))) {
      if (normalized && !visibleFolders.has(folder.id)) continue
      nodes.push({
        key: `folder:${folder.id}`,
        parentKey: folder.parentId ? `folder:${folder.parentId}` : `notebook:${notebook.id}`,
        kind: 'folder', id: folder.id, title: folder.name, sortOrder: folder.sortOrder,
      })
    }
    for (const note of [...state.notes.filter((item) => item.notebookId === notebook.id && noteMatches.has(item.id))]
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt))) {
      nodes.push({
        key: `note:${note.id}`,
        parentKey: note.folderId ? `folder:${note.folderId}` : `notebook:${notebook.id}`,
        kind: 'note', id: note.id, title: note.title || '未命名笔记', pinned: note.pinned, sortOrder: note.sortOrder,
      })
    }
  }
  return nodes
}

export function createNotebook(state: NotesState, id: string, name: string): NotesState {
  const next = copy(state)
  const now = timestamp()
  next.notebooks.push({ id, name, sortOrder: nextOrder(next.notebooks), createdAt: now, updatedAt: now })
  return next
}

export function createFolder(state: NotesState, id: string, notebookId: string, parentId: string | null, name: string): NotesState {
  const next = copy(state)
  const now = timestamp()
  const siblings = next.folders.filter((folder) => folder.notebookId === notebookId && folder.parentId === parentId)
  next.folders.push({ id, notebookId, parentId, name, sortOrder: nextOrder(siblings), createdAt: now, updatedAt: now })
  return next
}

export function createNote(state: NotesState, id: string, notebookId: string, folderId: string | null, title = '未命名笔记'): NotesState {
  const next = copy(state)
  const now = timestamp()
  const siblings = next.notes.filter((note) => note.notebookId === notebookId && note.folderId === folderId)
  next.notes.push({ id, notebookId, folderId, title, content: '', pinned: false, revision: 1, syncStatus: 'local', sortOrder: nextOrder(siblings), createdAt: now, updatedAt: now })
  return next
}

export function renameNode(state: NotesState, key: string, name: string): NotesState {
  const next = copy(state)
  const now = timestamp()
  const [kind, id] = key.split(':', 2)
  if (kind === 'notebook') {
    const notebook = next.notebooks.find((item) => item.id === id)
    if (notebook) { notebook.name = name; notebook.updatedAt = now }
  } else if (kind === 'folder') {
    const folder = next.folders.find((item) => item.id === id)
    if (folder) { folder.name = name; folder.updatedAt = now }
  } else if (kind === 'note') {
    const note = next.notes.find((item) => item.id === id)
    if (note) { note.title = name; note.updatedAt = now; note.revision += 1; note.syncStatus = 'local' }
  }
  return next
}

export function updateNote(state: NotesState, noteId: string, patch: Partial<Pick<NoteDocument, 'title' | 'content' | 'folderId'>>): NotesState {
  const next = copy(state)
  const note = next.notes.find((item) => item.id === noteId)
  if (!note) return next
  if (patch.folderId !== undefined && patch.folderId !== null) {
    const folder = next.folders.find((item) => item.id === patch.folderId)
    if (!folder || folder.notebookId !== note.notebookId) return next
  }
  Object.assign(note, patch)
  note.updatedAt = timestamp()
  note.revision += 1
  note.syncStatus = 'local'
  return next
}

export function togglePinnedNote(state: NotesState, noteId: string): NotesState {
  const next = copy(state)
  const note = next.notes.find((item) => item.id === noteId)
  if (!note) return next
  const shouldPin = !note.pinned
  for (const item of next.notes) item.pinned = false
  note.pinned = shouldPin
  note.updatedAt = timestamp()
  note.revision += 1
  note.syncStatus = 'local'
  return next
}

export function moveNote(state: NotesState, noteId: string, direction: -1 | 1): NotesState {
  const next = copy(state)
  const source = next.notes.find((item) => item.id === noteId)
  if (!source) return next
  const siblings = sortStable(next.notes.filter((note) => note.notebookId === source.notebookId && note.folderId === source.folderId))
  const index = siblings.findIndex((note) => note.id === noteId)
  const target = siblings[index + direction]
  if (!target) return next
  // Ordering is independent of updatedAt so editing a note never changes its relative position.
  const previousOrder = source.sortOrder
  source.sortOrder = target.sortOrder
  target.sortOrder = previousOrder
  const now = timestamp()
  source.updatedAt = now
  target.updatedAt = now
  return next
}

export function deleteNode(state: NotesState, key: string): NotesState {
  const next = copy(state)
  const [kind, id] = key.split(':', 2)
  if (kind === 'note') {
    next.notes = next.notes.filter((note) => note.id !== id)
    return next
  }
  if (kind === 'notebook') {
    next.notebooks = next.notebooks.filter((notebook) => notebook.id !== id)
    next.folders = next.folders.filter((folder) => folder.notebookId !== id)
    next.notes = next.notes.filter((note) => note.notebookId !== id)
    return next
  }
  if (kind === 'folder') {
    // Deleting a folder removes its complete subtree and every note stored below it.
    const descendants = new Set([id])
    let added = true
    while (added) {
      added = false
      for (const folder of next.folders) {
        if (folder.parentId && descendants.has(folder.parentId) && !descendants.has(folder.id)) {
          descendants.add(folder.id)
          added = true
        }
      }
    }
    next.folders = next.folders.filter((folder) => !descendants.has(folder.id))
    next.notes = next.notes.filter((note) => !note.folderId || !descendants.has(note.folderId))
  }
  return next
}
