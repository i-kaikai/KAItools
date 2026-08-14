import type {
  ApiResult,
  BootstrapState,
  HostsBackup,
  HostsPreview,
  HostsProfiles,
  HostsSnapshot,
  ToolTab,
} from '@/types'

const MOCK_KEY = 'devtoolkit.mock.state.v1'

const defaultState: BootstrapState = {
  settings: { schemaVersion: 1, theme: 'system', sidebarCollapsed: false },
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
  runtime: { version: '0.1.0-dev', webview2: 'browser-mock', dataDirectory: 'data' },
}

function mockState(): BootstrapState {
  try {
    const value = localStorage.getItem(MOCK_KEY)
    return value ? (JSON.parse(value) as BootstrapState) : structuredClone(defaultState)
  } catch {
    return structuredClone(defaultState)
  }
}

function saveMockState(state: BootstrapState): void {
  localStorage.setItem(MOCK_KEY, JSON.stringify(state))
}

async function bridge(): Promise<Record<string, (...args: unknown[]) => Promise<unknown>> | null> {
  if (window.pywebview?.api) return window.pywebview.api
  if (import.meta.env.DEV) return null
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
    if (!import.meta.env.DEV) {
      return { ok: false, error: { code: 'BRIDGE_UNAVAILABLE', message: '桌面桥接尚未就绪' } }
    }
    return mockInvoke<T>(method, args)
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

async function mockInvoke<T>(method: string, args: unknown[]): Promise<ApiResult<T>> {
  const state = mockState()
  if (method === 'load_state') return { ok: true, data: state as T }
  if (method === 'save_settings') {
    const payload = (args[0] ?? {}) as { settings?: Partial<BootstrapState['settings']>; hostsProfiles?: HostsProfiles }
    if (payload.settings) Object.assign(state.settings, payload.settings)
    if (payload.hostsProfiles) state.hostsProfiles = payload.hostsProfiles
    saveMockState(state)
    return { ok: true, data: undefined as T }
  }
  if (method === 'save_workspace') {
    const payload = args[0] as { tabs: ToolTab[] }
    state.workspace.tabs = payload.tabs
    saveMockState(state)
    return { ok: true, data: undefined as T }
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
}
