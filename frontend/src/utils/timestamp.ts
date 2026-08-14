import { DateTime, IANAZone } from 'luxon'

export type TimestampUnit = 'auto' | 'seconds' | 'milliseconds'

export interface TimeResult {
  milliseconds: number
  seconds: number
  iso: string
  local: string
  utc: string
  zoned: string
  offset: string
  zone: string
  detectedFormat: string
}

function resultFromDateTime(value: DateTime, zone: string, detectedFormat: string): TimeResult {
  const zoned = value.setZone(zone)
  return {
    milliseconds: value.toMillis(),
    seconds: Math.trunc(value.toMillis() / 1000),
    iso: value.toUTC().toISO({ suppressMilliseconds: false }) ?? '',
    local: value.toLocal().toFormat('yyyy-LL-dd HH:mm:ss.SSS ZZZZ'),
    utc: value.toUTC().toFormat("yyyy-LL-dd HH:mm:ss.SSS 'UTC'"),
    zoned: zoned.toFormat('yyyy-LL-dd HH:mm:ss.SSS ZZZZ'),
    offset: zoned.toFormat('ZZ'),
    zone,
    detectedFormat,
  }
}

export function validTimeZone(zone: string): boolean {
  return IANAZone.isValidZone(zone)
}

export function parseTimestamp(input: string, unit: TimestampUnit, zone: string): TimeResult {
  const trimmed = input.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) throw new Error('请输入有效数字时间戳')
  if (!validTimeZone(zone)) throw new Error('时区无效')
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) throw new Error('时间戳超出可处理范围')
  const detectedUnit = unit === 'auto' ? (Math.abs(numeric) >= 100_000_000_000 ? 'milliseconds' : 'seconds') : unit
  const milliseconds = detectedUnit === 'seconds' ? numeric * 1000 : numeric
  const value = DateTime.fromMillis(milliseconds)
  if (!value.isValid) throw new Error(value.invalidExplanation ?? '时间戳无效')
  return resultFromDateTime(value, zone, detectedUnit === 'seconds' ? '秒时间戳' : '毫秒时间戳')
}

export function parseDateTime(input: string, zone: string): TimeResult {
  return parseFlexibleDateTime(input, zone)
}

interface FormatCandidate {
  format: string
  label: string
  locale?: string
}

const COMMON_FORMATS: FormatCandidate[] = [
  { format: 'yyyy-LL-dd HH:mm:ss.SSS', label: 'yyyy-MM-dd HH:mm:ss.SSS' },
  { format: 'yyyy-LL-dd HH:mm:ss', label: 'yyyy-MM-dd HH:mm:ss' },
  { format: 'yyyy-LL-dd HH:mm', label: 'yyyy-MM-dd HH:mm' },
  { format: 'yyyy-LL-dd', label: 'yyyy-MM-dd' },
  { format: 'yyyy/LL/dd HH:mm:ss', label: 'yyyy/MM/dd HH:mm:ss' },
  { format: 'yyyy/LL/dd HH:mm', label: 'yyyy/MM/dd HH:mm' },
  { format: 'yyyy/LL/dd', label: 'yyyy/MM/dd' },
  { format: 'dd/LL/yyyy HH:mm:ss', label: 'dd/MM/yyyy HH:mm:ss' },
  { format: 'dd/LL/yyyy HH:mm', label: 'dd/MM/yyyy HH:mm' },
  { format: 'dd/LL/yyyy', label: 'dd/MM/yyyy' },
  { format: 'LL/dd/yyyy HH:mm:ss', label: 'MM/dd/yyyy HH:mm:ss' },
  { format: 'LL/dd/yyyy HH:mm', label: 'MM/dd/yyyy HH:mm' },
  { format: 'LL/dd/yyyy', label: 'MM/dd/yyyy' },
  { format: 'yyyy年M月d日 HH时mm分ss秒', label: '中文日期时间' },
  { format: 'yyyy年M月d日 HH:mm:ss', label: '中文日期时间' },
  { format: 'yyyy年M月d日', label: '中文日期' },
  { format: 'yyyyLLddHHmmss', label: '紧凑日期时间' },
  { format: 'yyyyLLdd', label: '紧凑日期' },
  { format: 'MMM d, yyyy h:mm:ss a', label: '英文日期时间', locale: 'en' },
  { format: 'MMM d, yyyy h:mm a', label: '英文日期时间', locale: 'en' },
]

function validCandidate(value: DateTime, input: string, format: string): boolean {
  return value.isValid && value.toFormat(format).toLowerCase() === input.toLowerCase()
}

export function parseFlexibleDateTime(input: string, zone: string): TimeResult {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('请输入日期、时间或时间戳')
  if (!validTimeZone(zone)) throw new Error('时区无效')

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed) && !/^\d{8}(?:\d{6})?$/.test(trimmed)) {
    return parseTimestamp(trimmed, 'auto', zone)
  }

  const utcValue = DateTime.fromFormat(trimmed, "yyyy-LL-dd HH:mm:ss.SSS 'UTC'", {
    zone: 'UTC',
    setZone: true,
  })
  if (utcValue.isValid && utcValue.toFormat("yyyy-LL-dd HH:mm:ss.SSS 'UTC'") === trimmed) {
    return resultFromDateTime(utcValue, zone, 'UTC 日期时间')
  }

  const gmtMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) GMT([+-])(\d{1,2})(?::(\d{2}))?$/i)
  if (gmtMatch) {
    const datePart = gmtMatch[1]!
    const sign = gmtMatch[2]!
    const hour = gmtMatch[3]!
    const minute = gmtMatch[4] ?? '00'
    const normalized = `${datePart} ${sign}${hour.padStart(2, '0')}:${minute}`
    const gmtValue = DateTime.fromFormat(normalized, 'yyyy-LL-dd HH:mm:ss.SSS ZZ', { setZone: true })
    if (gmtValue.isValid) return resultFromDateTime(gmtValue, zone, '带 UTC 偏移的日期时间')
  }

  const iso = DateTime.fromISO(trimmed, { zone, setZone: true })
  if (iso.isValid) {
    const localIso = !/[zZ]|[+-]\d{2}:?\d{2}|\[[^\]]+\]$/.test(trimmed)
    const localParts = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
    if (localIso && localParts) {
      const [, year, month, day, hour = '00', minute = '00', second = '00'] = localParts
      if (iso.toFormat('yyyy-LL-dd HH:mm:ss') !== `${year}-${month}-${day} ${hour}:${minute}:${second}`) {
        throw new Error('该时间在所选时区中不存在，可能处于夏令时跳变区间')
      }
    }
    return resultFromDateTime(iso, zone, 'ISO 8601')
  }

  for (const candidate of COMMON_FORMATS) {
    const value = DateTime.fromFormat(trimmed, candidate.format, {
      zone,
      locale: candidate.locale,
      setZone: true,
    })
    if (validCandidate(value, trimmed, candidate.format)) {
      return resultFromDateTime(value, zone, candidate.label)
    }
  }

  const rfc2822 = DateTime.fromRFC2822(trimmed, { zone, setZone: true })
  if (rfc2822.isValid) return resultFromDateTime(rfc2822, zone, 'RFC 2822')
  const http = DateTime.fromHTTP(trimmed, { zone, setZone: true })
  if (http.isValid) return resultFromDateTime(http, zone, 'HTTP 日期')
  const sql = DateTime.fromSQL(trimmed, { zone, setZone: true })
  if (sql.isValid) return resultFromDateTime(sql, zone, 'SQL 日期时间')

  throw new Error('无法识别该日期格式')
}

export function timeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  return intl.supportedValuesOf?.('timeZone') ?? ['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'America/New_York']
}
