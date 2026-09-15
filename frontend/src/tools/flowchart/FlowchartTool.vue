<script setup lang="ts">
import { Clipboard, Dnd, Export, Graph, History, Keyboard, MiniMap, Selection, Snapline, Transform, type Edge } from '@antv/x6'
import { AlignCenterHorizontal, AlignLeft, AlignRight, BringToFront, ClipboardPaste, Copy, Download, FileJson, FileOutput, FileText, FolderOpen, GitBranch, Maximize, MousePointer2, Redo2, Save, SendToBack, Trash2, Undo2, Upload, ZoomIn, ZoomOut } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useToastStore } from '@/stores/toast'
import { downloadBlob } from '@/utils/download'
import { deleteFlowchart, loadFlowchartLibrary, saveFlowchart, type SavedFlowchart } from './flowchartLibrary'
import FlowShapePreview from './FlowShapePreview.vue'
import {
  createFlowchartTemplate,
  createId,
  createFlowNode,
  edgeStrokeOptions,
  flowchartTemplates,
  flowShapeDefinitions,
  flowShapeGroups,
  nodeFillOptions,
  nodeStrokeOptions,
  normalizeFlowchartState,
  portIds,
  shapeDefinition,
  type EdgeMarker,
  type EdgeRoute,
  type FlowEdgeState,
  type FlowNodeState,
  type FlowShape,
  type FlowchartState,
  type FlowchartTemplateId,
  type StrokeDash,
  type TextAlign,
} from './flowchartModel'

type ToolMode = 'select' | 'connect'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const canvasHost = ref<HTMLDivElement | null>(null)
const canvasViewport = ref<HTMLDivElement | null>(null)
const minimapHost = ref<HTMLDivElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const selectedNodeId = ref('')
const selectedEdgeId = ref('')
const activePaletteGroup = ref<(typeof flowShapeGroups)[number]['id']>('basic')
const selectedTemplate = ref<FlowchartTemplateId>('approval')
const activeMode = ref<ToolMode>('select')
const connectionRoute = ref<EdgeRoute>('orthogonal')
const connectionEndMarker = ref<EdgeMarker>('arrow')
const connectingSourceId = ref('')
const historyRevision = ref(0)
const savedFlowcharts = ref<SavedFlowchart[]>([])
const selectedSavedId = ref('')
const model = reactive<FlowchartState>(normalizeFlowchartState(props.state))

let graph: Graph | null = null
let dnd: Dnd | null = null
let resizeObserver: ResizeObserver | null = null
let syncTimer = 0
let fitTimer = 0

const selectedNode = computed(() => model.nodes.find((node) => node.id === selectedNodeId.value) ?? null)
const selectedEdge = computed(() => model.edges.find((edge) => edge.id === selectedEdgeId.value) ?? null)
const paletteItems = computed(() => flowShapeDefinitions.filter((shape) => shape.group === activePaletteGroup.value))
const canUndo = computed(() => {
  historyRevision.value
  return graph?.canUndo() ?? false
})
const canRedo = computed(() => {
  historyRevision.value
  return graph?.canRedo() ?? false
})
const validationItems = computed(() => {
  const items: string[] = []
  if (model.nodes.length && !model.nodes.some((node) => node.shape === 'terminator')) items.push('缺少开始或结束节点')
  if (model.nodes.length > 1 && !model.edges.length) items.push('尚未连接流程节点')
  if (model.edges.some((edge) => !edge.label && model.nodes.find((node) => node.id === edge.source)?.shape === 'decision')) items.push('判断分支建议填写连线标签')
  return items
})

const ports = {
  groups: Object.fromEntries(portIds.map((position) => [position, {
    position,
    attrs: { circle: { r: 4, magnet: true, stroke: '#16866e', strokeWidth: 1.5, fill: '#ffffff' } },
  }])),
  items: portIds.map((id) => ({ id, group: id })),
}

function dashArray(value: StrokeDash): string {
  return value === 'dashed' ? '8 5' : value === 'dotted' ? '2 4' : ''
}

function marker(value: EdgeMarker): Record<string, unknown> | null {
  if (value === 'none') return null
  if (value === 'diamond') return { name: 'diamond', width: 10, height: 8 }
  if (value === 'circle') return { name: 'circle', r: 4 }
  return { name: 'block', width: 9, height: 7 }
}

function labelAttrs(node: FlowNodeState): Record<string, unknown> {
  const alignment: Record<TextAlign, Record<string, string | number>> = {
    left: { refX: 10, textAnchor: 'start' },
    center: { refX: '50%', textAnchor: 'middle' },
    right: { refX: -10, textAnchor: 'end' },
  }
  return {
    text: node.label,
    fill: node.textColor,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    refY: '50%',
    textVerticalAnchor: 'middle',
    ...alignment[node.textAlign],
    textWrap: { width: -18, height: -14, ellipsis: true },
  }
}

function routeAttrs(route: EdgeRoute, vertexCount = 0): { router: { name: string; args?: Record<string, unknown> }; connector: { name: string } } {
  if (route === 'straight') return { router: { name: 'normal' }, connector: { name: 'normal' } }
  if (route === 'curve') return { router: { name: 'normal' }, connector: { name: 'smooth' } }
  if (vertexCount) return { router: { name: 'normal' }, connector: { name: 'normal' } }
  return { router: { name: 'orth', args: { padding: 14 } }, connector: { name: 'normal' } }
}

function graphNode(node: FlowNodeState): Record<string, unknown> {
  const definition = shapeDefinition(node.shape)
  return {
    id: node.id,
    shape: definition.graphShape,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    zIndex: node.zIndex,
    data: { flowNode: { ...node } },
    attrs: {
      body: { ...definition.body, fill: node.fill, stroke: node.stroke, strokeWidth: node.strokeWidth, strokeDasharray: dashArray(node.dash), opacity: node.opacity },
      label: labelAttrs(node),
    },
    ports,
  }
}

function graphEdge(edge: FlowEdgeState): Record<string, unknown> {
  return {
    id: edge.id,
    source: { cell: edge.source, port: edge.sourcePort },
    target: { cell: edge.target, port: edge.targetPort },
    vertices: edge.vertices.map(({ x, y }) => ({ x, y })),
    data: { flowEdge: { ...edge } },
    ...routeAttrs(edge.route, edge.vertices.length),
    attrs: { line: { stroke: edge.stroke, strokeWidth: edge.strokeWidth, strokeDasharray: dashArray(edge.dash), sourceMarker: marker(edge.sourceMarker), targetMarker: marker(edge.targetMarker) } },
    labels: edge.label ? [edge.label] : [],
  }
}

function draftEdge(): FlowEdgeState {
  return {
    id: '',
    source: '',
    sourcePort: 'right',
    target: '',
    targetPort: 'left',
    vertices: [],
    route: connectionRoute.value,
    label: '',
    stroke: '#475569',
    strokeWidth: 1.5,
    dash: 'solid',
    sourceMarker: 'none',
    targetMarker: connectionEndMarker.value,
  }
}

function snapshotNode(id: string): FlowNodeState | null {
  if (!graph) return null
  const node = graph.getCellById(id)
  if (!node?.isNode()) return null
  const saved = node.getData<{ flowNode?: Partial<FlowNodeState> }>().flowNode
  if (!saved?.shape) return null
  const position = node.position()
  const size = node.size()
  const defaults = createFlowNode(saved.shape, position.x, position.y)
  return {
    ...defaults,
    ...saved,
    id: node.id,
    x: Math.round(position.x),
    y: Math.round(position.y),
    width: Math.round(size.width),
    height: Math.round(size.height),
    label: String(node.attr('label/text') ?? '').trim() || saved.label || defaults.label,
    fill: String(node.attr('body/fill') ?? '').trim() || saved.fill || defaults.fill,
    stroke: String(node.attr('body/stroke') ?? '').trim() || saved.stroke || defaults.stroke,
    strokeWidth: Number(node.attr('body/strokeWidth') ?? defaults.strokeWidth),
    textColor: String(node.attr('label/fill') ?? defaults.textColor),
    fontSize: Number(node.attr('label/fontSize') ?? defaults.fontSize),
    fontWeight: node.attr('label/fontWeight') === 400 || node.attr('label/fontWeight') === 700 ? node.attr('label/fontWeight') : 600,
  }
}

function snapshotEdge(id: string): FlowEdgeState | null {
  if (!graph) return null
  const edge = graph.getCellById(id)
  if (!edge?.isEdge()) return null
  const source = edge.getSourceCellId()
  const target = edge.getTargetCellId()
  if (!source || !target) return null
  const saved = edge.getData<{ flowEdge?: Partial<FlowEdgeState> }>().flowEdge
  const firstLabel = edge.getLabels()[0] as { attrs?: { text?: { text?: unknown }; label?: { text?: unknown } } } | string | undefined
  const renderedLabel = typeof firstLabel === 'string'
    ? firstLabel
    : typeof firstLabel?.attrs?.text?.text === 'string'
      ? firstLabel.attrs.text.text
      : typeof firstLabel?.attrs?.label?.text === 'string'
        ? firstLabel.attrs.label.text
        : ''
  const fallback: FlowEdgeState = {
    id: edge.id,
    source,
    sourcePort: edge.getSourcePortId() || 'right',
    target,
    targetPort: edge.getTargetPortId() || 'left',
    vertices: [],
    route: 'orthogonal',
    label: '',
    stroke: '#475569',
    strokeWidth: 1.5,
    dash: 'solid',
    sourceMarker: 'none',
    targetMarker: 'arrow',
  }
  return {
    ...fallback,
    ...saved,
    id: edge.id,
    source,
    sourcePort: edge.getSourcePortId() || 'right',
    target,
    targetPort: edge.getTargetPortId() || 'left',
    vertices: edge.getVertices().map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) })),
    label: renderedLabel || saved?.label || '',
    stroke: String(edge.attr('line/stroke') ?? saved?.stroke ?? fallback.stroke),
    strokeWidth: Number(edge.attr('line/strokeWidth') ?? saved?.strokeWidth ?? fallback.strokeWidth),
  }
}

function scheduleSync(): void {
  window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(syncFromGraph, 80)
}

function syncFromGraph(): void {
  if (!graph) return
  model.nodes = graph.getNodes().map((node) => snapshotNode(node.id)).filter((node): node is FlowNodeState => Boolean(node))
  model.edges = graph.getEdges().map((edge) => snapshotEdge(edge.id)).filter((edge): edge is FlowEdgeState => Boolean(edge))
  if (!model.nodes.some((node) => node.id === selectedNodeId.value)) selectedNodeId.value = ''
  if (!model.edges.some((edge) => edge.id === selectedEdgeId.value)) selectedEdgeId.value = ''
  historyRevision.value += 1
}

function clearSelection(): void {
  graph?.getEdges().forEach((edge) => edge.removeTools())
  graph?.cleanSelection()
  selectedNodeId.value = ''
  selectedEdgeId.value = ''
}

function selectNode(id: string, additive = false): void {
  const node = graph?.getCellById(id)
  if (!node?.isNode()) return
  graph?.getEdges().forEach((edge) => edge.removeTools())
  if (additive) graph?.select(node)
  else graph?.resetSelection(node)
  selectedNodeId.value = id
  selectedEdgeId.value = ''
}

function connectByNodeClick(id: string): void {
  if (!graph) return
  if (!connectingSourceId.value) {
    connectingSourceId.value = id
    graph.resetSelection(id)
    return
  }
  if (connectingSourceId.value === id) {
    connectingSourceId.value = ''
    graph.cleanSelection()
    return
  }
  const edge = { ...draftEdge(), id: createId('edge'), source: connectingSourceId.value, target: id }
  graph.addEdge(graphEdge(edge))
  connectingSourceId.value = ''
  graph.cleanSelection()
  scheduleSync()
}

function lockManualOrthogonalRoute(edge: Edge): void {
  const route = edge.getData<{ flowEdge?: Partial<FlowEdgeState> }>().flowEdge?.route
  if (route !== 'orthogonal') return
  const definition = routeAttrs(route, edge.getVertices().length)
  edge.setRouter(definition.router.name, definition.router.args)
  edge.setConnector(definition.connector.name)
}

function selectEdge(id: string): void {
  const edge = graph?.getCellById(id)
  if (!edge?.isEdge()) return
  graph?.getEdges().forEach((entry) => entry.removeTools())
  graph?.resetSelection(edge)
  edge.addTools([
    { name: 'segments', args: { precision: 1, attrs: { width: 16, height: 16, x: -8, y: -8, rx: 8, ry: 8, fill: 'var(--tool-accent)', stroke: 'var(--surface-raised)', 'stroke-width': 3 }, onChanged: ({ edge: changedEdge }: { edge: Edge }) => lockManualOrthogonalRoute(changedEdge) } },
    { name: 'source-arrowhead', args: { attrs: { class: 'flowchart-edge-endpoint', d: 'M 0 -8 A 8 8 0 1 1 0 8 A 8 8 0 1 1 0 -8 Z', fill: 'var(--surface-raised)', stroke: 'var(--tool-accent)', 'stroke-width': 3, 'vector-effect': 'non-scaling-stroke', cursor: 'move' } } },
    { name: 'target-arrowhead', args: { attrs: { class: 'flowchart-edge-endpoint', d: 'M 0 -8 A 8 8 0 1 1 0 8 A 8 8 0 1 1 0 -8 Z', fill: 'var(--surface-raised)', stroke: 'var(--tool-accent)', 'stroke-width': 3, 'vector-effect': 'non-scaling-stroke', cursor: 'move' } } },
  ])
  selectedNodeId.value = ''
  selectedEdgeId.value = id
}

function updateNode(patch: Partial<FlowNodeState>): void {
  const current = selectedNode.value
  const node = current ? graph?.getCellById(current.id) : null
  if (!current || !node?.isNode()) return
  const next = { ...current, ...patch }
  node.setData({ flowNode: next })
  const modelIndex = model.nodes.findIndex((entry) => entry.id === next.id)
  if (modelIndex >= 0) model.nodes[modelIndex] = { ...next }
  node.resize(next.width, next.height)
  node.setZIndex(next.zIndex)
  node.attr('body/fill', next.fill)
  node.attr('body/stroke', next.stroke)
  node.attr('body/strokeWidth', next.strokeWidth)
  node.attr('body/strokeDasharray', dashArray(next.dash))
  node.attr('body/opacity', next.opacity)
  node.attr('label/text', next.label)
  node.attr('label/fill', next.textColor)
  node.attr('label/fontSize', next.fontSize)
  node.attr('label/fontWeight', next.fontWeight)
  node.attr('label/refX', next.textAlign === 'left' ? 10 : next.textAlign === 'right' ? -10 : '50%')
  node.attr('label/textAnchor', next.textAlign === 'left' ? 'start' : next.textAlign === 'right' ? 'end' : 'middle')
  scheduleSync()
}

function updateEdge(patch: Partial<FlowEdgeState>): void {
  const current = selectedEdge.value
  const edge = current ? graph?.getCellById(current.id) : null
  if (!current || !edge?.isEdge()) return
  const next = { ...current, ...patch }
  const route = routeAttrs(next.route, next.vertices.length)
  edge.setData({ flowEdge: next })
  const modelIndex = model.edges.findIndex((entry) => entry.id === next.id)
  if (modelIndex >= 0) model.edges[modelIndex] = { ...next }
  edge.setRouter(route.router.name, route.router.args)
  edge.setConnector(route.connector.name)
  edge.attr({ line: { stroke: next.stroke, strokeWidth: next.strokeWidth, strokeDasharray: dashArray(next.dash), sourceMarker: marker(next.sourceMarker), targetMarker: marker(next.targetMarker) } as never })
  edge.setLabels(next.label ? [{ attrs: { text: { text: next.label } } }] : [])
  scheduleSync()
}

function startPaletteDrag(shape: FlowShape, event: MouseEvent): void {
  if (!graph || !dnd) return
  dnd.start(graph.createNode(graphNode(createFlowNode(shape, 0, 0))), event)
}

function setToolMode(mode: ToolMode): void {
  activeMode.value = mode
  connectingSourceId.value = ''
  if (!graph) return
  if (mode === 'connect') {
    graph.cleanSelection()
    selectedNodeId.value = ''
    selectedEdgeId.value = ''
  }
  if (mode === 'select') graph.enableSelection()
  else graph.disableSelection()
}

function selectedNodes() {
  return graph?.getSelectedCells().filter((cell) => cell.isNode()) ?? []
}

function alignSelected(mode: 'left' | 'center' | 'right'): void {
  const nodes = selectedNodes()
  if (!graph || nodes.length < 2) return
  const values = nodes.map((node) => ({ node, position: node.position(), size: node.size() }))
  const target = mode === 'left'
    ? Math.min(...values.map(({ position }) => position.x))
    : mode === 'right'
      ? Math.max(...values.map(({ position, size }) => position.x + size.width))
      : values.reduce((sum, { position, size }) => sum + position.x + size.width / 2, 0) / values.length
  graph.batchUpdate(() => values.forEach(({ node, position, size }) => node.position(mode === 'left' ? target : mode === 'right' ? target - size.width : target - size.width / 2, position.y)))
  scheduleSync()
}

function copySelected(): void {
  const cells = graph?.getSelectedCells() ?? []
  if (!cells.length) return
  graph?.copy(cells)
  toast.show('已复制所选内容', 'success')
}

function pasteSelected(): void {
  if (!graph || graph.isClipboardEmpty()) return
  const cells = graph.paste({ offset: { dx: 28, dy: 28 } })
  graph.resetSelection(cells)
  selectedNodeId.value = cells.find((cell) => cell.isNode())?.id ?? ''
  selectedEdgeId.value = ''
  scheduleSync()
}

function removeSelected(): void {
  const cells = graph?.getSelectedCells() ?? []
  if (!cells.length) return
  graph?.removeCells(cells)
  clearSelection()
  scheduleSync()
}

function bringSelectedToFront(): void {
  const nodes = selectedNodes()
  if (!graph || !nodes.length) return
  const top = Math.max(0, ...graph.getNodes().map((node) => node.getZIndex()))
  nodes.forEach((node, index) => node.setZIndex(top + index + 1))
  scheduleSync()
}

function sendSelectedToBack(): void {
  const nodes = selectedNodes()
  if (!graph || !nodes.length) return
  const bottom = Math.min(0, ...graph.getNodes().map((node) => node.getZIndex()))
  nodes.forEach((node, index) => node.setZIndex(bottom - nodes.length + index))
  scheduleSync()
}

function undo(): void { graph?.undo(); scheduleSync() }
function redo(): void { graph?.redo(); scheduleSync() }
function zoom(factor: number): void { graph?.zoom(factor, { absolute: false }) }

function fitGraph(): void {
  const host = canvasViewport.value
  if (!graph || !host) return
  graph.resize(host.clientWidth, host.clientHeight)
  const nodes = graph.getNodes()
  if (!nodes.length) return
  const bounds = nodes.reduce((current, node) => {
    const position = node.position()
    const size = node.size()
    return { left: Math.min(current.left, position.x), top: Math.min(current.top, position.y), right: Math.max(current.right, position.x + size.width), bottom: Math.max(current.bottom, position.y + size.height) }
  }, { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY })
  const scale = Math.max(0.18, Math.min(1.1, (host.clientWidth - 96) / Math.max(1, bounds.right - bounds.left), (host.clientHeight - 96) / Math.max(1, bounds.bottom - bounds.top)))
  graph.zoomTo(scale)
  graph.translate((host.clientWidth - (bounds.left + bounds.right) * scale) / 2, (host.clientHeight - (bounds.top + bounds.bottom) * scale) / 2)
}

function replaceDiagram(next: FlowchartState): void {
  if (!graph) return
  graph.fromJSON({ nodes: next.nodes.map(graphNode), edges: next.edges.map(graphEdge) })
  graph.cleanHistory()
  model.title = next.title
  model.nodes = next.nodes.map((node) => ({ ...node }))
  model.edges = next.edges.map((edge) => ({ ...edge }))
  clearSelection()
  requestAnimationFrame(fitGraph)
}

function applyTemplate(): void {
  if (model.nodes.length && !window.confirm('应用模板将替换当前画板内容，是否继续？')) return
  replaceDiagram(createFlowchartTemplate(selectedTemplate.value))
  toast.show('已应用流程图模板', 'success')
}

function clearGraph(): void {
  if (model.nodes.length && !window.confirm('清空后无法恢复当前未保存内容，是否继续？')) return
  graph?.clearCells()
  model.nodes = []
  model.edges = []
  clearSelection()
}

function currentState(): FlowchartState {
  syncFromGraph()
  return { title: model.title, nodes: model.nodes.map((node) => ({ ...node })), edges: model.edges.map((edge) => ({ ...edge })) }
}

function saveToLibrary(): void {
  savedFlowcharts.value = saveFlowchart(savedFlowcharts.value, currentState(), selectedSavedId.value || undefined)
  selectedSavedId.value = savedFlowcharts.value[0]?.id ?? ''
  toast.show('图纸已保存到本地库', 'success')
}

function loadFromLibrary(): void {
  const entry = savedFlowcharts.value.find((item) => item.id === selectedSavedId.value)
  if (!entry) return
  replaceDiagram(entry.state)
  toast.show(`已载入 ${entry.title}`, 'success')
}

function removeFromLibrary(): void {
  if (!selectedSavedId.value) return
  if (!window.confirm('删除后无法从本地图纸库恢复，是否继续？')) return
  savedFlowcharts.value = deleteFlowchart(savedFlowcharts.value, selectedSavedId.value)
  selectedSavedId.value = ''
  toast.show('已从本地库删除图纸', 'success')
}

function safeFileName(): string {
  return model.title.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'flowchart'
}

function exportJson(): void {
  syncFromGraph()
  downloadBlob(new Blob([JSON.stringify({ title: model.title, nodes: model.nodes, edges: model.edges }, null, 2)], { type: 'application/json;charset=utf-8' }), `${safeFileName()}.json`)
  toast.show('流程图 JSON 已开始下载', 'success')
}

function exportSvg(): void { graph?.exportSVG(safeFileName()); toast.show('SVG 已开始下载', 'success') }
function exportPng(): void { graph?.exportPNG(safeFileName(), { padding: 24 }); toast.show('PNG 已开始下载', 'success') }
function requestImport(): void { importInput.value?.click() }

async function importJson(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    replaceDiagram(normalizeFlowchartState(JSON.parse(await file.text()) as Record<string, unknown>))
    toast.show('已导入本地流程图', 'success')
  } catch {
    toast.show('无法读取流程图 JSON 文件', 'error')
  }
}

watch(model, () => emit('update:state', {
  title: model.title,
  nodes: model.nodes.map((node) => ({ ...node })),
  edges: model.edges.map((edge) => ({ ...edge, vertices: edge.vertices.map((vertex) => ({ ...vertex })) })),
}), { deep: true, immediate: true })

onMounted(async () => {
  if (!canvasHost.value || !canvasViewport.value || !minimapHost.value) return
  graph = new Graph({
    container: canvasHost.value,
    grid: { visible: true, type: 'dot', size: 16, args: { color: '#c9d4df', thickness: 1 } },
    background: { color: 'transparent' },
    panning: { enabled: true, eventTypes: ['rightMouseDown'] },
    preventDefaultContextMenu: true,
    mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.18, maxScale: 2.5 },
    connecting: {
      allowBlank: false,
      allowLoop: false,
      allowNode: false,
      allowEdge: false,
      allowMulti: true,
      highlight: true,
      snap: true,
      validateConnection: () => activeMode.value === 'connect',
      createEdge: () => graph!.createEdge(graphEdge(draftEdge())),
    },
  })
  graph.use(new History({ enabled: true }))
  graph.use(new Clipboard({ enabled: true, useLocalStorage: false }))
  graph.use(new Export())
  graph.use(new Keyboard({ enabled: true }))
  graph.use(new Selection({ enabled: true, multiple: true, rubberband: true, showNodeSelectionBox: true }))
  graph.use(new Snapline({ enabled: true, sharp: true }))
  graph.use(new Transform({ resizing: { enabled: true, minWidth: 60, minHeight: 32 }, rotating: false }))
  graph.use(new MiniMap({ container: minimapHost.value, width: 148, height: 94, padding: 8, scalable: true }))
  dnd = new Dnd({ target: graph })
  savedFlowcharts.value = loadFlowchartLibrary()
  graph.fromJSON({ nodes: model.nodes.map(graphNode), edges: model.edges.map(graphEdge) })
  graph.on('node:click', ({ node, e }) => {
    if (activeMode.value === 'connect') connectByNodeClick(node.id)
    else selectNode(node.id, e.ctrlKey || e.metaKey)
  })
  graph.on('edge:click', ({ edge }) => selectEdge(edge.id))
  graph.on('blank:click', clearSelection)
  graph.on('cell:changed', scheduleSync)
  graph.on('cell:added', scheduleSync)
  graph.on('cell:removed', scheduleSync)
  graph.on('history:change', () => { historyRevision.value += 1 })
  graph.bindKey(['ctrl+c', 'meta+c'], () => { copySelected(); return false })
  graph.bindKey(['ctrl+v', 'meta+v'], () => { pasteSelected(); return false })
  graph.bindKey(['ctrl+d', 'meta+d'], () => { copySelected(); pasteSelected(); return false })
  graph.bindKey(['ctrl+z', 'meta+z'], () => { undo(); return false })
  graph.bindKey(['ctrl+shift+z', 'meta+shift+z'], () => { redo(); return false })
  graph.bindKey(['backspace', 'delete'], () => { removeSelected(); return false })
  resizeObserver = new ResizeObserver(() => {
    window.clearTimeout(fitTimer)
    fitTimer = window.setTimeout(fitGraph, 80)
  })
  resizeObserver.observe(canvasViewport.value)
  await nextTick()
  fitGraph()
})

onBeforeUnmount(() => {
  window.clearTimeout(syncTimer)
  window.clearTimeout(fitTimer)
  resizeObserver?.disconnect()
  dnd?.dispose()
  graph?.dispose()
})
</script>

<template>
  <section class="tool-page flowchart-tool">
    <header class="tool-header flowchart-header">
      <div>
        <div class="flowchart-title-line"><h1>流程图画板</h1><input v-model="model.title" aria-label="流程图名称" maxlength="80" /></div>
        <p>{{ validationItems[0] || '本地编辑流程图节点、连线与样式；固定标签后在当前设备保留图纸。' }}</p>
      </div>
      <div class="toolbar flowchart-header-tools">
        <select v-model="selectedTemplate" aria-label="流程图模板"><option v-for="template in flowchartTemplates" :key="template.id" :value="template.id">{{ template.label }}</option></select>
        <IconButton :icon="FileText" label="应用流程图模板" @click="applyTemplate" />
        <select v-model="selectedSavedId" aria-label="本地图纸"><option value="">本地图纸</option><option v-for="entry in savedFlowcharts" :key="entry.id" :value="entry.id">{{ entry.title }}</option></select>
        <IconButton :icon="Save" label="保存本地图纸" @click="saveToLibrary" />
        <IconButton :icon="FolderOpen" label="载入本地图纸" :disabled="!selectedSavedId" @click="loadFromLibrary" />
        <IconButton :icon="Trash2" label="删除本地图纸" danger :disabled="!selectedSavedId" @click="removeFromLibrary" />
        <IconButton :icon="Undo2" label="撤销" :disabled="!canUndo" @click="undo" />
        <IconButton :icon="Redo2" label="重做" :disabled="!canRedo" @click="redo" />
        <IconButton :icon="FileJson" label="导出流程图 JSON" @click="exportJson" />
        <IconButton :icon="Upload" label="导入流程图 JSON" @click="requestImport" />
        <IconButton :icon="Download" label="导出 SVG" @click="exportSvg" />
        <IconButton :icon="FileOutput" label="导出 PNG" @click="exportPng" />
        <IconButton :icon="Trash2" label="清空流程图" danger :disabled="!model.nodes.length" @click="clearGraph" />
      </div>
    </header>

    <div class="flowchart-command-bar" aria-label="画板工具">
      <div class="flowchart-mode-tools">
        <button type="button" :class="{ active: activeMode === 'select' }" aria-label="选择工具" title="选择工具" @click="setToolMode('select')"><MousePointer2 :size="16" /></button>
        <button type="button" :class="{ active: activeMode === 'connect' }" aria-label="连线工具" title="连线工具" @click="setToolMode('connect')"><GitBranch :size="16" /></button>
      </div>
      <div v-if="activeMode === 'connect'" class="flowchart-connector-presets" aria-label="连线预设">
        <button type="button" :class="connectionRoute === 'orthogonal' ? 'flowchart-line-preset active' : 'flowchart-line-preset'" aria-label="使用正交连线" title="正交连线" @click="connectionRoute = 'orthogonal'"><i class="orthogonal" /><span>正交</span></button>
        <button type="button" :class="connectionRoute === 'straight' ? 'flowchart-line-preset active' : 'flowchart-line-preset'" aria-label="使用直线连线" title="直线连线" @click="connectionRoute = 'straight'"><i class="straight" /><span>直线</span></button>
        <button type="button" :class="connectionRoute === 'curve' ? 'flowchart-line-preset active' : 'flowchart-line-preset'" aria-label="使用曲线连线" title="曲线连线" @click="connectionRoute = 'curve'"><i class="curve" /><span>曲线</span></button>
        <span class="flowchart-connector-divider" />
        <button type="button" :class="connectionEndMarker === 'arrow' ? 'flowchart-arrow-preset active' : 'flowchart-arrow-preset'" aria-label="使用箭头终点" title="箭头终点" @click="connectionEndMarker = 'arrow'">→</button>
        <button type="button" :class="connectionEndMarker === 'diamond' ? 'flowchart-arrow-preset active' : 'flowchart-arrow-preset'" aria-label="使用菱形终点" title="菱形终点" @click="connectionEndMarker = 'diamond'">◇</button>
        <button type="button" :class="connectionEndMarker === 'none' ? 'flowchart-arrow-preset active' : 'flowchart-arrow-preset'" aria-label="使用无线条终点" title="无线条终点" @click="connectionEndMarker = 'none'">─</button>
        <span class="flowchart-connect-hint">{{ connectingSourceId ? '已选起点，点击目标节点' : '点击两节点或拖拽锚点' }}</span>
      </div>
      <div v-if="selectedNode || selectedEdge" class="flowchart-selection-tools">
        <IconButton :icon="Copy" label="复制所选内容" size="small" @click="copySelected" />
        <IconButton :icon="ClipboardPaste" label="粘贴内容" size="small" @click="pasteSelected" />
        <IconButton :icon="AlignLeft" label="左对齐所选节点" size="small" @click="alignSelected('left')" />
        <IconButton :icon="AlignCenterHorizontal" label="水平居中对齐所选节点" size="small" @click="alignSelected('center')" />
        <IconButton :icon="AlignRight" label="右对齐所选节点" size="small" @click="alignSelected('right')" />
        <IconButton :icon="BringToFront" label="置于顶层" size="small" @click="bringSelectedToFront" />
        <IconButton :icon="SendToBack" label="置于底层" size="small" @click="sendSelectedToBack" />
      </div>
      <div class="flowchart-view-tools">
        <span class="flowchart-pan-hint">右键拖动画板</span>
        <IconButton :icon="ZoomOut" label="缩小画板" size="small" @click="zoom(-0.15)" />
        <IconButton :icon="ZoomIn" label="放大画板" size="small" @click="zoom(0.15)" />
        <IconButton :icon="Maximize" label="适配画板内容" size="small" @click="fitGraph" />
      </div>
    </div>

    <div class="flowchart-workbench" :class="`mode-${activeMode}`">
      <aside class="flowchart-palette" aria-label="流程图形状库">
        <div class="flowchart-palette-header"><div><strong>形状库</strong><small>{{ paletteItems.length }} 个图形</small></div><select v-model="activePaletteGroup" aria-label="形状分类"><option v-for="group in flowShapeGroups" :key="group.id" :value="group.id">{{ group.label }}</option></select></div>
        <div class="flowchart-shape-list"><button v-for="item in paletteItems" :key="item.id" type="button" :class="['flowchart-shape', `shape-${item.id}`]" :aria-label="`拖拽添加${item.label}`" :title="item.label" @mousedown.prevent="startPaletteDrag(item.id, $event)"><span class="flowchart-shape-preview"><FlowShapePreview :shape="item.id" /></span><span class="flowchart-shape-label">{{ item.label }}</span></button></div>
      </aside>

      <div ref="canvasViewport" class="flowchart-canvas-wrap"><div ref="canvasHost" class="flowchart-canvas" aria-label="流程图编辑画板" /><div ref="minimapHost" class="flowchart-minimap" aria-label="流程图小地图" /></div>

      <aside class="flowchart-inspector" aria-label="图形属性">
        <template v-if="selectedNode">
          <div class="panel-label"><span>节点属性</span><small>{{ shapeDefinition(selectedNode.shape).label }}</small></div>
          <label>内容<input :value="selectedNode.label" aria-label="节点内容" maxlength="240" @input="updateNode({ label: ($event.target as HTMLInputElement).value })" /></label>
          <div class="flowchart-field-grid"><label>宽<input :value="selectedNode.width" aria-label="节点宽度" type="number" min="60" max="640" @change="updateNode({ width: Number(($event.target as HTMLInputElement).value) })" /></label><label>高<input :value="selectedNode.height" aria-label="节点高度" type="number" min="32" max="480" @change="updateNode({ height: Number(($event.target as HTMLInputElement).value) })" /></label><label>字号<input :value="selectedNode.fontSize" aria-label="节点字号" type="number" min="10" max="48" @change="updateNode({ fontSize: Number(($event.target as HTMLInputElement).value) })" /></label><label>字重<select :value="selectedNode.fontWeight" aria-label="节点字重" @change="updateNode({ fontWeight: Number(($event.target as HTMLSelectElement).value) as 400 | 600 | 700 })"><option :value="400">常规</option><option :value="600">加粗</option><option :value="700">粗体</option></select></label></div>
          <div class="flowchart-swatch-field"><span>填充色</span><div><button v-for="fill in nodeFillOptions" :key="fill" type="button" :class="{ active: selectedNode.fill === fill }" :style="{ backgroundColor: fill }" :aria-label="`使用填充色 ${fill}`" @click="updateNode({ fill })" /><input :value="selectedNode.fill" aria-label="自定义节点填充色" type="color" @input="updateNode({ fill: ($event.target as HTMLInputElement).value })" /></div></div>
          <div class="flowchart-swatch-field"><span>边框色</span><div><button v-for="stroke in nodeStrokeOptions" :key="stroke" type="button" :class="{ active: selectedNode.stroke === stroke }" :style="{ backgroundColor: stroke }" :aria-label="`使用边框色 ${stroke}`" @click="updateNode({ stroke })" /><input :value="selectedNode.stroke" aria-label="自定义节点边框色" type="color" @input="updateNode({ stroke: ($event.target as HTMLInputElement).value })" /></div></div>
          <div class="flowchart-field-grid"><label>边框<select :value="selectedNode.dash" aria-label="节点边框样式" @change="updateNode({ dash: ($event.target as HTMLSelectElement).value as StrokeDash })"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label><label>透明度<input :value="Math.round(selectedNode.opacity * 100)" aria-label="节点透明度" type="range" min="10" max="100" @input="updateNode({ opacity: Number(($event.target as HTMLInputElement).value) / 100 })" /></label></div>
          <div class="flowchart-align-tools" aria-label="节点文字对齐"><button type="button" :class="{ active: selectedNode.textAlign === 'left' }" aria-label="左对齐节点文字" @click="updateNode({ textAlign: 'left' })"><AlignLeft :size="15" /></button><button type="button" :class="{ active: selectedNode.textAlign === 'center' }" aria-label="居中节点文字" @click="updateNode({ textAlign: 'center' })"><AlignCenterHorizontal :size="15" /></button><button type="button" :class="{ active: selectedNode.textAlign === 'right' }" aria-label="右对齐节点文字" @click="updateNode({ textAlign: 'right' })"><AlignRight :size="15" /></button></div>
          <button class="flowchart-delete" type="button" @click="removeSelected"><Trash2 :size="15" />删除节点</button>
        </template>
        <template v-else-if="selectedEdge">
          <div class="panel-label"><span>连线属性</span><small>拖动控制点</small></div>
          <label>标签<input :value="selectedEdge.label" aria-label="连线标签" maxlength="120" @input="updateEdge({ label: ($event.target as HTMLInputElement).value })" /></label>
          <div class="flowchart-field-grid"><label>路径<select :value="selectedEdge.route" aria-label="连线路径" @change="updateEdge({ route: ($event.target as HTMLSelectElement).value as EdgeRoute })"><option value="orthogonal">正交</option><option value="straight">直线</option><option value="curve">曲线</option></select></label><label>线宽<input :value="selectedEdge.strokeWidth" aria-label="连线宽度" type="number" min="1" max="12" step="0.5" @change="updateEdge({ strokeWidth: Number(($event.target as HTMLInputElement).value) })" /></label></div>
          <div class="flowchart-field-grid"><label>起点<select :value="selectedEdge.sourceMarker" aria-label="连线起点样式" @change="updateEdge({ sourceMarker: ($event.target as HTMLSelectElement).value as EdgeMarker })"><option value="none">无</option><option value="arrow">箭头</option><option value="diamond">菱形</option><option value="circle">圆点</option></select></label><label>终点<select :value="selectedEdge.targetMarker" aria-label="连线终点样式" @change="updateEdge({ targetMarker: ($event.target as HTMLSelectElement).value as EdgeMarker })"><option value="none">无</option><option value="arrow">箭头</option><option value="diamond">菱形</option><option value="circle">圆点</option></select></label></div>
          <div class="flowchart-swatch-field"><span>线条色</span><div><button v-for="stroke in edgeStrokeOptions" :key="stroke" type="button" :class="{ active: selectedEdge.stroke === stroke }" :style="{ backgroundColor: stroke }" :aria-label="`使用线条色 ${stroke}`" @click="updateEdge({ stroke })" /><input :value="selectedEdge.stroke" aria-label="自定义线条色" type="color" @input="updateEdge({ stroke: ($event.target as HTMLInputElement).value })" /></div></div>
          <label>线条样式<select :value="selectedEdge.dash" aria-label="连线样式" @change="updateEdge({ dash: ($event.target as HTMLSelectElement).value as StrokeDash })"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
          <button class="flowchart-delete" type="button" @click="removeSelected"><Trash2 :size="15" />删除连线</button>
        </template>
        <template v-else><div class="panel-label"><span>属性</span><small>未选择</small></div><div class="flowchart-inspector-empty"><MousePointer2 :size="24" aria-hidden="true" /><span>选择节点或连线后编辑样式</span></div><div v-if="validationItems.length" class="flowchart-validation"><strong>检查</strong><span v-for="item in validationItems" :key="item">{{ item }}</span></div></template>
      </aside>
    </div>
    <input ref="importInput" class="flowchart-import-input" aria-label="导入流程图文件" type="file" accept="application/json,.json" @change="importJson" />
  </section>
</template>
