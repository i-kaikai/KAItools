<script setup lang="ts">
import { GripVertical, Pin, PinOff, RotateCcw, Search, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { workspaceTools } from '@/tools/registry'
import { t } from '@/i18n'
import type { ToolId } from '@/types'

const props = defineProps<{ open: boolean; toolIds: ToolId[] }>()
const emit = defineEmits<{ close: []; save: [toolIds: ToolId[]] }>()
const query = ref('')
const draft = ref<ToolId[]>([])
const dragging = ref<ToolId | null>(null)

const allTools = computed(() => workspaceTools.filter((tool) => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return !keyword || [tool.name, tool.description, ...tool.keywords].some((value) => value.toLocaleLowerCase().includes(keyword))
}))
const selectedTools = computed(() => draft.value.map((id) => workspaceTools.find((tool) => tool.id === id)).filter(Boolean))

watch(() => props.open, (open) => {
  if (!open) return
  draft.value = [...props.toolIds]
  query.value = ''
}, { immediate: true })

function isSelected(toolId: ToolId): boolean {
  return draft.value.includes(toolId)
}

function toggle(toolId: ToolId): void {
  const index = draft.value.indexOf(toolId)
  if (index >= 0) {
    if (draft.value.length === 1) return
    draft.value.splice(index, 1)
  } else if (draft.value.length < 12) draft.value.push(toolId)
}

function move(toolId: ToolId, direction: -1 | 1): void {
  const from = draft.value.indexOf(toolId)
  const to = from + direction
  if (from < 0 || to < 0 || to >= draft.value.length) return
  const [item] = draft.value.splice(from, 1)
  if (item) draft.value.splice(to, 0, item)
}

function drop(target: ToolId): void {
  const source = dragging.value
  dragging.value = null
  if (!source || source === target) return
  const from = draft.value.indexOf(source)
  const to = draft.value.indexOf(target)
  if (from < 0 || to < 0) return
  draft.value.splice(from, 1)
  draft.value.splice(to, 0, source)
}

function reset(): void {
  draft.value = ['notes', 'json', 'java', 'timestamp', 'base64-text', 'cron', 'hosts', 'md5']
}
</script>

<template>
  <div v-if="open" class="shortcut-manager-backdrop" @pointerdown.self="emit('close')">
    <section class="shortcut-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-manager-title">
      <header>
        <div><span>SIDEBAR SHORTCUTS</span><h2 id="shortcut-manager-title">{{ t('shortcuts.title') }}</h2><p>{{ t('shortcuts.description') }}</p></div>
        <button type="button" :aria-label="t('shortcuts.close')" @click="emit('close')"><X :size="18" /></button>
      </header>
      <div class="shortcut-manager-body">
        <section class="shortcut-manager-selected">
          <div class="shortcut-manager-section-heading"><strong>{{ t('shortcuts.order') }}</strong><small>{{ draft.length }}/12</small></div>
          <div class="shortcut-manager-list">
            <div
              v-for="(tool, index) in selectedTools"
              :key="tool!.id"
              draggable="true"
              @dragstart="dragging = tool!.id"
              @dragover.prevent
              @drop="drop(tool!.id)"
            >
              <GripVertical :size="15" aria-hidden="true" />
              <component :is="tool!.icon" :size="17" aria-hidden="true" />
              <span><strong>{{ tool!.name }}</strong><small>{{ tool!.description }}</small></span>
              <button type="button" :disabled="index === 0" :aria-label="t('shortcuts.moveUp')" @click="move(tool!.id, -1)">↑</button>
              <button type="button" :disabled="index === selectedTools.length - 1" :aria-label="t('shortcuts.moveDown')" @click="move(tool!.id, 1)">↓</button>
              <button type="button" :aria-label="t('shortcuts.remove')" @click="toggle(tool!.id)"><PinOff :size="15" /></button>
            </div>
          </div>
        </section>
        <section class="shortcut-manager-catalog">
          <label><Search :size="16" /><input v-model="query" type="search" :placeholder="t('shortcuts.search')" /></label>
          <div class="shortcut-manager-section-heading"><strong>{{ t('shortcuts.allTools') }}</strong><small>{{ allTools.length }}</small></div>
          <div class="shortcut-manager-catalog-list">
            <button v-for="tool in allTools" :key="tool.id" type="button" :class="{ active: isSelected(tool.id) }" @click="toggle(tool.id)">
              <component :is="tool.icon" :size="17" aria-hidden="true" />
              <span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span>
              <Pin v-if="isSelected(tool.id)" :size="15" aria-hidden="true" /><span v-else class="shortcut-add">{{ t('shortcuts.add') }}</span>
            </button>
          </div>
        </section>
      </div>
      <footer>
        <button class="command-button subtle" type="button" @click="reset"><RotateCcw :size="15" />{{ t('shortcuts.restore') }}</button>
        <span />
        <button class="command-button subtle" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="command-button" type="button" @click="emit('save', draft); emit('close')">{{ t('shortcuts.save') }}</button>
      </footer>
    </section>
  </div>
</template>
