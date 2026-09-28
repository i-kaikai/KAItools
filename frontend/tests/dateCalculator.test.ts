import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addChinaWorkdays,
  calculateAge,
  calculateDateInterval,
  getCountdown,
  getDateInformation,
  loadChinaHolidaySchedule,
  shiftCalendarDate,
} from '@/utils/dateCalculator'

const PAPER = 'https://www.gov.cn/zhengce/holiday-notice.htm'

function schedule(year: number, days: Array<{ date: string; isOffDay: boolean }> = [], papers = [PAPER]) {
  return { year, papers, days: days.map((day) => ({ ...day, name: '测试安排' })) }
}

function response(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response
}

function stubSchedules(items: Record<number, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const year = Number(String(input).match(/\/(\d{4})\.json$/)?.[1])
    if (!(year in items)) return response({}, 404)
    return response(items[year])
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('date calculator', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('shifts calendar dates by signed day, month, and year offsets', () => {
    expect(shiftCalendarDate('2024-02-28', 1, 'days')).toBe('2024-02-29')
    expect(shiftCalendarDate('2024-03-01', -1, 'days')).toBe('2024-02-29')
    expect(shiftCalendarDate('2026-01-31', 1, 'months')).toBe('2026-02-28')
    expect(shiftCalendarDate('2024-02-29', 1, 'years')).toBe('2025-02-28')
    expect(() => shiftCalendarDate('2026-01-01', 1.5, 'days')).toThrow('整数')
  })

  it('calculates signed date intervals and age at an arbitrary reference date', () => {
    expect(calculateDateInterval('2026-12-31', '2027-01-01')).toMatchObject({ totalDays: 1, years: 0, months: 0, days: 1 })
    expect(calculateDateInterval('2027-01-01', '2026-12-31').totalDays).toBe(-1)
    expect(calculateAge('2000-02-29', '2025-02-28')).toEqual({ years: 25, months: 0, days: 0 })
    expect(calculateAge('2001-01-31', '2001-02-28')).toEqual({ years: 0, months: 1, days: 0 })
    expect(() => calculateAge('2025-01-01', '2024-12-31')).toThrow('不能早于')
  })

  it('reports weekday, ISO week, day of year, leap year, and countdown direction', () => {
    expect(getDateInformation('2024-01-01')).toMatchObject({ weekday: '星期一', isoWeek: 1, dayOfYear: 1, leapYear: true })
    const target = new Date(2026, 0, 1, 0, 0, 10).getTime()
    expect(getCountdown('2026-01-01T00:00:10', target - 10_000)).toMatchObject({ expired: false, days: 0, hours: 0, minutes: 0, seconds: 10 })
    expect(getCountdown('2026-01-01T00:00:10', target + 2_000)).toMatchObject({ expired: true, seconds: 2 })
  })

  it('counts official days off and makeup workdays in both directions without counting the start date', async () => {
    stubSchedules({
      2025: schedule(2025),
      2026: schedule(2026, [
        { date: '2026-01-01', isOffDay: true },
        { date: '2026-01-03', isOffDay: false },
        { date: '2026-01-05', isOffDay: true },
      ]),
    })
    expect((await addChinaWorkdays('2026-01-01', 1)).date).toBe('2026-01-02')
    expect((await addChinaWorkdays('2026-01-02', 1)).date).toBe('2026-01-03')
    expect((await addChinaWorkdays('2026-01-03', 1)).date).toBe('2026-01-06')
    expect((await addChinaWorkdays('2026-01-05', -1)).date).toBe('2026-01-03')
    expect((await addChinaWorkdays('2025-12-31', 1)).date).toBe('2026-01-02')
    expect((await addChinaWorkdays('2026-01-05', 0)).date).toBe('2026-01-05')
  })

  it('requires next-year data before calculating December dates', async () => {
    stubSchedules({
      2026: schedule(2026),
      2027: schedule(2027, [], []),
    })
    await expect(addChinaWorkdays('2026-12-30', 1)).rejects.toThrow('尚未公布 2027 年')
  })

  it('caches valid schedules for seven days and revalidates stale data in the background', async () => {
    const fetchMock = stubSchedules({ 2026: schedule(2026) })
    await loadChinaHolidaySchedule(2026)
    await loadChinaHolidaySchedule(2026)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const key = 'kaitools.date-calculator.cn-calendar.v1.2026'
    const cached = JSON.parse(localStorage.getItem(key) ?? '{}')
    cached.fetchedAt = Date.now() - 8 * 24 * 60 * 60 * 1000
    localStorage.setItem(key, JSON.stringify(cached))
    const stale = await loadChinaHolidaySchedule(2026)
    expect(stale.stale).toBe(true)
    await stale.refresh
    expect(JSON.parse(localStorage.getItem(key) ?? '{}').fetchedAt).toBeGreaterThan(cached.fetchedAt)
  })

  it('uses stale cache after network errors and rejects missing, unpublished, or malformed data', async () => {
    stubSchedules({ 2026: schedule(2026) })
    await loadChinaHolidaySchedule(2026)
    const key = 'kaitools.date-calculator.cn-calendar.v1.2026'
    const cached = JSON.parse(localStorage.getItem(key) ?? '{}')
    cached.fetchedAt = 0
    localStorage.setItem(key, JSON.stringify(cached))

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const stale = await loadChinaHolidaySchedule(2026, true)
    expect(stale.stale).toBe(true)
    expect(stale.refreshError).toBe('offline')

    localStorage.clear()
    await expect(loadChinaHolidaySchedule(2026)).rejects.toThrow('offline')
    vi.stubGlobal('fetch', vi.fn(async () => response(schedule(2026, [], []))))
    await expect(loadChinaHolidaySchedule(2026)).rejects.toThrow('尚未公布 2026 年')
    vi.stubGlobal('fetch', vi.fn(async () => response({ year: 2026, papers: [PAPER], days: [{ date: '2026-01-01', isOffDay: 'yes' }] })))
    await expect(loadChinaHolidaySchedule(2026, true)).rejects.toThrow('格式无效')
  })
})
