// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { buildRequestUrl, isSensitiveHeader, keyValuesToHeaders, normalizeApiKeyValues, readApiResponse } from '@/utils/apiDebugger'

describe('API debugger helpers', () => {
  it('keeps safe headers while clearing credential values for storage', () => {
    const headers = normalizeApiKeyValues([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'Authorization', value: 'Bearer secret', enabled: true },
      { key: 'X-Api-Key', value: 'key-123', enabled: false },
    ])
    expect(headers).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'Authorization', value: '', enabled: true },
      { key: 'X-Api-Key', value: '', enabled: false },
    ])
    expect(isSensitiveHeader(' Proxy-Authorization ')).toBe(true)
    expect(keyValuesToHeaders(headers).get('authorization')).toBe('')
  })

  it('builds an HTTP URL and updates enabled query parameters', () => {
    expect(buildRequestUrl('https://api.example.test/users?limit=10', [
      { key: 'limit', value: '25', enabled: true },
      { key: 'sort', value: 'name', enabled: true },
      { key: 'ignored', value: 'yes', enabled: false },
    ])).toBe('https://api.example.test/users?limit=25&sort=name')
    expect(() => buildRequestUrl('api.example.test', [])).toThrow('请求地址必须包含')
    expect(() => buildRequestUrl('file:///private.json', [])).toThrow('仅支持')
  })

  it('reads a JSON response into an editable formatted snapshot', async () => {
    const snapshot = await readApiResponse(new Response('{"ok":true,"items":[1,2]}', {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_123' },
    }), 12.7)
    expect(snapshot).toMatchObject({ status: 201, statusText: 'Created', elapsedMs: 13, contentType: 'application/json' })
    expect(snapshot.body).toBe('{\n  "ok": true,\n  "items": [\n    1,\n    2\n  ]\n}')
    expect(snapshot.headers).toContainEqual({ key: 'x-request-id', value: 'req_123', enabled: true })
  })
})
