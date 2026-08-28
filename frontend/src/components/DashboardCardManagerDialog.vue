<script setup lang="ts">
import { ArrowDown, ArrowUp, LayoutDashboard, Palette, Plus, RotateCcw, Search, Trash2, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import SegmentedControl from '@/components/SegmentedControl.vue'
import { t } from '@/i18n'
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
const carouselModeOptions = computed<Array<{ value: DashboardCarouselMode; label: string }>>(() => [
  { value: 'classic', label: t('cards.classic') }, { value: 'step', label: t('cards.step') },
])

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
        <div><span><LayoutDashboard :size="14" />HOME CARDS</span><h2 id="dashboard-card-title">{{ t('cards.title') }}</h2><p>{{ t('cards.description') }}</p></div>
        <button type="button" :aria-label="t('cards.close')" @click="emit('close')"><X :size="18" /></button>
      </header>
      <div class="dashboard-card-body">
        <section class="dashboard-card-list">
          <div class="dashboard-card-section-heading"><strong>{{ t('cards.added') }}</strong><small>{{ draft.length }}/6</small></div>
          <div v-if="draft.length" class="dashboard-card-list-items">
            <div v-for="(card, index) in draft" :key="card.id" :class="{ active: card.id === selectedId }">
              <button class="dashboard-card-select" type="button" :aria-pressed="card.id === selectedId" @click="selectedId = card.id"><span class="dashboard-card-swatch" :style="{ backgroundColor: card.accentColor }" /><span><strong>{{ card.title }}</strong><small>{{ workspaceTools.find((tool) => tool.id === card.toolId)?.name }}</small></span></button>
              <i v-if="!card.enabled">{{ t('cards.hidden') }}</i><button type="button" :aria-label="t('cards.moveUp')" :disabled="index === 0" @click="move(card.id, -1)"><ArrowUp :size="14" /></button><button type="button" :aria-label="t('cards.moveDown')" :disabled="index === draft.length - 1" @click="move(card.id, 1)"><ArrowDown :size="14" /></button><button type="button" :aria-label="t('cards.remove')" :disabled="draft.length === 1" @click="remove(card.id)"><Trash2 :size="14" /></button>
            </div>
          </div>
          <p v-else class="dashboard-card-empty">{{ t('cards.empty') }}</p>
        </section>
        <section class="dashboard-card-catalog">
          <label><Search :size="16" /><input v-model="query" type="search" :placeholder="t('cards.search')" /></label>
          <div class="dashboard-card-section-heading"><strong>{{ t('cards.available') }}</strong><small>{{ availableTools.length }}</small></div>
          <div class="dashboard-card-catalog-items">
            <button v-for="tool in availableTools" :key="tool.id" type="button" :class="{ active: cardForTool(tool.id) }" :disabled="!canAddMoreCards && !cardForTool(tool.id)" @click="add(tool.id)"><component :is="tool.icon" :size="17" /><span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span><span v-if="cardForTool(tool.id)">{{ t('cards.alreadyAdded') }}</span><Plus v-else :size="16" /></button>
          </div>
        </section>
      </div>
      <section v-if="selectedCard" class="dashboard-card-editor" :aria-label="t('cards.edit')">
        <div class="dashboard-carousel-mode"><span>{{ t('cards.carousel') }}</span><SegmentedControl v-model="carouselMode" :label="t('cards.carouselMode')" :options="carouselModeOptions" /></div>
        <div class="dashboard-motion-control" :class="{ inactive: carouselMode !== 'classic' }"><label>{{ t('cards.rotationSpeed') }} <output>{{ t('cards.degreesPerSecond', { count: classicRotationSpeed }) }}</output><input v-model.number="classicRotationSpeed" :aria-label="t('cards.rotationSpeed')" type="range" min="6" max="30" step="1" :disabled="carouselMode !== 'classic'" /></label></div>
        <div class="dashboard-motion-control" :class="{ inactive: carouselMode !== 'step' }"><label>{{ t('cards.dwellTime') }} <output>{{ t('cards.seconds', { count: (stepIntervalMs / 1000).toFixed(1) }) }}</output><input v-model.number="stepIntervalMs" :aria-label="t('cards.dwellTime')" type="range" min="800" max="6000" step="200" :disabled="carouselMode !== 'step'" /></label></div>
        <label>{{ t('cards.name') }}<input v-model="selectedCard.title" maxlength="80" /></label><label>{{ t('cards.descriptionLabel') }}<input v-model="selectedCard.description" maxlength="240" /></label><div><span><Palette :size="14" />{{ t('cards.accent') }}</span><button v-for="color in palette" :key="color" type="button" class="dashboard-card-color" :class="{ active: selectedCard.accentColor === color }" :style="{ backgroundColor: color }" :aria-label="t('cards.useAccent', { color })" @click="selectedCard.accentColor = color" /></div><label class="dashboard-card-enabled"><input v-model="selectedCard.enabled" type="checkbox" />{{ t('cards.show') }}</label>
      </section>
      <footer><button class="command-button subtle" type="button" :disabled="saving" @click="reset"><RotateCcw :size="14" />{{ t('cards.restore') }}</button><span /><button class="command-button subtle" type="button" :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</button><button class="command-button" type="button" :disabled="saving || !canSave" @click="save">{{ saving ? t('cards.saving') : t('cards.save') }}</button></footer>
    </section>
  </div>
</template>
