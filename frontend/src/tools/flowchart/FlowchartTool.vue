<script setup lang="ts">
import type { Dnd as X6Dnd, Edge, Graph as X6Graph } from '@antv/x6'
import { AlignCenterHorizontal, AlignLeft, AlignRight, ArrowRight, BringToFront, ClipboardPaste, Copy, Download, FileJson, FileOutput, FileText, FolderOpen, GitBranch, Hand, Maximize2, MousePointer2, Redo2, Save, Scan, SendToBack, Shapes, Trash2, Undo2, Upload, ZoomIn, ZoomOut } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { downloadBlob } from '@/utils/download'
import { deleteFlowchart, loadFlowchartLibrary, saveFlowchart, type SavedFlowchart } from './flowchartLibrary'
import FlowShapePreview from './FlowShapePreview.vue'
import {
  createFlowchartTemplate,
  createFlowEdge,
  createId,
  createFlowNode,
  edgeStrokeOptions,
  flowchartTemplates,
  flowShapeDefinitions,
  nodeFillOptions,
  nodeStrokeOptions,
  normalizeFlowchartState,
  portIds,
  shapeDefinition,
  type EdgeMarker,
  type EdgeRoute,
  type FlowEdgeVertex,
  type FlowEdgeState,
  type FlowNodeState,
  type FlowShape,
  type FlowchartState,
  type FlowchartTemplateId,
  type StrokeDash,
  type TextAlign,
} from './flowchartModel'

type ToolMode = 'select' | 'connect' | 'pan'
type CanvasTouchIntent = 'pan' | 'place' | 'node' | 'edge' | 'line'
type RailPopover = 'shapes' | 'connectors' | null
type ExtensionDirection = 'left' | 'right' | 'top' | 'bottom'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const confirm = useConfirmStore()
const toast = useToastStore()
const canvasHost = ref<HTMLDivElement | null>(null)
const canvasViewport = ref<HTMLDivElement | null>(null)
const workbenchHost = ref<HTMLDivElement | null>(null)
const minimapHost = ref<HTMLDivElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const selectedNodeId = ref('')
const selectedEdgeId = ref('')
const selectedTemplate = ref<FlowchartTemplateId>('approval')
const activeMode = ref<ToolMode>('select')
const activeRailPopover = ref<RailPopover>(null)
const connectionRoute = ref<EdgeRoute>('orthogonal')
const connectionEndMarker = ref<EdgeMarker>('arrow')
const connectingSourceId = ref('')
const historyRevision = ref(0)
const savedFlowcharts = ref<SavedFlowchart[]>([])
const selectedSavedId = ref('')
const model = reactive<FlowchartState>(normalizeFlowchartState(props.state))
const fileManagerFileId = typeof props.state.__fileManagerFileId === 'string' ? props.state.__fileManagerFileId : ''
const touchPanningCanvas = ref(false)
const pendingPaletteShape = ref<FlowShape | null>(null)
const paletteTouchDragging = ref(false)
const canvasFullscreen = ref(false)
const bindingEndpoint = ref<'source' | 'target' | null>(null)
const extensionAnchors = ref<{ direction: ExtensionDirection; left: number; top: number }[]>([])
const extensionPreview = ref<{ left: number; top: number; width: number; height: number; shape: FlowShape } | null>(null)
const edgeEndpointAnchors = ref<{ terminal: 'source' | 'target'; left: number; top: number }[]>([])
const hoveredConnectionNodeId = ref('')
const hoveredConnectionPort = ref<{ nodeId: string; portId: string } | null>(null)

let graph: X6Graph | null = null
let dnd: X6Dnd | null = null
let disposed = false
let resizeObserver: ResizeObserver | null = null
let syncTimer = 0
let fitTimer = 0
let activeCanvasTouchId: number | null = null
let previousCanvasTouchX = 0
let previousCanvasTouchY = 0
let canvasTouchStartX = 0
let canvasTouchStartY = 0
let canvasTouchMoved = false
let canvasTouchIntent: CanvasTouchIntent = 'pan'
let canvasTouchCellId = ''
let canvasTouchNodeOriginX = 0
let canvasTouchNodeOriginY = 0
let canvasTouchStartLocalX = 0
let canvasTouchStartLocalY = 0
let pendingTouchPanX = 0
let pendingTouchPanY = 0
let paletteTouchShape: FlowShape | null = null
let paletteTouchId: number | null = null
let paletteTouchStartX = 0
let paletteTouchStartY = 0
let paletteTouchSource: HTMLElement | null = null
let paletteTouchTimer = 0
let paletteTouchGhost: HTMLDivElement | null = null
let freeLineId = ''
let freeLineStartClientX = 0
let freeLineStartClientY = 0
let canvasPointerId: number | null = null
let previousCanvasPointerX = 0
let previousCanvasPointerY = 0
let canvasPointerStartX = 0
let canvasPointerStartY = 0
let canvasPointerStartedWithPendingLine = false
let pendingClickLine: { previewId: string } | null = null
let endpointDrag: { pointerId: number; terminal: 'source' | 'target'; startX: number; startY: number; moved: boolean } | null = null
let preserveSelectionUntil = 0
let pendingDiagram: FlowchartState | null = null

const touchPanThreshold = 4
const paletteLongPressDelay = 360

const nodeById = computed(() => new Map(model.nodes.map((node) => [node.id, node])))
const edgeById = computed(() => new Map(model.edges.map((edge) => [edge.id, edge])))
const selectedNode = computed(() => nodeById.value.get(selectedNodeId.value) ?? null)
const selectedEdge = computed(() => edgeById.value.get(selectedEdgeId.value) ?? null)
const paletteItems = computed(() => flowShapeDefinitions)
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
  if (model.edges.some((edge) => !edge.label && nodeById.value.get(edge.source)?.shape === 'decision')) items.push('判断分支建议填写连线标签')
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

function routeAttrs(route: EdgeRoute, vertexCount = 0, hasPointTerminal = false): { router: { name: string; args?: Record<string, unknown> }; connector: { name: string } } {
  if (route === 'straight') return { router: { name: 'normal' }, connector: { name: 'normal' } }
  if (route === 'curve') return { router: { name: 'normal' }, connector: { name: 'smooth' } }
  if (vertexCount) return { router: { name: 'normal' }, connector: { name: 'normal' } }
  if (hasPointTerminal) return { router: { name: 'normal' }, connector: { name: 'normal' } }
  return { router: { name: 'manhattan', args: { padding: 14, step: 8, startDirections: ['right', 'bottom', 'top', 'left'], endDirections: ['left', 'top', 'bottom', 'right'], excludeTerminals: ['source', 'target'] } }, connector: { name: 'normal' } }
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

function orthogonalNodeVertices(source: FlowNodeState, target: FlowNodeState, sourcePort: string, targetPort: string): FlowEdgeVertex[] {
  const sourcePoint = {
    x: sourcePort === 'right' ? source.x + source.width : sourcePort === 'left' ? source.x : source.x + source.width / 2,
    y: sourcePort === 'bottom' ? source.y + source.height : sourcePort === 'top' ? source.y : source.y + source.height / 2,
  }
  const targetPoint = {
    x: targetPort === 'right' ? target.x + target.width : targetPort === 'left' ? target.x : target.x + target.width / 2,
    y: targetPort === 'bottom' ? target.y + target.height : targetPort === 'top' ? target.y : target.y + target.height / 2,
  }
  const horizontalSource = sourcePort === 'right' || sourcePort === 'left'
  const horizontalTarget = targetPort === 'right' || targetPort === 'left'
  const candidates: FlowEdgeVertex[][] = []
  if (horizontalSource && horizontalTarget) {
    if (sourcePoint.y === targetPoint.y) return []
    const middleX = Math.round((sourcePoint.x + targetPoint.x) / 2)
    candidates.push([{ x: middleX, y: sourcePoint.y }, { x: middleX, y: targetPoint.y }])
    candidates.push(
      [{ x: Math.min(source.x, target.x) - 32, y: sourcePoint.y }, { x: Math.min(source.x, target.x) - 32, y: targetPoint.y }],
      [{ x: Math.max(source.x + source.width, target.x + target.width) + 32, y: sourcePoint.y }, { x: Math.max(source.x + source.width, target.x + target.width) + 32, y: targetPoint.y }],
    )
  } else if (!horizontalSource && !horizontalTarget) {
    if (sourcePoint.x === targetPoint.x) return []
    const approachY = targetPort === 'top' ? targetPoint.y - 28 : targetPoint.y + 28
    candidates.push([{ x: sourcePoint.x, y: approachY }, { x: targetPoint.x, y: approachY }])
    candidates.push(
      [{ x: sourcePoint.x, y: Math.min(source.y, target.y) - 32 }, { x: targetPoint.x, y: Math.min(source.y, target.y) - 32 }],
      [{ x: sourcePoint.x, y: Math.max(source.y + source.height, target.y + target.height) + 32 }, { x: targetPoint.x, y: Math.max(source.y + source.height, target.y + target.height) + 32 }],
    )
  } else if (horizontalSource) {
    const middleX = Math.round(sourcePoint.x + (targetPoint.x - sourcePoint.x) * .35)
    const approachY = targetPort === 'top' ? targetPoint.y - 28 : targetPoint.y + 28
    candidates.push([{ x: middleX, y: sourcePoint.y }, { x: middleX, y: approachY }, { x: targetPoint.x, y: approachY }])
    candidates.push(
      [{ x: source.x + source.width + 32, y: sourcePoint.y }, { x: source.x + source.width + 32, y: approachY }, { x: targetPoint.x, y: approachY }],
      [{ x: source.x - 32, y: sourcePoint.y }, { x: source.x - 32, y: approachY }, { x: targetPoint.x, y: approachY }],
    )
  } else {
    const middleY = Math.round(sourcePoint.y + (targetPoint.y - sourcePoint.y) * .35)
    const approachX = targetPort === 'left' ? targetPoint.x - 28 : targetPoint.x + 28
    candidates.push([{ x: sourcePoint.x, y: middleY }, { x: approachX, y: middleY }, { x: approachX, y: targetPoint.y }])
    candidates.push(
      [{ x: sourcePoint.x, y: source.y - 32 }, { x: approachX, y: source.y - 32 }, { x: approachX, y: targetPoint.y }],
      [{ x: sourcePoint.x, y: source.y + source.height + 32 }, { x: approachX, y: source.y + source.height + 32 }, { x: approachX, y: targetPoint.y }],
    )
  }
  const others = model.nodes.filter((node) => node.id !== source.id && node.id !== target.id)
  const hitsNode = (from: FlowEdgeVertex, to: FlowEdgeVertex, node: FlowNodeState): boolean => {
    const padding = 12
    const left = node.x - padding
    const right = node.x + node.width + padding
    const top = node.y - padding
    const bottom = node.y + node.height + padding
    if (from.x === to.x) return from.x >= left && from.x <= right && Math.max(from.y, to.y) >= top && Math.min(from.y, to.y) <= bottom
    if (from.y === to.y) return from.y >= top && from.y <= bottom && Math.max(from.x, to.x) >= left && Math.min(from.x, to.x) <= right
    return false
  }
  const clearPath = (vertices: FlowEdgeVertex[]) => {
    const points = [sourcePoint, ...vertices, targetPoint]
    return others.every((node) => points.slice(0, -1).every((point, index) => {
      const next = points[index + 1]
      return next ? !hitsNode(point, next, node) : true
    }))
  }
  return candidates.find(clearPath) ?? candidates[0] ?? []
}

function resolvedEdgeVertices(edge: FlowEdgeState): FlowEdgeVertex[] {
  if (edge.manualVertices || edge.route !== 'orthogonal' || !edge.source || !edge.target) return edge.vertices
  const source = model.nodes.find((node) => node.id === edge.source)
  const target = model.nodes.find((node) => node.id === edge.target)
  return source && target ? orthogonalNodeVertices(source, target, edge.sourcePort, edge.targetPort) : edge.vertices
}

function refreshAutomaticOrthogonalRoutes(): void {
  if (!graph) return
  graph.getEdges().forEach((edge) => {
    const saved = edge.getData<{ flowEdge?: FlowEdgeState }>().flowEdge
    if (!saved || saved.manualVertices || saved.route !== 'orthogonal') return
    const source = snapshotNode(edge.getSourceCellId() || '')
    const target = snapshotNode(edge.getTargetCellId() || '')
    if (!source || !target) return
    const vertices = orthogonalNodeVertices(source, target, edge.getSourcePortId() || saved.sourcePort, edge.getTargetPortId() || saved.targetPort)
    edge.setData({ flowEdge: { ...saved, source: source.id, sourcePort: edge.getSourcePortId() || saved.sourcePort, target: target.id, targetPort: edge.getTargetPortId() || saved.targetPort, vertices, manualVertices: false } })
    edge.setVertices(vertices)
    const definition = routeAttrs('orthogonal', vertices.length, false)
    edge.setRouter(definition.router.name, definition.router.args)
    edge.setConnector(definition.connector.name)
  })
}

function graphEdge(edge: FlowEdgeState): Record<string, unknown> {
  const vertices = resolvedEdgeVertices(edge)
  const resolved = { ...edge, vertices }
  return {
    id: edge.id,
    source: edge.source ? { cell: edge.source, port: edge.sourcePort } : edge.sourcePoint ?? { x: 0, y: 0 },
    target: edge.target ? { cell: edge.target, port: edge.targetPort } : edge.targetPoint ?? { x: 0, y: 0 },
    vertices: vertices.map(({ x, y }) => ({ x, y })),
    data: { flowEdge: resolved },
    ...routeAttrs(edge.route, vertices.length, Boolean(edge.sourcePoint || edge.targetPoint)),
    attrs: { line: { stroke: edge.stroke, strokeWidth: edge.strokeWidth, strokeDasharray: dashArray(edge.dash), sourceMarker: marker(edge.sourceMarker), targetMarker: marker(edge.targetMarker) } },
    labels: edge.label ? [edge.label] : [],
  }
}

function draftEdge(): FlowEdgeState {
  return {
    id: '',
    source: '',
    sourcePort: 'right',
    sourcePoint: undefined,
    target: '',
    targetPort: 'left',
    targetPoint: undefined,
    vertices: [],
    manualVertices: false,
    route: connectionRoute.value,
    label: '',
    stroke: '#475569',
    strokeWidth: 1.5,
    dash: 'solid',
    sourceMarker: 'none',
    targetMarker: connectionEndMarker.value,
  }
}

function isFloatingEdge(edge: Pick<FlowEdgeState, 'sourcePoint' | 'targetPoint'>): boolean {
  return Boolean(edge.sourcePoint || edge.targetPoint)
}

function freeLineVertices(route: EdgeRoute, source: FlowEdgeVertex, target: FlowEdgeVertex): FlowEdgeVertex[] {
  if (route !== 'orthogonal' || source.x === target.x || source.y === target.y) return []
  return [{ x: target.x, y: source.y }]
}

function orthogonalPointVertices(sourcePoint: FlowEdgeVertex, targetPoint: FlowEdgeVertex, sourcePort: string, targetPort: string): FlowEdgeVertex[] {
  const horizontalSource = sourcePort === 'right' || sourcePort === 'left'
  const horizontalTarget = targetPort === 'right' || targetPort === 'left'
  if (horizontalSource && horizontalTarget) {
    if (sourcePoint.y === targetPoint.y) return []
    const middleX = Math.round((sourcePoint.x + targetPoint.x) / 2)
    return [{ x: middleX, y: sourcePoint.y }, { x: middleX, y: targetPoint.y }]
  }
  if (!horizontalSource && !horizontalTarget) {
    if (sourcePoint.x === targetPoint.x) return []
    const middleY = Math.round((sourcePoint.y + targetPoint.y) / 2)
    return [{ x: sourcePoint.x, y: middleY }, { x: targetPoint.x, y: middleY }]
  }
  if (horizontalSource) {
    const middleX = Math.round(sourcePoint.x + (targetPoint.x - sourcePoint.x) * .35)
    const approachY = targetPort === 'top' ? targetPoint.y - 28 : targetPoint.y + 28
    return [{ x: middleX, y: sourcePoint.y }, { x: middleX, y: approachY }, { x: targetPoint.x, y: approachY }]
  }
  const middleY = Math.round(sourcePoint.y + (targetPoint.y - sourcePoint.y) * .35)
  const approachX = targetPort === 'left' ? targetPoint.x - 28 : targetPoint.x + 28
  return [{ x: sourcePoint.x, y: middleY }, { x: approachX, y: middleY }, { x: approachX, y: targetPoint.y }]
}

function createFreeLine(source: FlowEdgeVertex, target: FlowEdgeVertex, route = connectionRoute.value): FlowEdgeState {
  const edge = {
    ...draftEdge(),
    route,
    id: createId('edge'),
    source: '',
    sourcePort: '',
    sourcePoint: { ...source },
    target: '',
    targetPort: '',
    targetPoint: { ...target },
  }
  return { ...edge, vertices: freeLineVertices(edge.route, source, target) }
}

function beginFreeLine(clientX: number, clientY: number): void {
  if (!graph) return
  const point = graph.clientToLocal(clientX, clientY)
  const start = { x: Math.round(point.x), y: Math.round(point.y) }
  const preview = createFreeLine(start, start)
  const previewCell = graph.addEdge(graphEdge(preview))
  previewCell.setData({ flowEdge: { ...preview, isPreview: true } })
  freeLineId = preview.id
  freeLineStartClientX = clientX
  freeLineStartClientY = clientY
}

function updateFreeLine(clientX: number, clientY: number): void {
  if (!graph || !freeLineId) return
  const edge = graph.getCellById(freeLineId)
  if (!edge?.isEdge()) return
  const saved = edge.getData<{ flowEdge?: FlowEdgeState }>().flowEdge
  const source = saved?.sourcePoint
  if (!saved || !source) return
  const local = graph.clientToLocal(clientX, clientY)
  const target = { x: Math.round(local.x), y: Math.round(local.y) }
  const next = { ...saved, targetPoint: target, vertices: freeLineVertices(saved.route, source, target) }
  const route = routeAttrs(next.route, next.vertices.length, true)
  edge.setData({ flowEdge: next })
  edge.setTarget(target)
  edge.setVertices(next.vertices)
  edge.setRouter(route.router.name, route.router.args)
  edge.setConnector(route.connector.name)
}

function finishFreeLine(clientX: number, clientY: number, cancelled = false): void {
  if (!graph || !freeLineId) return
  const id = freeLineId
  const edge = graph.getCellById(id)
  freeLineId = ''
  if (!edge?.isEdge()) return
  if (cancelled || Math.hypot(clientX - freeLineStartClientX, clientY - freeLineStartClientY) < 10) {
    graph.removeCells([edge])
    return
  }
  updateFreeLine(clientX, clientY)
  const current = edge.getData<{ flowEdge?: FlowEdgeState & { isPreview?: boolean } }>().flowEdge
  if (!current) return
  const target = nodePortAt(clientX, clientY, true)
  const next = target
    ? { ...current, target: target.nodeId, targetPort: target.portId, targetPoint: undefined, isPreview: false }
    : { ...current, isPreview: false }
  const route = routeAttrs(next.route, next.vertices.length, isFloatingEdge(next))
  edge.setData({ flowEdge: next })
  if (target) edge.setTarget({ cell: target.nodeId, port: target.portId })
  edge.setRouter(route.router.name, route.router.args)
  edge.setConnector(route.connector.name)
  syncFromGraph()
  selectEdge(edge.id)
  preserveCurrentSelection()
  setToolMode('select')
  scheduleSync()
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
  if (edge.getData<{ flowEdge?: { isPreview?: boolean } }>().flowEdge?.isPreview) return null
  const source = edge.getSourceCellId() || ''
  const target = edge.getTargetCellId() || ''
  const sourcePoint = source ? undefined : edge.getSourcePoint()
  const targetPoint = target ? undefined : edge.getTargetPoint()
  if ((!source && !sourcePoint) || (!target && !targetPoint)) return null
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
    sourcePort: source ? edge.getSourcePortId() || 'right' : '',
    sourcePoint: sourcePoint ? { x: Math.round(sourcePoint.x), y: Math.round(sourcePoint.y) } : undefined,
    target,
    targetPort: target ? edge.getTargetPortId() || 'left' : '',
    targetPoint: targetPoint ? { x: Math.round(targetPoint.x), y: Math.round(targetPoint.y) } : undefined,
    vertices: [],
    manualVertices: false,
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
    sourcePort: source ? edge.getSourcePortId() || 'right' : '',
    sourcePoint: sourcePoint ? { x: Math.round(sourcePoint.x), y: Math.round(sourcePoint.y) } : undefined,
    target,
    targetPort: target ? edge.getTargetPortId() || 'left' : '',
    targetPoint: targetPoint ? { x: Math.round(targetPoint.x), y: Math.round(targetPoint.y) } : undefined,
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
  refreshAutomaticOrthogonalRoutes()
  model.nodes = graph.getNodes().map((node) => snapshotNode(node.id)).filter((node): node is FlowNodeState => Boolean(node))
  model.edges = graph.getEdges().map((edge) => snapshotEdge(edge.id)).filter((edge): edge is FlowEdgeState => Boolean(edge))
  if (!model.nodes.some((node) => node.id === selectedNodeId.value)) selectedNodeId.value = ''
  if (!model.edges.some((edge) => edge.id === selectedEdgeId.value)) selectedEdgeId.value = ''
  historyRevision.value += 1
}

function clearSelection(): void {
  if (Date.now() < preserveSelectionUntil) return
  graph?.getEdges().forEach((edge) => edge.removeTools())
  graph?.cleanSelection()
  selectedNodeId.value = ''
  selectedEdgeId.value = ''
  bindingEndpoint.value = null
  extensionAnchors.value = []
  edgeEndpointAnchors.value = []
  clearHoveredConnectionNode()
  clearHoveredConnectionPort()
  clearExtensionPreview()
}

function preserveCurrentSelection(): void {
  // X6 emits a blank click after the pointerup that completes a line. Keep the
  // new line selected so this trailing event cannot immediately clear its tools.
  preserveSelectionUntil = Date.now() + 240
}

function selectNode(id: string, additive = false): void {
  const node = graph?.getCellById(id)
  if (!node?.isNode()) return
  graph?.getEdges().forEach((edge) => edge.removeTools())
  if (additive) graph?.select(node)
  else graph?.resetSelection(node)
  selectedNodeId.value = id
  selectedEdgeId.value = ''
  bindingEndpoint.value = null
  edgeEndpointAnchors.value = []
  requestAnimationFrame(updateExtensionControl)
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
  const saved = edge.getData<{ flowEdge?: Partial<FlowEdgeState> }>().flowEdge
  const route = saved?.route
  if (route !== 'orthogonal') return
  edge.setData({ flowEdge: { ...saved, vertices: edge.getVertices().map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) })), manualVertices: true } })
  const definition = routeAttrs(route, edge.getVertices().length, Boolean(saved?.sourcePoint || saved?.targetPoint))
  edge.setRouter(definition.router.name, definition.router.args)
  edge.setConnector(definition.connector.name)
}

function selectEdge(id: string): void {
  const edge = graph?.getCellById(id)
  if (!edge?.isEdge()) return
  const isCurrentEdge = selectedEdgeId.value === id
  graph?.getEdges().forEach((entry) => entry.removeTools())
  graph?.resetSelection(edge)
  const selected = edge.getData<{ flowEdge?: FlowEdgeState }>().flowEdge
  if (selected?.route === 'orthogonal') {
    edge.addTools([
      { name: 'segments', args: { precision: 1, threshold: 12, attrs: { width: 16, height: 16, x: -8, y: -8, rx: 8, ry: 8, fill: 'var(--tool-accent)', stroke: 'var(--surface-raised)', 'stroke-width': 3 }, onChanged: ({ edge: changedEdge }: { edge: Edge }) => lockManualOrthogonalRoute(changedEdge) } },
    ])
  }
  selectedNodeId.value = ''
  selectedEdgeId.value = id
  extensionAnchors.value = []
  clearExtensionPreview()
  if (!isCurrentEdge) bindingEndpoint.value = null
  requestAnimationFrame(updateEdgeEndpointControls)
}

function portIdFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const port = target.closest<SVGElement>('[magnet="true"]')
  return port?.getAttribute('port') ?? port?.closest<SVGElement>('[port]')?.getAttribute('port') ?? null
}

function bindSelectedEndpoint(nodeId: string, portId: string): void {
  const endpoint = bindingEndpoint.value
  const current = selectedEdge.value
  const edge = current ? graph?.getCellById(current.id) : null
  if (!endpoint || !current || !edge?.isEdge()) return
  const next = endpoint === 'source'
    ? { ...current, source: nodeId, sourcePort: portId, sourcePoint: undefined }
    : { ...current, target: nodeId, targetPort: portId, targetPoint: undefined }
  const sourceNode = model.nodes.find((node) => node.id === next.source)
  const targetNode = model.nodes.find((node) => node.id === next.target)
  const normalized = sourceNode && targetNode && next.route === 'orthogonal'
    ? { ...next, vertices: orthogonalNodeVertices(sourceNode, targetNode, next.sourcePort, next.targetPort), manualVertices: false }
    : { ...next, manualVertices: false }
  const route = routeAttrs(normalized.route, normalized.vertices.length, isFloatingEdge(normalized))
  edge.setData({ flowEdge: normalized })
  if (endpoint === 'source') edge.setSource({ cell: nodeId, port: portId })
  else edge.setTarget({ cell: nodeId, port: portId })
  edge.setVertices(normalized.vertices)
  edge.setRouter(route.router.name, route.router.args)
  edge.setConnector(route.connector.name)
  bindingEndpoint.value = null
  clearHoveredConnectionPort()
  syncFromGraph()
  selectEdge(edge.id)
  requestAnimationFrame(updateEdgeEndpointControls)
  scheduleSync()
}

function updateEdgeEndpointControls(): void {
  const host = canvasViewport.value
  const current = selectedEdge.value
  const edge = current ? graph?.getCellById(current.id) : null
  if (!host || !edge?.isEdge() || selectedNode.value) {
    edgeEndpointAnchors.value = []
    return
  }
  const hostRect = host.getBoundingClientRect()
  const source = graph!.localToClient(edge.getSourcePoint())
  const target = graph!.localToClient(edge.getTargetPoint())
  edgeEndpointAnchors.value = [
    { terminal: 'source', left: source.x - hostRect.left, top: source.y - hostRect.top },
    { terminal: 'target', left: target.x - hostRect.left, top: target.y - hostRect.top },
  ]
}

function moveSelectedEndpoint(terminal: 'source' | 'target', clientX: number, clientY: number): void {
  const current = selectedEdge.value
  const edge = current ? graph?.getCellById(current.id) : null
  if (!graph || !current || !edge?.isEdge()) return
  const snap = nodePortAt(clientX, clientY)
  const snapped = snap ? graphPortPoint(snap.nodeId, snap.portId) : null
  const local = snapped ?? graph.clientToLocal(clientX, clientY)
  const point = { x: Math.round(local.x), y: Math.round(local.y) }
  let next = terminal === 'source'
    ? { ...current, source: '', sourcePort: '', sourcePoint: point, manualVertices: false }
    : { ...current, target: '', targetPort: '', targetPoint: point, manualVertices: false }
  if (next.route === 'orthogonal') {
    const snappedNode = snap ? snapshotNode(snap.nodeId) : null
    const fixedSource = current.source ? snapshotNode(current.source) : null
    const fixedTarget = current.target ? snapshotNode(current.target) : null
    if (terminal === 'source' && snappedNode && fixedTarget) {
      next = { ...next, vertices: orthogonalNodeVertices(snappedNode, fixedTarget, snap!.portId, current.targetPort) }
    } else if (terminal === 'target' && fixedSource && snappedNode) {
      next = { ...next, vertices: orthogonalNodeVertices(fixedSource, snappedNode, current.sourcePort, snap!.portId) }
    } else if (next.sourcePoint && next.targetPoint) {
      next = { ...next, vertices: freeLineVertices(next.route, next.sourcePoint, next.targetPoint) }
    } else if (terminal === 'source' && current.target) {
      next = { ...next, vertices: orthogonalPointVertices(point, edge.getTargetPoint(), snap?.portId ?? current.sourcePort, current.targetPort) }
    } else if (terminal === 'target' && current.source) {
      next = { ...next, vertices: orthogonalPointVertices(edge.getSourcePoint(), point, current.sourcePort, snap?.portId ?? current.targetPort) }
    }
  }
  const route = routeAttrs(next.route, next.vertices.length, isFloatingEdge(next))
  edge.setData({ flowEdge: next })
  if (terminal === 'source') edge.setSource(point)
  else edge.setTarget(point)
  edge.setVertices(next.vertices)
  edge.setRouter(route.router.name, route.router.args)
  edge.setConnector(route.connector.name)
  requestAnimationFrame(updateEdgeEndpointControls)
}

function beginEndpointDrag(terminal: 'source' | 'target', event: PointerEvent): void {
  if (event.pointerType === 'touch' || event.button !== 0 || endpointDrag) return
  const host = event.currentTarget as HTMLElement
  endpointDrag = { pointerId: event.pointerId, terminal, startX: event.clientX, startY: event.clientY, moved: false }
  bindingEndpoint.value = terminal
  host.setPointerCapture(event.pointerId)
  event.preventDefault()
  event.stopPropagation()
}

function moveEndpointDrag(event: PointerEvent): void {
  if (!endpointDrag || endpointDrag.pointerId !== event.pointerId) return
  if (!endpointDrag.moved) {
    endpointDrag.moved = Math.hypot(event.clientX - endpointDrag.startX, event.clientY - endpointDrag.startY) >= 4
  }
  if (!endpointDrag.moved) return
  moveSelectedEndpoint(endpointDrag.terminal, event.clientX, event.clientY)
  event.preventDefault()
  event.stopPropagation()
}

function finishEndpointDrag(event: PointerEvent): void {
  if (!endpointDrag || endpointDrag.pointerId !== event.pointerId) return
  const host = event.currentTarget as HTMLElement
  if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)
  const { terminal, moved } = endpointDrag
  endpointDrag = null
  if (!moved && event.type !== 'pointercancel') {
    // A short click arms this endpoint. The next click fixes it to a port or
    // blank position, matching the two-click line placement interaction.
    bindingEndpoint.value = terminal
    event.preventDefault()
    event.stopPropagation()
    return
  }
  host.style.pointerEvents = 'none'
  const target = event.type === 'pointercancel' ? null : nodePortAt(event.clientX, event.clientY, true)
  host.style.pointerEvents = ''
  if (target) {
    bindingEndpoint.value = terminal
    bindSelectedEndpoint(target.nodeId, target.portId)
  } else {
    bindingEndpoint.value = null
    syncFromGraph()
    const edgeId = selectedEdgeId.value
    if (edgeId) selectEdge(edgeId)
    scheduleSync()
  }
  event.preventDefault()
  event.stopPropagation()
}

function graphPortPoint(nodeId: string, portId: string): FlowEdgeVertex | null {
  const node = graph?.getCellById(nodeId)
  if (!node?.isNode()) return null
  const bounds = node.getBBox()
  if (portId === 'top') return { x: bounds.x + bounds.width / 2, y: bounds.y }
  if (portId === 'right') return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }
  if (portId === 'bottom') return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }
  return { x: bounds.x, y: bounds.y + bounds.height / 2 }
}

function nodePortAt(clientX: number, clientY: number, allowBody = false): { nodeId: string; portId: string } | null {
  const target = document.elementFromPoint(clientX, clientY)
  const portId = portIdFromTarget(target)
  const nodeId = target instanceof Element ? target.closest('.x6-node')?.getAttribute('data-cell-id') : null
  const cell = nodeId ? graph?.getCellById(nodeId) : null
  if (portId && cell?.isNode()) return { nodeId: cell.id, portId }

  // Hidden SVG ports and the custom endpoint controls can make elementFromPoint
  // return the node wrapper instead of the port. Resolve a nearby visual port by
  // its rendered center so dropping onto a port is independent of DOM hit order.
  if (!graph) return null
  const local = graph.clientToLocal(clientX, clientY)
  const candidates: { nodeId: string; portId: string; x: number; y: number }[] = []
  graph.getNodes().forEach((node) => {
    const bounds = node.getBBox()
    candidates.push(
      { nodeId: node.id, portId: 'top', x: bounds.x + bounds.width / 2, y: bounds.y },
      { nodeId: node.id, portId: 'right', x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
      { nodeId: node.id, portId: 'bottom', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
      { nodeId: node.id, portId: 'left', x: bounds.x, y: bounds.y + bounds.height / 2 },
    )
  })
  const nearest = candidates
    .map((candidate) => ({ ...candidate, distance: Math.hypot(local.x - candidate.x, local.y - candidate.y) }))
    .sort((left, right) => left.distance - right.distance)[0]
  if (nearest && nearest.distance <= 24) return { nodeId: nearest.nodeId, portId: nearest.portId }
  if (allowBody) {
    const node = graph.getNodes().find((entry) => entry.getBBox().containsPoint(local))
    if (node) {
      const bounds = node.getBBox()
      const distances = [
        { portId: 'top', distance: Math.abs(local.y - bounds.y) },
        { portId: 'right', distance: Math.abs(local.x - (bounds.x + bounds.width)) },
        { portId: 'bottom', distance: Math.abs(local.y - (bounds.y + bounds.height)) },
        { portId: 'left', distance: Math.abs(local.x - bounds.x) },
      ]
      const nearestDistance = distances.sort((left, right) => left.distance - right.distance)[0]
      return nearestDistance ? { nodeId: node.id, portId: nearestDistance.portId } : null
    }
  }
  return null
}

function beginClickLine(clientX: number, clientY: number, source?: { nodeId: string; portId: string }): void {
  if (!graph) return
  const local = graph.clientToLocal(clientX, clientY)
  const point = { x: Math.round(local.x), y: Math.round(local.y) }
  const preview: FlowEdgeState = source
    ? {
        ...draftEdge(),
        id: createId('edge'),
        source: source.nodeId,
        sourcePort: source.portId,
        sourcePoint: undefined,
        target: '',
        targetPort: '',
        targetPoint: point,
        route: connectionRoute.value,
        targetMarker: connectionEndMarker.value,
      }
    : createFreeLine(point, point, connectionRoute.value)
  const previewCell = graph.addEdge(graphEdge(preview))
  previewCell.setData({ flowEdge: { ...preview, isPreview: true } })
  pendingClickLine = { previewId: preview.id }
  activeRailPopover.value = null
}

function updateClickLine(clientX: number, clientY: number): void {
  if (!graph || !pendingClickLine) return
  const edge = graph.getCellById(pendingClickLine.previewId)
  if (!edge?.isEdge()) {
    pendingClickLine = null
    return
  }
  const saved = edge.getData<{ flowEdge?: FlowEdgeState & { isPreview?: boolean } }>().flowEdge
  if (!saved) return
  const local = graph.clientToLocal(clientX, clientY)
  const targetPort = nodePortAt(clientX, clientY)
  const targetPoint = targetPort ? graphPortPoint(targetPort.nodeId, targetPort.portId) ?? { x: Math.round(local.x), y: Math.round(local.y) } : { x: Math.round(local.x), y: Math.round(local.y) }
  const sourcePoint = saved.sourcePoint ?? edge.getSourcePoint()
  const sourceNode = saved.source ? snapshotNode(saved.source) : null
  const targetNode = targetPort ? snapshotNode(targetPort.nodeId) : null
  const vertices = saved.route === 'orthogonal' && sourceNode && targetNode && targetPort
    ? orthogonalNodeVertices(sourceNode, targetNode, saved.sourcePort, targetPort.portId)
    : sourcePoint ? orthogonalPointVertices(sourcePoint, targetPoint, saved.sourcePort || 'right', targetPort?.portId || 'left') : []
  const next = { ...saved, target: '', targetPort: '', targetPoint, vertices, isPreview: true }
  const route = routeAttrs(next.route, next.vertices.length, isFloatingEdge(next))
  edge.setData({ flowEdge: next })
  edge.setTarget(targetPoint)
  edge.setVertices(next.vertices)
  edge.setRouter(route.router.name, route.router.args)
  edge.setConnector(route.connector.name)
}

function cancelClickLine(): void {
  if (!graph || !pendingClickLine) return
  const edge = graph.getCellById(pendingClickLine.previewId)
  if (edge?.isEdge()) graph.removeCells([edge])
  pendingClickLine = null
}

function finishClickLine(clientX: number, clientY: number, cancelled = false): void {
  if (!graph || !pendingClickLine) return
  const edge = graph.getCellById(pendingClickLine.previewId)
  if (!edge?.isEdge()) {
    pendingClickLine = null
    return
  }
  if (cancelled) {
    pendingClickLine = null
    graph.removeCells([edge])
    return
  }
  updateClickLine(clientX, clientY)
  const current = edge.getData<{ flowEdge?: FlowEdgeState & { isPreview?: boolean } }>().flowEdge
  pendingClickLine = null
  if (!current) return
  const target = nodePortAt(clientX, clientY, true)
  if (target && current.source === target.nodeId) {
    graph.removeCells([edge])
    return
  }
  const next = target
    ? (() => {
        const sourceNode = model.nodes.find((node) => node.id === current.source)
        const targetNode = model.nodes.find((node) => node.id === target.nodeId)
        return sourceNode && targetNode && current.route === 'orthogonal'
          ? { ...current, target: target.nodeId, targetPort: target.portId, targetPoint: undefined, vertices: orthogonalNodeVertices(sourceNode, targetNode, current.sourcePort, target.portId), manualVertices: false, isPreview: false }
          : { ...current, target: target.nodeId, targetPort: target.portId, targetPoint: undefined, manualVertices: false, isPreview: false }
      })()
    : { ...current, isPreview: false }
  const route = routeAttrs(next.route, next.vertices.length, isFloatingEdge(next))
  edge.setData({ flowEdge: next })
  if (target) edge.setTarget({ cell: target.nodeId, port: target.portId })
  edge.setRouter(route.router.name, route.router.args)
  edge.setConnector(route.connector.name)
  syncFromGraph()
  selectEdge(edge.id)
  preserveCurrentSelection()
  setToolMode('select')
  scheduleSync()
}

function clearHoveredConnectionNode(): void {
  if (!hoveredConnectionNodeId.value) return
  graph?.findViewByCell(hoveredConnectionNodeId.value)?.container.classList.remove('flowchart-connection-target')
  hoveredConnectionNodeId.value = ''
}

function clearHoveredConnectionPort(): void {
  const current = hoveredConnectionPort.value
  if (current) graph?.findViewByCell(current.nodeId)?.container.querySelector(`[port="${current.portId}"]`)?.classList.remove('flowchart-connection-port-target')
  hoveredConnectionPort.value = null
}

function showHoveredConnectionPort(target: { nodeId: string; portId: string } | null): void {
  const current = hoveredConnectionPort.value
  if (current?.nodeId === target?.nodeId && current?.portId === target?.portId) return
  clearHoveredConnectionPort()
  if (!target) return
  graph?.findViewByCell(target.nodeId)?.container.querySelector(`[port="${target.portId}"]`)?.classList.add('flowchart-connection-port-target')
  hoveredConnectionPort.value = target
}

function showHoveredConnectionNode(id: string): void {
  if (!(activeMode.value === 'connect' || activeRailPopover.value === 'connectors' || selectedEdge.value || bindingEndpoint.value)) return
  if (hoveredConnectionNodeId.value === id) return
  clearHoveredConnectionNode()
  graph?.findViewByCell(id)?.container.classList.add('flowchart-connection-target')
  hoveredConnectionNodeId.value = id
}

function updateConnectionHover(clientX: number, clientY: number): void {
  if (!(activeMode.value === 'connect' || pendingClickLine || bindingEndpoint.value)) {
    clearHoveredConnectionNode()
    clearHoveredConnectionPort()
    return
  }
  showHoveredConnectionPort(nodePortAt(clientX, clientY))
  const nodeElement = document.elementsFromPoint(clientX, clientY)
    .map((element) => element.closest('.x6-node'))
    .find((element): element is Element => Boolean(element))
  const directId = nodeElement?.getAttribute('data-cell-id') ?? null
  const directCell = directId ? graph?.getCellById(directId) : null
  if (directCell?.isNode()) {
    showHoveredConnectionNode(directCell.id)
    return
  }
  if (!graph) return
  const renderedElement = Array.from(canvasHost.value?.querySelectorAll<HTMLElement>('.x6-node') ?? [])
    .find((element) => {
      const rect = element.getBoundingClientRect()
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    })
  const renderedId = renderedElement?.getAttribute('data-cell-id') ?? ''
  const renderedCell = renderedId ? graph.getCellById(renderedId) : null
  if (renderedCell?.isNode()) {
    showHoveredConnectionNode(renderedCell.id)
    return
  }
  const local = graph.clientToLocal(clientX, clientY)
  const node = graph.getNodes().find((entry) => entry.getBBox().containsPoint(local))
  if (node) showHoveredConnectionNode(node.id)
  else clearHoveredConnectionNode()
}

function extensionPorts(direction: ExtensionDirection): { sourcePort: string; targetPort: string } {
  if (direction === 'left') return { sourcePort: 'left', targetPort: 'right' }
  if (direction === 'top') return { sourcePort: 'top', targetPort: 'bottom' }
  if (direction === 'bottom') return { sourcePort: 'bottom', targetPort: 'top' }
  return { sourcePort: 'right', targetPort: 'left' }
}

function extensionDirectionAvailable(source: FlowNodeState, direction: ExtensionDirection): boolean {
  if (nearbyExtensionTarget(source, direction)) return false
  const ports = extensionPorts(direction)
  return !model.edges.some((edge) => {
    const sourceSide = edge.source === source.id && edge.sourcePort === ports.sourcePort
    const targetSide = edge.target === source.id && edge.targetPort === ports.sourcePort
    return sourceSide || targetSide
  })
}

function nearbyExtensionTarget(source: FlowNodeState, direction: ExtensionDirection): FlowNodeState | null {
  const sourceCenterX = source.x + source.width / 2
  const sourceCenterY = source.y + source.height / 2
  const candidates = model.nodes.filter((node) => {
    if (node.id === source.id) return false
    const centerX = node.x + node.width / 2
    const centerY = node.y + node.height / 2
    const lateralGap = Math.abs((direction === 'left' || direction === 'right' ? centerY - sourceCenterY : centerX - sourceCenterX))
    const maximumLateralGap = Math.max(source.width, source.height, node.width, node.height) * .7
    if (lateralGap > maximumLateralGap) return false
    if (direction === 'left') return node.x + node.width <= source.x + 24
    if (direction === 'right') return node.x >= source.x + source.width - 24
    if (direction === 'top') return node.y + node.height <= source.y + 24
    return node.y >= source.y + source.height - 24
  })
  return candidates.sort((left, right) => {
    const leftDistance = Math.abs((direction === 'left' || direction === 'right' ? left.x + left.width / 2 - sourceCenterX : left.y + left.height / 2 - sourceCenterY))
    const rightDistance = Math.abs((direction === 'left' || direction === 'right' ? right.x + right.width / 2 - sourceCenterX : right.y + right.height / 2 - sourceCenterY))
    return leftDistance - rightDistance
  })[0] ?? null
}

function clearExtensionPreview(): void {
  graph?.getNodes().forEach((node) => graph?.findViewByCell(node)?.container.classList.remove('flowchart-extension-target'))
  extensionPreview.value = null
}

function showExtensionPreview(direction: ExtensionDirection): void {
  const source = selectedNode.value
  const host = canvasViewport.value
  const view = graph && source ? graph.findViewByCell(source.id) : null
  if (!source || !host || !view?.container) return
  clearExtensionPreview()
  if (!extensionDirectionAvailable(source, direction)) return
  const hostRect = host.getBoundingClientRect()
  const rect = (view.container as SVGElement).getBoundingClientRect()
  const gap = 90
  const width = rect.width
  const height = rect.height
  const left = direction === 'left' ? rect.left - hostRect.left - width - gap : direction === 'right' ? rect.right - hostRect.left + gap : rect.left - hostRect.left
  const top = direction === 'top' ? rect.top - hostRect.top - height - gap : direction === 'bottom' ? rect.bottom - hostRect.top + gap : rect.top - hostRect.top
  extensionPreview.value = { left, top, width, height, shape: source.shape }
}

function extendFromNode(id: string, direction: ExtensionDirection = 'right'): void {
  if (!graph) return
  const source = model.nodes.find((node) => node.id === id) ?? snapshotNode(id)
  if (!source) return
  if (!extensionDirectionAvailable(source, direction)) return
  clearExtensionPreview()
  const ports = extensionPorts(direction)
  const spacing = 120
  let x = direction === 'left' ? source.x - source.width - spacing : direction === 'right' ? source.x + source.width + spacing : source.x
  let y = direction === 'top' ? source.y - source.height - spacing : direction === 'bottom' ? source.y + source.height + spacing : source.y
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const overlaps = model.nodes.some((node) => node.id !== source.id && x < node.x + node.width + 24 && x + source.width + 24 > node.x && y < node.y + node.height + 24 && y + source.height + 24 > node.y)
    if (!overlaps) break
    if (direction === 'left') x -= source.width + spacing
    else if (direction === 'right') x += source.width + spacing
    else if (direction === 'top') y -= source.height + spacing
    else y += source.height + spacing
  }
  const next = createFlowNode(source.shape, x, y)
  const edge = createFlowEdge(source, next, { ...ports, vertices: source && next && connectionRoute.value === 'orthogonal' ? orthogonalNodeVertices(source, next, ports.sourcePort, ports.targetPort) : [] })
  graph.batchUpdate(() => {
    graph?.addNode(graphNode(next))
    graph?.addEdge(graphEdge(edge))
  })
  syncFromGraph()
  selectNode(next.id)
  scheduleSync()
}

function updateExtensionControl(): void {
  const host = canvasViewport.value
  const id = selectedNodeId.value
  const view = graph && id ? graph.findViewByCell(id) : null
  if (!host || !view?.container) {
    extensionAnchors.value = []
    return
  }
  const hostRect = host.getBoundingClientRect()
  const nodeRect = (view.container as SVGElement).getBoundingClientRect()
  const clamp = (value: number, maximum: number) => Math.max(20, Math.min(maximum - 20, value))
  const source = model.nodes.find((node) => node.id === id) ?? snapshotNode(id)
  if (!source) {
    extensionAnchors.value = []
    return
  }
  const directions: ExtensionDirection[] = ['left', 'right', 'top', 'bottom']
  const available = directions.filter((direction) => extensionDirectionAvailable(source, direction))
  const anchors: { direction: ExtensionDirection; left: number; top: number }[] = [
    { direction: 'left', left: clamp(nodeRect.left - hostRect.left - 16, host.clientWidth), top: clamp(nodeRect.top - hostRect.top + nodeRect.height / 2, host.clientHeight) },
    { direction: 'right', left: clamp(nodeRect.right - hostRect.left + 16, host.clientWidth), top: clamp(nodeRect.top - hostRect.top + nodeRect.height / 2, host.clientHeight) },
    { direction: 'top', left: clamp(nodeRect.left - hostRect.left + nodeRect.width / 2, host.clientWidth), top: clamp(nodeRect.top - hostRect.top - 16, host.clientHeight) },
    { direction: 'bottom', left: clamp(nodeRect.left - hostRect.left + nodeRect.width / 2, host.clientWidth), top: clamp(nodeRect.bottom - hostRect.top + 16, host.clientHeight) },
  ]
  extensionAnchors.value = anchors.filter(({ direction }) => available.includes(direction))
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
  let next = { ...current, ...patch }
  if (next.sourcePoint && next.targetPoint) {
    next = { ...next, vertices: freeLineVertices(next.route, next.sourcePoint, next.targetPoint) }
  }
  const route = routeAttrs(next.route, next.vertices.length, isFloatingEdge(next))
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

function clearPaletteTouch(): void {
  window.clearTimeout(paletteTouchTimer)
  paletteTouchTimer = 0
  paletteTouchShape = null
  paletteTouchId = null
  paletteTouchSource = null
  paletteTouchDragging.value = false
  paletteTouchGhost?.remove()
  paletteTouchGhost = null
}

function movePaletteTouchGhost(clientX: number, clientY: number): void {
  if (!paletteTouchGhost) return
  paletteTouchGhost.style.transform = `translate(${Math.round(clientX)}px, ${Math.round(clientY)}px) translate(-50%, -50%)`
}

function beginPaletteTouchDrag(): void {
  const shape = paletteTouchShape
  const source = paletteTouchSource
  if (!shape || !source) return
  pendingPaletteShape.value = null
  paletteTouchDragging.value = true
  const ghost = document.createElement('div')
  ghost.className = 'flowchart-palette-drag-ghost'
  ghost.setAttribute('aria-hidden', 'true')
  const preview = source.querySelector('.flowchart-shape-preview')?.cloneNode(true)
  if (preview) ghost.append(preview)
  else ghost.textContent = shapeDefinition(shape).label
  document.body.append(ghost)
  paletteTouchGhost = ghost
  movePaletteTouchGhost(paletteTouchStartX, paletteTouchStartY)
}

function startPaletteTouch(shape: FlowShape, event: TouchEvent): void {
  if (event.touches.length !== 1) return
  const touch = event.changedTouches[0]
  if (!touch) return
  clearPaletteTouch()
  paletteTouchShape = shape
  paletteTouchId = touch.identifier
  paletteTouchStartX = touch.clientX
  paletteTouchStartY = touch.clientY
  paletteTouchSource = event.currentTarget as HTMLElement
  paletteTouchTimer = window.setTimeout(beginPaletteTouchDrag, paletteLongPressDelay)
}

function movePaletteTouch(event: TouchEvent): void {
  if (paletteTouchId === null) return
  const touch = touchWithId(event.touches, paletteTouchId)
  if (!touch) return
  if (!paletteTouchDragging.value) {
    if (Math.hypot(touch.clientX - paletteTouchStartX, touch.clientY - paletteTouchStartY) >= touchPanThreshold) {
      window.clearTimeout(paletteTouchTimer)
      paletteTouchTimer = 0
      paletteTouchShape = null
    }
    return
  }
  movePaletteTouchGhost(touch.clientX, touch.clientY)
  event.preventDefault()
  event.stopPropagation()
}

function isCanvasDropPoint(clientX: number, clientY: number): boolean {
  const viewport = canvasViewport.value
  const target = document.elementFromPoint(clientX, clientY)
  return Boolean(viewport && target && viewport.contains(target) && !isCanvasPlacementBlockedTarget(target))
}

function finishPaletteTouch(shape: FlowShape, event: TouchEvent): void {
  const touch = paletteTouchId === null ? undefined : touchWithId(event.changedTouches, paletteTouchId)
  const wasDragging = paletteTouchDragging.value
  const wasTap = paletteTouchShape === shape && touch && Math.hypot(touch.clientX - paletteTouchStartX, touch.clientY - paletteTouchStartY) < touchPanThreshold
  if (wasDragging) {
    if (touch && isCanvasDropPoint(touch.clientX, touch.clientY)) placePaletteNode(shape, touch.clientX, touch.clientY)
    clearPaletteTouch()
    event.preventDefault()
    event.stopPropagation()
    return
  }
  clearPaletteTouch()
  if (!wasTap) return
  pendingPaletteShape.value = pendingPaletteShape.value === shape ? null : shape
  if (pendingPaletteShape.value) {
    setToolMode('select')
    activeRailPopover.value = null
    toast.show(`已选择${shapeDefinition(shape).label}，点按画板空白处放置`, 'success')
  }
  event.preventDefault()
}

function cancelPaletteTouch(): void {
  clearPaletteTouch()
}

function placePaletteNode(shape: FlowShape, clientX: number, clientY: number): void {
  if (!graph) return
  const position = graph.clientToLocal(clientX, clientY)
  const node = createFlowNode(shape, Math.round(position.x), Math.round(position.y))
  node.x -= Math.round(node.width / 2)
  node.y -= Math.round(node.height / 2)
  graph.addNode(graphNode(node))
  syncFromGraph()
  selectNode(node.id)
  scheduleSync()
}

function toggleShapePopover(): void {
  activeRailPopover.value = activeRailPopover.value === 'shapes' ? null : 'shapes'
  setToolMode('select')
}

function activateDefaultConnector(): void {
  connectionRoute.value = 'orthogonal'
  connectionEndMarker.value = 'arrow'
  activeRailPopover.value = null
  setToolMode('connect')
}

function setToolMode(mode: ToolMode): void {
  if (mode !== 'connect') cancelClickLine()
  activeMode.value = mode
  connectingSourceId.value = ''
  if (mode === 'pan') {
    preserveSelectionUntil = 0
    clearSelection()
  }
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

async function toggleCanvasFullscreen(): Promise<void> {
  const workbench = workbenchHost.value
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await workbench?.requestFullscreen()
  } catch {
    toast.show('当前环境不支持画板全屏', 'error')
  }
}

function syncCanvasFullscreen(): void {
  canvasFullscreen.value = document.fullscreenElement === workbenchHost.value
  requestAnimationFrame(fitGraph)
}

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
  requestAnimationFrame(updateExtensionControl)
}

function replaceDiagram(next: FlowchartState): void {
  if (!graph) {
    pendingDiagram = next
    return
  }
  model.title = next.title
  model.nodes = next.nodes.map((node) => ({ ...node }))
  model.edges = next.edges.map((edge) => ({ ...edge, sourcePoint: edge.sourcePoint ? { ...edge.sourcePoint } : undefined, targetPoint: edge.targetPoint ? { ...edge.targetPoint } : undefined, vertices: edge.vertices.map((vertex) => ({ ...vertex })) }))
  graph.fromJSON({ nodes: model.nodes.map(graphNode), edges: model.edges.map(graphEdge) })
  graph.cleanHistory()
  clearSelection()
  requestAnimationFrame(fitGraph)
}

async function applyTemplate(): Promise<void> {
  if (model.nodes.length && !(await confirm.ask({
    title: '替换当前画板？',
    message: '应用模板会替换当前画板中的节点和连线，未保存的内容将被覆盖。',
    confirmLabel: '应用模板',
    tone: 'warning',
  }))) return
  replaceDiagram(createFlowchartTemplate(selectedTemplate.value))
  toast.show('已应用流程图模板', 'success')
}

async function clearGraph(): Promise<void> {
  if (model.nodes.length && !(await confirm.ask({
    title: '清空未保存内容？',
    message: '当前画板中的节点和连线清空后无法恢复。',
    confirmLabel: '清空画板',
    tone: 'danger',
  }))) return
  graph?.clearCells()
  model.nodes = []
  model.edges = []
  clearSelection()
}

function currentState(): FlowchartState {
  syncFromGraph()
  return {
    title: model.title,
    nodes: model.nodes.map(copyFlowNode),
    edges: model.edges.map(copyFlowEdge),
  }
}

function copyFlowNode(node: FlowNodeState): FlowNodeState {
  return { ...node }
}

function copyFlowEdge(edge: FlowEdgeState): FlowEdgeState {
  return {
    ...edge,
    sourcePoint: edge.sourcePoint ? { ...edge.sourcePoint } : undefined,
    targetPoint: edge.targetPoint ? { ...edge.targetPoint } : undefined,
    vertices: edge.vertices.map((vertex) => ({ ...vertex })),
  }
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

async function removeFromLibrary(): Promise<void> {
  if (!selectedSavedId.value) return
  if (!(await confirm.ask({
    title: '删除本地图纸？',
    message: '删除后无法从本地图纸库恢复，请确认是否继续。',
    confirmLabel: '确认删除',
    tone: 'danger',
  }))) return
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

function isCanvasPlacementBlockedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.flowchart-minimap, .x6-node, .x6-edge, .x6-widget-selection, .x6-widget-transform'))
}

function isNativeCanvasControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.flowchart-minimap, .x6-widget-selection, .x6-widget-transform, .x6-widget-tools'))
}

function startCanvasPointer(event: PointerEvent): void {
  if (event.pointerType === 'touch' || event.button !== 0 || canvasPointerId !== null) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('.x6-edge-tool-source-arrowhead')) {
    bindingEndpoint.value = 'source'
    return
  }
  if (target?.closest('.x6-edge-tool-target-arrowhead')) {
    bindingEndpoint.value = 'target'
    return
  }
  const directPortId = portIdFromTarget(target)
  const directPortNodeId = target?.closest('.x6-node')?.getAttribute('data-cell-id')
  const directPortNode = directPortNodeId ? graph?.getCellById(directPortNodeId) : null
  const portHit = directPortId && directPortNode?.isNode()
    ? { nodeId: directPortNode.id, portId: directPortId }
    : nodePortAt(event.clientX, event.clientY, Boolean(bindingEndpoint.value))
  if (bindingEndpoint.value) {
    if (portHit) {
      bindSelectedEndpoint(portHit.nodeId, portHit.portId)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (target?.closest('.flowchart-line-endpoint-control') || isNativeCanvasControlTarget(event.target)) return
    if (!isCanvasPlacementBlockedTarget(event.target)) {
      bindingEndpoint.value = null
      syncFromGraph()
      const edgeId = selectedEdgeId.value
      if (edgeId) selectEdge(edgeId)
      scheduleSync()
      event.preventDefault()
      event.stopPropagation()
      return
    }
  }
  if (isNativeCanvasControlTarget(event.target)) return
  if (activeMode.value === 'connect') {
    if (!pendingClickLine && !portHit && isCanvasPlacementBlockedTarget(event.target)) return
    const host = event.currentTarget as HTMLElement
    canvasPointerId = event.pointerId
    canvasPointerStartX = event.clientX
    canvasPointerStartY = event.clientY
    canvasPointerStartedWithPendingLine = Boolean(pendingClickLine)
    if (!pendingClickLine) beginClickLine(event.clientX, event.clientY, portHit ?? undefined)
    host.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (activeMode.value !== 'pan' || isCanvasPlacementBlockedTarget(event.target)) return
  preserveSelectionUntil = 0
  clearSelection()
  const host = event.currentTarget as HTMLElement
  canvasPointerId = event.pointerId
  previousCanvasPointerX = event.clientX
  previousCanvasPointerY = event.clientY
  host.setPointerCapture(event.pointerId)
  event.preventDefault()
  event.stopPropagation()
}

function moveCanvasPointer(event: PointerEvent): void {
  if (event.pointerType === 'touch') return
  updateConnectionHover(event.clientX, event.clientY)
  if (pendingClickLine) updateClickLine(event.clientX, event.clientY)
  if (bindingEndpoint.value && !endpointDrag) moveSelectedEndpoint(bindingEndpoint.value, event.clientX, event.clientY)
  if (event.pointerId !== canvasPointerId) return
  if (activeMode.value === 'pan') {
    graph?.translateBy(event.clientX - previousCanvasPointerX, event.clientY - previousCanvasPointerY)
    requestAnimationFrame(updateExtensionControl)
    previousCanvasPointerX = event.clientX
    previousCanvasPointerY = event.clientY
  }
  event.preventDefault()
  event.stopPropagation()
}

function finishCanvasPointer(event: PointerEvent): void {
  if (event.pointerType === 'touch' || event.pointerId !== canvasPointerId) return
  const host = event.currentTarget as HTMLElement
  if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)
  const moved = Math.hypot(event.clientX - canvasPointerStartX, event.clientY - canvasPointerStartY) >= 8
  if (pendingClickLine && (canvasPointerStartedWithPendingLine || moved || event.type === 'pointercancel')) {
    finishClickLine(event.clientX, event.clientY, event.type === 'pointercancel')
  }
  canvasPointerId = null
  canvasPointerStartedWithPendingLine = false
  event.preventDefault()
  event.stopPropagation()
}

function touchCellAt(target: EventTarget | null): { id: string; type: 'node' | 'edge' } | null {
  if (!graph || !(target instanceof Element)) return null
  const cell = graph.findViewByElem(target)?.cell
  if (cell?.isNode()) return { id: cell.id, type: 'node' }
  if (cell?.isEdge()) return { id: cell.id, type: 'edge' }
  return null
}

function touchWithId(touches: TouchList, identifier: number): Touch | undefined {
  return Array.from(touches).find((touch) => touch.identifier === identifier)
}

function beginCanvasTouch(touch: Touch, intent: CanvasTouchIntent): void {
  activeCanvasTouchId = touch.identifier
  previousCanvasTouchX = touch.clientX
  previousCanvasTouchY = touch.clientY
  canvasTouchStartX = touch.clientX
  canvasTouchStartY = touch.clientY
  const local = graph?.clientToLocal(touch.clientX, touch.clientY)
  canvasTouchStartLocalX = local?.x ?? 0
  canvasTouchStartLocalY = local?.y ?? 0
  canvasTouchMoved = false
  canvasTouchIntent = intent
}

function startTouchPan(event: TouchEvent): void {
  if (activeCanvasTouchId !== null || event.touches.length !== 1 || isNativeCanvasControlTarget(event.target)) return
  const touch = event.changedTouches[0]
  if (!touch) return
  const touchedCell = touchCellAt(event.target)
  if (touchedCell) {
    beginCanvasTouch(touch, touchedCell.type)
    canvasTouchCellId = touchedCell.id
    if (touchedCell.type === 'node') {
      const node = graph?.getCellById(touchedCell.id)
      const position = node?.isNode() ? node.position() : null
      canvasTouchNodeOriginX = position?.x ?? 0
      canvasTouchNodeOriginY = position?.y ?? 0
    }
  } else {
    if (isCanvasPlacementBlockedTarget(event.target)) return
    const intent: CanvasTouchIntent = pendingPaletteShape.value ? 'place' : activeMode.value === 'connect' ? 'line' : 'pan'
    beginCanvasTouch(touch, intent)
    if (intent === 'line') beginFreeLine(touch.clientX, touch.clientY)
  }
  event.preventDefault()
  event.stopPropagation()
}

function moveTouchPan(event: TouchEvent): void {
  if (activeCanvasTouchId === null) return
  const touch = touchWithId(event.touches, activeCanvasTouchId)
  if (!touch) return
  if (canvasTouchIntent === 'edge') {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (!canvasTouchMoved && Math.hypot(touch.clientX - canvasTouchStartX, touch.clientY - canvasTouchStartY) < touchPanThreshold) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  canvasTouchMoved = true
  if (canvasTouchIntent === 'line') {
    updateFreeLine(touch.clientX, touch.clientY)
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (canvasTouchIntent === 'node') {
    const node = graph?.getCellById(canvasTouchCellId)
    const local = graph?.clientToLocal(touch.clientX, touch.clientY)
    if (node?.isNode() && local) node.position(canvasTouchNodeOriginX + local.x - canvasTouchStartLocalX, canvasTouchNodeOriginY + local.y - canvasTouchStartLocalY)
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (canvasTouchIntent === 'place') pendingPaletteShape.value = null
  canvasTouchIntent = 'pan'
  touchPanningCanvas.value = true
  const deltaX = touch.clientX - previousCanvasTouchX
  const deltaY = touch.clientY - previousCanvasTouchY
  if (graph) graph.translateBy(deltaX, deltaY)
  else {
    pendingTouchPanX += deltaX
    pendingTouchPanY += deltaY
  }
  requestAnimationFrame(updateExtensionControl)
  previousCanvasTouchX = touch.clientX
  previousCanvasTouchY = touch.clientY
  event.preventDefault()
  event.stopPropagation()
}

function finishTouchPan(event: TouchEvent): void {
  if (activeCanvasTouchId === null) return
  if (touchWithId(event.touches, activeCanvasTouchId)) return
  const endedTouch = touchWithId(event.changedTouches, activeCanvasTouchId)
  const selectedShape = pendingPaletteShape.value
  if (event.type !== 'touchcancel' && canvasTouchIntent === 'node' && !canvasTouchMoved) {
    if (activeMode.value === 'connect') connectByNodeClick(canvasTouchCellId)
    else selectNode(canvasTouchCellId)
  } else if (event.type !== 'touchcancel' && canvasTouchIntent === 'edge') {
    selectEdge(canvasTouchCellId)
  } else if (canvasTouchIntent === 'line' && endedTouch) {
    finishFreeLine(endedTouch.clientX, endedTouch.clientY, event.type === 'touchcancel')
  } else if (event.type !== 'touchcancel' && canvasTouchIntent === 'place' && !canvasTouchMoved && selectedShape && endedTouch) {
    placePaletteNode(selectedShape, endedTouch.clientX, endedTouch.clientY)
    pendingPaletteShape.value = null
  } else if (event.type !== 'touchcancel' && canvasTouchIntent === 'node' && canvasTouchMoved) {
    scheduleSync()
  } else if (event.type !== 'touchcancel' && !canvasTouchMoved) {
    clearSelection()
  }
  activeCanvasTouchId = null
  touchPanningCanvas.value = false
  canvasTouchMoved = false
  canvasTouchIntent = 'pan'
  canvasTouchCellId = ''
  event.preventDefault()
  event.stopPropagation()
}

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
  nodes: model.nodes.map(copyFlowNode),
  edges: model.edges.map(copyFlowEdge),
  ...(fileManagerFileId ? { __fileManagerFileId: fileManagerFileId } : {}),
}), { deep: true, immediate: true })

onMounted(async () => {
  if (!canvasHost.value || !canvasViewport.value || !minimapHost.value) return
  const { Clipboard, Dnd, Export, Graph, History, Keyboard, MiniMap, Selection, Snapline, Transform } = await import('@antv/x6')
  if (disposed || !canvasHost.value || !canvasViewport.value || !minimapHost.value) return
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
      // New links are created only by the explicit tool flows below. X6 remains
      // enabled here solely to reconnect the endpoint of an existing edge.
      validateConnection: ({ edge }) => Boolean(edge && model.edges.some((entry) => entry.id === edge.id)),
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
  const queuedDiagram = pendingDiagram
  pendingDiagram = null
  if (queuedDiagram) replaceDiagram(queuedDiagram)
  graph.on('node:click', ({ node, e }) => {
    if (Date.now() < preserveSelectionUntil) return
    const portId = portIdFromTarget(e.target)
    if (bindingEndpoint.value && portId) bindSelectedEndpoint(node.id, portId)
    else if (activeMode.value === 'connect') return
    else selectNode(node.id, e.ctrlKey || e.metaKey)
  })
  graph.on('node:mouseenter', ({ node }) => showHoveredConnectionNode(node.id))
  graph.on('node:mouseleave', ({ node }) => {
    if (bindingEndpoint.value || pendingClickLine || activeMode.value === 'connect') return
    if (hoveredConnectionNodeId.value === node.id) clearHoveredConnectionNode()
  })
  graph.on('edge:click', ({ edge }) => selectEdge(edge.id))
  graph.on('blank:mousedown', ({ e }) => {
    if (e.button === 2 || activeMode.value === 'pan') clearSelection()
  })
  graph.on('blank:click', clearSelection)
  graph.on('cell:changed', () => {
    scheduleSync()
    if (selectedEdgeId.value) requestAnimationFrame(updateEdgeEndpointControls)
  })
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
  document.addEventListener('fullscreenchange', syncCanvasFullscreen)
  await nextTick()
  fitGraph()
  if (pendingTouchPanX || pendingTouchPanY) {
    graph.translateBy(pendingTouchPanX, pendingTouchPanY)
    pendingTouchPanX = 0
    pendingTouchPanY = 0
  }
})

onBeforeUnmount(() => {
  disposed = true
  window.clearTimeout(syncTimer)
  window.clearTimeout(fitTimer)
  resizeObserver?.disconnect()
  document.removeEventListener('fullscreenchange', syncCanvasFullscreen)
  activeCanvasTouchId = null
  canvasPointerId = null
  pendingDiagram = null
  pendingTouchPanX = 0
  pendingTouchPanY = 0
  freeLineId = ''
  canvasTouchMoved = false
  clearPaletteTouch()
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

    <div ref="workbenchHost" class="flowchart-workbench" :class="`mode-${activeMode}`">
      <aside class="flowchart-tool-rail" aria-label="画板工具栏">
        <div class="flowchart-rail-group">
          <button type="button" class="flowchart-rail-button tooltip-anchor" :class="{ active: activeMode === 'select' }" aria-label="选择工具" :aria-pressed="activeMode === 'select'" data-tooltip="选择" @click="activeRailPopover = null; setToolMode('select')"><MousePointer2 :size="18" /></button>
          <button type="button" class="flowchart-rail-button tooltip-anchor" :class="{ active: activeRailPopover === 'shapes' }" aria-label="形状工具" :aria-pressed="activeRailPopover === 'shapes'" data-tooltip="形状" @click="toggleShapePopover"><Shapes :size="18" /></button>
          <button type="button" class="flowchart-rail-button tooltip-anchor" :class="{ active: activeMode === 'connect' }" aria-label="连线工具" :aria-pressed="activeMode === 'connect'" data-tooltip="连线" @click="activateDefaultConnector"><GitBranch :size="18" /></button>
          <button type="button" class="flowchart-rail-button tooltip-anchor" :class="{ active: activeMode === 'pan' }" aria-label="抓手工具" :aria-pressed="activeMode === 'pan'" data-tooltip="抓手" @click="activeRailPopover = null; setToolMode('pan')"><Hand :size="18" /></button>
        </div>
        <div class="flowchart-rail-divider" />
        <div class="flowchart-rail-group flowchart-rail-view-tools">
          <button type="button" class="flowchart-rail-button tooltip-anchor" aria-label="缩小画板" data-tooltip="缩小" @click="zoom(-0.15)"><ZoomOut :size="17" /></button>
          <button type="button" class="flowchart-rail-button tooltip-anchor" aria-label="放大画板" data-tooltip="放大" @click="zoom(0.15)"><ZoomIn :size="17" /></button>
          <button type="button" class="flowchart-rail-button tooltip-anchor" aria-label="适配画板内容" data-tooltip="适配内容" @click="fitGraph"><Scan :size="17" /></button>
          <button type="button" class="flowchart-rail-button tooltip-anchor" :aria-label="canvasFullscreen ? '退出全屏画板' : '全屏画板'" :data-tooltip="canvasFullscreen ? '退出全屏' : '全屏画板'" @click="toggleCanvasFullscreen"><Maximize2 :size="17" /></button>
        </div>

        <section v-if="activeRailPopover === 'shapes'" class="flowchart-rail-popover flowchart-shape-popover" aria-label="形状选择">
          <header><strong>形状</strong><small>{{ paletteItems.length }} 个图形</small></header>
          <div class="flowchart-shape-list"><button v-for="item in paletteItems" :key="item.id" type="button" :class="['flowchart-shape', `shape-${item.id}`, { 'is-pending': pendingPaletteShape === item.id, 'is-touch-dragging': paletteTouchDragging && paletteTouchShape === item.id }]" :aria-label="`拖拽添加${item.label}`" :aria-pressed="pendingPaletteShape === item.id" :title="item.label" @mousedown.prevent="startPaletteDrag(item.id, $event)" @touchstart="startPaletteTouch(item.id, $event)" @touchmove="movePaletteTouch" @touchend="finishPaletteTouch(item.id, $event)" @touchcancel="cancelPaletteTouch"><span class="flowchart-shape-preview"><FlowShapePreview :shape="item.id" /></span><span class="flowchart-shape-label">{{ item.label }}</span></button></div>
        </section>

      </aside>

      <div
        ref="canvasViewport"
        class="flowchart-canvas-wrap"
        :class="{ 'is-touch-panning': touchPanningCanvas, 'is-edge-selected': Boolean(selectedEdge), 'is-connect-mode': activeMode === 'connect', 'is-line-ready': activeRailPopover === 'connectors' || activeMode === 'connect', 'is-binding-endpoint': Boolean(bindingEndpoint) }"
        @pointerdown.capture="startCanvasPointer"
        @pointermove.capture="moveCanvasPointer"
        @pointerup.capture="finishCanvasPointer"
        @pointercancel.capture="finishCanvasPointer"
        @touchstart.capture="startTouchPan"
        @touchmove.capture="moveTouchPan"
        @touchend.capture="finishTouchPan"
        @touchcancel.capture="finishTouchPan"
      >
        <div ref="canvasHost" class="flowchart-canvas" aria-label="流程图编辑画板" />
        <div v-for="anchor in edgeEndpointAnchors" :key="anchor.terminal" class="flowchart-line-endpoint-control" :class="{ active: bindingEndpoint === anchor.terminal }" :data-terminal="anchor.terminal" :style="{ left: `${anchor.left}px`, top: `${anchor.top}px` }" role="button" :aria-label="anchor.terminal === 'source' ? '拖动连线起点' : '拖动连线终点'" tabindex="0" @pointerdown="beginEndpointDrag(anchor.terminal, $event)" @pointermove="moveEndpointDrag" @pointerup="finishEndpointDrag" @pointercancel="finishEndpointDrag" />
        <div v-if="selectedNode && extensionPreview" class="flowchart-extension-preview" :class="`shape-${extensionPreview.shape}`" :style="{ left: `${extensionPreview.left}px`, top: `${extensionPreview.top}px`, width: `${extensionPreview.width}px`, height: `${extensionPreview.height}px` }"><FlowShapePreview :shape="extensionPreview.shape" /></div>
        <button v-for="anchor in extensionAnchors" :key="anchor.direction" type="button" class="flowchart-extend-button tooltip-anchor" :class="`is-${anchor.direction}`" :style="{ left: `${anchor.left}px`, top: `${anchor.top}px` }" :aria-label="`向${anchor.direction === 'left' ? '左' : anchor.direction === 'right' ? '右' : anchor.direction === 'top' ? '上' : '下'}延展`" :data-tooltip="`向${anchor.direction === 'left' ? '左' : anchor.direction === 'right' ? '右' : anchor.direction === 'top' ? '上' : '下'}延展`" @mouseenter="showExtensionPreview(anchor.direction)" @mouseleave="clearExtensionPreview" @focus="showExtensionPreview(anchor.direction)" @blur="clearExtensionPreview" @click.stop="selectedNode && extendFromNode(selectedNode.id, anchor.direction)"><ArrowRight :size="15" /></button>
        <div v-if="selectedNode || selectedEdge" class="flowchart-context-actions" aria-label="所选内容操作">
          <IconButton :icon="Copy" label="复制所选内容" size="small" @click="copySelected" />
          <IconButton :icon="ClipboardPaste" label="粘贴内容" size="small" @click="pasteSelected" />
          <IconButton :icon="AlignLeft" label="左对齐所选节点" size="small" @click="alignSelected('left')" />
          <IconButton :icon="AlignCenterHorizontal" label="水平居中对齐所选节点" size="small" @click="alignSelected('center')" />
          <IconButton :icon="AlignRight" label="右对齐所选节点" size="small" @click="alignSelected('right')" />
          <IconButton :icon="BringToFront" label="置于顶层" size="small" @click="bringSelectedToFront" />
          <IconButton :icon="SendToBack" label="置于底层" size="small" @click="sendSelectedToBack" />
        </div>
        <div ref="minimapHost" class="flowchart-minimap" aria-label="流程图小地图" />
      </div>

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
          <label>线宽<input :value="selectedEdge.strokeWidth" aria-label="连线宽度" type="number" min="1" max="12" step="0.5" @change="updateEdge({ strokeWidth: Number(($event.target as HTMLInputElement).value) })" /></label>
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
