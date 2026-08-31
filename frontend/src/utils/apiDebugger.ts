export interface ApiKeyValue {
  key: string
  value: string
  enabled: boolean
}

export interface ApiResponseSnapshot {
  status: number
  statusText: string
  elapsedMs: number
  contentType: string
  size: number
  headers: ApiKeyValue[]
  body: string
}

const sensitiveHeaderNames = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
])

export function isSensitiveHeader(value: string): boolean {
  return sensitiveHeaderNames.has(value.trim().toLowerCase())
}

export function normalizeApiKeyValues(values: unknown, preserveSensitiveValues = false): ApiKeyValue[] {
  if (!Array.isArray(values)) return []
  return values.slice(0, 40).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const item = value as Partial<ApiKeyValue>
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    if (!key) return []
    return [{
      key,
      value: typeof item.value === 'string' && (preserveSensitiveValues || !isSensitiveHeader(key)) ? item.value : '',
      enabled: item.enabled !== false,
    }]
  })
}

export function keyValuesToHeaders(values: ApiKeyValue[]): Headers {
  const headers = new Headers()
  for (const item of values) {
    if (!item.enabled || !item.key.trim()) continue
    headers.set(item.key.trim(), item.value)
  }
  return headers
}

export function headersToKeyValues(headers: Headers): ApiKeyValue[] {
  return [...headers.entries()].map(([key, value]) => ({ key, value, enabled: true }))
}

export function buildRequestUrl(source: string, params: ApiKeyValue[]): string {
  const value = source.trim()
  if (!value) throw new Error('请输入请求地址')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('请求地址必须包含 http:// 或 https://')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 http:// 和 https:// 请求地址')
  for (const item of params) {
    if (!item.enabled || !item.key.trim()) continue
    url.searchParams.set(item.key.trim(), item.value)
  }
  return url.href
}

export async function readApiResponse(response: Response, elapsedMs: number): Promise<ApiResponseSnapshot> {
  const contentType = response.headers.get('content-type') ?? ''
  const body = await response.text()
  let formattedBody = body
  if (body && /(?:application|text)\/(?:[\w.+-]*\+)?json\b/i.test(contentType)) {
    try {
      formattedBody = JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      // Keep invalid JSON visible exactly as returned by the server.
    }
  }
  return {
    status: response.status,
    statusText: response.statusText,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    contentType,
    size: new TextEncoder().encode(body).byteLength,
    headers: headersToKeyValues(response.headers),
    body: formattedBody,
  }
}
