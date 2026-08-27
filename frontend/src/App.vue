<script setup lang="ts">
import {
  ChevronDown,
  CircleUserRound,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
  X,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import ToolSearchDialog from '@/components/ToolSearchDialog.vue'
import ShortcutManagerDialog from '@/components/ShortcutManagerDialog.vue'
import AccountSyncDialog from '@/components/AccountSyncDialog.vue'
import DeveloperPanelDialog from '@/components/DeveloperPanelDialog.vue'
import ApplicationSettingsDialog from '@/components/ApplicationSettingsDialog.vue'
import { desktopApi } from '@/api/desktopApi'
import { logoutLocalAccount } from '@/api/remoteApi'
import { isWebRuntime } from '@/runtime'
import ToastViewport from '@/components/ToastViewport.vue'
import giteeLogo from '@/assets/gitee-g-red.svg'
import githubLogo from '@/assets/github-invertocat-white.svg'
import kaitoolsMarkWhite from '@/assets/kaitools-mark-white.svg'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import type { ThemeMode, ToolTab } from '@/types'
import { homeTool, toolsById, workspaceTools } from '@/tools/registry'
import { APP_VERSION } from '@/version'

const app = useAppStore()
const toast = useToastStore()
const sidebarSearch = ref('')
const searchOpen = ref(false)
const shortcutManagerOpen = ref(false)
const accountSyncOpen = ref(false)
const developerPanelOpen = ref(false)
const applicationSettingsOpen = ref(false)
let developerUnlockClicks = 0
let developerUnlockTimer: number | undefined
const tabMenu = ref({ visible: false, x: 0, y: 0, tabId: '' })
const sidebarTools = computed(() => app.sidebarShortcuts.toolIds
  .map((toolId) => toolsById[toolId])
  .filter((tool): tool is (typeof workspaceTools)[number] => Boolean(tool && tool.id !== 'home')))
const visibleTools = computed(() => {
  const query = sidebarSearch.value.trim().toLowerCase()
  if (!query) return sidebarTools.value
  return sidebarTools.value.filter((tool) => [tool.name, tool.description, ...tool.keywords].some((value) => value.toLowerCase().includes(query)))
})
const activeTool = computed(() => (app.activeTab ? toolsById[app.activeTab.toolId] : undefined))
const themeIcon = computed(() => ({ system: Monitor, light: Sun, dark: Moon })[app.settings.theme])
const themeLabel = computed(() => ({ system: '跟随系统', light: '浅色主题', dark: '深色主题' })[app.settings.theme])
const accountTitle = computed(() => app.account?.displayName || app.account?.email || '本地模式')
const accountSubtitle = computed(() => app.account ? (app.usingLocalDeveloperService ? '已登录 · 本机开发服务' : '已登录 · 同步已启用') : '账户与同步')
const developerModeActive = computed(() => import.meta.env.DEV || app.settings.developerModeEnabled)

async function signOut(): Promise<void> {
  if (app.account) await logoutLocalAccount(app.apiOrigin)
  app.clearSession()
}

async function handleVersionClick(): Promise<void> {
  if (developerModeActive.value) {
    developerPanelOpen.value = true
    return
  }
  window.clearTimeout(developerUnlockTimer)
  developerUnlockClicks += 1
  developerUnlockTimer = window.setTimeout(() => { developerUnlockClicks = 0 }, 2500)
  if (developerUnlockClicks === 6) {
    toast.show('再点击 1 次启用开发者模式')
  } else if (developerUnlockClicks >= 7) {
    developerUnlockClicks = 0
    const saved = await app.setDeveloperModeEnabled(true)
    if (!saved) return
    toast.show('开发者模式已启用')
    developerPanelOpen.value = true
  }
}

function openTool(toolId: keyof typeof toolsById, forceNew = false): void {
  const tool = toolsById[toolId]
  app.openTool(tool.id, tool.name, tool.initialState(), tool.singleton, forceNew)
}

function openSearch(): void {
  searchOpen.value = true
}

function closeSearch(): void {
  searchOpen.value = false
}

function openShortcutManager(): void {
  shortcutManagerOpen.value = true
}

function selectSearchTool(toolId: keyof typeof toolsById): void {
  openTool(toolId)
  closeSearch()
}

function closeTab(tab: ToolTab): void {
  app.closeTab(tab.id)
}

function activateTab(tab: ToolTab): void {
  app.activateTab(tab.id)
}

function openTabMenu(event: MouseEvent, tab: ToolTab): void {
  const menuWidth = 172
  const menuHeight = 170
  tabMenu.value = {
    visible: true,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    tabId: tab.id,
  }
}

function closeTabMenu(): void {
  tabMenu.value.visible = false
}

function tabsForMenu(mode: 'current' | 'others' | 'right' | 'all'): string[] {
  const targetIndex = app.tabs.findIndex((tab) => tab.id === tabMenu.value.tabId)
  if (targetIndex < 0) return []
  return app.tabs
    .filter((tab, index) => {
      if (tab.toolId === 'home') return false
      if (mode === 'current') return index === targetIndex
      if (mode === 'others') return index !== targetIndex
      if (mode === 'right') return index > targetIndex
      return true
    })
    .map((tab) => tab.id)
}

function closeTabsFromMenu(mode: 'current' | 'others' | 'right' | 'all'): void {
  app.closeTabs(tabsForMenu(mode))
  closeTabMenu()
}

function cycleTheme(): void {
  const order: ThemeMode[] = ['system', 'light', 'dark']
  const index = order.indexOf(app.settings.theme)
  app.setTheme(order[(index + 1) % order.length] ?? 'system')
}

async function minimizeApplication(): Promise<void> {
  if (isWebRuntime) return
  const result = await desktopApi.hideToTray()
  if (!result.ok) toast.show(result.error.message, 'error')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (event.key === 'Escape' && searchOpen.value) {
    event.preventDefault()
    closeSearch()
    return
  }
  if (event.key === 'Escape' && tabMenu.value.visible) {
    closeTabMenu()
    return
  }
  if (event.key === 'Escape' && applicationSettingsOpen.value) {
    applicationSettingsOpen.value = false
    return
  }
  if (event.key === 'Escape' && developerPanelOpen.value) {
    developerPanelOpen.value = false
    return
  }
  if (event.key === 'Escape' && shortcutManagerOpen.value) {
    shortcutManagerOpen.value = false
    return
  }
  if (event.key === 'Escape' && accountSyncOpen.value) {
    accountSyncOpen.value = false
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    void minimizeApplication()
    return
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchOpen.value ? closeSearch() : openSearch()
    return
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'w' && app.activeTab) {
    event.preventDefault()
    closeTab(app.activeTab)
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'n' && activeTool.value) {
    event.preventDefault()
    openTool(activeTool.value.id, true)
  }
}

onMounted(() => {
  void app.bootstrap(homeTool.initialState())
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointerdown', closeTabMenu)
  window.addEventListener('blur', closeTabMenu)
})
onBeforeUnmount(() => {
  window.clearTimeout(developerUnlockTimer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerdown', closeTabMenu)
  window.removeEventListener('blur', closeTabMenu)
})
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'sidebar-collapsed': app.settings.sidebarCollapsed,
      'home-active': !app.activeTab || app.activeTab.toolId === 'home',
    }"
  >
    <aside class="app-sidebar">
      <div class="brand-row">
        <div class="brand-row-main">
          <button class="brand-home" type="button" aria-label="返回首页" @click="openTool('home')">
            <div class="brand-mark" aria-hidden="true"><img :src="kaitoolsMarkWhite" alt="" /></div>
            <div v-if="!app.settings.sidebarCollapsed" class="brand-copy"><strong>KAITools</strong><small>Local workspace</small></div>
          </button>
          <IconButton
            :icon="app.settings.sidebarCollapsed ? PanelLeftOpen : PanelLeftClose"
            :label="app.settings.sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
            size="small"
            @click="app.toggleSidebar"
          />
        </div>
        <div v-if="!app.settings.sidebarCollapsed" class="runtime-copy sidebar-runtime">
          <button class="runtime-version" type="button" @click="handleVersionClick"><span>v{{ app.runtime?.version ?? APP_VERSION }}</span><small v-if="developerModeActive">DEV</small></button>
          <small v-if="isWebRuntime">浏览器 · 本地存储</small>
          <small v-else :title="`WebView2 ${app.runtime?.webview2 ?? '检测中'}`">WebView2 {{ app.runtime?.webview2 ?? '检测中' }}</small>
        </div>
      </div>

      <button
        class="sidebar-home"
        :class="{ active: app.activeTab?.toolId === 'home' }"
        type="button"
        aria-label="首页"
        @click="openTool('home')"
      >
        <component :is="homeTool.icon" :size="17" :stroke-width="1.8" aria-hidden="true" />
        <span v-if="!app.settings.sidebarCollapsed">首页</span>
      </button>

      <div v-if="!app.settings.sidebarCollapsed" class="tool-search">
        <input v-model="sidebarSearch" placeholder="搜索工具" aria-label="筛选工具" @keydown.esc="sidebarSearch = ''" />
        <kbd>Ctrl K</kbd>
        <button class="tool-search-open tooltip-anchor" type="button" aria-label="打开全局搜索" data-tooltip="打开全局搜索 (Ctrl K)" @click="openSearch">
          <Search :size="15" aria-hidden="true" />
        </button>
      </div>
      <IconButton v-else class="sidebar-search-button" :icon="Search" label="搜索工具" @click="openSearch" />

      <nav class="tool-nav" aria-label="开发工具">
        <div v-if="!app.settings.sidebarCollapsed" class="nav-section-label"><span>快捷工具</span><small>{{ sidebarTools.length }}</small></div>
        <div
          v-for="tool in visibleTools"
          :key="tool.id"
          class="tool-nav-row"
          :class="[{ active: app.activeTab?.toolId === tool.id }, `tool-${tool.id}`]"
        >
          <button
            class="tool-nav-main tooltip-anchor"
            type="button"
            :aria-label="tool.name"
            :title="app.settings.sidebarCollapsed ? tool.name : undefined"
            @click="openTool(tool.id)"
          >
            <component :is="tool.icon" :size="17" :stroke-width="1.8" aria-hidden="true" />
            <span v-if="!app.settings.sidebarCollapsed"><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span>
          </button>
          <IconButton
            v-if="!app.settings.sidebarCollapsed && !tool.singleton"
            :icon="Plus"
            :label="`新建${tool.name}标签`"
            size="small"
            @click="openTool(tool.id, true)"
          />
        </div>
        <div v-if="!app.settings.sidebarCollapsed && !visibleTools.length" class="tool-search-empty-state">未找到匹配工具<br /><button type="button" @click="openSearch">管理快捷方式</button></div>
        <button v-if="!app.settings.sidebarCollapsed" class="sidebar-manage-shortcuts" type="button" @click="openShortcutManager"><SlidersHorizontal :size="16" /><span>管理快捷方式</span><small>{{ sidebarTools.length }}/12</small></button>
        <div v-else class="tool-nav-row sidebar-manage-row">
          <button class="tool-nav-main" type="button" aria-label="管理快捷方式" title="管理快捷方式" @click="openShortcutManager"><SlidersHorizontal :size="17" aria-hidden="true" /></button>
        </div>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-footer-actions">
          <button class="icon-button tooltip-anchor repository-brand-button" type="button" aria-label="打开 Gitee 仓库" data-tooltip="打开 Gitee 仓库" @click="app.openProjectRepository"><img :src="giteeLogo" alt="" /></button>
          <button class="icon-button tooltip-anchor repository-brand-button" type="button" aria-label="打开 GitHub 仓库" data-tooltip="打开 GitHub 仓库" @click="app.openGithubRepository"><img :src="githubLogo" alt="" /></button>
          <IconButton :icon="themeIcon" :label="themeLabel" @click="cycleTheme" />
          <IconButton :icon="Settings" label="应用设置" @click="applicationSettingsOpen = true" />
        </div>
      </div>
    </aside>

    <main class="workspace">
      <div class="workspace-topbar">
        <div class="tab-strip" role="tablist" aria-label="工作标签">
          <div
          v-for="tab in app.tabs"
          :key="tab.id"
          class="workspace-tab"
          :class="{ active: tab.id === app.activeTabId }"
          :data-tool="tab.toolId"
          role="tab"
          :tabindex="tab.id === app.activeTabId ? 0 : -1"
          :aria-selected="tab.id === app.activeTabId"
          @click="activateTab(tab)"
          @contextmenu.prevent.stop="openTabMenu($event, tab)"
          @keydown.enter="activateTab(tab)"
        >
          <component :is="toolsById[tab.toolId].icon" :size="14" aria-hidden="true" />
          <span>{{ tab.title }}</span>
          <IconButton
            v-if="tab.toolId !== 'home'"
            :icon="tab.pinned ? Pin : PinOff"
            :label="tab.pinned ? '取消固定' : '固定标签'"
            size="small"
            :active="tab.pinned"
            @click.stop="app.togglePin(tab.id)"
          />
          <IconButton v-if="tab.toolId !== 'home'" :icon="X" label="关闭标签" size="small" @click.stop="closeTab(tab)" />
        </div>
          <IconButton
            v-if="activeTool && !activeTool.singleton"
            :icon="Plus"
            :label="`新建${activeTool.name}标签`"
            size="small"
            @click="openTool(activeTool.id, true)"
          />
        </div>
        <button class="account-entry" type="button" :aria-expanded="accountSyncOpen" aria-haspopup="dialog" @click="accountSyncOpen = !accountSyncOpen">
          <span class="account-entry-avatar" :class="{ connected: app.account }"><CircleUserRound :size="17" aria-hidden="true" /></span>
          <span class="account-entry-copy"><strong>{{ accountTitle }}</strong><small>{{ accountSubtitle }}</small></span>
          <ChevronDown class="account-entry-chevron" :size="14" aria-hidden="true" />
        </button>
      </div>

      <div
        v-if="tabMenu.visible"
        class="tab-context-menu"
        role="menu"
        aria-label="标签页操作"
        :style="{ left: `${tabMenu.x}px`, top: `${tabMenu.y}px` }"
        @pointerdown.stop
        @contextmenu.prevent
      >
        <button role="menuitem" type="button" :disabled="!tabsForMenu('current').length" @click="closeTabsFromMenu('current')">关闭当前</button>
        <button role="menuitem" type="button" :disabled="!tabsForMenu('others').length" @click="closeTabsFromMenu('others')">关闭其他</button>
        <button role="menuitem" type="button" :disabled="!tabsForMenu('right').length" @click="closeTabsFromMenu('right')">关闭右侧</button>
        <div role="separator" />
        <button role="menuitem" type="button" class="danger" :disabled="!tabsForMenu('all').length" @click="closeTabsFromMenu('all')">关闭所有</button>
      </div>

      <div v-if="app.loadingError" class="fatal-state">
        <strong>无法加载 KAITools</strong>
        <span>{{ app.loadingError }}</span>
      </div>
      <div v-else-if="!app.ready" class="loading-state"><span class="spinner" />正在启动</div>
      <component
        :is="activeTool?.component"
        v-else-if="app.activeTab && activeTool"
        :key="app.activeTab.id"
        :state="app.activeTab.state"
        @update:state="app.updateTabState(app.activeTab.id, $event)"
      />
    </main>
    <ToolSearchDialog
      :open="searchOpen"
      :shortcut-ids="app.sidebarShortcuts.toolIds"
      @close="closeSearch"
      @select="selectSearchTool($event.id)"
      @toggle-shortcut="app.toggleSidebarShortcut($event.id)"
    />
    <ShortcutManagerDialog :open="shortcutManagerOpen" :tool-ids="app.sidebarShortcuts.toolIds" @close="shortcutManagerOpen = false" @save="app.setSidebarShortcuts($event)" />
    <AccountSyncDialog
      :open="accountSyncOpen"
      :account="app.account"
      :migration-required="app.migrationRequired"
      :shortcut-conflict="app.shortcutConflict"
      :shortcut-sync-mode="app.shortcutSync.mode"
      :shortcut-syncing="app.shortcutSyncing"
      @close="accountSyncOpen = false"
      @signed-in="app.establishSession($event)"
      @signed-out="signOut"
      @migration-choice="app.chooseShortcutMigration($event)"
      @conflict-choice="app.resolveShortcutConflict($event)"
      @retry-shortcut-sync="app.retryShortcutSync"
    />
    <DeveloperPanelDialog :open="developerPanelOpen && developerModeActive" @close="developerPanelOpen = false" />
    <Teleport to="body"><ApplicationSettingsDialog :open="applicationSettingsOpen" @close="applicationSettingsOpen = false" /></Teleport>
    <ToastViewport />
  </div>
</template>
