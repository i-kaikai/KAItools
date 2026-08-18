export type SearchMatchRange = { from: number; to: number }

export type SearchCountResult = {
  total: number
  selectedIndex?: number
}

type ChunkedSearchCountOptions = {
  cursor: Iterator<SearchMatchRange>
  selected?: SearchMatchRange
  onComplete: (result: SearchCountResult) => void
  timeSliceMs?: number
  now?: () => number
  schedule?: (task: () => void) => () => void
}

/**
 * Walk a CodeMirror search cursor in short tasks so large documents keep the UI responsive.
 */
export function countSearchMatchesInChunks(options: ChunkedSearchCountOptions): () => void {
  const now = options.now ?? (() => performance.now())
  const schedule = options.schedule ?? ((task: () => void) => {
    const timer = window.setTimeout(task, 0)
    return () => window.clearTimeout(timer)
  })
  const timeSliceMs = options.timeSliceMs ?? 6
  let cancelScheduledTask: (() => void) | undefined
  let cancelled = false
  let total = 0
  let selectedIndex: number | undefined

  const run = () => {
    const startedAt = now()
    while (!cancelled) {
      const next = options.cursor.next()
      if (next.done) {
        options.onComplete({ total, selectedIndex })
        return
      }

      total += 1
      if (options.selected && next.value.from === options.selected.from && next.value.to === options.selected.to) {
        selectedIndex = total
      }

      if (now() - startedAt >= timeSliceMs) {
        cancelScheduledTask = schedule(run)
        return
      }
    }
  }

  cancelScheduledTask = schedule(run)
  return () => {
    cancelled = true
    cancelScheduledTask?.()
  }
}
