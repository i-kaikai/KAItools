import type {
  ApiResult,
  AppSettings,
  BackendConnection,
  BootstrapState,
  DashboardCards,
  HostsBackup,
  HostsPreview,
  HostsProfiles,
  HostsSnapshot,
  SidebarShortcuts,
  NotesState,
  ClipboardHistorySnapshot,
  SystemStatusSnapshot,
  ShortcutSyncState,
  ToolTab,
} from '@/types'
import { isWebRuntime } from '@/runtime'
import { loadBrowserNotes, saveBrowserNotes } from '@/api/notesStorage'
import { defaultDashboardCards } from '@/tools/home/dashboardCards'
import { DEFAULT_LOCAL_API_ORIGIN, resolveLocalServiceOrigin } from '@/api/remoteApi'
import { APP_VERSION } from '@/version'

const BROWSER_KEY = 'devtoolkit.browser.state.v1'
const LEGACY_MOCK_KEY = 'devtoolkit.mock.state.v1'
export const PROJECT_REPOSITORY_URL = 'https://gitee.com/i-_-kaikai/kaitools'
export const GITHUB_REPOSITORY_URL = 'https://github.com/i-kaikai/KAItools'
export const DESKTOP_DOWNLOAD_URL = 'https://gitee.com/i-_-kaikai/kaitools/releases'
const DESKTOP_ONLY_METHODS = new Set([
  'read_hosts',
  'apply_hosts',
  'list_hosts_backups',
  'restore_hosts_backup',
  'open_webview2_download',
  'get_clipboard_history',
  'clear_clipboard_history',
  'delete_clipboard_history_item',
  'set_clipboard_monitoring',
  'copy_text',
])

function defaultBrowserState(): BootstrapState {
  return {
    settings: {
      schemaVersion: 1,
      theme: 'system',
      sidebarCollapsed: true,
      particleQuality: 'high',
      motionMode: 'system',
      sidebarStartup: 'remember',
      restorePinnedTabsOnLaunch: true,
      editorFontSize: 13,
      editorLineWrapping: true,
      clipboardMonitoringEnabled: true,
      systemStatusRefreshSeconds: 0,
      developerModeEnabled: false,
      activationHotkey: 'Ctrl+Alt+K',
    },
    backendConnection: { schemaVersion: 1, localApiOrigin: DEFAULT_LOCAL_API_ORIGIN, useLocalApi: false },
    sidebarShortcuts: { schemaVersion: 1, toolIds: ['notes', 'json', 'calculator', 'java', 'timestamp', 'base64-text', 'cron', 'hosts', 'clipboard-history', 'md5'] },
    shortcutSync: { schemaVersion: 1, accountId: null, mode: 'pending', revision: null, pendingToolIds: null },
    dashboardCards: defaultDashboardCards(),
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
      version: APP_VERSION,
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
    const settings = normalizeBrowserSettings(stored.settings)
    return {
      settings,
      backendConnection: normalizeBrowserBackendConnection(stored.backendConnection, settings.developerModeEnabled),
      sidebarShortcuts: {
        schemaVersion: 1,
        toolIds: Array.isArray(stored.sidebarShortcuts?.toolIds)
          ? stored.sidebarShortcuts.toolIds
          : defaults.sidebarShortcuts.toolIds,
      },
      shortcutSync: {
        schemaVersion: 1,
        accountId: typeof stored.shortcutSync?.accountId === 'string' ? stored.shortcutSync.accountId : null,
        mode: stored.shortcutSync?.mode === 'enabled' || stored.shortcutSync?.mode === 'paused' ? stored.shortcutSync.mode : 'pending',
        revision: typeof stored.shortcutSync?.revision === 'number' ? stored.shortcutSync.revision : null,
        pendingToolIds: Array.isArray(stored.shortcutSync?.pendingToolIds) ? stored.shortcutSync.pendingToolIds : null,
      },
      dashboardCards: {
        schemaVersion: 1,
        cards: Array.isArray(stored.dashboardCards?.cards) && stored.dashboardCards.cards.length
          ? stored.dashboardCards.cards
          : defaults.dashboardCards.cards,
        carouselMode: stored.dashboardCards?.carouselMode === 'classic' ? 'classic' : 'step',
        classicRotationSpeed: typeof stored.dashboardCards?.classicRotationSpeed === 'number'
          ? Math.max(6, Math.min(30, stored.dashboardCards.classicRotationSpeed))
          : defaults.dashboardCards.classicRotationSpeed,
        stepIntervalMs: typeof stored.dashboardCards?.stepIntervalMs === 'number'
          ? Math.max(800, Math.min(6000, stored.dashboardCards.stepIntervalMs))
          : defaults.dashboardCards.stepIntervalMs,
      },
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
  if (method === 'open_desktop_download') return openDesktopDownloadInBrowser() as ApiResult<T>
  if (method === 'open_developer_tools') return { ok: false, error: { code: 'WEB_DEVTOOLS_NATIVE', message: '网页环境请使用浏览器 F12 打开开发者工具' } }
  if (method === 'set_activation_hotkey') return { ok: false, error: { code: 'DESKTOP_ONLY', message: '全局唤起快捷键仅 Windows 桌面版可用' } }
  if (method === 'hide_to_tray') return { ok: false, error: { code: 'DESKTOP_ONLY', message: '隐藏到系统托盘仅 Windows 桌面版可用' } }
  if (isWebRuntime && DESKTOP_ONLY_METHODS.has(method)) {
    return { ok: false, error: { code: 'DESKTOP_ONLY', message: '此功能仅 Windows 桌面版可用' } }
  }

  const state = browserState()
  if (method === 'load_state') return { ok: true, data: state as T }
  if (method === 'get_system_status') return { ok: true, data: await getBrowserSystemStatus() as T }
  if (method === 'get_clipboard_history') {
    return {
      ok: true,
      data: {
        enabled: true,
        maxEntries: 100,
        maxBytes: 16 * 1024,
        items: [{ id: 'development-clipboard', text: 'KAITools 开发剪切板示例', createdAt: new Date().toISOString(), truncated: false }],
      } as T,
    }
  }
  if (method === 'clear_clipboard_history' || method === 'set_clipboard_monitoring' || method === 'copy_text') return { ok: true, data: undefined as T }
  if (method === 'delete_clipboard_history_item') return { ok: true, data: { removed: true } as T }
  if (method === 'save_settings') {
    try {
      const payload = (args[0] ?? {}) as {
        settings?: Partial<BootstrapState['settings']>
        backendConnection?: BackendConnection
        sidebarShortcuts?: SidebarShortcuts
        shortcutSync?: ShortcutSyncState
        dashboardCards?: DashboardCards
        hostsProfiles?: HostsProfiles
      }
      if (payload.settings) state.settings = normalizeBrowserSettings({ ...state.settings, ...payload.settings })
      if (payload.backendConnection) state.backendConnection = payload.backendConnection
      if (payload.sidebarShortcuts) state.sidebarShortcuts = payload.sidebarShortcuts
      if (payload.shortcutSync) state.shortcutSync = payload.shortcutSync
      if (payload.dashboardCards) state.dashboardCards = payload.dashboardCards
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
  if (method === 'load_notes') {
    try {
      return { ok: true, data: await loadBrowserNotes() as T }
    } catch (error) {
      return { ok: false, error: { code: 'BROWSER_NOTES_LOAD_FAILED', message: error instanceof Error ? error.message : String(error) } }
    }
  }
  if (method === 'save_notes') {
    try {
      await saveBrowserNotes(args[0] as NotesState)
      return { ok: true, data: undefined as T }
    } catch (error) {
      return { ok: false, error: { code: 'BROWSER_NOTES_SAVE_FAILED', message: error instanceof Error ? error.message : String(error) } }
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

export function openDesktopDownloadInBrowser(
  openWindow: typeof window.open = window.open.bind(window),
): ApiResult<void> {
  return openFixedRepositoryInBrowser(DESKTOP_DOWNLOAD_URL, 'Gitee', openWindow)
}

export const desktopApi = {
  loadState: () => invoke<BootstrapState>('load_state'),
  saveSettings: (payload: {
    settings?: Partial<BootstrapState['settings']>
    backendConnection?: BackendConnection
    sidebarShortcuts?: SidebarShortcuts
    shortcutSync?: ShortcutSyncState
    dashboardCards?: DashboardCards
    hostsProfiles?: HostsProfiles
  }) =>
    invoke<void>('save_settings', payload),
  saveWorkspace: (tabs: ToolTab[]) => invoke<void>('save_workspace', { tabs }),
  loadNotes: () => invoke<NotesState>('load_notes'),
  saveNotes: (notes: NotesState) => invoke<void>('save_notes', notes),
  readHosts: () => invoke<HostsSnapshot>('read_hosts'),
  applyHosts: (content: string, sourceSha256: string, previewOnly: boolean) =>
    invoke<HostsPreview>('apply_hosts', { content, sourceSha256, previewOnly }),
  listHostsBackups: () => invoke<HostsBackup[]>('list_hosts_backups'),
  restoreHostsBackup: (id: string) => invoke<{ changed: boolean; backups: HostsBackup[] }>('restore_hosts_backup', id),
  openWebView2Download: () => invoke<void>('open_webview2_download'),
  openProjectRepository: () => invoke<void>('open_project_repository'),
  openGithubRepository: () => invoke<void>('open_github_repository'),
  openDesktopDownload: () => invoke<void>('open_desktop_download'),
  openDeveloperTools: () => invoke<void>('open_developer_tools'),
  setActivationHotkey: (hotkey: string) => invoke<{ activationHotkey: string }>('set_activation_hotkey', hotkey),
  hideToTray: () => invoke<void>('hide_to_tray'),
  getClipboardHistory: () => invoke<ClipboardHistorySnapshot>('get_clipboard_history'),
  clearClipboardHistory: () => invoke<void>('clear_clipboard_history'),
  deleteClipboardHistoryItem: (id: string) => invoke<{ removed: boolean }>('delete_clipboard_history_item', id),
  setClipboardMonitoring: (enabled: boolean) => invoke<{ enabled: boolean }>('set_clipboard_monitoring', enabled),
  copyText: (text: string) => invoke<void>('copy_text', text),
  getSystemStatus: () => invoke<SystemStatusSnapshot>('get_system_status'),
}

function normalizeBrowserBackendConnection(value: Partial<BackendConnection> | undefined, developerModeEnabled: boolean): BackendConnection {
  const legacy = value as Partial<BackendConnection> & { apiOrigin?: unknown } | undefined
  const legacyLocalOrigin = typeof legacy?.apiOrigin === 'string' ? resolveLocalServiceOrigin(legacy.apiOrigin) : null
  const localApiOrigin = typeof value?.localApiOrigin === 'string'
    ? resolveLocalServiceOrigin(value.localApiOrigin)
    : null
  return {
    schemaVersion: 1,
    localApiOrigin: localApiOrigin ?? legacyLocalOrigin ?? DEFAULT_LOCAL_API_ORIGIN,
    useLocalApi: developerModeEnabled && (value?.useLocalApi === true || Boolean(legacyLocalOrigin)),
  }
}

function normalizeBrowserSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const defaults = defaultBrowserState().settings
  return {
    schemaVersion: 1,
    theme: value?.theme === 'light' || value?.theme === 'dark' ? value.theme : 'system',
    sidebarCollapsed: typeof value?.sidebarCollapsed === 'boolean' ? value.sidebarCollapsed : defaults.sidebarCollapsed,
    particleQuality: value?.particleQuality === 'balanced' || value?.particleQuality === 'off' ? value.particleQuality : 'high',
    motionMode: value?.motionMode === 'reduced' ? 'reduced' : 'system',
    sidebarStartup: value?.sidebarStartup === 'collapsed' || value?.sidebarStartup === 'expanded' ? value.sidebarStartup : 'remember',
    restorePinnedTabsOnLaunch: typeof value?.restorePinnedTabsOnLaunch === 'boolean'
      ? value.restorePinnedTabsOnLaunch
      : defaults.restorePinnedTabsOnLaunch,
    editorFontSize: typeof value?.editorFontSize === 'number' && Number.isInteger(value.editorFontSize) && value.editorFontSize >= 12 && value.editorFontSize <= 16
      ? value.editorFontSize
      : defaults.editorFontSize,
    editorLineWrapping: typeof value?.editorLineWrapping === 'boolean'
      ? value.editorLineWrapping
      : defaults.editorLineWrapping,
    clipboardMonitoringEnabled: typeof value?.clipboardMonitoringEnabled === 'boolean'
      ? value.clipboardMonitoringEnabled
      : defaults.clipboardMonitoringEnabled,
    systemStatusRefreshSeconds: value?.systemStatusRefreshSeconds === 30 || value?.systemStatusRefreshSeconds === 60 || value?.systemStatusRefreshSeconds === 300
      ? value.systemStatusRefreshSeconds
      : 0,
    developerModeEnabled: value?.developerModeEnabled === true,
    activationHotkey: typeof value?.activationHotkey === 'string' ? value.activationHotkey : defaults.activationHotkey,
  }
}

async function getBrowserSystemStatus(): Promise<SystemStatusSnapshot> {
  const navigatorWithDetails = navigator as Navigator & {
    deviceMemory?: number
    connection?: { effectiveType?: string; type?: string; downlink?: number }
    userAgentData?: { brands?: Array<{ brand: string; version: string }>; platform?: string }
  }
  const storageEstimate = await navigator.storage?.estimate?.().catch(() => undefined)
  let localStorageAvailable = true
  try {
    void localStorage.length
  } catch {
    localStorageAvailable = false
  }
  let webgl = false
  if (!navigator.userAgent.includes('jsdom')) {
    try {
      const canvas = document.createElement('canvas')
      webgl = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
    } catch {
      webgl = false
    }
  }
  return {
    capturedAt: new Date().toISOString(),
    runtime: 'web',
    system: {
      browser: navigatorWithDetails.userAgentData?.brands?.map((brand) => `${brand.brand} ${brand.version}`).join(', ') || navigator.userAgent,
      platform: navigatorWithDetails.userAgentData?.platform || navigator.platform || null,
      logicalCores: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: navigatorWithDetails.deviceMemory ?? null,
      cpuName: null,
      powerSource: 'unavailable',
      powerPercent: null,
      powerCharging: null,
      online: navigator.onLine,
      network: navigatorWithDetails.connection?.effectiveType || navigatorWithDetails.connection?.type || null,
      downlinkMbps: navigatorWithDetails.connection?.downlink ?? null,
      viewport: `${window.innerWidth} x ${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio,
      webgl,
    },
    application: {
      localStorageAvailable,
      indexedDbAvailable: typeof indexedDB !== 'undefined',
      storageQuotaBytes: storageEstimate?.quota ?? null,
      storageUsageBytes: storageEstimate?.usage ?? null,
      trayHidden: null,
      clipboard: null,
    },
  }
}
