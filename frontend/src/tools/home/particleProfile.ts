import type { ParticleQuality } from '@/types'

export interface ParticleProfile {
  outerCount: number
  innerCount: number
  satelliteCount: number
  pixelRatioMax: number
  frameIntervalMs: number
  powerPreference: WebGLPowerPreference
}

export const PARTICLE_PROFILES: Record<Exclude<ParticleQuality, 'off'>, ParticleProfile> = {
  high: {
    outerCount: 14_500,
    innerCount: 3_600,
    satelliteCount: 1_050,
    pixelRatioMax: 1.5,
    frameIntervalMs: 1_000 / 60,
    powerPreference: 'high-performance',
  },
  balanced: {
    outerCount: 5_800,
    innerCount: 1_450,
    satelliteCount: 420,
    pixelRatioMax: 1,
    frameIntervalMs: 1_000 / 30,
    powerPreference: 'low-power',
  },
}

export function particleProfileFor(quality: ParticleQuality): ParticleProfile {
  return PARTICLE_PROFILES[quality === 'balanced' ? 'balanced' : 'high']
}
