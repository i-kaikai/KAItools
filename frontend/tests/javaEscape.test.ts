import { describe, expect, it } from 'vitest'

import { escapeJava, unescapeJava } from '@/utils/javaEscape'

describe('Java string transforms', () => {
  it('escapes Java control characters', () => {
    expect(escapeJava('line 1\n"line 2"\\')).toBe('line 1\\n\\"line 2\\"\\\\')
  })

  it('preserves Chinese by default and supports Unicode mode', () => {
    expect(escapeJava('工具')).toBe('工具')
    expect(escapeJava('工具', true)).toBe('\\u5DE5\\u5177')
  })

  it('unescapes Unicode, repeated u and octal escapes', () => {
    expect(unescapeJava('\\u5DE5\\uu5177\\141').value).toBe('工具a')
  })

  it('reports invalid escapes without pretending to succeed', () => {
    const result = unescapeJava('good\\x')
    expect(result.error?.offset).toBe(4)
    expect(result.value).toBe('good')
  })
})

