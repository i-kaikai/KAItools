import { describe, expect, it } from 'vitest'

import { PARTICLE_PROFILES, particleProfileFor } from '@/tools/home/particleProfile'

describe('particle quality profiles', () => {
  it('keeps the existing visual density for high quality', () => {
    expect(PARTICLE_PROFILES.high.outerCount + PARTICLE_PROFILES.high.innerCount + PARTICLE_PROFILES.high.satelliteCount).toBe(19_150)
    expect(PARTICLE_PROFILES.high.pixelRatioMax).toBe(1.5)
    expect(PARTICLE_PROFILES.high.frameIntervalMs).toBeCloseTo(1_000 / 60)
  })

  it('uses a lower-density capped profile for balanced quality and resolves off safely', () => {
    expect(PARTICLE_PROFILES.balanced.outerCount + PARTICLE_PROFILES.balanced.innerCount + PARTICLE_PROFILES.balanced.satelliteCount).toBe(7_670)
    expect(PARTICLE_PROFILES.balanced.pixelRatioMax).toBe(1)
    expect(PARTICLE_PROFILES.balanced.frameIntervalMs).toBeCloseTo(1_000 / 30)
    expect(particleProfileFor('off')).toBe(PARTICLE_PROFILES.high)
  })
})
