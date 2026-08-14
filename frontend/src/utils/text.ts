import { diffChars, diffLines, type Change } from 'diff'
import type { EditorHighlight } from '@/types'

export interface TextStatistics {
  characters: number
  charactersWithoutWhitespace: number
  words: number
  lines: number
  paragraphs: number
  chineseCharacters: number
  bytes: number
}

export function getTextStatistics(value: string): TextStatistics {
  const trimmed = value.trim()
  return {
    characters: Array.from(value).length,
    charactersWithoutWhitespace: Array.from(value.replace(/\s/g, '')).length,
    words: trimmed ? trimmed.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0 : 0,
    lines: value ? value.split(/\r\n|\r|\n/).length : 0,
    paragraphs: trimmed ? trimmed.split(/(?:\r?\n){2,}/).filter((part) => part.trim()).length : 0,
    chineseCharacters: value.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g)?.length ?? 0,
    bytes: new TextEncoder().encode(value).length,
  }
}

export function compareText(
  left: string,
  right: string,
  mode: 'lines' | 'characters',
  ignoreWhitespace = false,
): Change[] {
  if (mode === 'lines') return diffLines(left, right, { ignoreWhitespace, newlineIsToken: true })
  const normalize = (value: string) => (ignoreWhitespace ? value.replace(/\s+/g, ' ') : value)
  return diffChars(normalize(left), normalize(right))
}

interface TextComparisonHighlights {
  left: EditorHighlight[]
  right: EditorHighlight[]
}

interface OffsetToken {
  from: number
  to: number
}

function lineTokens(value: string): OffsetToken[] {
  const parts = value.split(/(\n|\r\n)/)
  if (!parts[parts.length - 1]) parts.pop()
  let offset = 0
  return parts.map((part) => {
    const token = { from: offset, to: offset + part.length }
    offset += part.length
    return token
  })
}

function tokenHighlight(tokens: OffsetToken[], index: number, count: number, kind: EditorHighlight['kind']): EditorHighlight | null {
  const first = tokens[index]
  const last = tokens[index + count - 1]
  if (!first || !last || last.to <= first.from) return null
  return { from: first.from, to: last.to, kind }
}

function lineHighlights(left: string, right: string, changes: Change[]): TextComparisonHighlights {
  const leftTokens = lineTokens(left)
  const rightTokens = lineTokens(right)
  const highlights: TextComparisonHighlights = { left: [], right: [] }
  let leftIndex = 0
  let rightIndex = 0
  for (const change of changes) {
    const count = change.count ?? 0
    if (change.removed) {
      const highlight = tokenHighlight(leftTokens, leftIndex, count, 'removed')
      if (highlight) highlights.left.push(highlight)
      leftIndex += count
    } else if (change.added) {
      const highlight = tokenHighlight(rightTokens, rightIndex, count, 'added')
      if (highlight) highlights.right.push(highlight)
      rightIndex += count
    } else {
      leftIndex += count
      rightIndex += count
    }
  }
  return highlights
}

function normalizeWithOffsets(value: string, ignoreWhitespace: boolean): { value: string; offsets: number[] } {
  if (!ignoreWhitespace) return { value, offsets: Array.from({ length: value.length + 1 }, (_, index) => index) }
  let normalized = ''
  const offsets = [0]
  let sourceIndex = 0
  for (const match of value.matchAll(/\s+/g)) {
    const start = match.index
    for (; sourceIndex < start; sourceIndex += 1) {
      normalized += value[sourceIndex]
      offsets.push(sourceIndex + 1)
    }
    normalized += ' '
    sourceIndex = start + match[0].length
    offsets.push(sourceIndex)
  }
  for (; sourceIndex < value.length; sourceIndex += 1) {
    normalized += value[sourceIndex]
    offsets.push(sourceIndex + 1)
  }
  return { value: normalized, offsets }
}

function characterHighlights(left: string, right: string, ignoreWhitespace: boolean): TextComparisonHighlights {
  const normalizedLeft = normalizeWithOffsets(left, ignoreWhitespace)
  const normalizedRight = normalizeWithOffsets(right, ignoreWhitespace)
  const changes = diffChars(normalizedLeft.value, normalizedRight.value)
  const highlights: TextComparisonHighlights = { left: [], right: [] }
  let leftOffset = 0
  let rightOffset = 0
  for (const change of changes) {
    const length = change.value.length
    if (change.removed) {
      highlights.left.push({
        from: normalizedLeft.offsets[leftOffset] ?? left.length,
        to: normalizedLeft.offsets[leftOffset + length] ?? left.length,
        kind: 'removed',
      })
      leftOffset += length
    } else if (change.added) {
      highlights.right.push({
        from: normalizedRight.offsets[rightOffset] ?? right.length,
        to: normalizedRight.offsets[rightOffset + length] ?? right.length,
        kind: 'added',
      })
      rightOffset += length
    } else {
      leftOffset += length
      rightOffset += length
    }
  }
  return highlights
}

export function getTextComparisonHighlights(
  left: string,
  right: string,
  mode: 'lines' | 'characters',
  ignoreWhitespace = false,
): TextComparisonHighlights {
  if (mode === 'characters') return characterHighlights(left, right, ignoreWhitespace)
  return lineHighlights(left, right, compareText(left, right, mode, ignoreWhitespace))
}
