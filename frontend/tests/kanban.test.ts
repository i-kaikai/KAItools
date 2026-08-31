import { describe, expect, it } from 'vitest'

import { clearCompletedKanbanTasks, createKanbanTask, emptyKanbanDraft, isKanbanTaskOverdue, moveKanbanTask, normalizeKanbanState, updateKanbanTask } from '@/utils/kanban'

describe('kanban state', () => {
  const now = new Date(2026, 7, 29, 9, 0, 0).getTime()

  it('normalizes persisted task data through a strict whitelist', () => {
    const state = normalizeKanbanState({
      tasks: [
        { id: 'keep', title: '  整理资料  ', note: '  周五前完成  ', status: 'doing', priority: 'high', dueDate: '2026-09-02', createdAt: 100, updatedAt: 200, unwanted: true },
        { id: 'drop', title: ' ', status: 'done' },
        { title: '无效日期', dueDate: '2026-02-31', status: 'unexpected', priority: 'unexpected' },
      ],
      filter: 'overdue',
      query: ' 资料 ',
      ignored: true,
    }, now)

    expect(state).toEqual({
      tasks: [
        { id: 'keep', title: '整理资料', note: '周五前完成', status: 'doing', priority: 'high', dueDate: '2026-09-02', createdAt: 100, updatedAt: 200 },
        expect.objectContaining({ title: '无效日期', dueDate: '', status: 'todo', priority: 'medium' }),
      ],
      filter: 'overdue',
      query: '资料',
    })
  })

  it('creates, edits, moves, and clears local tasks', () => {
    const created = createKanbanTask({ ...emptyKanbanDraft(), title: '完成接口联调', priority: 'high', dueDate: '2026-08-30' }, now)
    expect(created).toMatchObject({ title: '完成接口联调', status: 'todo', priority: 'high' })

    const edited = updateKanbanTask([created!], created!.id, { ...emptyKanbanDraft('doing'), title: '完成接口联调', note: '等待确认', priority: 'medium', dueDate: '' }, now + 1)
    const moved = moveKanbanTask(edited, created!.id, 'done', now + 2)
    expect(moved[0]).toMatchObject({ status: 'done', note: '等待确认', updatedAt: now + 2 })
    expect(clearCompletedKanbanTasks(moved)).toEqual([])
  })

  it('marks only unfinished past due dates as overdue', () => {
    const task = createKanbanTask({ ...emptyKanbanDraft(), title: '归档合同', dueDate: '2026-08-28' }, now)!
    expect(isKanbanTaskOverdue(task, now)).toBe(true)
    expect(isKanbanTaskOverdue({ ...task, status: 'done' }, now)).toBe(false)
  })
})
