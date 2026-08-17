import { defineStore } from 'pinia'
import { toRaw } from 'vue'

import { desktopApi } from '@/api/desktopApi'
import { useToastStore } from '@/stores/toast'
import type { AppSettings, HostsProfiles, RuntimeInfo, ThemeMode, ToolId, ToolTab } from '@/types'

let workspaceTimer: number | undefined
let settingsTimer: number | undefined
let mediaQuery: MediaQueryList | undefined

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const useAppStore = defineStore('app', {
  state: () => ({
    ready: false,
    loadingError: '',
    settings: { schemaVersion: 1, theme: 'system', sidebarCollapsed: true } as AppSettings,
    hostsProfiles: { schemaVersion: 1, groups: [] } as HostsProfiles,
    tabs: [] as ToolTab[],
    activeTabId: '',
    runtime: null as RuntimeInfo | null,
  }),
  getters: {
    activeTab(state): ToolTab | undefined {
      return state.tabs.find((tab) => tab.id === state.activeTabId)
    },
  },
  actions: {
    async bootstrap(defaultHomeState: Record<string, unknown>) {
      const result = await desktopApi.loadState()
      if (!result.ok) {
        this.loadingError = result.error.message
        return
      }
      this.settings = result.data.settings
      this.hostsProfiles = result.data.hostsProfiles
      this.runtime = result.data.runtime
      const pinnedTabs = result.data.workspace.tabs.filter((tab) => tab.pinned && tab.toolId !== 'home')
      this.tabs = [
        { id: id('home'), toolId: 'home', title: '首页', pinned: false, state: defaultHomeState },
        ...pinnedTabs,
      ]
      this.activeTabId = this.tabs[0]?.id ?? ''
      this.applyTheme(this.settings.theme)
      this.ready = true
    },
    openTool(toolId: ToolId, title: string, initialState: Record<string, unknown>, singleton = false, forceNew = false) {
      const existing = this.tabs.find((tab) => tab.toolId === toolId)
      if (existing && (singleton || !forceNew)) {
        if (existing.toolId === 'home') existing.state = { ...existing.state, entered: true }
        this.activeTabId = existing.id
        return
      }
      const sameToolCount = this.tabs.filter((tab) => tab.toolId === toolId).length
      const tab: ToolTab = {
        id: id(toolId),
        toolId,
        title: sameToolCount ? `${title} ${sameToolCount + 1}` : title,
        pinned: false,
        state: structuredClone(initialState),
      }
      this.tabs.push(tab)
      this.activeTabId = tab.id
    },
    activateTab(tabId: string) {
      const tab = this.tabs.find((item) => item.id === tabId)
      if (!tab) return
      if (tab.toolId === 'home') tab.state = { ...tab.state, entered: true }
      this.activeTabId = tab.id
    },
    closeTab(tabId: string) {
      this.closeTabs([tabId])
    },
    closeTabs(tabIds: string[]) {
      const closing = new Set(tabIds)
      const activeIndex = this.tabs.findIndex((tab) => tab.id === this.activeTabId)
      const activeWillClose = closing.has(this.activeTabId)
      const remaining = this.tabs.filter((tab) => tab.toolId === 'home' || !closing.has(tab.id))
      if (remaining.length === this.tabs.length) return
      this.tabs = remaining
      if (activeWillClose) {
        const nextIndex = Math.min(Math.max(activeIndex, 0), remaining.length - 1)
        this.activeTabId = remaining[nextIndex]?.id ?? remaining[0]?.id ?? ''
      }
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
      workspaceTimer = window.setTimeout(() => {
        const pinned = this.tabs.filter((tab) => tab.pinned).map((tab) => structuredClone(toRaw(tab)))
        void desktopApi.saveWorkspace(pinned)
      }, 350)
    },
    setTheme(theme: ThemeMode) {
      this.settings.theme = theme
      this.applyTheme(theme)
      this.scheduleSettingsSave()
    },
    toggleSidebar() {
      this.settings.sidebarCollapsed = !this.settings.sidebarCollapsed
      this.scheduleSettingsSave()
    },
    async openProjectRepository() {
      const result = await desktopApi.openProjectRepository()
      if (!result.ok) useToastStore().show(result.error.message, 'error')
    },
    async openGithubRepository() {
      const result = await desktopApi.openGithubRepository()
      if (!result.ok) useToastStore().show(result.error.message, 'error')
    },
    setHostsProfiles(profiles: HostsProfiles) {
      this.hostsProfiles = profiles
      this.scheduleSettingsSave()
    },
    scheduleSettingsSave() {
      window.clearTimeout(settingsTimer)
      settingsTimer = window.setTimeout(() => {
        void desktopApi.saveSettings({
          settings: this.settings,
          hostsProfiles: this.hostsProfiles,
        })
      }, 350)
    },
    applyTheme(theme: ThemeMode) {
      mediaQuery ??= window.matchMedia('(prefers-color-scheme: dark)')
      const resolved = theme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved
      mediaQuery.onchange = () => {
        if (this.settings.theme === 'system') this.applyTheme('system')
      }
    },
  },
})
