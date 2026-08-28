const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export type IdentifierKind = 'uuid-v4' | 'uuid-v7' | 'ulid'

export interface ParsedIdentifier {
  kind: IdentifierKind | 'uuid' | 'unknown'
  normalized: string
  timestamp: number | null
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function generateUuidV4(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = randomBytes(16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  return bytesToUuid(bytes)
}

export function generateUuidV7(timestamp = Date.now()): string {
  const bytes = randomBytes(16)
  let remaining = timestamp
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256
    remaining = Math.floor(remaining / 256)
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  return bytesToUuid(bytes)
}

function encodeTime(timestamp: number): string {
  let remaining = Math.max(0, Math.floor(timestamp))
  let output = ''
  for (let index = 0; index < 10; index += 1) {
    output = CROCKFORD_BASE32[remaining % 32] + output
    remaining = Math.floor(remaining / 32)
  }
  return output
}

function encodeRandom(bytes: Uint8Array): string {
  let buffer = 0
  let bitCount = 0
  let output = ''
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bitCount += 8
    while (bitCount >= 5) {
      bitCount -= 5
      output += CROCKFORD_BASE32[(buffer >> bitCount) & 31]
    }
  }
  return output
}

export function generateUlid(timestamp = Date.now()): string {
  return `${encodeTime(timestamp)}${encodeRandom(randomBytes(10))}`
}

function parseUlidTimestamp(value: string): number | null {
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(value)) return null
  return value.slice(0, 10).toUpperCase().split('').reduce((timestamp, character) => timestamp * 32 + CROCKFORD_BASE32.indexOf(character), 0)
}

function parseUuidV7Timestamp(value: string): number | null {
  const normalized = value.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(normalized) || normalized[12] !== '7') return null
  return Number.parseInt(normalized.slice(0, 12), 16)
}

export function parseIdentifier(value: string): ParsedIdentifier {
  const normalized = value.trim()
  const ulidTimestamp = parseUlidTimestamp(normalized)
  if (ulidTimestamp !== null) return { kind: 'ulid', normalized: normalized.toUpperCase(), timestamp: ulidTimestamp }

  const compactUuid = normalized.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(compactUuid)) return { kind: 'unknown', normalized, timestamp: null }
  const version = compactUuid[12]
  const uuid = `${compactUuid.slice(0, 8)}-${compactUuid.slice(8, 12)}-${compactUuid.slice(12, 16)}-${compactUuid.slice(16, 20)}-${compactUuid.slice(20)}`
  if (version === '4') return { kind: 'uuid-v4', normalized: uuid, timestamp: null }
  if (version === '7') return { kind: 'uuid-v7', normalized: uuid, timestamp: parseUuidV7Timestamp(uuid) }
  return { kind: 'uuid', normalized: uuid, timestamp: null }
}
