import { describe, expect, it } from 'vitest'

import { resolveRuntimeTarget } from '@/runtime'

describe('runtime configuration', () => {
  it('selects web only for the explicit web build mode', () => {
    expect(resolveRuntimeTarget('web')).toBe('web')
    expect(resolveRuntimeTarget('production')).toBe('desktop')
    expect(resolveRuntimeTarget('development')).toBe('desktop')
  })

})
