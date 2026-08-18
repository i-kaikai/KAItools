import type {
  ApiResult,
  BootstrapState,
  HostsBackup,
  HostsPreview,
  HostsProfiles,
  HostsSnapshot,
  ToolTab,
} from '@/types'
import { isWebRuntime } from '@/runtime'

const BROWSER_KEY = 'devtoolkit.browser.state.v1'
const LEGACY_MOCK_KEY = 'devtoolkit.mock.state.v1'
export const PROJECT_REPOSITORY_URL = 'https://gitee.com/i-_-kaikai/kaitools'
export const GITHUB_REPOSITORY_URL = 'https://github.com/i-kaikai/KAItools'
const DESKTOP_ONLY_METHODS = new Set([
  'read_hosts',
  'apply_hosts',
  'list_hosts_backups',
  'restore_hosts_backup',
  'open_webview2_download',
])

function defaultBrowserState(): BootstrapState {
  return {
    settings: { schemaVersion: 1, theme: 'system', sidebarCollapsed: true },
    workspace: { schemaVersion: 1, tabs: [] },
    hostsProfiles: {
      schemaVersion: 1,
      groups: [
        {
          id: 'default',
          name: '开发环境',
          enabled: true,
          entries: [
            {
              id: 'sample-entry',
              ip: '127.0.0.1',
              hostname: 'api.local',
              comment: '本地接口',
              enabled: true,
            },
          ],
        },
      ],
    },
    runtime: {
      version: '0.1.0',
      webview2: null,
      dataDirectory: isWebRuntime ? '浏览器本地存储' : '浏览器开发存储',
    },
  }
}

function browserState(): BootstrapState {
  try {
    const value = localStorage.getItem(BROWSER_KEY) ?? localStorage.getItem(LEGACY_MOCK_KEY)
    if (!value) return defaultBrowserState()
    const stored = JSON.parse(value) as Partial<BootstrapState>
    const defaults = defaultBrowserState()
    return {
      settings: { ...defaults.settings, ...stored.settings },
      workspace: {
        schemaVersion: 1,
        tabs: Array.isArray(stored.workspace?.tabs) ? stored.workspace.tabs : [],
      },
      hostsProfiles: Array.isArray(stored.hostsProfiles?.groups) ? stored.hostsProfiles : defaults.hostsProfiles,
      runtime: defaults.runtime,
    }
  } catch {
    return defaultBrowserState()
  }
}

function saveBrowserState(state: BootstrapState): void {
  localStorage.setItem(BROWSER_KEY, JSON.stringify(state))
}

async function bridge(): Promise<Record<string, (...args: unknown[]) => Promise<unknown>> | null> {
  if (isWebRuntime) return null
  if (window.pywebview?.api) return window.pywebview.api
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') return null
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 3000)
    window.addEventListener(
      'pywebviewready',
      () => {
        window.clearTimeout(timeout)
        resolve()
      },
      { once: true },
    )
  })
  return window.pywebview?.api ?? null
}

async function invoke<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const api = await bridge()
  if (!api) {
    if (!isWebRuntime && !import.meta.env.DEV && import.meta.env.MODE !== 'test') {
      return { ok: false, error: { code: 'BRIDGE_UNAVAILABLE', message: '桌面桥接尚未就绪' } }
    }
    return browserInvoke<T>(method, args)
  }
  const callable = api[method]
  if (!callable) {
    return { ok: false, error: { code: 'METHOD_UNAVAILABLE', message: `桌面方法不可用：${method}` } }
  }
  try {
    return (await callable(...args)) as ApiResult<T>
  } catch (error) {
    return {
      ok: false,
      error: { code: 'BRIDGE_CALL_FAILED', message: error instanceof Error ? error.message : String(error) },
    }
  }
}

async function browserInvoke<T>(method: string, args: unknown[]): Promise<ApiResult<T>> {
  if (method === 'open_project_repository') return openRepositoryInBrowser() as ApiResult<T>
  if (method === 'open_github_repository') return openGithubRepositoryInBrowser() as ApiResult<T>
  if (isWebRuntime && DESKTOP_ONLY_METHODS.has(method)) {
    return { ok: false, error: { code: 'DESKTOP_ONLY', message: '此功能仅 Windows 桌面版可用' } }
  }

  const state = browserState()
  if (method === 'load_state') return { ok: true, data: state as T }
  if (method === 'save_settings') {
    try {
      const payload = (args[0] ?? {}) as { settings?: Partial<BootstrapState['settings']>; hostsProfiles?: HostsProfiles }
      if (payload.settings) Object.assign(state.settings, payload.settings)
      if (payload.hostsProfiles) state.hostsProfiles = payload.hostsProfiles
      saveBrowserState(state)
      return { ok: true, data: undefined as T }
    } catch (error) {
      return {
        ok: false,
        error: { code: 'BROWSER_STORAGE_FAILED', message: error instanceof Error ? error.message : String(error) },
      }
    }
  }
  if (method === 'save_workspace') {
    try {
      const payload = args[0] as { tabs: ToolTab[] }
      state.workspace.tabs = payload.tabs
      saveBrowserState(state)
      return { ok: true, data: undefined as T }
    } catch (error) {
      return {
        ok: false,
        error: { code: 'BROWSER_STORAGE_FAILED', message: error instanceof Error ? error.message : String(error) },
      }
    }
  }
  if (method === 'read_hosts') {
    return {
      ok: true,
      data: {
        path: 'C:\\Windows\\System32\\drivers\\etc\\hosts',
        sha256: 'mock-sha256',
        content: '# Copyright (c) Microsoft Corp.\r\n127.0.0.1\tlocalhost\r\n::1\tlocalhost\r\n',
        encoding: 'utf-8',
        newline: 'CRLF',
        backups: [],
      } as T,
    }
  }
  if (method === 'apply_hosts') {
    const payload = args[0] as { content: string; sourceSha256: string }
    return {
      ok: true,
      data: {
        currentContent: '# Copyright (c) Microsoft Corp.\r\n127.0.0.1\tlocalhost\r\n::1\tlocalhost\r\n',
        desiredContent: payload.content,
        changed: true,
        sourceSha256: payload.sourceSha256,
        desiredSha256: 'mock-desired',
        backups: [],
      } as T,
    }
  }
  if (method === 'list_hosts_backups' || method === 'restore_hosts_backup') {
    return { ok: true, data: [] as T }
  }
  return { ok: true, data: undefined as T }
}

function openFixedRepositoryInBrowser(
  url: string,
  repositoryName: 'Gitee' | 'GitHub',
  openWindow: typeof window.open,
): ApiResult<void> {
  const popup = openWindow('about:blank', '_blank')
  if (!popup) {
    return { ok: false, error: { code: 'OPEN_EXTERNAL_FAILED', message: `浏览器阻止了 ${repositoryName} 仓库窗口，请允许弹出窗口后重试` } }
  }
  try {
    popup.opener = null
    const referrerPolicy = popup.document.createElement('meta')
    referrerPolicy.name = 'referrer'
    referrerPolicy.content = 'no-referrer'
    popup.document.head.append(referrerPolicy)
    popup.location.replace(url)
    return { ok: true, data: undefined }
  } catch (error) {
    popup.close()
    return {
      ok: false,
      error: { code: 'OPEN_EXTERNAL_FAILED', message: `无法打开 ${repositoryName} 仓库`, details: error instanceof Error ? error.message : String(error) },
    }
  }
}

export function openRepositoryInBrowser(
  openWindow: typeof window.open = window.open.bind(window),
): ApiResult<void> {
  return openFixedRepositoryInBrowser(PROJECT_REPOSITORY_URL, 'Gitee', openWindow)
}

export function openGithubRepositoryInBrowser(
  openWindow: typeof window.open = window.open.bind(window),
): ApiResult<void> {
  return openFixedRepositoryInBrowser(GITHUB_REPOSITORY_URL, 'GitHub', openWindow)
}

export const desktopApi = {
  loadState: () => invoke<BootstrapState>('load_state'),
  saveSettings: (payload: { settings?: Partial<BootstrapState['settings']>; hostsProfiles?: HostsProfiles }) =>
    invoke<void>('save_settings', payload),
  saveWorkspace: (tabs: ToolTab[]) => invoke<void>('save_workspace', { tabs }),
  readHosts: () => invoke<HostsSnapshot>('read_hosts'),
  applyHosts: (content: string, sourceSha256: string, previewOnly: boolean) =>
    invoke<HostsPreview>('apply_hosts', { content, sourceSha256, previewOnly }),
  listHostsBackups: () => invoke<HostsBackup[]>('list_hosts_backups'),
  restoreHostsBackup: (id: string) => invoke<{ changed: boolean; backups: HostsBackup[] }>('restore_hosts_backup', id),
  openWebView2Download: () => invoke<void>('open_webview2_download'),
  openProjectRepository: () => invoke<void>('open_project_repository'),
  openGithubRepository: () => invoke<void>('open_github_repository'),
}
