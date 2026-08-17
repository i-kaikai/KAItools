// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { decodeBase64Text, encodeBase64Text } from '@/utils/base64'
import { describeCronExpression, getNextCronRuns, parseCronExpression } from '@/utils/cron'
import { formatSql, formatXml, formatYaml } from '@/utils/formatters'
import { compareJson } from '@/utils/jsonDiff'
import { javaBeanToJson, jsonToJavaBean } from '@/utils/jsonJava'
import { evaluateRegex, serializeRegexMatches } from '@/utils/regex'
import { workspaceTools } from '@/tools/registry'
import { compareText, getTextComparisonHighlights, getTextStatistics } from '@/utils/text'

describe('new local developer tools', () => {
  it('round-trips UTF-8 text through Base64', () => {
    const source = '你好，KAITools'
    expect(decodeBase64Text(encodeBase64Text(source))).toBe(source)
    expect(encodeBase64Text('a?', true)).not.toContain('=')
  })

  it('compares JSON by object meaning while preserving array order', () => {
    expect(compareJson('{"a":1,"b":2}', '{"b":2,"a":1}').equal).toBe(true)
    const comparison = compareJson('{"items":[1,2]}', '{"items":[2,1]}')
    expect(comparison.equal).toBe(false)
    expect(comparison.leftHighlights).toHaveLength(2)
    expect(comparison.rightHighlights).toHaveLength(2)
  })

  it('generates JavaBean source and extracts field defaults', () => {
    const java = jsonToJavaBean('{"id":1,"name":"demo","active":true,"tags":["a"]}', 'Profile')
    expect(java).toContain('public class Profile')
    expect(java).toContain('private Long id;')
    expect(java).toContain('private List<String> tags;')
    expect(JSON.parse(javaBeanToJson(java))).toEqual({ id: 0, name: '', active: false, tags: [] })
  })

  it('formats SQL, YAML and XML and reports malformed input', () => {
    expect(formatSql('select id from users where enabled=1', 'sql', 'upper', 2)).toContain('SELECT')
    expect(formatYaml('app: {name: demo, enabled: true}', 2)).toContain('name: demo')
    expect(formatXml('<root><item>demo</item></root>', 2)).toContain('\n  <item>demo</item>\n')
    expect(() => formatYaml('key: 1\nkey: 2', 2)).toThrow()
    expect(() => formatXml('<root>', 2)).toThrow()
  })

  it('computes future cron runs', () => {
    const runs = getNextCronRuns('0 9 * * 1-5', 2, new Date('2026-08-14T10:00:00+08:00'), 'Asia/Shanghai')
    expect(runs).toHaveLength(2)
    expect(runs[0]?.getTime()).toBeGreaterThan(new Date('2026-08-14T10:00:00+08:00').getTime())
    expect(parseCronExpression('*/15 9-18 * * 1-5')).toEqual({ minute: '*/15', hour: '9-18', day: '*', month: '*', weekday: '1-5' })
    expect(describeCronExpression('0 9 * * 1-5')).toBe('每个工作日 09:00 执行')
    expect(() => parseCronExpression('0 0 9 * * 1-5')).toThrow('必须包含 5 个字段')
  })

  it('compares text and reports Unicode-aware statistics', () => {
    const changes = compareText('第一行\n旧内容', '第一行\n新内容', 'lines')
    expect(changes.some((part) => part.added)).toBe(true)
    expect(changes.some((part) => part.removed)).toBe(true)
    const highlights = getTextComparisonHighlights('第一行\n旧内容', '第一行\n新内容', 'lines')
    expect(highlights.left).toEqual([{ from: 4, to: 7, kind: 'removed' }])
    expect(highlights.right).toEqual([{ from: 4, to: 7, kind: 'added' }])
    expect(getTextStatistics('你好 world\n第二行')).toMatchObject({ characters: 12, words: 1, lines: 2, chineseCharacters: 5 })
  })

  it('maps character highlights back to original text when whitespace is ignored', () => {
    const highlights = getTextComparisonHighlights('alpha   old', 'alpha new', 'characters', true)
    expect(highlights.left).toEqual([{ from: 8, to: 11, kind: 'removed' }])
    expect(highlights.right).toEqual([{ from: 6, to: 9, kind: 'added' }])
  })

  it('evaluates regular expressions with captures, highlights and replacement previews', () => {
    const result = evaluateRegex('order-2026-0817 order-2025-1201', 'order-(\\d{4})-(\\d{4})', 'g', '$1/$2')
    expect(result.error).toBe('')
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]).toMatchObject({ match: 'order-2026-0817', index: 0, captures: ['2026', '0817'] })
    expect(result.highlights).toEqual([
      { from: 0, to: 15, kind: 'match' },
      { from: 16, to: 31, kind: 'match' },
    ])
    expect(result.replacement).toBe('2026/0817 2025/1201')
    expect(JSON.parse(serializeRegexMatches(result.matches))).toHaveLength(2)
  })

  it('reports invalid regular expressions and terminates zero-width global matches', () => {
    expect(evaluateRegex('abc', '[', 'g').error).toBeTruthy()
    const zeroWidth = evaluateRegex('aa', '(?=a)', 'g')
    expect(zeroWidth.matches).toHaveLength(2)
    expect(zeroWidth.highlights).toHaveLength(0)
  })

  it('registers chain-compatible tools with deterministic input mappings', () => {
    const regex = workspaceTools.find((tool) => tool.id === 'regex')
    const json = workspaceTools.find((tool) => tool.id === 'json')
    expect(regex?.chainInput?.('alpha')).toEqual({ input: 'alpha' })
    expect(json?.chainInput?.('{"ok":true}')).toEqual({ input: '{"ok":true}', outputMode: 'code' })
    expect(workspaceTools.filter((tool) => tool.chainInput).length).toBeGreaterThanOrEqual(10)
  })
})
