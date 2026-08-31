export const kanbanStatuses = ['todo', 'doing', 'done'] as const
export const kanbanPriorities = ['high', 'medium', 'low'] as const
export const kanbanFilters = ['all', 'open', 'overdue'] as const

export type KanbanStatus = (typeof kanbanStatuses)[number]
export type KanbanPriority = (typeof kanbanPriorities)[number]
export type KanbanFilter = (typeof kanbanFilters)[number]

export interface KanbanTask {
  id: string
  title: string
  note: string
  status: KanbanStatus
  priority: KanbanPriority
  dueDate: string
  createdAt: number
  updatedAt: number
}

export interface KanbanBoardState {
  tasks: KanbanTask[]
  filter: KanbanFilter
  query: string
}

export interface KanbanTaskDraft {
  title: string
  note: string
  status: KanbanStatus
  priority: KanbanPriority
  dueDate: string
}

const statusSet = new Set<string>(kanbanStatuses)
const prioritySet = new Set<string>(kanbanPriorities)
const filterSet = new Set<string>(kanbanFilters)
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function taskId(): string {
  return crypto.randomUUID?.() ?? `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
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

function statusOf(value: unknown): KanbanStatus {
  return typeof value === 'string' && statusSet.has(value) ? value as KanbanStatus : 'todo'
}

function priorityOf(value: unknown): KanbanPriority {
  return typeof value === 'string' && prioritySet.has(value) ? value as KanbanPriority : 'medium'
}

export function normalizeKanbanState(value: Record<string, unknown>, now = Date.now()): KanbanBoardState {
  const tasks = Array.isArray(value.tasks) ? value.tasks.slice(0, 200).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const source = item as Partial<KanbanTask>
    const title = boundedString(source.title, 120)
    if (!title) return []
    const dueDate = boundedString(source.dueDate, 10)
    const createdAt = validTimestamp(source.createdAt, now)
    return [{
      id: boundedString(source.id, 80) || taskId(),
      title,
      note: boundedString(source.note, 1200),
      status: statusOf(source.status),
      priority: priorityOf(source.priority),
      dueDate: validDate(dueDate) ? dueDate : '',
      createdAt,
      updatedAt: validTimestamp(source.updatedAt, createdAt),
    }]
  }) : []
  const filter = typeof value.filter === 'string' && filterSet.has(value.filter) ? value.filter as KanbanFilter : 'all'
  return { tasks, filter, query: boundedString(value.query, 80) }
}

export function emptyKanbanDraft(status: KanbanStatus = 'todo'): KanbanTaskDraft {
  return { title: '', note: '', status, priority: 'medium', dueDate: '' }
}

export function createKanbanTask(draft: KanbanTaskDraft, now = Date.now()): KanbanTask | null {
  const title = boundedString(draft.title, 120)
  if (!title) return null
  const dueDate = boundedString(draft.dueDate, 10)
  return {
    id: taskId(),
    title,
    note: boundedString(draft.note, 1200),
    status: statusOf(draft.status),
    priority: priorityOf(draft.priority),
    dueDate: validDate(dueDate) ? dueDate : '',
    createdAt: now,
    updatedAt: now,
  }
}

export function updateKanbanTask(tasks: KanbanTask[], taskId: string, draft: KanbanTaskDraft, now = Date.now()): KanbanTask[] {
  const title = boundedString(draft.title, 120)
  if (!title) return tasks
  const dueDate = boundedString(draft.dueDate, 10)
  return tasks.map((task) => task.id === taskId ? {
    ...task,
    title,
    note: boundedString(draft.note, 1200),
    status: statusOf(draft.status),
    priority: priorityOf(draft.priority),
    dueDate: validDate(dueDate) ? dueDate : '',
    updatedAt: now,
  } : task)
}

export function moveKanbanTask(tasks: KanbanTask[], taskId: string, status: KanbanStatus, now = Date.now()): KanbanTask[] {
  return tasks.map((task) => task.id === taskId && task.status !== status ? { ...task, status, updatedAt: now } : task)
}

export function removeKanbanTask(tasks: KanbanTask[], taskId: string): KanbanTask[] {
  return tasks.filter((task) => task.id !== taskId)
}

export function clearCompletedKanbanTasks(tasks: KanbanTask[]): KanbanTask[] {
  return tasks.filter((task) => task.status !== 'done')
}

export function isKanbanTaskOverdue(task: KanbanTask, now = Date.now()): boolean {
  if (!task.dueDate || task.status === 'done') return false
  const today = new Date(now)
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return task.dueDate < localToday
}
