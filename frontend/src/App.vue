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
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import ToastViewport from '@/components/ToastViewport.vue'
import { useAppStore } from '@/stores/app'
import type { ThemeMode, ToolTab } from '@/types'
import { homeTool, toolsById, workspaceTools } from '@/tools/registry'

const app = useAppStore()
const search = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const visibleTools = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return workspaceTools
  return workspaceTools.filter((tool) => [tool.name, tool.description, ...tool.keywords].some((value) => value.toLowerCase().includes(query)))
})
const activeTool = computed(() => (app.activeTab ? toolsById[app.activeTab.toolId] : undefined))
const themeIcon = computed(() => ({ system: Monitor, light: Sun, dark: Moon })[app.settings.theme])
const themeLabel = computed(() => ({ system: '跟随系统', light: '浅色主题', dark: '深色主题' })[app.settings.theme])

function openTool(toolId: keyof typeof toolsById, forceNew = false): void {
  const tool = toolsById[toolId]
  app.openTool(tool.id, tool.name, tool.initialState(), tool.singleton, forceNew)
}

function closeTab(tab: ToolTab): void {
  app.closeTab(tab.id)
}

function cycleTheme(): void {
  const order: ThemeMode[] = ['system', 'light', 'dark']
  const index = order.indexOf(app.settings.theme)
  app.setTheme(order[(index + 1) % order.length] ?? 'system')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.ctrlKey && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (app.settings.sidebarCollapsed) app.toggleSidebar()
    void nextTick(() => searchInput.value?.focus())
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
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
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
          <div class="brand-mark" aria-hidden="true"><span>&lt;</span><i>/</i><span>&gt;</span></div>
          <div v-if="!app.settings.sidebarCollapsed" class="brand-copy"><strong>DevToolkit</strong><small>Local workspace</small></div>
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

      <div v-if="!app.settings.sidebarCollapsed" class="tool-search">
        <Search :size="15" aria-hidden="true" />
        <input ref="searchInput" v-model="search" placeholder="搜索工具" aria-label="搜索工具" />
        <kbd>Ctrl K</kbd>
      </div>

      <nav class="tool-nav" aria-label="开发工具">
        <div v-if="!app.settings.sidebarCollapsed" class="nav-section-label"><span>工具</span><small>{{ visibleTools.length }}</small></div>
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
            :data-tooltip="app.settings.sidebarCollapsed ? tool.name : undefined"
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
        <IconButton :icon="themeIcon" :label="themeLabel" @click="cycleTheme" />
        <div v-if="!app.settings.sidebarCollapsed" class="runtime-copy">
          <span>v{{ app.runtime?.version ?? '0.1.0' }}</span>
          <small>WebView2 {{ app.runtime?.webview2 ?? '...' }}</small>
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

      <div v-if="app.loadingError" class="fatal-state">
        <strong>无法加载 DevToolkit</strong>
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
    <ToastViewport />
  </div>
</template>
