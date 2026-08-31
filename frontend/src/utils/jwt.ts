import { decodeBase64Text } from '@/utils/base64'

export interface JwtTimestampClaim {
  key: 'iat' | 'nbf' | 'exp'
  label: string
  timestamp: number
  value: string
  status: 'past' | 'current' | 'future'
}

export interface JwtAnalysis {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  headerText: string
  payloadText: string
  signaturePresent: boolean
  timestamps: JwtTimestampClaim[]
}

const timestampLabels: Record<JwtTimestampClaim['key'], string> = {
  iat: '签发时间',
  nbf: '生效时间',
  exp: '过期时间',
}

function decodeSegment(segment: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(decodeBase64Text(segment))
  } catch {
    throw new Error(`${label}不是有效的 Base64URL JSON`)
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label}必须是 JSON 对象`)
  return value as Record<string, unknown>
}

function timestampFor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value) * 1000
  return null
}

export function analyzeJwt(source: string, now = Date.now()): JwtAnalysis {
  const segments = source.trim().split('.')
  if (segments.length !== 3 || !segments[0] || !segments[1]) throw new Error('JWT 必须由 Header、Payload 和签名三段组成')
  const header = decodeSegment(segments[0], 'JWT Header')
  const payload = decodeSegment(segments[1], 'JWT Payload')
  const timestamps = (['iat', 'nbf', 'exp'] as const).flatMap((key) => {
    const timestamp = timestampFor(payload[key])
    if (timestamp === null || !Number.isFinite(timestamp)) return []
    const status: JwtTimestampClaim['status'] = key === 'exp'
      ? timestamp > now ? 'future' : 'past'
      : key === 'nbf'
        ? timestamp > now ? 'future' : 'current'
        : timestamp > now ? 'future' : 'past'
    return [{
      key,
      label: timestampLabels[key],
      timestamp,
      value: new Date(timestamp).toLocaleString(),
      status,
    }]
  })
  return {
    header,
    payload,
    headerText: JSON.stringify(header, null, 2),
    payloadText: JSON.stringify(payload, null, 2),
    signaturePresent: Boolean(segments[2]),
    timestamps,
  }
}
