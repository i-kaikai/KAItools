import { DateTime } from 'luxon'

const CACHE_KEY_PREFIX = 'kaitools.date-calculator.cn-calendar.v1.'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_WORKDAY_OFFSET = 36_000
const MAX_CALENDAR_STEPS = 40_000
const SCHEDULE_URL = 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master'

export type CalendarOffsetUnit = 'days' | 'months' | 'years'
export type DateMode = 'add' | 'interval' | 'countdown' | 'age'

interface HolidayRecord {
  name: string
  date: string
  isOffDay: boolean
}

export interface ChinaHolidaySchedule {
  year: number
  papers: string[]
  days: HolidayRecord[]
}

interface CachedSchedule {
  schemaVersion: 1
  fetchedAt: number
  schedule: ChinaHolidaySchedule
}

interface ScheduleLoad {
  schedule: ChinaHolidaySchedule
  fetchedAt: number
  stale: boolean
  refresh?: Promise<ScheduleLoad>
  refreshError?: string
}

export interface WorkdayCalculation {
  date: string
  sourceYears: number[]
  staleYears: number[]
  updatedAt: number[]
  refreshes: Promise<ScheduleLoad>[]
  refreshErrors: string[]
}

function utcDate(value: string): DateTime {
  const date = DateTime.fromISO(value, { zone: 'utc' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !date.isValid || date.toISODate() !== value) {
    throw new Error('请输入有效日期')
  }
  return date
}

function parseSchedule(year: number, value: unknown): ChinaHolidaySchedule {
  if (!value || typeof value !== 'object') throw new Error('日历数据格式无效')
  const input = value as Record<string, unknown>
  if (input.year !== year || !Array.isArray(input.papers) || !Array.isArray(input.days)) {
    throw new Error('日历数据格式无效')
  }
  if (!input.papers.length || !input.papers.every((paper) => typeof paper === 'string' && /^https:\/\//.test(paper))) {
    throw new Error(`尚未公布 ${year} 年工作日历`)
  }

  const days = new Map<string, HolidayRecord>()
  for (const rawDay of input.days) {
    if (!rawDay || typeof rawDay !== 'object') throw new Error('日历数据格式无效')
    const day = rawDay as Record<string, unknown>
    if (typeof day.date !== 'string' || typeof day.name !== 'string' || typeof day.isOffDay !== 'boolean') {
      throw new Error('日历数据格式无效')
    }
    const parsedDate = utcDate(day.date)
    if (parsedDate.year !== year && parsedDate.year !== year - 1) throw new Error('日历数据包含无效年份')
    const record = { date: day.date, name: day.name, isOffDay: day.isOffDay }
    const existing = days.get(record.date)
    if (existing && existing.isOffDay !== record.isOffDay) throw new Error('日历数据存在冲突日期')
    days.set(record.date, record)
  }

  return { year, papers: input.papers as string[], days: [...days.values()] }
}

function readCachedSchedule(year: number): CachedSchedule | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${year}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.schemaVersion !== 1 || typeof parsed.fetchedAt !== 'number' || !Number.isFinite(parsed.fetchedAt)) {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}${year}`)
      return null
    }
    const cached = { schemaVersion: 1 as const, fetchedAt: parsed.fetchedAt, schedule: parseSchedule(year, parsed.schedule) }
    return cached
  } catch {
    try { localStorage.removeItem(`${CACHE_KEY_PREFIX}${year}`) } catch { /* Storage may be unavailable. */ }
    return null
  }
}

async function fetchSchedule(year: number): Promise<CachedSchedule> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${SCHEDULE_URL}/${year}.json`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 404) throw new Error(`尚未公布 ${year} 年工作日历`)
      throw new Error(`工作日历请求失败（HTTP ${response.status}）`)
    }
    const schedule = parseSchedule(year, await response.json())
    const cached: CachedSchedule = { schemaVersion: 1, fetchedAt: Date.now(), schedule }
    try { localStorage.setItem(`${CACHE_KEY_PREFIX}${year}`, JSON.stringify(cached)) } catch { /* Storage may be unavailable; the current calculation can still use this response. */ }
    return cached
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('工作日历请求超时')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function loadChinaHolidaySchedule(year: number, forceRefresh = false): Promise<ScheduleLoad> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error(`暂不支持查询 ${year} 年工作日历`)
  const cached = readCachedSchedule(year)
  if (cached && !forceRefresh && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { schedule: cached.schedule, fetchedAt: cached.fetchedAt, stale: false }
  }

  if (cached && !forceRefresh) {
    const refresh = fetchSchedule(year).then((result) => ({ schedule: result.schedule, fetchedAt: result.fetchedAt, stale: false }))
    return { schedule: cached.schedule, fetchedAt: cached.fetchedAt, stale: true, refresh }
  }

  try {
    const result = await fetchSchedule(year)
    return { schedule: result.schedule, fetchedAt: result.fetchedAt, stale: false }
  } catch (error) {
    if (cached) {
      return {
        schedule: cached.schedule,
        fetchedAt: cached.fetchedAt,
        stale: true,
        refreshError: error instanceof Error ? error.message : '工作日历更新失败',
      }
    }
    throw error
  }
}

export function shiftCalendarDate(start: string, amount: string | number, unit: CalendarOffsetUnit): string {
  const date = utcDate(start)
  const offset = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isSafeInteger(offset)) throw new Error('日期偏移量必须是整数')
  const shifted = date.plus({ [unit]: offset })
  if (!shifted.isValid || !shifted.toISODate()) throw new Error('日期偏移超出可计算范围')
  return shifted.toISODate()!
}

export function calculateDateInterval(start: string, end: string): { totalDays: number; years: number; months: number; days: number } {
  const startDate = utcDate(start)
  const endDate = utcDate(end)
  const parts = endDate.diff(startDate, ['years', 'months', 'days']).toObject()
  return {
    totalDays: endDate.diff(startDate, 'days').days,
    years: parts.years ?? 0,
    months: parts.months ?? 0,
    days: Math.trunc(parts.days ?? 0),
  }
}

export function calculateAge(birthDate: string, asOfDate: string): { years: number; months: number; days: number } {
  const birth = utcDate(birthDate)
  const asOf = utcDate(asOfDate)
  if (asOf < birth) throw new Error('截至日期不能早于出生日期')
  const anniversary = (year: number): DateTime => {
    const day = birth.month === 2 && birth.day === 29 && !DateTime.utc(year, 2, 29).isValid ? 28 : birth.day
    return DateTime.utc(year, birth.month, day)
  }
  let years = asOf.year - birth.year
  if (asOf < anniversary(asOf.year)) years -= 1
  const lastBirthday = anniversary(birth.year + years)
  let months = (asOf.year - lastBirthday.year) * 12 + asOf.month - lastBirthday.month
  if (lastBirthday.plus({ months }) > asOf) months -= 1
  const monthAnchor = lastBirthday.plus({ months })
  return { years, months, days: Math.trunc(asOf.diff(monthAnchor, 'days').days) }
}

export function getDateInformation(value: string): { weekday: string; isoWeek: number; dayOfYear: number; leapYear: boolean } {
  const date = utcDate(value).setLocale('zh-CN')
  return {
    weekday: date.toFormat('cccc'),
    isoWeek: date.weekNumber,
    dayOfYear: date.ordinal,
    leapYear: date.isInLeapYear,
  }
}

export function getCountdown(target: string, nowMillis: number): { expired: boolean; days: number; hours: number; minutes: number; seconds: number } {
  const targetDate = DateTime.fromISO(target, { setZone: true })
  if (!targetDate.isValid || !target.includes('T')) throw new Error('请输入有效日期和时间')
  let seconds = Math.floor((targetDate.toMillis() - nowMillis) / 1000)
  const expired = seconds < 0
  seconds = Math.abs(seconds)
  return {
    expired,
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3_600),
    minutes: Math.floor((seconds % 3_600) / 60),
    seconds: seconds % 60,
  }
}

export async function addChinaWorkdays(
  start: string,
  amount: string | number,
  options: { forceRefresh?: boolean } = {},
): Promise<WorkdayCalculation> {
  let date = utcDate(start)
  const offset = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isSafeInteger(offset) || Math.abs(offset) > MAX_WORKDAY_OFFSET) {
    throw new Error(`工作日偏移量须为 ${MAX_WORKDAY_OFFSET.toLocaleString('zh-CN')} 以内的整数`)
  }
  if (offset === 0) return { date: start, sourceYears: [], staleYears: [], updatedAt: [], refreshes: [], refreshErrors: [] }

  const sourceLoads = new Map<number, ScheduleLoad>()
  const sourceYears = new Set<number>()
  const staleYears = new Set<number>()
  const updatedAt = new Set<number>()
  const refreshes: Promise<ScheduleLoad>[] = []
  const refreshErrors: string[] = []
  const direction = Math.sign(offset)
  let remaining = Math.abs(offset)

  async function loadSource(year: number): Promise<ScheduleLoad> {
    let result = sourceLoads.get(year)
    if (!result) {
      result = await loadChinaHolidaySchedule(year, options.forceRefresh)
      sourceLoads.set(year, result)
      sourceYears.add(year)
      updatedAt.add(result.fetchedAt)
      if (result.stale) staleYears.add(year)
      if (result.refreshError) refreshErrors.push(result.refreshError)
      if (result.refresh) refreshes.push(result.refresh)
    }
    return result
  }

  for (let steps = 0; remaining > 0; steps += 1) {
    if (steps >= MAX_CALENDAR_STEPS) throw new Error('日期跨度超出可计算范围')
    date = date.plus({ days: direction })
    if (!date.isValid) throw new Error('日期偏移超出可计算范围')

    const schedule = await loadSource(date.year)
    const exceptions = new Map(schedule.schedule.days.map((day) => [day.date, day.isOffDay]))
    if (date.month === 12) {
      const nextSchedule = await loadSource(date.year + 1)
      nextSchedule.schedule.days.forEach((day) => exceptions.set(day.date, day.isOffDay))
    }
    const isoDate = date.toISODate()!
    const offDay = exceptions.get(isoDate)
    const isWorkday = offDay === undefined ? date.weekday <= 5 : !offDay
    if (isWorkday) remaining -= 1
  }

  return {
    date: date.toISODate()!,
    sourceYears: [...sourceYears],
    staleYears: [...staleYears],
    updatedAt: [...updatedAt],
    refreshes,
    refreshErrors,
  }
}
