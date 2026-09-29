import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useConfirmStore } from '@/stores/confirm'

describe('confirm store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('resolves the current request and clears it', async () => {
    const store = useConfirmStore()
    const result = store.ask({ title: '删除文件？', message: '无法恢复。', tone: 'danger' })

    expect(store.current?.title).toBe('删除文件？')
    expect(store.current?.confirmLabel).toBe('继续')
    store.settle(true)

    await expect(result).resolves.toBe(true)
    expect(store.current).toBeUndefined()
  })

  it('keeps later requests queued behind the current dialog', async () => {
    const store = useConfirmStore()
    const first = store.ask({ title: '第一个', message: '确认' })
    const second = store.ask({ title: '第二个', message: '确认' })

    store.settle(false)
    expect(store.current?.title).toBe('第二个')
    store.settle(true)

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
    expect(store.current).toBeUndefined()
  })

  it('returns save, discard, and cancel decisions without changing confirm callers', async () => {
    const store = useConfirmStore()
    const save = store.askSave({ title: '保存更改？', message: '有未归档内容' })
    const confirm = store.ask({ title: '确认删除？', message: '无法恢复' })

    expect(store.current?.kind).toBe('save')
    store.settle('discard')
    expect(store.current?.kind).toBe('confirm')
    store.settle(false)

    await expect(save).resolves.toBe('discard')
    await expect(confirm).resolves.toBe(false)
  })
})
