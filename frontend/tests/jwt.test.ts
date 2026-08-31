// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { analyzeJwt } from '@/utils/jwt'

const sampleJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJrYWkiLCJpYXQiOjE3MDAwMDAwMDAsIm5iZiI6MTcwMDAwMDAwMCwiZXhwIjoyMDAwMDAwMDAwfQ.signature'

describe('JWT analyzer', () => {
  it('decodes header, payload and timestamp claims without verifying the signature', () => {
    const result = analyzeJwt(sampleJwt, 1_750_000_000_000)
    expect(result.header).toMatchObject({ alg: 'HS256', typ: 'JWT' })
    expect(result.payload).toMatchObject({ sub: 'kai' })
    expect(result.signaturePresent).toBe(true)
    expect(result.timestamps.map((claim) => [claim.key, claim.status])).toEqual([
      ['iat', 'past'], ['nbf', 'current'], ['exp', 'future'],
    ])
  })

  it('rejects malformed compact tokens and non-object payloads', () => {
    expect(() => analyzeJwt('only.two')).toThrow('JWT 必须由')
    expect(() => analyzeJwt('e30.W10.signature')).toThrow('JWT Payload必须是 JSON 对象')
  })
})
