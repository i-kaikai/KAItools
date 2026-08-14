import { diffLines, type Change } from 'diff'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`${label} JSON 无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

export interface JsonComparison {
  equal: boolean
  left: string
  right: string
  changes: Change[]
  additions: number
  removals: number
}

export function compareJson(leftSource: string, rightSource: string): JsonComparison {
  const left = `${JSON.stringify(canonicalize(parseJson(leftSource, '左侧')), null, 2)}\n`
  const right = `${JSON.stringify(canonicalize(parseJson(rightSource, '右侧')), null, 2)}\n`
  const changes = diffLines(left, right, { newlineIsToken: true })
  return {
    equal: left === right,
    left,
    right,
    changes,
    additions: changes.filter((change) => change.added).reduce((sum, change) => sum + (change.count ?? 0), 0),
    removals: changes.filter((change) => change.removed).reduce((sum, change) => sum + (change.count ?? 0), 0),
  }
}
