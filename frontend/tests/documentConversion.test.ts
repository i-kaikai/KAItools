import { describe, expect, it } from 'vitest'

import { normalizeDocxTableWidths } from '@/utils/documentConversion'

describe('document conversion layout repairs', () => {
  it('restores a zero-width DOCX table from its explicit column widths', () => {
    const container = document.createElement('div')
    container.innerHTML = '<table style="width: 0pt"><colgroup><col style="width: 63pt"><col style="width: 120pt"></colgroup><tbody><tr><td>值</td><td>说明</td></tr></tbody></table>'

    expect(normalizeDocxTableWidths(container)).toBe(1)
    expect(container.querySelector('table')?.style.width).toBe('183pt')
  })

  it('leaves intentional and indeterminate table widths unchanged', () => {
    const container = document.createElement('div')
    container.innerHTML = '<table style="width: 200pt"><colgroup><col style="width: 50pt"></colgroup></table><table><colgroup><col></colgroup></table>'

    expect(normalizeDocxTableWidths(container)).toBe(0)
    expect([...container.querySelectorAll('table')].map((table) => table.style.width)).toEqual(['200pt', ''])
  })
})
