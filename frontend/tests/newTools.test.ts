// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { decodeBase64Text, encodeBase64Text } from '@/utils/base64'
import { getNextCronRuns } from '@/utils/cron'
import { formatSql, formatXml, formatYaml } from '@/utils/formatters'
import { compareJson } from '@/utils/jsonDiff'
import { javaBeanToJson, jsonToJavaBean } from '@/utils/jsonJava'
import { compareText, getTextStatistics } from '@/utils/text'

describe('new local developer tools', () => {
  it('round-trips UTF-8 text through Base64', () => {
    const source = '你好，DevToolkit'
    expect(decodeBase64Text(encodeBase64Text(source))).toBe(source)
    expect(encodeBase64Text('a?', true)).not.toContain('=')
  })

  it('compares JSON by object meaning while preserving array order', () => {
    expect(compareJson('{"a":1,"b":2}', '{"b":2,"a":1}').equal).toBe(true)
    expect(compareJson('{"items":[1,2]}', '{"items":[2,1]}').equal).toBe(false)
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
    const runs = getNextCronRuns('0 9 * * 1-5', 2, new Date('2026-08-14T10:00:00+08:00'))
    expect(runs).toHaveLength(2)
    expect(runs[0]?.getTime()).toBeGreaterThan(new Date('2026-08-14T10:00:00+08:00').getTime())
  })

  it('compares text and reports Unicode-aware statistics', () => {
    const changes = compareText('第一行\n旧内容', '第一行\n新内容', 'lines')
    expect(changes.some((part) => part.added)).toBe(true)
    expect(changes.some((part) => part.removed)).toBe(true)
    expect(getTextStatistics('你好 world\n第二行')).toMatchObject({ characters: 12, words: 1, lines: 2, chineseCharacters: 5 })
  })
})
