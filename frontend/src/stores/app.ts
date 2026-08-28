import { defineStore } from 'pinia'
import { toRaw } from 'vue'

import { desktopApi } from '@/api/desktopApi'
import { defaultNotesState } from '@/api/notesStorage'
import {
  getRemoteShortcuts,
  putRemoteShortcuts,
  refreshLocalSession,
  DEFAULT_LOCAL_API_ORIGIN,
  DEFAULT_REMOTE_API_ORIGIN,
  resolveLocalServiceOrigin,
  type RemoteAccount,
  type RemoteSession,
  type ShortcutSnapshot,
} from '@/api/remoteApi'
import { useToastStore } from '@/stores/toast'
import { setActiveLocale, translateForLocale } from '@/i18n'
import { defaultDashboardCards, localizeSystemDashboardCards } from '@/tools/home/dashboardCards'
import type { AppLocale, AppSettings, BackendConnection, DashboardCards, HostsProfiles, NotesState, RuntimeInfo, ShortcutSyncState, SidebarShortcuts, ThemeMode, ToolId, ToolTab } from '@/types'

// Debounce persistence separately so high-frequency editor and tab interactions never block rendering.
let workspaceTimer: number | undefined
let settingsTimer: number | undefined
let notesTimer: number | undefined
let mediaQuery: MediaQueryList | undefined
let motionQuery: MediaQueryList | undefined
const knownToolIds = new Set<ToolId>(['notes', 'json', 'json-diff', 'json-java', 'java', 'timestamp', 'base64-text', 'base64-image', 'base64-file', 'qrcode', 'image-studio', 'video-audio', 'cron', 'sql', 'yaml', 'xml', 'text-diff', 'text-stats', 'regex', 'md5', 'naming', 'identifiers', 'hosts', 'clipboard-history', 'calculator'])

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function defaultShortcutSync(): ShortcutSyncState {
  return { schemaVersion: 1, accountId: null, mode: 'pending', revision: null, pendingToolIds: null }
}

function defaultAppSettings(): AppSettings {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    theme: 'system',
    sidebarCollapsed: true,
    particleQuality: 'high',
    motionMode: 'system',
    sidebarStartup: 'remember',
    restorePinnedTabsOnLaunch: true,
    editorFontSize: 13,
    editorLineWrapping: true,
    clipboardMonitoringEnabled: true,
    systemStatusRefreshSeconds: 1,
    systemStatusRefreshMigrationVersion: 1,
    developerModeEnabled: false,
    activationHotkey: 'Ctrl+Alt+K',
  }
}

function normalizeAppSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const defaults = defaultAppSettings()
  return {
    schemaVersion: 1,
    locale: value?.locale === 'en-US' ? 'en-US' : 'zh-CN',
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
    systemStatusRefreshSeconds: value?.systemStatusRefreshMigrationVersion !== 1 && value?.systemStatusRefreshSeconds === 0
      ? defaults.systemStatusRefreshSeconds
      : value?.systemStatusRefreshSeconds === 0 || value?.systemStatusRefreshSeconds === 1 || value?.systemStatusRefreshSeconds === 30 || value?.systemStatusRefreshSeconds === 60 || value?.systemStatusRefreshSeconds === 300
        ? value.systemStatusRefreshSeconds
        : defaults.systemStatusRefreshSeconds,
    systemStatusRefreshMigrationVersion: 1,
    developerModeEnabled: value?.developerModeEnabled === true,
    activationHotkey: typeof value?.activationHotkey === 'string' ? value.activationHotkey : defaults.activationHotkey,
  }
}

function asToolIds(toolIds: string[]): ToolId[] {
  return toolIds.filter((toolId): toolId is ToolId => knownToolIds.has(toolId as ToolId)).slice(0, 12)
}

function isShortcutSnapshot(value: unknown): value is ShortcutSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<ShortcutSnapshot>
  return typeof snapshot.revision === 'number' && Array.isArray(snapshot.toolIds)
}

function localizeDefaultTabTitle(tab: ToolTab, locale: AppLocale): ToolTab {
  const translatedName = translateForLocale(locale, `tool.${tab.toolId}.name`)
  for (const sourceLocale of ['zh-CN', 'en-US'] as AppLocale[]) {
    const sourceName = translateForLocale(sourceLocale, `tool.${tab.toolId}.name`)
    if (tab.title === sourceName) return { ...tab, title: translatedName }
    const suffix = tab.title.match(new RegExp(`^${sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`))
    if (suffix) return { ...tab, title: `${translatedName} ${suffix[1]}` }
  }
  return tab
}

export const useAppStore = defineStore('app', {
  state: () => ({
    ready: false,
    loadingError: '',
    settings: defaultAppSettings() as AppSettings,
    systemReducedMotion: false,
    backendConnection: { schemaVersion: 1, localApiOrigin: DEFAULT_LOCAL_API_ORIGIN, useLocalApi: false } as BackendConnection,
    sidebarShortcuts: { schemaVersion: 1, toolIds: ['notes', 'json', 'calculator', 'java', 'timestamp', 'base64-text', 'cron', 'hosts', 'clipboard-history', 'md5'] } as SidebarShortcuts,
    shortcutSync: defaultShortcutSync() as ShortcutSyncState,
    dashboardCards: defaultDashboardCards() as DashboardCards,
    account: null as RemoteAccount | null,
    accessToken: '',
    remoteShortcutSnapshot: null as ShortcutSnapshot | null,
    shortcutConflict: null as { localToolIds: ToolId[]; server: ShortcutSnapshot } | null,
    shortcutSyncing: false,
    hostsProfiles: { schemaVersion: 1, groups: [] } as HostsProfiles,
    notes: defaultNotesState() as NotesState,
    tabs: [] as ToolTab[],
    activeTabId: '',
    runtime: null as RuntimeInfo | null,
  }),
  getters: {
    activeTab(state): ToolTab | undefined { return state.tabs.find((tab) => tab.id === state.activeTabId) },
    migrationRequired(state): boolean { return Boolean(state.account && state.shortcutSync.mode === 'pending' && state.remoteShortcutSnapshot) },
    apiOrigin(state): string {
      return state.settings.developerModeEnabled && state.backendConnection.useLocalApi
        ? state.backendConnection.localApiOrigin
        : DEFAULT_REMOTE_API_ORIGIN
    },
    usingLocalDeveloperService(state): boolean {
      return state.settings.developerModeEnabled && state.backendConnection.useLocalApi
    },
    reducedMotion(state): boolean {
      return state.settings.motionMode === 'reduced' || state.systemReducedMotion
    },
  },
  actions: {
    async bootstrap(defaultHomeState: Record<string, unknown>) {
      const result = await desktopApi.loadState()
      if (!result.ok) { this.loadingError = result.error.message; return }
      this.settings = normalizeAppSettings(result.data.settings)
      setActiveLocale(this.settings.locale)
      const legacyConnection = result.data.backendConnection as BackendConnection & { apiOrigin?: unknown }
      const legacyLocalOrigin = typeof legacyConnection.apiOrigin === 'string' ? resolveLocalServiceOrigin(legacyConnection.apiOrigin) : null
      const configuredLocalOrigin = typeof legacyConnection.localApiOrigin === 'string'
        ? resolveLocalServiceOrigin(legacyConnection.localApiOrigin)
        : null
      this.backendConnection = {
        schemaVersion: 1,
        localApiOrigin: configuredLocalOrigin ?? legacyLocalOrigin ?? DEFAULT_LOCAL_API_ORIGIN,
        // Legacy loopback settings are retained only for an already enabled developer mode.
        useLocalApi: this.settings.developerModeEnabled && (legacyConnection.useLocalApi === true || Boolean(legacyLocalOrigin)),
      }
      this.sidebarShortcuts = result.data.sidebarShortcuts
      this.shortcutSync = result.data.shortcutSync ?? defaultShortcutSync()
      const defaultCards = defaultDashboardCards()
      this.dashboardCards = localizeSystemDashboardCards({
        schemaVersion: 1,
        cards: result.data.dashboardCards?.cards ?? defaultCards.cards,
        carouselMode: result.data.dashboardCards?.carouselMode === 'classic' ? 'classic' : 'step',
        classicRotationSpeed: typeof result.data.dashboardCards?.classicRotationSpeed === 'number'
          ? Math.max(6, Math.min(30, result.data.dashboardCards.classicRotationSpeed))
          : defaultCards.classicRotationSpeed,
        stepIntervalMs: typeof result.data.dashboardCards?.stepIntervalMs === 'number'
          ? Math.max(800, Math.min(6000, result.data.dashboardCards.stepIntervalMs))
          : defaultCards.stepIntervalMs,
      }, this.settings.locale)
      this.hostsProfiles = result.data.hostsProfiles
      this.runtime = result.data.runtime
      const pinnedTabs = this.settings.restorePinnedTabsOnLaunch
        ? result.data.workspace.tabs.filter((tab) => tab.pinned && tab.toolId !== 'home').map((tab) => localizeDefaultTabTitle(tab, this.settings.locale))
        : []
      this.tabs = [{ id: id('home'), toolId: 'home', title: translateForLocale(this.settings.locale, 'tool.home.name'), pinned: false, state: defaultHomeState }, ...pinnedTabs]
      this.activeTabId = this.tabs[0]?.id ?? ''
      if (this.settings.sidebarStartup === 'collapsed') this.settings.sidebarCollapsed = true
      if (this.settings.sidebarStartup === 'expanded') this.settings.sidebarCollapsed = false
      this.applyTheme(this.settings.theme)
      this.applyMotionPreference()
      const notesResult = await desktopApi.loadNotes()
      if (notesResult.ok) this.notes = notesResult.data
      else useToastStore().show(notesResult.error.message, 'error')
      this.ready = true
      // Session restoration is deliberately asynchronous: local tools remain usable when the API is offline.
      void this.restoreSession()
    },
    openTool(toolId: ToolId, title: string, initialState: Record<string, unknown>, singleton = false, forceNew = false) {
      const existing = this.tabs.find((tab) => tab.toolId === toolId)
      if (existing && (singleton || !forceNew)) { this.activeTabId = existing.id; return }
      const sameToolCount = this.tabs.filter((tab) => tab.toolId === toolId).length
      this.tabs.push({ id: id(toolId), toolId, title: sameToolCount ? `${title} ${sameToolCount + 1}` : title, pinned: false, state: structuredClone(initialState) })
      this.activeTabId = this.tabs.at(-1)?.id ?? ''
    },
    activateTab(tabId: string) { if (this.tabs.some((tab) => tab.id === tabId)) this.activeTabId = tabId },
    closeTab(tabId: string) { this.closeTabs([tabId]) },
    closeTabs(tabIds: string[]) {
      const closing = new Set(tabIds)
      const activeIndex = this.tabs.findIndex((tab) => tab.id === this.activeTabId)
      const activeWillClose = closing.has(this.activeTabId)
      const remaining = this.tabs.filter((tab) => tab.toolId === 'home' || !closing.has(tab.id))
      if (remaining.length === this.tabs.length) return
      this.tabs = remaining
      if (activeWillClose) this.activeTabId = remaining[Math.min(Math.max(activeIndex, 0), remaining.length - 1)]?.id ?? remaining[0]?.id ?? ''
      this.scheduleWorkspaceSave()
    },
    togglePin(tabId: string) {
      const tab = this.tabs.find((item) => item.id === tabId)
      if (!tab) return
      tab.pinned = !tab.pinned
      this.scheduleWorkspaceSave()
    },
    updateTabState(tabId: string, state: Record<string, unknown>) {
      const tab = this.tabs.find((item) => item.id === tabId)
      if (!tab) return
      tab.state = state
      if (tab.pinned) this.scheduleWorkspaceSave()
    },
    scheduleWorkspaceSave() {
      window.clearTimeout(workspaceTimer)
      workspaceTimer = window.setTimeout(() => { void desktopApi.saveWorkspace(this.tabs.filter((tab) => tab.pinned).map((tab) => structuredClone(toRaw(tab)))) }, 350)
    },
    setTheme(theme: ThemeMode) { this.settings.theme = theme; this.applyTheme(theme); this.scheduleSettingsSave() },
    setLocale(locale: AppLocale) {
      if (this.settings.locale === locale) return
      this.settings.locale = locale
      this.dashboardCards = localizeSystemDashboardCards(this.dashboardCards, locale)
      this.tabs = this.tabs.map((tab) => localizeDefaultTabTitle(tab, locale))
      setActiveLocale(locale)
      this.scheduleSettingsSave()
    },
    toggleSidebar() { this.settings.sidebarCollapsed = !this.settings.sidebarCollapsed; this.scheduleSettingsSave() },
    setParticleQuality(quality: AppSettings['particleQuality']) {
      this.settings.particleQuality = quality
      this.scheduleSettingsSave()
    },
    setMotionMode(mode: AppSettings['motionMode']) {
      this.settings.motionMode = mode
      this.applyMotionPreference()
      this.scheduleSettingsSave()
    },
    setSidebarStartup(mode: AppSettings['sidebarStartup']) {
      this.settings.sidebarStartup = mode
      this.scheduleSettingsSave()
    },
    setRestorePinnedTabsOnLaunch(enabled: boolean) {
      this.settings.restorePinnedTabsOnLaunch = enabled
      this.scheduleSettingsSave()
    },
    setEditorFontSize(size: number) {
      this.settings.editorFontSize = Math.max(12, Math.min(16, Math.round(size)))
      this.scheduleSettingsSave()
    },
    setEditorLineWrapping(enabled: boolean) {
      this.settings.editorLineWrapping = enabled
      this.scheduleSettingsSave()
    },
    async setClipboardMonitoringEnabled(enabled: boolean): Promise<boolean> {
      this.settings.clipboardMonitoringEnabled = enabled
      const result = await desktopApi.setClipboardMonitoring(enabled)
      if (!result.ok) {
        useToastStore().show(result.error.message, 'error')
        return false
      }
      return this.persistSettings()
    },
    setSystemStatusRefreshSeconds(seconds: AppSettings['systemStatusRefreshSeconds']) {
      this.settings.systemStatusRefreshSeconds = seconds
      this.scheduleSettingsSave()
    },
    async setDeveloperModeEnabled(enabled: boolean): Promise<boolean> {
      this.settings.developerModeEnabled = enabled
      if (!enabled) this.backendConnection.useLocalApi = false
      return this.persistSettings()
    },
    async setActivationHotkey(hotkey: string): Promise<boolean> {
      const result = await desktopApi.setActivationHotkey(hotkey)
      if (!result.ok) {
        useToastStore().show(result.error.message, 'error')
        return false
      }
      this.settings.activationHotkey = result.data.activationHotkey
      return true
    },
    toggleSidebarShortcut(toolId: ToolId) {
      const next = [...this.sidebarShortcuts.toolIds]
      const index = next.indexOf(toolId)
      if (index >= 0) {
        if (next.length === 1) { useToastStore().show('侧栏至少保留一个快捷工具', 'error'); return }
        next.splice(index, 1)
      } else if (next.length < 12) next.push(toolId)
      this.setSidebarShortcuts(next)
    },
    setSidebarShortcuts(toolIds: ToolId[]) {
      const unique = [...new Set(toolIds)].filter((toolId) => knownToolIds.has(toolId))
      if (!unique.length || unique.length > 12) return
      this.sidebarShortcuts = { schemaVersion: 1, toolIds: unique }
      this.queueShortcutSync()
      this.scheduleSettingsSave()
    },
    resetSidebarShortcuts() { this.setSidebarShortcuts(['notes', 'json', 'calculator', 'java', 'timestamp', 'base64-text', 'cron', 'hosts', 'clipboard-history', 'md5']) },
    setBackendConnection(connection: BackendConnection) {
      this.backendConnection = {
        schemaVersion: 1,
        localApiOrigin: resolveLocalServiceOrigin(connection.localApiOrigin) ?? DEFAULT_LOCAL_API_ORIGIN,
        useLocalApi: this.settings.developerModeEnabled && connection.useLocalApi,
      }
      this.scheduleSettingsSave()
    },
    async setDashboardCards(dashboardCards: DashboardCards): Promise<boolean> {
      const toolIds = new Set<ToolId>()
      const normalized = dashboardCards.cards
        .filter((card) => {
          if (!knownToolIds.has(card.toolId) || toolIds.has(card.toolId) || !card.title.trim() || !/^#[0-9a-fA-F]{6}$/.test(card.accentColor)) return false
          toolIds.add(card.toolId)
          return true
        })
        .slice(0, 6)
        .map((card, sortOrder) => {
          return {
            ...card,
            title: card.title.trim().slice(0, 80),
            description: card.description.trim().slice(0, 240),
            accentColor: card.accentColor.toLowerCase(),
            sortOrder,
          }
        })
      if (!normalized.length || !normalized.some((card) => card.enabled)) {
        useToastStore().show('首页至少需要显示一张有效卡片', 'error')
        return false
      }
      const previous = this.dashboardCards
      this.dashboardCards = {
        schemaVersion: 1,
        cards: normalized,
        carouselMode: dashboardCards.carouselMode === 'classic' ? 'classic' : 'step',
        classicRotationSpeed: Math.max(6, Math.min(30, Math.round(dashboardCards.classicRotationSpeed))),
        stepIntervalMs: Math.max(800, Math.min(6000, Math.round(dashboardCards.stepIntervalMs / 200) * 200)),
      }
      const saved = await this.persistSettings()
      if (!saved) {
        this.dashboardCards = previous
        return false
      }
      useToastStore().show('首页卡片已更新')
      return true
    },
    async openProjectRepository() { const result = await desktopApi.openProjectRepository(); if (!result.ok) useToastStore().show(result.error.message, 'error') },
    async openGithubRepository() { const result = await desktopApi.openGithubRepository(); if (!result.ok) useToastStore().show(result.error.message, 'error') },
    setHostsProfiles(profiles: HostsProfiles) { this.hostsProfiles = profiles; this.scheduleSettingsSave() },
    scheduleSettingsSave() {
      window.clearTimeout(settingsTimer)
      settingsTimer = window.setTimeout(() => { void this.persistSettings() }, 350)
    },
    setNotes(notes: NotesState) { this.notes = notes; this.scheduleNotesSave() },
    scheduleNotesSave() {
      window.clearTimeout(notesTimer)
      notesTimer = window.setTimeout(async () => {
        // Notes are local-only, but a failed write must be visible instead of silently dropping the edit.
        const result = await desktopApi.saveNotes(structuredClone(toRaw(this.notes)))
        if (!result.ok) useToastStore().show(`笔记未保存：${result.error.message}`, 'error')
      }, 450)
    },
    async persistSettings(): Promise<boolean> {
      const result = await desktopApi.saveSettings({
        settings: this.settings,
        backendConnection: this.backendConnection,
        sidebarShortcuts: this.sidebarShortcuts,
        shortcutSync: this.shortcutSync,
        dashboardCards: this.dashboardCards,
        hostsProfiles: this.hostsProfiles,
      })
      if (!result.ok) useToastStore().show(`设置未保存：${result.error.message}`, 'error')
      return result.ok
    },
    async restoreSession() {
      const result = await refreshLocalSession(this.apiOrigin)
      if (result.ok) await this.establishSession(result.data)
    },
    async establishSession(session: RemoteSession) {
      this.account = session.user
      this.accessToken = session.accessToken
      // Tokens stay only in memory. Persistent state stores queue metadata, never credentials.
      if (this.shortcutSync.accountId !== session.user.id || this.shortcutSync.mode === 'pending') {
        await this.prepareShortcutMigration()
      } else if (this.shortcutSync.mode === 'enabled') {
        void this.replayShortcutQueue()
      }
    },
    clearSession() {
      this.account = null
      this.accessToken = ''
      this.remoteShortcutSnapshot = null
      this.shortcutConflict = null
    },
    async prepareShortcutMigration() {
      if (!this.account || !this.accessToken) return
      const result = await getRemoteShortcuts(this.apiOrigin, this.accessToken)
      if (!result.ok) { useToastStore().show(`无法读取快捷方式：${result.error.message}`, 'error'); return }
      this.remoteShortcutSnapshot = result.data
      this.shortcutSync = { ...this.shortcutSync, accountId: this.account.id, mode: 'pending', revision: result.data.revision, pendingToolIds: null }
      this.scheduleSettingsSave()
    },
    async chooseShortcutMigration(choice: 'local' | 'server' | 'later') {
      if (!this.account) return
      const snapshot = this.remoteShortcutSnapshot
      if (!snapshot) { await this.prepareShortcutMigration(); return }
      // Never overwrite local shortcuts until the user explicitly chooses the first-login migration direction.
      if (choice === 'later') {
        this.shortcutSync = { schemaVersion: 1, accountId: this.account.id, mode: 'paused', revision: snapshot.revision, pendingToolIds: null }
      } else if (choice === 'server') {
        const toolIds = asToolIds(snapshot.toolIds)
        if (toolIds.length) this.sidebarShortcuts = { schemaVersion: 1, toolIds }
        this.shortcutSync = { schemaVersion: 1, accountId: this.account.id, mode: 'enabled', revision: snapshot.revision, pendingToolIds: null }
      } else {
        this.shortcutSync = { schemaVersion: 1, accountId: this.account.id, mode: 'enabled', revision: snapshot.revision, pendingToolIds: [...this.sidebarShortcuts.toolIds] }
      }
      this.remoteShortcutSnapshot = null
      await this.persistSettings()
      if (choice === 'local') void this.replayShortcutQueue()
    },
    queueShortcutSync() {
      if (!this.account || !this.accessToken || this.shortcutSync.mode !== 'enabled' || this.shortcutSync.accountId !== this.account.id) return
      // Local-first behavior: persist the latest intent, then replay it when the service is reachable.
      this.shortcutSync = { ...this.shortcutSync, pendingToolIds: [...this.sidebarShortcuts.toolIds] }
      void this.replayShortcutQueue()
    },
    async replayShortcutQueue() {
      if (this.shortcutSyncing || !this.account || !this.accessToken || this.shortcutSync.mode !== 'enabled' || !this.shortcutSync.pendingToolIds || this.shortcutSync.revision === null) return
      this.shortcutSyncing = true
      const pending = [...this.shortcutSync.pendingToolIds]
      const result = await putRemoteShortcuts(this.apiOrigin, this.accessToken, { baseRevision: this.shortcutSync.revision, toolIds: pending })
      this.shortcutSyncing = false
      if (result.ok) {
        this.shortcutSync = { ...this.shortcutSync, revision: result.data.revision, pendingToolIds: null }
        await this.persistSettings()
        return
      }
      // Do not guess a merge for ordered shortcuts; present the two complete versions to the user.
      if (result.error.code === 'SHORTCUT_CONFLICT' && isShortcutSnapshot(result.error.details)) {
        this.shortcutConflict = { localToolIds: pending, server: result.error.details }
        this.shortcutSync = { ...this.shortcutSync, revision: result.error.details.revision, pendingToolIds: null }
        await this.persistSettings()
      }
    },
    async resolveShortcutConflict(choice: 'local' | 'server') {
      const conflict = this.shortcutConflict
      if (!conflict) return
      if (choice === 'server') {
        const toolIds = asToolIds(conflict.server.toolIds)
        if (toolIds.length) this.sidebarShortcuts = { schemaVersion: 1, toolIds }
        this.shortcutSync = { ...this.shortcutSync, revision: conflict.server.revision, pendingToolIds: null }
      } else {
        this.sidebarShortcuts = { schemaVersion: 1, toolIds: conflict.localToolIds }
        this.shortcutSync = { ...this.shortcutSync, revision: conflict.server.revision, pendingToolIds: conflict.localToolIds }
      }
      this.shortcutConflict = null
      await this.persistSettings()
      if (choice === 'local') void this.replayShortcutQueue()
    },
    async retryShortcutSync() {
      if (this.shortcutSync.mode === 'paused') { await this.prepareShortcutMigration(); return }
      void this.replayShortcutQueue()
    },
    applyTheme(theme: ThemeMode) {
      mediaQuery ??= window.matchMedia('(prefers-color-scheme: dark)')
      const resolved = theme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved
      mediaQuery.onchange = () => { if (this.settings.theme === 'system') this.applyTheme('system') }
    },
    applyMotionPreference() {
      motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)')
      this.systemReducedMotion = motionQuery.matches
      document.documentElement.dataset.motion = this.reducedMotion ? 'reduced' : 'full'
      motionQuery.onchange = () => {
        this.systemReducedMotion = motionQuery?.matches ?? false
        document.documentElement.dataset.motion = this.reducedMotion ? 'reduced' : 'full'
      }
    },
  },
})
