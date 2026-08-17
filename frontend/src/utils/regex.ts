import type { EditorHighlight } from '@/types'

export interface RegexMatchResult {
  match: string
  index: number
  end: number
  captures: Array<string | null>
  groups: Record<string, string> | null
}

export interface RegexEvaluation {
  matches: RegexMatchResult[]
  highlights: EditorHighlight[]
  replacement: string
  error: string
}

export function evaluateRegex(input: string, pattern: string, flags: string, replacement = ''): RegexEvaluation {
  if (!pattern) return { matches: [], highlights: [], replacement: input, error: '' }
  try {
    const expression = new RegExp(pattern, flags)
    const matches: RegexMatchResult[] = []
    const highlights: EditorHighlight[] = []
    let current: RegExpExecArray | null

    while ((current = expression.exec(input)) !== null) {
      const index = current.index
      const end = index + current[0].length
      matches.push({
        match: current[0],
        index,
        end,
        captures: current.slice(1).map((value) => value ?? null),
        groups: current.groups ? { ...current.groups } : null,
      })
      if (end > index) highlights.push({ from: index, to: end, kind: 'match' })
      if (!expression.global && !expression.sticky) break
      if (current[0].length === 0) expression.lastIndex += 1
    }

    return { matches, highlights, replacement: input.replace(new RegExp(pattern, flags), replacement), error: '' }
  } catch (error) {
    return {
      matches: [],
      highlights: [],
      replacement: input,
      error: error instanceof Error ? error.message : '正则表达式无效',
    }
  }
}

export function serializeRegexMatches(matches: RegexMatchResult[]): string {
  return JSON.stringify(matches, null, 2)
}
