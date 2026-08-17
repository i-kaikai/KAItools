import { CronExpressionParser } from 'cron-parser'

export interface CronFields {
  minute: string
  hour: string
  day: string
  month: string
  weekday: string
}

export function buildCronExpression(fields: CronFields): string {
  return [fields.minute, fields.hour, fields.day, fields.month, fields.weekday]
    .map((field) => field.trim() || '*')
    .join(' ')
}

export function parseCronExpression(expression: string): CronFields {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error('标准 Crontab 表达式必须包含 5 个字段')
  CronExpressionParser.parse(fields.join(' '))
  const [minute, hour, day, month, weekday] = fields
  return { minute: minute!, hour: hour!, day: day!, month: month!, weekday: weekday! }
}

function padded(value: string): string {
  return /^\d+$/.test(value) ? value.padStart(2, '0') : value
}

export function describeCronExpression(expression: string): string {
  const fields = parseCronExpression(expression)
  const { minute, hour, day, month, weekday } = fields
  const time = `${padded(hour)}:${padded(minute)}`
  if (expression === '* * * * *') return '每分钟执行一次'
  const minuteStep = minute.match(/^\*\/(\d+)$/)?.[1]
  if (minuteStep && hour === '*' && day === '*' && month === '*' && weekday === '*') return `每 ${minuteStep} 分钟执行一次`
  if (/^\d+$/.test(minute) && hour === '*' && day === '*' && month === '*' && weekday === '*') return `每小时的第 ${padded(minute)} 分执行`
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    if (day === '*' && month === '*' && weekday === '1-5') return `每个工作日 ${time} 执行`
    if (day === '*' && month === '*' && /^(0,6|6,0)$/.test(weekday)) return `每个周末 ${time} 执行`
    if (day === '*' && month === '*' && weekday === '*') return `每天 ${time} 执行`
    if (/^\d+$/.test(day) && month === '*' && weekday === '*') return `每月 ${day} 日 ${time} 执行`
    if (/^\d+$/.test(day) && /^\d+$/.test(month) && weekday === '*') return `每年 ${month} 月 ${day} 日 ${time} 执行`
  }
  return `分钟 ${minute}，小时 ${hour}，日期 ${day}，月份 ${month}，星期 ${weekday}`
}

export function getNextCronRuns(expression: string, count = 5, currentDate = new Date(), timeZone?: string): Date[] {
  try {
    parseCronExpression(expression)
    const interval = CronExpressionParser.parse(expression, { currentDate, tz: timeZone })
    return interval.take(count).map((date) => date.toDate())
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Cron 表达式无效')
  }
}
