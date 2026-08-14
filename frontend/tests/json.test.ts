import { describe, expect, it } from 'vitest'

import { formatJson, minifyJson, parseJsonDocument } from '@/utils/json'

describe('JSON tools', () => {
  it('formats without changing large integer lexemes', () => {
    const source = '{"id":900719925474099312345,"name":"demo"}'
    expect(formatJson(source, 2)).toContain('900719925474099312345')
  })

  it('preserves duplicate properties in code and tree output', () => {
    const source = '{"value":1,"value":2}'
    const formatted = formatJson(source, 2)
    expect(formatted.match(/"value"/g)).toHaveLength(2)
    const tree = parseJsonDocument(source).tree
    expect(tree?.children.map((item) => item.valueText)).toEqual(['1', '2'])
  })

  it('minifies only trivia', () => {
    expect(minifyJson('{\n  "message": "a b",\n  "ok": true\n}')).toBe('{"message":"a b","ok":true}')
  })

  it('rejects comments and trailing commas in strict mode', () => {
    expect(parseJsonDocument('{/* no */"a":1}').issues.length).toBeGreaterThan(0)
    expect(parseJsonDocument('{"a":1,}').issues.length).toBeGreaterThan(0)
  })
})

