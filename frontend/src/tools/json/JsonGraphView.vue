<script setup lang="ts">
import { ChevronDown, ChevronRight, Maximize, ZoomIn, ZoomOut } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { replaceJsonNode, type JsonTreeItem } from '@/utils/json'
import { layoutJsonGraph } from '@/utils/jsonGraph'
import JsonNodeEditor from './JsonNodeEditor.vue'

const props = defineProps<{ root: JsonTreeItem | null; source: string }>()
const emit = defineEmits<{ 'update:source': [value: string] }>()

const host = ref<HTMLDivElement | null>(null)
const collapsedIds = ref<Set<string>>(new Set())
const zoom = ref(1)
const panX = ref(24)
const panY = ref(24)
const dragging = ref(false)
const selectedItem = ref<JsonTreeItem | null>(null)
const layout = computed(() => (props.root ? layoutJsonGraph(props.root, collapsedIds.value) : null))
let resizeObserver: ResizeObserver | null = null
let activePointerId: number | null = null
let pointerX = 0
let pointerY = 0

function edgePath(edge: { fromX: number; fromY: number; toX: number; toY: number }): string {
  const controlOffset = Math.max(36, (edge.toX - edge.fromX) * 0.48)
  return `M ${edge.fromX} ${edge.fromY} C ${edge.fromX + controlOffset} ${edge.fromY}, ${edge.toX - controlOffset} ${edge.toY}, ${edge.toX} ${edge.toY}`
}

function nodeSummary(item: JsonTreeItem): string {
  if (item.type === 'object') return `Object · ${item.children.length}`
  if (item.type === 'array') return `Array · ${item.children.length}`
  return item.type
}

function nodeTitle(item: JsonTreeItem, isRoot: boolean): string {
  if (!isRoot) return item.key
  if (item.type === 'object') return 'Object'
  if (item.type === 'array') return 'Array'
  return 'Value'
}

function nodeMeta(item: JsonTreeItem, isRoot: boolean, entryCount: number): string {
  return isRoot ? `根级 · ${entryCount}` : nodeSummary(item)
}

function entryKey(item: JsonTreeItem, isRoot: boolean): string {
  if (isRoot && item.key === '$') return '值'
  return item.path.endsWith(`[${item.key}]`) ? `[${item.key}]` : item.key
}

function entryValue(item: JsonTreeItem): string {
  return item.children.length ? nodeSummary(item) : item.valueText
}

function displayPath(item: JsonTreeItem, isRoot: boolean): string {
  if (isRoot) return '根节点'
  return item.path.replace(/^\$\.?/, '')
}

function toggleNode(item: JsonTreeItem): void {
  if (!item.children.length) return
  const next = new Set(collapsedIds.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)
  collapsedIds.value = next
}

function openNode(item: JsonTreeItem): void {
  selectedItem.value = item
}

function applyNode(value: string): void {
  if (!selectedItem.value) return
  emit('update:source', replaceJsonNode(props.source, selectedItem.value, value))
  selectedItem.value = null
}

function fitView(): void {
  const graph = layout.value
  const element = host.value
  if (!graph || !element) return
  const availableWidth = Math.max(1, element.clientWidth - 56)
  const availableHeight = Math.max(1, element.clientHeight - 56)
  const nextZoom = Math.min(1.15, availableWidth / graph.width, availableHeight / graph.height)
  zoom.value = Math.max(0.12, nextZoom)
  panX.value = (element.clientWidth - graph.width * zoom.value) / 2
  panY.value = (element.clientHeight - graph.height * zoom.value) / 2
}

function setZoom(nextZoom: number, clientX?: number, clientY?: number): void {
  const element = host.value
  if (!element) return
  const clamped = Math.min(2.2, Math.max(0.12, nextZoom))
  const rect = element.getBoundingClientRect()
  const anchorX = (clientX ?? rect.left + rect.width / 2) - rect.left
  const anchorY = (clientY ?? rect.top + rect.height / 2) - rect.top
  const graphX = (anchorX - panX.value) / zoom.value
  const graphY = (anchorY - panY.value) / zoom.value
  panX.value = anchorX - graphX * clamped
  panY.value = anchorY - graphY * clamped
  zoom.value = clamped
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  setZoom(zoom.value * Math.exp(-event.deltaY * 0.0012), event.clientX, event.clientY)
}

function onPointerDown(event: PointerEvent): void {
  if (!host.value || event.button !== 0 || (event.target as HTMLElement).closest('button, .json-graph-node')) return
  activePointerId = event.pointerId
  pointerX = event.clientX
  pointerY = event.clientY
  dragging.value = true
  host.value.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return
  panX.value += event.clientX - pointerX
  panY.value += event.clientY - pointerY
  pointerX = event.clientX
  pointerY = event.clientY
}

function finishPointer(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return
  activePointerId = null
  dragging.value = false
  try {
    host.value?.releasePointerCapture(event.pointerId)
  } catch {
    // Pointer capture may already be released by the browser.
  }
}

watch(
  () => props.root?.id,
  async () => {
    collapsedIds.value = new Set()
    await nextTick()
    fitView()
  },
)

watch(collapsedIds, async () => {
  await nextTick()
  fitView()
})

onMounted(() => {
  resizeObserver = new ResizeObserver(fitView)
  if (host.value) resizeObserver.observe(host.value)
  nextTick(fitView)
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div
    ref="host"
    class="json-graph"
    :class="{ 'is-dragging': dragging }"
    aria-label="JSON 关系图"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="finishPointer"
    @pointercancel="finishPointer"
  >
    <div v-if="layout" class="json-graph-toolbar" aria-label="关系图工具栏">
      <IconButton :icon="ZoomOut" label="缩小关系图" size="small" @click="setZoom(zoom / 1.2)" />
      <span>{{ Math.round(zoom * 100) }}%</span>
      <IconButton :icon="ZoomIn" label="放大关系图" size="small" @click="setZoom(zoom * 1.2)" />
      <IconButton :icon="Maximize" label="适应关系图" size="small" @click="fitView" />
    </div>

    <div
      v-if="layout"
      class="json-graph-stage"
      :style="{
        width: `${layout.width}px`,
        height: `${layout.height}px`,
        transform: `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`,
      }"
    >
      <svg class="json-graph-edges" :viewBox="`0 0 ${layout.width} ${layout.height}`" aria-hidden="true">
        <path v-for="edge in layout.edges" :key="edge.id" :d="edgePath(edge)" />
      </svg>
      <article
        v-for="node in layout.nodes"
        :key="node.item.id"
        class="json-graph-node"
        :class="`type-${node.item.type}`"
        :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` }"
        :title="displayPath(node.item, node.isRoot)"
        :aria-label="`${node.isRoot ? '根节点' : node.item.key} ${nodeSummary(node.item)}`"
        tabindex="0"
        @click="openNode(node.item)"
        @keydown.enter="openNode(node.item)"
      >
        <header class="json-graph-node-header">
          <span class="json-graph-node-copy">
            <strong>{{ nodeTitle(node.item, node.isRoot) }}</strong>
            <small>{{ nodeMeta(node.item, node.isRoot, node.entries.length) }}</small>
          </span>
          <button
            v-if="node.entries.some((entry) => entry.relation)"
            class="json-graph-toggle"
            type="button"
            :aria-label="node.collapsed ? '展开结构卡片' : '折叠结构卡片'"
            :aria-expanded="!node.collapsed"
            @click.stop="toggleNode(node.item)"
          >
            <ChevronRight v-if="node.collapsed" :size="15" aria-hidden="true" />
            <ChevronDown v-else :size="15" aria-hidden="true" />
          </button>
        </header>
        <div v-if="node.entries.length" class="json-graph-fields">
          <div v-for="entry in node.entries" :key="entry.item.id" class="json-graph-field" :class="`type-${entry.item.type}`">
            <span>{{ entryKey(entry.item, node.isRoot) }}</span>
            <code>{{ entryValue(entry.item) }}</code>
          </div>
        </div>
        <div v-else class="json-graph-empty">{{ node.item.type === 'array' ? '空数组' : '空对象' }}</div>
      </article>
    </div>

    <div v-else class="empty-state"><span>暂无可展示的 JSON</span></div>
    <div v-if="layout?.truncated" class="json-graph-limit">为保证流畅度，仅展示前 500 个节点</div>
    <JsonNodeEditor v-if="selectedItem" :item="selectedItem" :source="source" @close="selectedItem = null" @apply="applyNode" />
  </div>
</template>
