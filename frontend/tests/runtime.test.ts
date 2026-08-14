import { describe, expect, it } from 'vitest'

import { normalizeIcpNumber, resolveRuntimeTarget } from '@/runtime'

describe('runtime configuration', () => {
  it('selects web only for the explicit web build mode', () => {
    expect(resolveRuntimeTarget('web')).toBe('web')
    expect(resolveRuntimeTarget('production')).toBe('desktop')
    expect(resolveRuntimeTarget('development')).toBe('desktop')
  })

  it('normalizes the optional ICP number', () => {
    expect(normalizeIcpNumber('  京ICP备00000000号-1  ')).toBe('京ICP备00000000号-1')
    expect(normalizeIcpNumber(undefined)).toBe('')
  })
})
