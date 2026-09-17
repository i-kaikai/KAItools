import { describe, expect, it } from 'vitest'

import {
  clearCompletedChecklistItems,
  createChecklistItem,
  emptyChecklistItemDraft,
  isChecklistItemOverdue,
  isChecklistItemToday,
  moveChecklistItem,
  normalizeChecklistState,
  parseChecklistImport,
  toggleChecklistItem,
} from '@/utils/checklist'

describe('checklist state', () => {
  const now = new Date(2026, 8, 17, 10, 0, 0).getTime()

  it('creates a safe default list for empty or malformed state', () => {
    const state = normalizeChecklistState({ lists: [{ title: '' }, null, { title: '旅行准备', items: [{ title: '护照' }] }] }, now)

    expect(state.lists).toHaveLength(1)
    expect(state.lists[0]?.title).toBe('旅行准备')
    expect(state.lists[0]?.items[0]?.section).toBe('')
    expect(state.activeListId).toBe(state.lists[0]?.id)
  })

  it('creates, toggles, and clears completed items', () => {
    const item = createChecklistItem({ ...emptyChecklistItemDraft('出发前'), title: '确认车票', priority: 'high' }, now)
    expect(item).not.toBeNull()
    const completed = toggleChecklistItem([item!], item!.id, now + 1)

    expect(completed[0]?.completed).toBe(true)
    expect(clearCompletedChecklistItems(completed)).toEqual([])
  })

  it('moves items without changing the source array', () => {
    const first = createChecklistItem({ ...emptyChecklistItemDraft(), title: '第一项' }, now)!
    const second = createChecklistItem({ ...emptyChecklistItemDraft(), title: '第二项' }, now + 1)!
    const items = [first, second]
    const moved = moveChecklistItem(items, second.id, first.id, now + 2)

    expect(items.map((item) => item.title)).toEqual(['第一项', '第二项'])
    expect(moved.map((item) => item.title)).toEqual(['第二项', '第一项'])
    expect(moved[0]?.order).toBe(0)

    const movedFirst = moveChecklistItem(items, first.id, second.id, now + 3)
    expect(movedFirst.map((item) => item.title)).toEqual(['第一项', '第二项'])
  })

  it('recognizes local today and overdue dates', () => {
    const today = createChecklistItem({ ...emptyChecklistItemDraft(), title: '今天', dueDate: '2026-09-17' }, now)!
    const overdue = createChecklistItem({ ...emptyChecklistItemDraft(), title: '逾期', dueDate: '2026-09-16' }, now)!

    expect(isChecklistItemToday(today, now)).toBe(true)
    expect(isChecklistItemOverdue(today, now)).toBe(false)
    expect(isChecklistItemOverdue(overdue, now)).toBe(true)
  })

  it('parses newline text, markdown checks, and JSON title arrays', () => {
    expect(parseChecklistImport('- 设计接口\n[ ] 核对参数\n* 发布通知')).toEqual(['设计接口', '核对参数', '发布通知'])
    expect(parseChecklistImport('["准备证书", {"title":"检查版本"}]')).toEqual(['准备证书', '检查版本'])
  })
})
