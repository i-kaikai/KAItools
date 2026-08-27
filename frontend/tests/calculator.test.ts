import { beforeEach, describe, expect, it } from 'vitest'

import {
  calculateDate,
  calculateEngineering,
  calculateFinance,
  calculateProgrammerOperation,
  convertProgrammerBase,
  convertProgrammerInput,
  convertUnit,
  evaluateCalculatorExpression,
  loadCalculatorHistory,
  saveCalculatorHistory,
} from '@/utils/calculator'

describe('super calculator', () => {
  beforeEach(() => localStorage.clear())

  it('evaluates scientific expressions with BigNumber precision', () => {
    expect(evaluateCalculatorExpression('sqrt(2)^2 + sin(pi / 2)')).toBe('3')
    expect(() => evaluateCalculatorExpression('import("x")')).toThrow('不支持')
  })

  it('converts bases and applies width-aware bit operations', () => {
    expect(convertProgrammerBase('FF', 16, 8, false)).toMatchObject({ bin: '11111111', dec: '255', hex: 'FF' })
    expect(convertProgrammerInput('255', 10, 2)).toBe('11111111')
    expect(convertProgrammerInput('0b1111_1111', 2, 16)).toBe('FF')
    expect(convertProgrammerInput('0xFF', 16, 10)).toBe('255')
    expect(() => convertProgrammerBase('2', 2, 8, false)).toThrow('二进制仅支持 0 和 1')
    expect(calculateProgrammerOperation('255', '15', '&', 10, 8)).toBe('15')
  })

  it('computes financial, date and engineering modules locally', () => {
    expect(calculateFinance('simple', '100', '10', '2')).toBe('120')
    expect(calculateFinance('compound', '100', '10', '2')).toBe('121')
    expect(convertUnit('1024 byte', 'KB')).toContain('KB')
    expect(calculateDate('2026-01-01', '2026-01-31', '1', 'months').shifted).toBe('2026-02-01')
    expect(calculateEngineering('matrix', '[[1,2],[3,4]]', 'det')).toBe('-2')
    expect(calculateEngineering('statistics', '1,3,5,7', 'mean')).toBe('4')
  })

  it('keeps calculator history local and bounded', () => {
    saveCalculatorHistory(Array.from({ length: 102 }, (_, index) => ({ id: String(index), expression: String(index), result: String(index), createdAt: '2026-01-01T00:00:00Z' })))
    expect(loadCalculatorHistory()).toHaveLength(100)
  })
})
