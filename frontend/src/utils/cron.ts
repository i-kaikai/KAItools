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

export function getNextCronRuns(expression: string, count = 5, currentDate = new Date()): Date[] {
  try {
    const interval = CronExpressionParser.parse(expression, { currentDate })
    return interval.take(count).map((date) => date.toDate())
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Cron 表达式无效')
  }
}
