import type { ApiResult } from '@/types'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
// API origin is stored separately from the fixed API prefix to prevent arbitrary endpoint construction.
export const API_PREFIX = '/api'
export const DEFAULT_REMOTE_API_ORIGIN = 'https://tools.imkai.top'
export const DEFAULT_LOCAL_API_ORIGIN = 'http://127.0.0.1:8080'
export const testServiceConfigurationEnabled = import.meta.env.DEV || import.meta.env.VITE_KAITOOLS_ENABLE_SERVICE_CONFIGURATION === 'true'

export function resolveRemoteApiBaseUrl(value: string | undefined, development: boolean): string | null {
  const configured = value?.trim()
  if (!configured) return null
  try {
    const url = new URL(configured)
    const isLoopback = LOOPBACK_HOSTS.has(url.hostname)
    if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) return null
    if (url.protocol !== 'https:' && !(development && url.protocol === 'http:' && isLoopback)) return null
    url.pathname = ''
    return url.origin
  } catch {
    return null
  }
}

export function resolveLocalServiceOrigin(value: string | undefined): string | null {
  const configured = value?.trim()
  if (!configured) return null
  try {
    const url = new URL(configured)
    if (!LOOPBACK_HOSTS.has(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return null
    if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) return null
    url.pathname = ''
    return url.origin
  } catch {
    return null
  }
}

export function createApiUrl(origin: string, path: `/${string}`): string {
  return `${origin.replace(/\/$/, '')}${API_PREFIX}${path}`
}

export const remoteApiBaseUrl = resolveRemoteApiBaseUrl(
  import.meta.env.VITE_KAITOOLS_API_URL,
  import.meta.env.DEV,
)

export const remoteApiAvailable = remoteApiBaseUrl !== null

/**
 * Production always uses the fixed service origin. The only alternate origin is
 * a loopback server explicitly enabled in developer mode.
 */
export function resolveServiceOrigin(value: string | undefined): string | null {
  return resolveLocalServiceOrigin(value) ?? (resolveRemoteApiBaseUrl(value, false) === DEFAULT_REMOTE_API_ORIGIN ? DEFAULT_REMOTE_API_ORIGIN : null)
}

export interface ApiHealth {
  status: string
  mode: string
}

export interface RemoteAccount {
  id: string
  email: string
  displayName: string | null
  emailVerified: boolean
}

export interface RemoteSession {
  accessToken: string
  expiresAt: string
  user: RemoteAccount
}

export interface EmailVerificationReceipt {
  captured: boolean
  code: string | null
}

export interface ShortcutSnapshot {
  revision: number
  toolIds: string[]
  updatedAt: string | null
}

interface ApiEnvelope<T> {
  ok?: boolean
  data?: T
  error?: { code?: string; message?: string; details?: unknown }
}

async function serviceApiRequest<T>(origin: string, path: `/${string}`, init: RequestInit, accessToken?: string): Promise<ApiResult<T>> {
  const resolved = resolveServiceOrigin(origin)
  if (!resolved) return { ok: false, error: { code: 'INVALID_SERVICE_URL', message: '同步服务地址无效' } }
  try {
    const response = await fetch(createApiUrl(resolved, path), {
      credentials: 'include',
      // Access tokens are supplied by the in-memory store; refresh authentication remains an HttpOnly cookie.
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(init.headers ?? {}) },
      ...init,
    })
    const body = await response.json() as ApiEnvelope<T>
    if (!response.ok || !body.ok) {
      return { ok: false, error: { code: body.error?.code ?? 'REQUEST_FAILED', message: body.error?.message ?? '同步服务请求失败', details: body.error?.details } }
    }
    return { ok: true, data: body.data as T }
  } catch {
    return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '暂时无法连接同步服务' } }
  }
}

export async function requestEmailVerification(origin: string, email: string): Promise<ApiResult<EmailVerificationReceipt>> {
  return serviceApiRequest<EmailVerificationReceipt>(origin, '/auth/email-verifications', { method: 'POST', body: JSON.stringify({ email }) })
}

export async function registerLocalAccount(origin: string, payload: { email: string; password: string; code: string; displayName: string }): Promise<ApiResult<RemoteSession>> {
  return serviceApiRequest<RemoteSession>(origin, '/auth/register', { method: 'POST', body: JSON.stringify(payload) })
}

export async function loginLocalAccount(origin: string, email: string, password: string): Promise<ApiResult<RemoteSession>> {
  return serviceApiRequest<RemoteSession>(origin, '/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export async function logoutLocalAccount(origin: string): Promise<ApiResult<void>> {
  return serviceApiRequest<void>(origin, '/auth/logout', { method: 'POST', body: '{}' })
}

export async function refreshLocalSession(origin: string): Promise<ApiResult<RemoteSession>> {
  return serviceApiRequest<RemoteSession>(origin, '/auth/token/refresh', { method: 'POST', body: '{}' })
}

export async function getRemoteShortcuts(origin: string, accessToken: string): Promise<ApiResult<ShortcutSnapshot>> {
  return serviceApiRequest<ShortcutSnapshot>(origin, '/workspace/shortcuts', { method: 'GET' }, accessToken)
}

export async function putRemoteShortcuts(
  origin: string,
  accessToken: string,
  payload: { baseRevision: number; toolIds: string[] },
): Promise<ApiResult<ShortcutSnapshot>> {
  return serviceApiRequest<ShortcutSnapshot>(origin, '/workspace/shortcuts', { method: 'PUT', body: JSON.stringify(payload) }, accessToken)
}

export async function checkService(origin: string, signal?: AbortSignal): Promise<ApiResult<ApiHealth>> {
  const resolved = resolveServiceOrigin(origin)
  if (!resolved) return { ok: false, error: { code: 'INVALID_SERVICE_URL', message: '同步服务地址无效' } }
  try {
    const response = await fetch(createApiUrl(resolved, '/health'), { signal, headers: { Accept: 'application/json' } })
    const body = await response.json() as { ok?: boolean; data?: ApiHealth; error?: { code?: string; message?: string } }
    if (!response.ok || !body.ok || !body.data) {
      return { ok: false, error: { code: body.error?.code ?? 'SERVICE_UNAVAILABLE', message: body.error?.message ?? '同步服务暂不可用' } }
    }
    return { ok: true, data: body.data }
  } catch (error) {
    return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: error instanceof Error && error.name === 'AbortError' ? '连接检测已取消' : '暂时无法连接同步服务' } }
  }
}

export async function checkLocalService(origin: string, signal?: AbortSignal): Promise<ApiResult<ApiHealth>> {
  const resolved = resolveLocalServiceOrigin(origin)
  if (!resolved) return { ok: false, error: { code: 'INVALID_LOCAL_SERVICE_URL', message: '本地服务地址必须是 localhost、127.0.0.1 或 [::1]，且不能包含路径或参数' } }
  try {
    const response = await fetch(createApiUrl(resolved, '/health'), { signal, headers: { Accept: 'application/json' } })
    const body = await response.json() as { ok?: boolean; data?: ApiHealth; error?: { code?: string; message?: string } }
    if (!response.ok || !body.ok || !body.data) {
      return { ok: false, error: { code: body.error?.code ?? 'SERVICE_UNAVAILABLE', message: body.error?.message ?? '本地服务未就绪' } }
    }
    return { ok: true, data: body.data }
  } catch (error) {
    return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: error instanceof Error && error.name === 'AbortError' ? '连接检测已取消' : '无法连接本地服务，请确认后端已启动' } }
  }
}
