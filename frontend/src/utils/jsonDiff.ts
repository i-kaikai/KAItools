import { diffArrays, diffLines, type Change } from 'diff'
import { findNodeAtLocation, parseTree, type JSONPath, type Node } from 'jsonc-parser'
import type { EditorHighlight, EditorHighlightKind } from '@/types'

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
  leftHighlights: EditorHighlight[]
  rightHighlights: EditorHighlight[]
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function collectDifferencePaths(
  left: unknown,
  right: unknown,
  leftPath: JSONPath,
  rightPath: JSONPath,
  leftPaths: JSONPath[],
  rightPaths: JSONPath[],
): void {
  if (equalJson(left, right)) return
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length === right.length) {
      left.forEach((value, index) => collectDifferencePaths(value, right[index], [...leftPath, index], [...rightPath, index], leftPaths, rightPaths))
      return
    }
    let leftIndex = 0
    let rightIndex = 0
    for (const change of diffArrays(left, right, { comparator: equalJson })) {
      if (change.removed) {
        change.value.forEach((_, index) => leftPaths.push([...leftPath, leftIndex + index]))
        leftIndex += change.count
      } else if (change.added) {
        change.value.forEach((_, index) => rightPaths.push([...rightPath, rightIndex + index]))
        rightIndex += change.count
      } else {
        leftIndex += change.count
        rightIndex += change.count
      }
    }
    return
  }
  if (isObject(left) && isObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      if (!(key in right)) leftPaths.push([...leftPath, key])
      else if (!(key in left)) rightPaths.push([...rightPath, key])
      else collectDifferencePaths(left[key], right[key], [...leftPath, key], [...rightPath, key], leftPaths, rightPaths)
    }
    return
  }
  leftPaths.push(leftPath)
  rightPaths.push(rightPath)
}

function nodeHighlight(node: Node, kind: EditorHighlightKind): EditorHighlight {
  const target = node.parent?.type === 'property' ? node.parent : node
  return { from: target.offset, to: target.offset + target.length, kind }
}

function highlightsForPaths(source: string, paths: JSONPath[], kind: EditorHighlightKind): EditorHighlight[] {
  const root = parseTree(source)
  if (!root) return []
  const unique = new Map<string, EditorHighlight>()
  for (const path of paths) {
    const node = findNodeAtLocation(root, path)
    if (!node) continue
    const highlight = nodeHighlight(node, kind)
    unique.set(`${highlight.from}:${highlight.to}`, highlight)
  }
  return [...unique.values()]
}

export function compareJson(leftSource: string, rightSource: string): JsonComparison {
  const leftValue = parseJson(leftSource, '左侧')
  const rightValue = parseJson(rightSource, '右侧')
  const left = `${JSON.stringify(canonicalize(leftValue), null, 2)}\n`
  const right = `${JSON.stringify(canonicalize(rightValue), null, 2)}\n`
  const changes = diffLines(left, right, { newlineIsToken: true })
  const leftPaths: JSONPath[] = []
  const rightPaths: JSONPath[] = []
  collectDifferencePaths(leftValue, rightValue, [], [], leftPaths, rightPaths)
  return {
    equal: left === right,
    left,
    right,
    changes,
    additions: changes.filter((change) => change.added).reduce((sum, change) => sum + (change.count ?? 0), 0),
    removals: changes.filter((change) => change.removed).reduce((sum, change) => sum + (change.count ?? 0), 0),
    leftHighlights: highlightsForPaths(leftSource, leftPaths, 'removed'),
    rightHighlights: highlightsForPaths(rightSource, rightPaths, 'added'),
  }
}
