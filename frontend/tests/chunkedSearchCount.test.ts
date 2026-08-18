import { describe, expect, it } from 'vitest'

import { countSearchMatchesInChunks, type SearchMatchRange } from '@/utils/chunkedSearchCount'

function* cursorFor(ranges: SearchMatchRange[]): IterableIterator<SearchMatchRange> {
  yield* ranges
}

describe('chunked search counting', () => {
  it('counts all matches and reports the selected match across multiple tasks', () => {
    const queued: (() => void)[] = []
    let clock = 0
    let result: { total: number; selectedIndex?: number } | undefined
    countSearchMatchesInChunks({
      cursor: cursorFor([{ from: 0, to: 5 }, { from: 8, to: 13 }, { from: 16, to: 21 }]),
      selected: { from: 8, to: 13 },
      timeSliceMs: 5,
      now: () => (clock += 3),
      schedule: (task) => {
        queued.push(task)
        return () => {
          const index = queued.indexOf(task)
          if (index >= 0) queued.splice(index, 1)
        }
      },
      onComplete: (next) => (result = next),
    })

    while (queued.length) queued.shift()?.()
    expect(result).toEqual({ total: 3, selectedIndex: 2 })
  })

  it('cancels scheduled work without publishing a stale count', () => {
    const queued: (() => void)[] = []
    let completed = false
    const cancel = countSearchMatchesInChunks({
      cursor: cursorFor(Array.from({ length: 2_000 }, (_, index) => ({ from: index * 2, to: index * 2 + 1 }))),
      timeSliceMs: 0,
      now: () => performance.now(),
      schedule: (task) => {
        queued.push(task)
        return () => {
          const index = queued.indexOf(task)
          if (index >= 0) queued.splice(index, 1)
        }
      },
      onComplete: () => (completed = true),
    })

    cancel()
    while (queued.length) queued.shift()?.()
    expect(completed).toBe(false)
  })
})
