import { describe, expect, it } from 'vitest'

import { formatJson, minifyJson, parseJsonDocument, replaceJsonNode } from '@/utils/json'
import { layoutJsonGraph } from '@/utils/jsonGraph'

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

  it('lays out every visible JSON relationship and respects collapsed nodes', () => {
    const tree = parseJsonDocument('{"user":{"id":900719925474099312345,"roles":["admin","editor"]}}').tree!
    const expanded = layoutJsonGraph(tree, new Set())
    expect(expanded.nodes).toHaveLength(3)
    expect(expanded.edges).toHaveLength(2)
    const userNode = expanded.nodes.find((node) => node.item.key === 'user')
    expect(userNode?.entries.map((entry) => entry.item.key)).toEqual(['id', 'roles'])
    expect(userNode?.entries.find((entry) => entry.item.key === 'id')?.item.valueText).toBe('900719925474099312345')

    const user = tree.children[0]!
    const collapsed = layoutJsonGraph(tree, new Set([user.id]))
    expect(collapsed.nodes.map((node) => node.item.key)).toEqual(['$', 'user'])
    expect(collapsed.nodes.find((node) => node.item.key === 'user')?.collapsed).toBe(true)
  })

  it('replaces an editable graph node without parsing away large integers', () => {
    const source = '{\n  "user": {\n    "id": 900719925474099312345,\n    "name": "old"\n  }\n}'
    const user = parseJsonDocument(source).tree!.children[0]!
    const updated = replaceJsonNode(source, user, '{\n  "id": 900719925474099312345,\n  "name": "new"\n}')
    expect(updated).toContain('900719925474099312345')
    expect(updated).toContain('"name": "new"')
    expect(parseJsonDocument(updated).issues).toHaveLength(0)
  })
})
