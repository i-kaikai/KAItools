import { all, create, type MathJsStatic } from 'mathjs'
import { DateTime } from 'luxon'

const math = create(all!, { number: 'BigNumber', precision: 64, predictable: true, matrix: 'Matrix' }) as MathJsStatic
const FORBIDDEN_EXPRESSION = /\b(?:import|createUnit|evaluate|parse|compile|help)\b/i

export interface CalculatorHistoryEntry {
  id: string
  expression: string
  result: string
  createdAt: string
}

export function evaluateCalculatorExpression(expression: string): string {
  const source = expression.trim()
  if (!source) return ''
  if (source.length > 4_096 || FORBIDDEN_EXPRESSION.test(source)) throw new Error('表达式包含不支持的函数')
  return math.format(math.evaluate(source), { precision: 32, lowerExp: -12, upperExp: 12 })
}

export function convertUnit(value: string, targetUnit: string): string {
  if (!value.trim() || !targetUnit.trim()) return ''
  // Math.js follows SI's lowercase kilo prefix (kB), while developers commonly type KB.
  const normalizedTarget = targetUnit.trim().replace(/\bKB\b/g, 'kB')
  const formatted = math.format(math.unit(value).to(normalizedTarget), { precision: 20 })
  return targetUnit.trim() === 'KB' ? formatted.replace(/\bkB\b/g, 'KB') : formatted
}

function parseInteger(input: string, base: number): bigint {
  const source = input.trim().replace(/_/g, '')
  if (!source) throw new Error('请输入整数')
  const negative = source.startsWith('-')
  let body = negative ? source.slice(1) : source
  const prefix = base === 2 ? '0b' : base === 8 ? '0o' : base === 16 ? '0x' : ''
  if (prefix && body.toLowerCase().startsWith(prefix)) body = body.slice(prefix.length)
  if (!body) throw new Error('请输入整数')
  const digits = '0123456789abcdef'.slice(0, base)
  if (![...body.toLowerCase()].every((char) => digits.includes(char))) {
    const message = base === 2
      ? '二进制仅支持 0 和 1'
      : base === 8
        ? '八进制仅支持 0 到 7'
        : base === 10
          ? '十进制仅支持 0 到 9'
          : '十六进制仅支持 0 到 9 与 A 到 F'
    throw new Error(message)
  }
  let result = 0n
  for (const char of body.toLowerCase()) result = result * BigInt(base) + BigInt(digits.indexOf(char))
  return negative ? -result : result
}

/** Convert an existing programmer value when the input radix changes. */
export function convertProgrammerInput(input: string, fromBase: number, toBase: number): string {
  return parseInteger(input, fromBase).toString(toBase).toUpperCase()
}

export function convertProgrammerBase(input: string, fromBase: number, width: 8 | 16 | 32 | 64, signed: boolean): Record<'bin' | 'oct' | 'dec' | 'hex', string> {
  const value = parseInteger(input, fromBase)
  const normalized = signed ? BigInt.asIntN(width, value) : BigInt.asUintN(width, value)
  const unsigned = BigInt.asUintN(width, normalized)
  const baseValue = signed && normalized < 0n ? normalized : unsigned
  return {
    bin: unsigned.toString(2).padStart(width, '0'),
    oct: baseValue.toString(8),
    dec: baseValue.toString(10),
    hex: unsigned.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0'),
  }
}

export function calculateProgrammerOperation(left: string, right: string, operator: '&' | '|' | '^' | '<<' | '>>', base: number, width: 8 | 16 | 32 | 64): string {
  const a = BigInt.asUintN(width, parseInteger(left, base))
  const b = parseInteger(right, base)
  const value = operator === '&' ? a & b : operator === '|' ? a | b : operator === '^' ? a ^ b : operator === '<<' ? a << b : a >> b
  return BigInt.asUintN(width, value).toString(10)
}

export function calculateFinance(kind: 'simple' | 'compound' | 'loan' | 'tax', principal: string, annualRate: string, periods: string, taxRate = '0'): string {
  const amount = math.bignumber(principal || 0)
  const rate = math.divide(math.bignumber(annualRate || 0), 100)
  const count = Math.max(0, Number(periods || 0))
  if (!Number.isFinite(count)) throw new Error('期数必须为数字')
  if (kind === 'simple') return math.format(math.multiply(amount, math.add(1, math.multiply(rate, count))), { precision: 20 })
  if (kind === 'compound') return math.format(math.multiply(amount, math.pow(math.add(1, rate), count)), { precision: 20 })
  if (kind === 'loan') {
    const monthlyRate = math.divide(rate, 12)
    const months = Math.max(1, count)
    const payment = math.equal(monthlyRate, 0)
      ? math.divide(amount, months)
      : math.divide(math.multiply(amount, monthlyRate, math.pow(math.add(1, monthlyRate), months)), math.subtract(math.pow(math.add(1, monthlyRate), months), 1))
    return math.format(payment, { precision: 20 })
  }
  const afterTax = math.multiply(amount, math.subtract(1, math.divide(math.bignumber(taxRate || 0), 100)))
  return math.format(afterTax, { precision: 20 })
}

export function calculateDate(start: string, end: string, amount: string, unit: 'days' | 'months' | 'years'): { difference: string; shifted: string } {
  const startDate = DateTime.fromISO(start)
  const endDate = DateTime.fromISO(end)
  if (!startDate.isValid || !endDate.isValid) throw new Error('请输入有效日期')
  const difference = endDate.diff(startDate, ['years', 'months', 'days']).toObject()
  const shift = Number(amount || 0)
  if (!Number.isFinite(shift)) throw new Error('日期偏移必须为数字')
  return {
    difference: `${difference.years ?? 0} 年 ${difference.months ?? 0} 月 ${Math.floor(difference.days ?? 0)} 天`,
    shifted: startDate.plus({ [unit]: shift }).toISODate() ?? '',
  }
}

export function calculateEngineering(kind: 'matrix' | 'complex' | 'statistics', source: string, operation: string): string {
  if (kind === 'matrix') {
    const matrix = math.evaluate(source)
    const result = operation === 'transpose' ? math.transpose(matrix) : operation === 'det' ? math.det(matrix) : operation === 'inv' ? math.inv(matrix) : math.multiply(matrix, matrix)
    return math.format(result, { precision: 20 })
  }
  if (kind === 'complex') {
    const [left = '0', right = '0'] = source.split(',').map((item) => item.trim())
    const a = math.complex(left)
    const b = math.complex(right)
    const result = operation === 'add' ? math.add(a, b) : operation === 'sub' ? math.subtract(a, b) : operation === 'mul' ? math.multiply(a, b) : math.divide(a, b)
    return math.format(result, { precision: 20 })
  }
  const values = source.split(/[\s,]+/).filter(Boolean).map((item) => math.bignumber(item))
  if (!values.length) throw new Error('请输入至少一个数值')
  const result = operation === 'mean' ? math.mean(values) : operation === 'median' ? math.median(values) : operation === 'variance' ? math.variance(values) : math.std(values)
  return math.format(result, { precision: 20 })
}

const HISTORY_KEY = 'kaitools.calculator.history.v1'

export function loadCalculatorHistory(): CalculatorHistoryEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is CalculatorHistoryEntry => Boolean(item && typeof item.expression === 'string' && typeof item.result === 'string')).slice(0, 100) : []
  } catch {
    return []
  }
}

export function saveCalculatorHistory(items: CalculatorHistoryEntry[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 100)))
}
