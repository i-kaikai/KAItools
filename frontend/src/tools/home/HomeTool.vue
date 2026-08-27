<script setup lang="ts">
import { ArrowUpRight, BookOpenText, Boxes, CircleDot, ExternalLink, LayoutDashboard, LayoutGrid, Sparkles } from '@lucide/vue'
import { computed, ref } from 'vue'

import giteeLogo from '@/assets/gitee-g-red.svg'
import githubLogo from '@/assets/github-invertocat-white.svg'
import { useAppStore } from '@/stores/app'
import { toolCategories, workspaceTools, type ToolDefinition } from '@/tools/registry'
import type { DashboardCard, DashboardCards } from '@/types'
import DashboardCardManagerDialog from '@/components/DashboardCardManagerDialog.vue'
import SystemStatusPanel from '@/components/SystemStatusPanel.vue'
import { APP_VERSION } from '@/version'
import ParticleField from './ParticleField.vue'
import ToolCarousel from './ToolCarousel.vue'

const app = useAppStore()
const particleField = ref<InstanceType<typeof ParticleField> | null>(null)
const openTabs = computed(() => app.tabs.filter((tab) => tab.toolId !== 'home'))
const pinnedTabs = computed(() => openTabs.value.filter((tab) => tab.pinned))
const categorizedTools = computed(() => toolCategories.map((category) => ({
  ...category,
  tools: workspaceTools.filter((tool) => tool.category === category.id),
})))
const pinnedNote = computed(() => app.notes.notes.find((note) => note.pinned) ?? app.notes.notes[0])
const pinnedNotePreview = computed(() => (pinnedNote.value?.content ?? '在这里记录你的开发想法、待办和下一步计划。')
  .replace(/^\s{0,3}#{1,6}\s*/gm, '')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[`*_~]/g, '')
  .replace(/^\s{0,3}[-+]\s+/gm, '')
  .replace(/\s+/g, ' ')
  .trim())
const sessionTools = computed(() => openTabs.value.flatMap((tab) => {
  const tool = workspaceTools.find((item) => item.id === tab.toolId)
  return tool ? [{ tab, tool }] : []
}).slice(0, 4))
const dashboardCardManagerOpen = ref(false)
const dashboardCardSaving = ref(false)
const carouselItems = computed(() => [...app.dashboardCards.cards]
  .filter((card) => card.enabled)
  .sort((left, right) => left.sortOrder - right.sortOrder)
  .map((card) => ({ card, tool: workspaceTools.find((tool) => tool.id === card.toolId) }))
  .filter((item): item is { card: DashboardCard; tool: ToolDefinition } => Boolean(item.tool)))

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
  regex: '#bb78a3',
  hosts: '#38bdd8',
  md5: '#f0b54d',
  notes: '#a58df0',
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

function focusCard(tool: ToolDefinition): void {
  particleField.value?.focus({ toolId: tool.id, color: toolColors[tool.id] ?? '#35d0a7' })
}

function releaseCard(): void {
  particleField.value?.release()
}

function openNotes(): void {
  const notes = workspaceTools.find((tool) => tool.id === 'notes')
  if (notes) openTool(notes)
}

async function saveDashboardCards(dashboardCards: DashboardCards): Promise<void> {
  dashboardCardSaving.value = true
  const saved = await app.setDashboardCards(dashboardCards)
  dashboardCardSaving.value = false
  if (saved) dashboardCardManagerOpen.value = false
}
</script>

<template>
  <section class="home-page home-next" :class="{ 'home-motion-entry': animateOnEntry && !app.reducedMotion }">
    <ParticleField
      v-if="app.settings.particleQuality !== 'off'"
      ref="particleField"
      stage="workbench"
      :quality="app.settings.particleQuality"
      :reduced-motion="app.reducedMotion"
    />

    <div class="home-content home-workbench home-next-content">
      <header class="home-workbench-header home-next-header">
        <div class="home-title-block">
          <div class="home-status-line">
            <div class="home-kicker"><CircleDot :size="13" />LOCAL WORKSPACE</div>
            <time class="home-current-date" :datetime="todayDateTime">{{ todayLabel }}</time>
          </div>
          <h1>KAITools</h1>
          <p>选择一个工具，继续手上的工作。</p>
        </div>
        <div class="home-header-actions">
          <div class="home-header-stats" aria-label="本地工作台状态">
            <span><b>{{ workspaceTools.length.toString().padStart(2, '0') }}</b>工具</span>
            <span><b>{{ openTabs.length.toString().padStart(2, '0') }}</b>工作中</span>
          </div>
          <button class="home-card-manager" type="button" @click="dashboardCardManagerOpen = true"><LayoutDashboard :size="15" /><span>管理首页卡片</span><small>{{ app.dashboardCards.cards.length }}</small></button>
        </div>
      </header>

      <section class="home-launchpad" aria-labelledby="home-launchpad-title">
        <div class="home-launchpad-copy">
          <div class="home-section-eyebrow"><Sparkles :size="15" />LOCAL MODE</div>
          <h2 id="home-launchpad-title">本地工具台</h2>
          <p>在当前设备完成处理。工具输入、工作区和笔记默认保留在本地。</p>
          <div class="home-local-mode-card" aria-label="本地模式状态">
            <span class="home-local-mode-signal" aria-hidden="true" />
            <div><small>WORKSPACE STATE</small><strong>本地优先</strong><span>数据默认不离开当前设备</span></div>
            <em>离线可用</em>
          </div>
        </div>

        <div class="home-deck-carousel home-next-deck">
          <ToolCarousel :items="carouselItems" :mode="app.dashboardCards.carouselMode" :classic-rotation-speed="app.dashboardCards.classicRotationSpeed" :step-interval-ms="app.dashboardCards.stepIntervalMs" :reduced-motion="app.reducedMotion" @open="openTool" @focus="focusCard" @release="releaseCard" />
        </div>

        <aside class="home-pinned-note home-next-active-module" aria-label="置顶笔记">
          <div class="home-active-module-topline"><span><BookOpenText :size="13" />置顶笔记</span><small>{{ pinnedNote?.syncStatus === 'synced' ? 'SYNCED' : 'LOCAL' }}</small></div>
          <div class="home-active-module-main home-pinned-note-main">
            <span class="home-active-module-icon"><BookOpenText :size="29" :stroke-width="1.65" aria-hidden="true" /></span>
          </div>
          <div class="home-pinned-note-content"><strong>{{ pinnedNote?.title ?? '关于 KAITools' }}</strong><p>{{ pinnedNotePreview.slice(0, 360) }}</p></div>
          <div class="home-pinned-note-meta"><span>{{ pinnedNote ? new Date(pinnedNote.updatedAt).toLocaleDateString('zh-CN') : '刚刚' }}</span><span>{{ pinnedNote?.syncStatus === 'synced' ? '已同步' : '本地保存' }}</span></div>
          <button class="home-pinned-note-action" type="button" @click="openNotes">
            <span>打开笔记</span>
            <span class="home-pinned-note-action-icon"><ArrowUpRight :size="16" aria-hidden="true" /></span>
          </button>
        </aside>
      </section>

      <div class="home-bottom-grid">
        <section class="home-workspace home-workspace-overview" aria-labelledby="home-workspace-title">
          <header class="home-section-heading compact">
            <div><Boxes :size="16" /><h2 id="home-workspace-title">工作台概览</h2></div>
            <small>当前设备</small>
          </header>
          <div class="home-overview-stat-grid" aria-label="本地工作台统计">
            <div><b>{{ workspaceTools.length.toString().padStart(2, '0') }}</b><small>本地工具</small></div>
            <div><b>{{ toolCategories.length.toString().padStart(2, '0') }}</b><small>工具分类</small></div>
            <div><b>{{ openTabs.length.toString().padStart(2, '0') }}</b><small>当前标签</small></div>
            <div><b>{{ pinnedTabs.length.toString().padStart(2, '0') }}</b><small>固定标签</small></div>
            <div><b>{{ app.notes.notes.length.toString().padStart(2, '0') }}</b><small>本地笔记</small></div>
            <div><b>{{ app.notes.notebooks.length.toString().padStart(2, '0') }}</b><small>笔记本</small></div>
          </div>
          <section class="home-session-tools" aria-label="当前会话工具">
            <header><span>当前会话</span><small>{{ openTabs.length ? `已打开 ${openTabs.length} 个工具` : '尚未打开工具' }}</small></header>
            <div v-if="sessionTools.length" class="home-session-tool-grid">
              <button v-for="item in sessionTools" :key="item.tab.id" type="button" :style="{ '--tool-accent': toolColors[item.tool.id] }" @click="activateTab(item.tab.id)">
                <component :is="item.tool.icon" :size="17" aria-hidden="true" />
                <span><strong>{{ item.tab.title }}</strong><small>{{ item.tool.description }}</small></span>
                <ArrowUpRight :size="15" aria-hidden="true" />
              </button>
            </div>
            <div v-else class="home-session-empty">从上方工具轨道或侧栏打开工具，当前会话会显示在这里。</div>
          </section>
        </section>

        <section class="home-system" aria-labelledby="home-system-title">
          <h2 id="home-system-title" class="visually-hidden">系统状态与仓库</h2>
          <SystemStatusPanel />
          <dl class="home-system-list">
            <div><dt>KAITools</dt><dd>v{{ app.runtime?.version ?? APP_VERSION }} · {{ pinnedTabs.length }} 个固定标签</dd></div>
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
                  <span>i-kaikai/KAItools</span>
                  <ExternalLink :size="13" aria-hidden="true" />
                </button>
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section class="home-categories" aria-labelledby="home-categories-title">
        <header class="home-section-heading">
          <div><LayoutGrid :size="16" /><h2 id="home-categories-title">工具分类</h2></div>
          <small>{{ toolCategories.length }} 个分类 · {{ workspaceTools.length }} 个工具</small>
        </header>
        <div class="home-category-grid">
          <section v-for="category in categorizedTools" :key="category.id" class="home-category-group">
            <header><div><strong>{{ category.name }}</strong><small>{{ category.description }}</small></div><span>{{ category.tools.length.toString().padStart(2, '0') }}</span></header>
            <div>
              <button v-for="tool in category.tools" :key="tool.id" type="button" :style="{ '--tool-accent': toolColors[tool.id] }" @click="openTool(tool)">
                <component :is="tool.icon" :size="16" aria-hidden="true" />
                <span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span>
                <ArrowUpRight :size="15" aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
    <Teleport to="body"><DashboardCardManagerDialog :open="dashboardCardManagerOpen" :dashboard-cards="app.dashboardCards" :saving="dashboardCardSaving" @close="dashboardCardManagerOpen = false" @save="saveDashboardCards" /></Teleport>
  </section>
</template>
