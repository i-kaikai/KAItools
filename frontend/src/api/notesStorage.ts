import type { NoteDocument, NoteFolder, Notebook, NotesState } from '@/types'

const DATABASE_NAME = 'kaitools-notes'
const STORE_NAME = 'state'
const STATE_KEY = 'notes'

function isoNow(): string {
  return new Date().toISOString()
}

export function defaultNotesState(): NotesState {
  const now = isoNow()
  return {
    schemaVersion: 1,
    notebooks: [{ id: 'kaitools-notebook', name: '开始使用', sortOrder: 0, createdAt: now, updatedAt: now }],
    folders: [],
    notes: [{
      id: 'about-kaitools',
      notebookId: 'kaitools-notebook',
      folderId: null,
      title: '关于 KAITools',
      content: '# KAI\n\n## Keep Approaching Ideal\n\n始终靠近理想\n\nKAITools 是面向开发者的本地优先工具空间。JSON、编码、时间、系统配置和笔记都先在当前设备完成处理；只有你主动登录并启用同步时，笔记、偏好与快捷方式才会进入服务端工作区。\n\n把这里当作产品说明、开发备忘录，或你的下一条想法。\n',
      pinned: true,
      revision: 1,
      syncStatus: 'local',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    }],
  }
}

function sanitizeNotes(value: unknown): NotesState {
  const fallback = defaultNotesState()
  if (!value || typeof value !== 'object') return fallback
  const source = value as Partial<NotesState>
  if (!Array.isArray(source.notebooks) || !Array.isArray(source.folders) || !Array.isArray(source.notes)) return fallback
  return {
    schemaVersion: 1,
    notebooks: source.notebooks as Notebook[],
    folders: source.folders as NoteFolder[],
    notes: (source.notes as NoteDocument[]).map((note, index) => ({ ...note, sortOrder: typeof note.sortOrder === 'number' ? note.sortOrder : index })),
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器笔记存储'))
  })
}

export async function loadBrowserNotes(): Promise<NotesState> {
  const database = await openDatabase()
  try {
    return await new Promise<NotesState>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(STATE_KEY)
      request.onsuccess = () => resolve(sanitizeNotes(request.result))
      request.onerror = () => reject(request.error ?? new Error('无法读取浏览器笔记'))
    })
  } finally {
    database.close()
  }
}

export async function saveBrowserNotes(notes: NotesState): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(notes, STATE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('无法保存浏览器笔记'))
      transaction.onabort = () => reject(transaction.error ?? new Error('浏览器笔记保存已取消'))
    })
  } finally {
    database.close()
  }
}
