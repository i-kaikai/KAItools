<script setup lang="ts">
import { ArrowLeft, ArrowRight, ArrowUpRight, CircleDot, ExternalLink, FolderCog, LayoutGrid, Layers3 } from '@lucide/vue'
import { computed, ref } from 'vue'

import { isWebRuntime } from '@/runtime'
import giteeLogo from '@/assets/gitee-g-red.svg'
import githubLogo from '@/assets/github-invertocat-white.svg'
import { useAppStore } from '@/stores/app'
import { toolCategories, workspaceTools, type ToolDefinition } from '@/tools/registry'
import ParticleField from './ParticleField.vue'
import ToolCarousel from './ToolCarousel.vue'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()

const app = useAppStore()
const particleField = ref<InstanceType<typeof ParticleField> | null>(null)
const entered = computed({
  get: () => props.state.entered === true,
  set: (value: boolean) => emit('update:state', { ...props.state, entered: value }),
})
const openTabs = computed(() => app.tabs.filter((tab) => tab.toolId !== 'home'))
const pinnedTabs = computed(() => openTabs.value.filter((tab) => tab.pinned))
const categorizedTools = computed(() => toolCategories.map((category) => ({
  ...category,
  tools: workspaceTools.filter((tool) => tool.category === category.id),
})))
const toolColors: Record<string, string> = {
  json: '#35d0a7',
  'json-diff': '#40c9a2',
  'json-java': '#ef8f62',
  java: '#ff7d5d',
  timestamp: '#6ea0ff',
  'base64-text': '#dcad49',
  'base64-image': '#db7ca9',
  'base64-file': '#b79ae8',
  cron: '#6eb9ff',
  sql: '#4cc7c9',
  yaml: '#9dbb55',
  xml: '#e99754',
  'text-diff': '#d87f82',
  'text-stats': '#8e9fe8',
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
const currentDate = new Date()
const todayLabel = `${new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}).format(currentDate)} · ${new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(currentDate)}`
const todayDateTime = [
  currentDate.getFullYear(),
  String(currentDate.getMonth() + 1).padStart(2, '0'),
  String(currentDate.getDate()).padStart(2, '0'),
].join('-')

function openTool(tool: ToolDefinition): void {
  app.openTool(tool.id, tool.name, tool.initialState(), tool.singleton)
}

function activateTab(tabId: string): void {
  app.activateTab(tabId)
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
          <h1 id="home-title">KAITools</h1>
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
            <div class="home-status-line">
              <div class="home-kicker"><CircleDot :size="13" />WORKSPACE ONLINE</div>
              <time class="home-current-date" :datetime="todayDateTime">{{ todayLabel }}</time>
            </div>
            <h1>KAITools</h1>
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
              <div><dt>KAITools</dt><dd>v{{ app.runtime?.version ?? '0.1.0' }}</dd></div>
              <div>
                <dt>Gitee 仓库</dt>
                <dd>
                  <button class="home-repository-link" type="button" aria-label="打开 Gitee 仓库" @click="app.openProjectRepository">
                    <img class="repository-brand-icon" :src="giteeLogo" alt="" />
                    <span>i-_-kaikai/kaitools</span>
                    <ExternalLink :size="13" aria-hidden="true" />
                  </button>
                </dd>
              </div>
              <div>
                <dt>GitHub 仓库</dt>
                <dd>
                  <button class="home-repository-link" type="button" aria-label="打开 GitHub 仓库" @click="app.openGithubRepository">
                    <img class="repository-brand-icon" :src="githubLogo" alt="" />
                    <span>imxukai/KAItools</span>
                    <ExternalLink :size="13" aria-hidden="true" />
                  </button>
                </dd>
              </div>
              <template v-if="isWebRuntime">
                <div><dt>运行环境</dt><dd>浏览器</dd></div>
                <div><dt>数据存储</dt><dd>浏览器本地存储</dd></div>
              </template>
              <template v-else>
                <div><dt>WebView2</dt><dd>{{ app.runtime?.webview2 ?? '检测中' }}</dd></div>
                <div><dt>数据目录</dt><dd :title="app.runtime?.dataDirectory">{{ app.runtime?.dataDirectory ?? '加载中' }}</dd></div>
              </template>
            </dl>
          </section>
        </div>

        <section class="home-categories" aria-labelledby="home-categories-title">
          <header class="home-section-heading">
            <div><LayoutGrid :size="15" /><h2 id="home-categories-title">工具分类</h2></div>
            <small>{{ toolCategories.length }} 个分类 · {{ workspaceTools.length }} 个工具</small>
          </header>
          <div class="home-category-grid">
            <section v-for="category in categorizedTools" :key="category.id" class="home-category-group">
              <header><div><strong>{{ category.name }}</strong><small>{{ category.description }}</small></div><span>{{ category.tools.length.toString().padStart(2, '0') }}</span></header>
              <div>
                <button v-for="tool in category.tools" :key="tool.id" type="button" :style="{ '--tool-accent': toolColors[tool.id] }" @click="openTool(tool)">
                  <component :is="tool.icon" :size="15" aria-hidden="true" />
                  <span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span>
                  <ArrowUpRight :size="14" aria-hidden="true" />
                </button>
              </div>
            </section>
          </div>
        </section>
      </div>
    </Transition>
  </section>
</template>
