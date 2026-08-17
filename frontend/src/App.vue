<script setup lang="ts">
import {
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Search,
  Sun,
  X,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import ToolSearchDialog from '@/components/ToolSearchDialog.vue'
import { isWebRuntime } from '@/runtime'
import ToastViewport from '@/components/ToastViewport.vue'
import giteeLogo from '@/assets/gitee-g-red.svg'
import githubLogo from '@/assets/github-invertocat-white.svg'
import kaitoolsMarkWhite from '@/assets/kaitools-mark-white.svg'
import { useAppStore } from '@/stores/app'
import type { ThemeMode, ToolTab } from '@/types'
import { homeTool, toolsById, workspaceTools } from '@/tools/registry'

const app = useAppStore()
const searchOpen = ref(false)
const tabMenu = ref({ visible: false, x: 0, y: 0, tabId: '' })
const activeTool = computed(() => (app.activeTab ? toolsById[app.activeTab.toolId] : undefined))
const themeIcon = computed(() => ({ system: Monitor, light: Sun, dark: Moon })[app.settings.theme])
const themeLabel = computed(() => ({ system: '跟随系统', light: '浅色主题', dark: '深色主题' })[app.settings.theme])

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

function selectSearchTool(toolId: keyof typeof toolsById): void {
  openTool(toolId)
  closeSearch()
}

function closeTab(tab: ToolTab): void {
  app.closeTab(tab.id)
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

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && searchOpen.value) {
    event.preventDefault()
    closeSearch()
    return
  }
  if (event.key === 'Escape' && tabMenu.value.visible) {
    closeTabMenu()
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

      <button v-if="!app.settings.sidebarCollapsed" class="tool-search-trigger" type="button" @click="openSearch">
        <Search :size="15" aria-hidden="true" />
        <span>搜索工具</span>
        <kbd>Ctrl K</kbd>
      </button>
      <IconButton v-else class="sidebar-search-button" :icon="Search" label="搜索工具" @click="openSearch" />

      <nav class="tool-nav" aria-label="开发工具">
        <div v-if="!app.settings.sidebarCollapsed" class="nav-section-label"><span>工具</span><small>{{ workspaceTools.length }}</small></div>
        <div
          v-for="tool in workspaceTools"
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
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-footer-actions">
          <button class="icon-button tooltip-anchor repository-brand-button" type="button" aria-label="打开 Gitee 仓库" data-tooltip="打开 Gitee 仓库" @click="app.openProjectRepository"><img :src="giteeLogo" alt="" /></button>
          <button class="icon-button tooltip-anchor repository-brand-button" type="button" aria-label="打开 GitHub 仓库" data-tooltip="打开 GitHub 仓库" @click="app.openGithubRepository"><img :src="githubLogo" alt="" /></button>
          <IconButton :icon="themeIcon" :label="themeLabel" @click="cycleTheme" />
        </div>
        <div v-if="!app.settings.sidebarCollapsed" class="runtime-copy">
          <span>v{{ app.runtime?.version ?? '0.1.0' }}</span>
          <small v-if="isWebRuntime">浏览器 · 本地存储</small>
          <small v-else>WebView2 {{ app.runtime?.webview2 ?? '...' }}</small>
        </div>
      </div>
    </aside>

    <main class="workspace">
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
          @click="app.activeTabId = tab.id"
          @contextmenu.prevent.stop="openTabMenu($event, tab)"
          @keydown.enter="app.activeTabId = tab.id"
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
    <ToolSearchDialog :open="searchOpen" @close="closeSearch" @select="selectSearchTool($event.id)" />
    <ToastViewport />
  </div>
</template>
