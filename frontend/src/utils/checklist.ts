export const checklistViews = ['all', 'today', 'overdue', 'completed'] as const
export const checklistPriorities = ['high', 'medium', 'low'] as const

export type ChecklistView = (typeof checklistViews)[number]
export type ChecklistPriority = (typeof checklistPriorities)[number]

export interface ChecklistItem {
  id: string
  title: string
  note: string
  section: string
  priority: ChecklistPriority
  dueDate: string
  completed: boolean
  order: number
  createdAt: number
  updatedAt: number
}

export interface ChecklistList {
  id: string
  title: string
  items: ChecklistItem[]
  createdAt: number
  updatedAt: number
}

export interface ChecklistState {
  lists: ChecklistList[]
  activeListId: string
  view: ChecklistView
  query: string
  collapsedSections: string[]
}

export interface ChecklistItemDraft {
  title: string
  note: string
  section: string
  priority: ChecklistPriority
  dueDate: string
}

const viewSet = new Set<string>(checklistViews)
const prioritySet = new Set<string>(checklistPriorities)
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const defaultSection = ''

function entityId(prefix: string): string {
  return crypto.randomUUID?.() ?? `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function validDate(value: string): boolean {
  if (!datePattern.test(value)) return false
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText ?? 0)
  const month = Number(monthText ?? 0)
  const day = Number(dayText ?? 0)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function validTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function priorityOf(value: unknown): ChecklistPriority {
  return typeof value === 'string' && prioritySet.has(value) ? value as ChecklistPriority : 'medium'
}

function itemFrom(value: unknown, index: number, now: number): ChecklistItem | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<ChecklistItem>
  const title = boundedString(source.title, 160)
  if (!title) return null
  const createdAt = validTimestamp(source.createdAt, now)
  const dueDate = boundedString(source.dueDate, 10)
  return {
    id: boundedString(source.id, 80) || entityId('check'),
    title,
    note: boundedString(source.note, 1200),
    section: boundedString(source.section, 60),
    priority: priorityOf(source.priority),
    dueDate: validDate(dueDate) ? dueDate : '',
    completed: source.completed === true,
    order: typeof source.order === 'number' && Number.isFinite(source.order) ? source.order : index,
    createdAt,
    updatedAt: validTimestamp(source.updatedAt, createdAt),
  }
}

function listFrom(value: unknown, now: number): ChecklistList | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<ChecklistList>
  const title = boundedString(source.title, 80)
  if (!title) return null
  const createdAt = validTimestamp(source.createdAt, now)
  const items = Array.isArray(source.items)
    ? source.items.slice(0, 500).flatMap((item, index) => {
      const normalized = itemFrom(item, index, now)
      return normalized ? [normalized] : []
    }).sort((left, right) => left.order - right.order || left.createdAt - right.createdAt)
    : []
  return {
    id: boundedString(source.id, 80) || entityId('list'),
    title,
    items,
    createdAt,
    updatedAt: validTimestamp(source.updatedAt, createdAt),
  }
}

function defaultList(now: number): ChecklistList {
  return { id: entityId('list'), title: '工作清单', items: [], createdAt: now, updatedAt: now }
}

export function normalizeChecklistState(value: Record<string, unknown>, now = Date.now()): ChecklistState {
  const lists = Array.isArray(value.lists)
    ? value.lists.slice(0, 30).flatMap((item) => {
      const normalized = listFrom(item, now)
      return normalized ? [normalized] : []
    })
    : []
  const safeLists = lists.length ? lists : [defaultList(now)]
  const requestedActiveId = boundedString(value.activeListId, 80)
  const activeListId = safeLists.some((list) => list.id === requestedActiveId) ? requestedActiveId : safeLists[0]!.id
  const view = typeof value.view === 'string' && viewSet.has(value.view) ? value.view as ChecklistView : 'all'
  const collapsedSections = Array.isArray(value.collapsedSections)
    ? [...new Set(value.collapsedSections.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 60)).filter(Boolean))].slice(0, 100)
    : []
  return { lists: safeLists, activeListId, view, query: boundedString(value.query, 100), collapsedSections }
}

export function emptyChecklistItemDraft(section = defaultSection): ChecklistItemDraft {
  return { title: '', note: '', section, priority: 'medium', dueDate: '' }
}

export function createChecklistList(title: string, now = Date.now()): ChecklistList | null {
  const normalizedTitle = boundedString(title, 80)
  if (!normalizedTitle) return null
  return { id: entityId('list'), title: normalizedTitle, items: [], createdAt: now, updatedAt: now }
}

export function renameChecklistList(lists: ChecklistList[], listId: string, title: string, now = Date.now()): ChecklistList[] {
  const normalizedTitle = boundedString(title, 80)
  if (!normalizedTitle) return lists
  return lists.map((list) => list.id === listId ? { ...list, title: normalizedTitle, updatedAt: now } : list)
}

export function createChecklistItem(draft: ChecklistItemDraft, now = Date.now()): ChecklistItem | null {
  const title = boundedString(draft.title, 160)
  if (!title) return null
  const dueDate = boundedString(draft.dueDate, 10)
  return {
    id: entityId('check'),
    title,
    note: boundedString(draft.note, 1200),
    section: boundedString(draft.section, 60),
    priority: priorityOf(draft.priority),
    dueDate: validDate(dueDate) ? dueDate : '',
    completed: false,
    order: now,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateChecklistItem(items: ChecklistItem[], itemId: string, draft: ChecklistItemDraft, now = Date.now()): ChecklistItem[] {
  const title = boundedString(draft.title, 160)
  if (!title) return items
  const dueDate = boundedString(draft.dueDate, 10)
  return items.map((item) => item.id === itemId ? {
    ...item,
    title,
    note: boundedString(draft.note, 1200),
    section: boundedString(draft.section, 60),
    priority: priorityOf(draft.priority),
    dueDate: validDate(dueDate) ? dueDate : '',
    updatedAt: now,
  } : item)
}

export function toggleChecklistItem(items: ChecklistItem[], itemId: string, now = Date.now()): ChecklistItem[] {
  return items.map((item) => item.id === itemId ? { ...item, completed: !item.completed, updatedAt: now } : item)
}

export function removeChecklistItem(items: ChecklistItem[], itemId: string): ChecklistItem[] {
  return items.filter((item) => item.id !== itemId)
}

export function clearCompletedChecklistItems(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((item) => !item.completed)
}

export function moveChecklistItem(items: ChecklistItem[], itemId: string, targetId: string, now = Date.now()): ChecklistItem[] {
  if (itemId === targetId) return items
  const ordered = [...items].sort((left, right) => left.order - right.order || left.createdAt - right.createdAt)
  const sourceIndex = ordered.findIndex((item) => item.id === itemId)
  const targetIndex = ordered.findIndex((item) => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) return items
  const [source] = ordered.splice(sourceIndex, 1)
  if (!source) return items
  const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
  ordered.splice(insertionIndex, 0, source)
  return ordered.map((item, index) => ({ ...item, order: index, updatedAt: item.id === itemId ? now : item.updatedAt }))
}

export function isChecklistItemOverdue(item: ChecklistItem, now = Date.now()): boolean {
  if (!item.dueDate || item.completed) return false
  const today = new Date(now)
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return item.dueDate < localToday
}

export function isChecklistItemToday(item: ChecklistItem, now = Date.now()): boolean {
  if (!item.dueDate || item.completed) return false
  const today = new Date(now)
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return item.dueDate === localToday
}

export function checklistDefaultSection(): string {
  return defaultSection
}

export function parseChecklistImport(value: string, maxItems = 500): string[] {
  const source = value.trim()
  if (source.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(source)
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => typeof item === 'string' ? item : item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string' ? (item as { title: string }).title : '')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, maxItems)
      }
    } catch {
      // Fall back to line parsing so a malformed JSON paste remains importable as text.
    }
  }
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/^(?:[-*+]\s+|\[[ xX]\]\s+)/, '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
}
