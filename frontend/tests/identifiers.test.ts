import { describe, expect, it } from 'vitest'

import { generateUlid, generateUuidV4, generateUuidV7, parseIdentifier } from '@/utils/identifiers'

describe('identifiers', () => {
  it('generates an RFC 4122 UUID v4', () => {
    expect(generateUuidV4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('preserves the timestamp in UUID v7 and ULID', () => {
    const timestamp = 1_700_000_000_000
    const uuidV7 = generateUuidV7(timestamp)
    const ulid = generateUlid(timestamp)
    expect(parseIdentifier(uuidV7)).toMatchObject({ kind: 'uuid-v7', timestamp })
    expect(parseIdentifier(ulid)).toMatchObject({ kind: 'ulid', timestamp })
  })

  it('rejects malformed identifiers', () => {
    expect(parseIdentifier('not-an-id')).toMatchObject({ kind: 'unknown', timestamp: null })
  })
})
