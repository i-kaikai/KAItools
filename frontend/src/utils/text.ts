import { diffChars, diffLines, type Change } from 'diff'

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
