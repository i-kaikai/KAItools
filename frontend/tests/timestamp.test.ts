import { describe, expect, it } from 'vitest'

import { parseDateTime, parseFlexibleDateTime, parseTimestamp } from '@/utils/timestamp'

describe('timestamp tools', () => {
  it('recognizes seconds and milliseconds', () => {
    expect(parseTimestamp('1704067200', 'auto', 'UTC').milliseconds).toBe(1704067200000)
    expect(parseTimestamp('1704067200000', 'auto', 'UTC').seconds).toBe(1704067200)
  })

  it('formats a timestamp in an IANA zone', () => {
    expect(parseTimestamp('0', 'seconds', 'Asia/Shanghai').zoned).toContain('1970-01-01 08:00:00')
  })

  it('converts a zoned date to epoch', () => {
    expect(parseDateTime('1970-01-01T08:00', 'Asia/Shanghai').seconds).toBe(0)
  })

  it('rejects a nonexistent daylight-saving time', () => {
    expect(() => parseDateTime('2024-03-10T02:30', 'America/New_York')).toThrow()
  })

  it.each([
    ['2024-01-01 08:00:00', 1704067200, 'yyyy-MM-dd HH:mm:ss'],
    ['2024/01/01 08:00', 1704067200, 'yyyy/MM/dd HH:mm'],
    ['2024年1月1日 08时00分00秒', 1704067200, '中文日期时间'],
    ['20240101080000', 1704067200, '紧凑日期时间'],
    ['Mon, 01 Jan 2024 00:00:00 GMT', 1704067200, 'RFC 2822'],
  ])('auto-detects %s', (input, seconds, detectedFormat) => {
    const result = parseFlexibleDateTime(input, 'Asia/Shanghai')
    expect(result.seconds).toBe(seconds)
    expect(result.detectedFormat).toBe(detectedFormat)
  })

  it('reports input it cannot identify', () => {
    expect(() => parseFlexibleDateTime('not a date', 'UTC')).toThrow('无法识别')
  })

  it('accepts its own date outputs as new input', () => {
    const original = parseFlexibleDateTime('1704067200', 'Asia/Shanghai')
    for (const output of [original.iso, original.utc, original.zoned, original.local]) {
      expect(parseFlexibleDateTime(output, 'Asia/Shanghai').milliseconds).toBe(original.milliseconds)
    }
  })
})
