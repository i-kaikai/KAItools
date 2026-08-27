<script setup lang="ts">
import { ArrowDown, ArrowUp, LayoutDashboard, Palette, Plus, RotateCcw, Search, Trash2, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import SegmentedControl from '@/components/SegmentedControl.vue'
import { workspaceTools } from '@/tools/registry'
import { defaultDashboardCards } from '@/tools/home/dashboardCards'
import type { DashboardCard, DashboardCarouselMode, DashboardCards, ToolId } from '@/types'

const props = defineProps<{ open: boolean; dashboardCards: DashboardCards; saving: boolean }>()
const emit = defineEmits<{ close: []; save: [dashboardCards: DashboardCards] }>()

const query = ref('')
const draft = ref<DashboardCard[]>([])
const carouselMode = ref<DashboardCarouselMode>('step')
const classicRotationSpeed = ref(16)
const stepIntervalMs = ref(1600)
const selectedId = ref('')
const palette = ['#35d0a7', '#6ea0ff', '#ef8f62', '#b79ae8', '#db7ca9', '#dcad49']
const carouselModeOptions: Array<{ value: DashboardCarouselMode; label: string }> = [
  { value: 'classic', label: '连续旋转' },
  { value: 'step', label: '逐卡切换' },
]

const selectedCard = computed(() => draft.value.find((card) => card.id === selectedId.value) ?? null)
const canSave = computed(() => draft.value.length > 0 && draft.value.some((card) => card.enabled) && draft.value.every((card) => card.title.trim()))
const canAddMoreCards = computed(() => draft.value.length < 6)
const availableTools = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  return workspaceTools.filter((tool) => !normalized || [tool.name, tool.description, ...tool.keywords].some((value) => value.toLocaleLowerCase().includes(normalized)))
})

watch(() => props.open, (open) => {
  if (!open) return
  draft.value = props.dashboardCards.cards.map((card) => ({ ...card })).sort((left, right) => left.sortOrder - right.sortOrder)
  carouselMode.value = props.dashboardCards.carouselMode === 'classic' ? 'classic' : 'step'
  classicRotationSpeed.value = Math.max(6, Math.min(30, props.dashboardCards.classicRotationSpeed ?? 16))
  stepIntervalMs.value = Math.max(800, Math.min(6000, props.dashboardCards.stepIntervalMs ?? 1600))
  selectedId.value = draft.value[0]?.id ?? ''
  query.value = ''
}, { immediate: true })

function uid(): string {
  return `dashboard-${crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`
}

function cardForTool(toolId: ToolId): DashboardCard | undefined {
  return draft.value.find((card) => card.toolId === toolId)
}

function add(toolId: ToolId): void {
  const existing = cardForTool(toolId)
  if (existing) { selectedId.value = existing.id; return }
  if (!canAddMoreCards.value) return
  const tool = workspaceTools.find((item) => item.id === toolId)
  if (!tool) return
  const card: DashboardCard = {
    id: uid(),
    toolId,
    title: tool.name,
    description: tool.description,
    accentColor: palette[draft.value.length % palette.length]!,
    sortOrder: draft.value.length,
    enabled: true,
  }
  draft.value.push(card)
  selectedId.value = card.id
}

function remove(cardId: string): void {
  if (draft.value.length <= 1) return
  const index = draft.value.findIndex((card) => card.id === cardId)
  if (index < 0) return
  draft.value.splice(index, 1)
  normalizeOrder()
  selectedId.value = draft.value[Math.min(index, draft.value.length - 1)]?.id ?? ''
}

function move(cardId: string, direction: -1 | 1): void {
  const from = draft.value.findIndex((card) => card.id === cardId)
  const to = from + direction
  if (from < 0 || to < 0 || to >= draft.value.length) return
  const [card] = draft.value.splice(from, 1)
  if (card) draft.value.splice(to, 0, card)
  normalizeOrder()
}

function normalizeOrder(): void {
  draft.value.forEach((card, index) => { card.sortOrder = index })
}

function save(): void {
  if (!canSave.value) return
  normalizeOrder()
  emit('save', {
    schemaVersion: 1,
    cards: draft.value.map((card) => ({ ...card })),
    carouselMode: carouselMode.value,
    classicRotationSpeed: classicRotationSpeed.value,
    stepIntervalMs: stepIntervalMs.value,
  })
}

function reset(): void {
  const defaults = defaultDashboardCards()
  draft.value = defaults.cards
  carouselMode.value = defaults.carouselMode
  classicRotationSpeed.value = defaults.classicRotationSpeed
  stepIntervalMs.value = defaults.stepIntervalMs
  selectedId.value = draft.value[0]?.id ?? ''
}
</script>

<template>
  <div v-if="open" class="dashboard-card-backdrop" @pointerdown.self="emit('close')">
    <section class="dashboard-card-dialog" role="dialog" aria-modal="true" aria-labelledby="dashboard-card-title">
      <header>
        <div><span><LayoutDashboard :size="14" />HOME CARDS</span><h2 id="dashboard-card-title">管理首页卡片</h2><p>卡片仅保存在当前设备，点击后直接打开对应工具。</p></div>
        <button type="button" aria-label="关闭首页卡片管理" @click="emit('close')"><X :size="18" /></button>
      </header>
      <div class="dashboard-card-body">
        <section class="dashboard-card-list">
          <div class="dashboard-card-section-heading"><strong>已添加</strong><small>{{ draft.length }}/6</small></div>
          <div v-if="draft.length" class="dashboard-card-list-items">
            <div v-for="(card, index) in draft" :key="card.id" :class="{ active: card.id === selectedId }">
              <button class="dashboard-card-select" type="button" :aria-pressed="card.id === selectedId" @click="selectedId = card.id"><span class="dashboard-card-swatch" :style="{ backgroundColor: card.accentColor }" /><span><strong>{{ card.title }}</strong><small>{{ workspaceTools.find((tool) => tool.id === card.toolId)?.name }}</small></span></button>
              <i v-if="!card.enabled">隐藏</i><button type="button" aria-label="上移首页卡片" :disabled="index === 0" @click="move(card.id, -1)"><ArrowUp :size="14" /></button><button type="button" aria-label="下移首页卡片" :disabled="index === draft.length - 1" @click="move(card.id, 1)"><ArrowDown :size="14" /></button><button type="button" aria-label="移除首页卡片" :disabled="draft.length === 1" @click="remove(card.id)"><Trash2 :size="14" /></button>
            </div>
          </div>
          <p v-else class="dashboard-card-empty">从右侧选择工具，添加为首页卡片。</p>
        </section>
        <section class="dashboard-card-catalog">
          <label><Search :size="16" /><input v-model="query" type="search" placeholder="搜索工具" /></label>
          <div class="dashboard-card-section-heading"><strong>可添加工具</strong><small>{{ availableTools.length }} 个</small></div>
          <div class="dashboard-card-catalog-items">
            <button v-for="tool in availableTools" :key="tool.id" type="button" :class="{ active: cardForTool(tool.id) }" :disabled="!canAddMoreCards && !cardForTool(tool.id)" @click="add(tool.id)"><component :is="tool.icon" :size="17" /><span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span><span v-if="cardForTool(tool.id)">已添加</span><Plus v-else :size="16" /></button>
          </div>
        </section>
      </div>
      <section v-if="selectedCard" class="dashboard-card-editor" aria-label="编辑首页卡片">
        <div class="dashboard-carousel-mode"><span>轮播</span><SegmentedControl v-model="carouselMode" label="首页卡片轮播方式" :options="carouselModeOptions" /></div>
        <div class="dashboard-motion-control" :class="{ inactive: carouselMode !== 'classic' }"><label>连续旋转速度 <output>{{ classicRotationSpeed }} 度/秒</output><input v-model.number="classicRotationSpeed" aria-label="连续旋转速度" type="range" min="6" max="30" step="1" :disabled="carouselMode !== 'classic'" /></label></div>
        <div class="dashboard-motion-control" :class="{ inactive: carouselMode !== 'step' }"><label>逐卡停留时间 <output>{{ (stepIntervalMs / 1000).toFixed(1) }} 秒</output><input v-model.number="stepIntervalMs" aria-label="逐卡停留时间" type="range" min="800" max="6000" step="200" :disabled="carouselMode !== 'step'" /></label></div>
        <label>标题<input v-model="selectedCard.title" maxlength="80" /></label><label>描述<input v-model="selectedCard.description" maxlength="240" /></label><div><span><Palette :size="14" />强调色</span><button v-for="color in palette" :key="color" type="button" class="dashboard-card-color" :class="{ active: selectedCard.accentColor === color }" :style="{ backgroundColor: color }" :aria-label="`使用 ${color} 强调色`" @click="selectedCard.accentColor = color" /></div><label class="dashboard-card-enabled"><input v-model="selectedCard.enabled" type="checkbox" />显示此卡片</label>
      </section>
      <footer><button class="command-button subtle" type="button" :disabled="saving" @click="reset"><RotateCcw :size="14" />恢复系统默认</button><span /><button class="command-button subtle" type="button" :disabled="saving" @click="emit('close')">取消</button><button class="command-button" type="button" :disabled="saving || !canSave" @click="save">{{ saving ? '正在保存…' : '保存首页卡片' }}</button></footer>
    </section>
  </div>
</template>
