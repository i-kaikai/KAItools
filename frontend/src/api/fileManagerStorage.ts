import type { FileManagerAttachment, FileManagerFile, FileManagerFolder, FileManagerState, ToolId } from '@/types'

const DATABASE_NAME = 'kaitools-file-manager'
const STORE_NAME = 'state'
const STATE_KEY = 'files'
const MAX_FOLDERS = 500
const MAX_FILES = 2_000
const MAX_ATTACHMENTS = 20

function now(): string {
  return new Date().toISOString()
}

export function defaultFileManagerState(): FileManagerState {
  return { schemaVersion: 1, folders: [], files: [] }
}

function copyState(state: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(state)
}

function asTimestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback
}

function asFolder(value: unknown): FileManagerFolder | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<FileManagerFolder>
  const timestamp = now()
  if (typeof source.id !== 'string' || !source.id || source.id.length > 100) return null
  if (source.parentId !== null && typeof source.parentId !== 'string') return null
  if (typeof source.name !== 'string' || !source.name.trim() || source.name.trim().length > 120) return null
  return {
    id: source.id,
    parentId: source.parentId,
    name: source.name.trim(),
    createdAt: asTimestamp(source.createdAt, timestamp),
    updatedAt: asTimestamp(source.updatedAt, timestamp),
  }
}

function asAttachment(value: unknown): FileManagerAttachment | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<FileManagerAttachment>
  if (!source.id || !source.name || !source.mimeType || typeof source.dataBase64 !== 'string') return null
  if (typeof source.id !== 'string' || typeof source.name !== 'string' || typeof source.mimeType !== 'string') return null
  if (source.id.length > 100 || source.name.length > 260 || source.mimeType.length > 160) return null
  return {
    id: source.id,
    name: source.name,
    mimeType: source.mimeType,
    size: typeof source.size === 'number' && Number.isFinite(source.size) && source.size >= 0 ? source.size : 0,
    dataBase64: source.dataBase64,
  }
}

function asFile(value: unknown, folderIds: Set<string>): FileManagerFile | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<FileManagerFile>
  const timestamp = now()
  if (typeof source.id !== 'string' || !source.id || source.id.length > 100) return null
  if (source.folderId !== null && (typeof source.folderId !== 'string' || !folderIds.has(source.folderId))) return null
  if (typeof source.title !== 'string' || !source.title.trim() || source.title.trim().length > 160) return null
  const toolId = (source as { toolId?: unknown }).toolId
  if (typeof toolId !== 'string' || toolId === 'home' || toolId === 'file-manager' || toolId === 'clipboard-history') return null
  if (!source.state || typeof source.state !== 'object' || Array.isArray(source.state)) return null
  const attachments = Array.isArray(source.attachments)
    ? source.attachments.map(asAttachment).filter((item): item is FileManagerAttachment => item !== null).slice(0, MAX_ATTACHMENTS)
    : []
  return {
    id: source.id,
    folderId: source.folderId,
    title: source.title.trim(),
    toolId: toolId as FileManagerFile['toolId'],
    payloadVersion: typeof source.payloadVersion === 'number' && Number.isInteger(source.payloadVersion) && source.payloadVersion > 0 ? source.payloadVersion : 1,
    state: copyState(source.state as Record<string, unknown>),
    attachments,
    createdAt: asTimestamp(source.createdAt, timestamp),
    updatedAt: asTimestamp(source.updatedAt, timestamp),
  }
}

export function sanitizeFileManager(value: unknown): FileManagerState {
  if (!value || typeof value !== 'object') return defaultFileManagerState()
  const source = value as Partial<FileManagerState>
  const folders = Array.isArray(source.folders)
    ? source.folders.map(asFolder).filter((item): item is FileManagerFolder => item !== null).slice(0, MAX_FOLDERS)
    : []
  const folderIds = new Set(folders.map((folder) => folder.id))
  const uniqueFolders = folders.filter((folder, index) => folders.findIndex((item) => item.id === folder.id) === index)
    .map((folder) => ({ ...folder, parentId: folder.parentId && folderIds.has(folder.parentId) && folder.parentId !== folder.id ? folder.parentId : null }))
  const validFolderIds = new Set(uniqueFolders.map((folder) => folder.id))
  const files = Array.isArray(source.files)
    ? source.files.map((file) => asFile(file, validFolderIds)).filter((item): item is FileManagerFile => item !== null).slice(0, MAX_FILES)
    : []
  const uniqueFiles = files.filter((file, index) => files.findIndex((item) => item.id === file.id) === index)
  return { schemaVersion: 1, folders: uniqueFolders, files: uniqueFiles }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器文件管理器存储'))
  })
}

export async function loadBrowserFileManager(): Promise<FileManagerState> {
  const database = await openDatabase()
  try {
    return await new Promise<FileManagerState>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(STATE_KEY)
      request.onsuccess = () => resolve(sanitizeFileManager(request.result))
      request.onerror = () => reject(request.error ?? new Error('无法读取浏览器文件管理器'))
    })
  } finally {
    database.close()
  }
}

export async function saveBrowserFileManager(state: FileManagerState): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(sanitizeFileManager(state), STATE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('无法保存浏览器文件管理器'))
      transaction.onabort = () => reject(transaction.error ?? new Error('浏览器文件管理器保存已取消'))
    })
  } finally {
    database.close()
  }
}

export function isArchivableTool(toolId: ToolId): toolId is FileManagerFile['toolId'] {
  return toolId !== 'home' && toolId !== 'file-manager' && toolId !== 'clipboard-history' && toolId !== 'hosts'
}
