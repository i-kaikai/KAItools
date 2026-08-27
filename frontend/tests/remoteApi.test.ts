import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApiUrl, DEFAULT_REMOTE_API_ORIGIN, getRemoteShortcuts, requestEmailVerification, resolveLocalServiceOrigin, resolveRemoteApiBaseUrl, resolveServiceOrigin } from '@/api/remoteApi'

describe('remote API configuration', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts HTTPS endpoints for production', () => {
    expect(resolveRemoteApiBaseUrl('https://tools.imkai.top/', false)).toBe('https://tools.imkai.top')
  })

  it('accepts HTTP only for loopback development', () => {
    expect(resolveRemoteApiBaseUrl('http://127.0.0.1:8080', true)).toBe('http://127.0.0.1:8080')
    expect(resolveRemoteApiBaseUrl('http://api.example.com', true)).toBeNull()
  })

  it('rejects invalid or insecure production endpoints', () => {
    expect(resolveRemoteApiBaseUrl('http://tools.imkai.top', false)).toBeNull()
    expect(resolveRemoteApiBaseUrl('not a URL', false)).toBeNull()
  })

  it('accepts only loopback origins for runtime local service configuration', () => {
    expect(resolveLocalServiceOrigin('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(resolveLocalServiceOrigin('https://localhost:9443/')).toBe('https://localhost:9443')
    expect(resolveLocalServiceOrigin('http://192.168.1.10:8080')).toBeNull()
    expect(resolveLocalServiceOrigin('http://127.0.0.1:8080/api')).toBeNull()
  })

  it('uses the fixed production service by default and permits loopback only as a developer override', () => {
    expect(DEFAULT_REMOTE_API_ORIGIN).toBe('https://tools.imkai.top')
    expect(resolveServiceOrigin(DEFAULT_REMOTE_API_ORIGIN)).toBe(DEFAULT_REMOTE_API_ORIGIN)
    expect(resolveServiceOrigin('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(resolveServiceOrigin('https://untrusted.example.com')).toBeNull()
  })

  it('constructs a single canonical api root', () => {
    expect(createApiUrl('http://127.0.0.1:8080/', '/health')).toBe('http://127.0.0.1:8080/api/health')
  })

  it('preserves backend validation messages for the account form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: { code: 'REQUEST_VALIDATION_FAILED', message: '不是一个合法的电子邮件地址' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })))

    const result = await requestEmailVerification('http://127.0.0.1:8080', 'invalid-email')

    expect(result).toEqual({
      ok: false,
      error: { code: 'REQUEST_VALIDATION_FAILED', message: '不是一个合法的电子邮件地址' },
    })
  })

  it('sends the memory-only access token for shortcut synchronization and preserves conflict snapshots', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: { code: 'SHORTCUT_CONFLICT', message: '快捷方式已在其他设备更新', details: { revision: 4, toolIds: ['json'], updatedAt: null } },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })))

    const result = await getRemoteShortcuts('http://127.0.0.1:8080', 'memory-access-token')

    expect(result).toMatchObject({ ok: false, error: { code: 'SHORTCUT_CONFLICT', details: { revision: 4 } } })
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8080/api/workspace/shortcuts', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer memory-access-token' }) }))
  })
})
