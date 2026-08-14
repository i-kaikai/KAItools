<script setup lang="ts">
import { ArrowLeft, ArrowRight, CircleDot, FolderCog, Layers3 } from '@lucide/vue'
import { computed, ref } from 'vue'

import { useAppStore } from '@/stores/app'
import { workspaceTools, type ToolDefinition } from '@/tools/registry'
import ParticleField from './ParticleField.vue'
import ToolCarousel from './ToolCarousel.vue'

defineProps<{ state: Record<string, unknown> }>()

const app = useAppStore()
const particleField = ref<InstanceType<typeof ParticleField> | null>(null)
const entered = ref(false)
const openTabs = computed(() => app.tabs.filter((tab) => tab.toolId !== 'home'))
const pinnedTabs = computed(() => openTabs.value.filter((tab) => tab.pinned))
const toolColors: Record<string, string> = {
  json: '#35d0a7',
  java: '#ff7d5d',
  timestamp: '#6ea0ff',
  hosts: '#38bdd8',
  md5: '#f0b54d',
}
const animateOnEntry = (() => {
  try {
    const key = 'devtoolkit.home.motion.seen'
    const unseen = sessionStorage.getItem(key) !== 'true'
    if (unseen) sessionStorage.setItem(key, 'true')
    return unseen
  } catch {
    return true
  }
})()
const today = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date())

function openTool(tool: ToolDefinition): void {
  app.openTool(tool.id, tool.name, tool.initialState(), tool.singleton)
}

function activateTab(tabId: string): void {
  app.activeTabId = tabId
}

function enterWorkspace(): void {
  entered.value = true
}

function returnToOrbit(): void {
  entered.value = false
  particleField.value?.release()
}

function focusCard(tool: ToolDefinition): void {
  particleField.value?.focus({ toolId: tool.id, color: toolColors[tool.id] ?? '#35d0a7' })
}

function releaseCard(): void {
  particleField.value?.release()
}
</script>

<template>
  <section class="home-page" :class="{ 'home-motion-entry': animateOnEntry, 'is-workbench': entered }">
    <ParticleField ref="particleField" :stage="entered ? 'workbench' : 'hero'" />

    <Transition name="home-stage" mode="out-in">
      <section v-if="!entered" key="orbit" class="home-orbit" aria-labelledby="home-title">
        <div class="home-orbit-copy">
          <div class="home-kicker"><CircleDot :size="13" />LOCAL CORE · READY</div>
          <h1 id="home-title">DevToolkit</h1>
          <p>你的本地开发工具空间</p>
          <button class="home-enter-action" type="button" @click="enterWorkspace">
            <span>进入工具台</span>
            <ArrowRight :size="17" aria-hidden="true" />
          </button>
          <small>{{ workspaceTools.length }} 个模块 · 数据仅保存在本机</small>
        </div>
      </section>

      <div v-else key="workbench" class="home-content home-workbench">
        <header class="home-workbench-header">
          <div class="home-title-block">
            <div class="home-kicker"><CircleDot :size="13" />WORKSPACE ONLINE <span>{{ today }}</span></div>
            <h1>DevToolkit</h1>
            <p>选择一个工具开始处理</p>
          </div>
          <div class="home-header-actions">
            <span>{{ workspaceTools.length.toString().padStart(2, '0') }} MODULES</span>
            <button class="home-orbit-return" type="button" @click="returnToOrbit">
              <ArrowLeft :size="15" aria-hidden="true" />
              <span>返回环星</span>
            </button>
          </div>
        </header>

        <ToolCarousel @open="openTool" @focus="focusCard" @release="releaseCard" />

        <div class="home-bottom-grid">
          <section class="home-workspace" aria-labelledby="home-workspace-title">
            <header class="home-section-heading compact">
              <div><Layers3 :size="16" /><h2 id="home-workspace-title">最近工作区</h2></div>
              <small>{{ openTabs.length }} 个已打开</small>
            </header>
            <div v-if="openTabs.length" class="home-tab-list">
              <button v-for="tab in openTabs.slice(0, 4)" :key="tab.id" type="button" @click="activateTab(tab.id)">
                <component :is="workspaceTools.find((tool) => tool.id === tab.toolId)?.icon" :size="15" aria-hidden="true" />
                <span>{{ tab.title }}</span>
                <small>{{ tab.pinned ? '已固定' : '已打开' }}</small>
                <ArrowRight :size="14" aria-hidden="true" />
              </button>
            </div>
            <div v-else class="home-empty-row"><Layers3 :size="17" /><span>当前没有打开的工具</span></div>
          </section>

          <section class="home-system" aria-labelledby="home-system-title">
            <header class="home-section-heading compact">
              <div><FolderCog :size="16" /><h2 id="home-system-title">本机环境</h2></div>
              <small>{{ pinnedTabs.length }} 个固定标签</small>
            </header>
            <dl class="home-system-list">
              <div><dt>DevToolkit</dt><dd>v{{ app.runtime?.version ?? '0.1.0' }}</dd></div>
              <div><dt>WebView2</dt><dd>{{ app.runtime?.webview2 ?? '检测中' }}</dd></div>
              <div><dt>数据目录</dt><dd :title="app.runtime?.dataDirectory">{{ app.runtime?.dataDirectory ?? '加载中' }}</dd></div>
            </dl>
          </section>
        </div>
      </div>
    </Transition>
  </section>
</template>
