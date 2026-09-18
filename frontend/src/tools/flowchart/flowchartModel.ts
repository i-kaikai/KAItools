export type FlowShape =
  | 'terminator'
  | 'process'
  | 'decision'
  | 'data'
  | 'document'
  | 'subroutine'
  | 'manual-input'
  | 'manual-operation'
  | 'preparation'
  | 'delay'
  | 'display'
  | 'database'
  | 'on-page-connector'
  | 'off-page-connector'
  | 'annotation'

export type EdgeRoute = 'orthogonal' | 'straight' | 'curve'
export type EdgeMarker = 'none' | 'arrow' | 'diamond' | 'circle'
export type StrokeDash = 'solid' | 'dashed' | 'dotted'
export type TextAlign = 'left' | 'center' | 'right'
export type FlowchartTemplateId = 'blank' | 'approval' | 'order' | 'incident'

export interface FlowNodeState {
  id: string
  shape: FlowShape
  x: number
  y: number
  width: number
  height: number
  label: string
  fill: string
  stroke: string
  strokeWidth: number
  dash: StrokeDash
  textColor: string
  fontSize: number
  fontWeight: 400 | 600 | 700
  textAlign: TextAlign
  opacity: number
  locked: boolean
  zIndex: number
}

export interface FlowEdgeVertex {
  x: number
  y: number
}

export interface FlowEdgeState {
  id: string
  source: string
  sourcePort: string
  sourcePoint?: FlowEdgeVertex
  target: string
  targetPort: string
  targetPoint?: FlowEdgeVertex
  vertices: FlowEdgeVertex[]
  manualVertices?: boolean
  route: EdgeRoute
  label: string
  stroke: string
  strokeWidth: number
  dash: StrokeDash
  sourceMarker: EdgeMarker
  targetMarker: EdgeMarker
}

export interface FlowchartState {
  title: string
  nodes: FlowNodeState[]
  edges: FlowEdgeState[]
}

export interface FlowShapeDefinition {
  id: FlowShape
  label: string
  group: 'basic' | 'advanced' | 'connectors'
  width: number
  height: number
  defaultLabel: string
  fill: string
  stroke: string
  graphShape: 'rect' | 'ellipse' | 'polygon'
  body: Record<string, unknown>
}

export interface FlowchartTemplate {
  id: FlowchartTemplateId
  label: string
  description: string
}

export const flowShapeGroups = [
  { id: 'basic', label: '基础流程' },
  { id: 'advanced', label: '数据与操作' },
  { id: 'connectors', label: '连接与注释' },
] as const

export const flowShapeDefinitions: FlowShapeDefinition[] = [
  { id: 'terminator', label: '开始/结束', group: 'basic', width: 140, height: 52, defaultLabel: '开始', fill: '#d9f8ec', stroke: '#16866e', graphShape: 'rect', body: { rx: 26, ry: 26 } },
  { id: 'process', label: '处理', group: 'basic', width: 156, height: 68, defaultLabel: '处理', fill: '#e5efff', stroke: '#3b82f6', graphShape: 'rect', body: { rx: 7, ry: 7 } },
  { id: 'decision', label: '判断', group: 'basic', width: 148, height: 92, defaultLabel: '是否通过？', fill: '#fff0c7', stroke: '#b7791f', graphShape: 'polygon', body: { refPoints: '0,46 74,0 148,46 74,92' } },
  { id: 'data', label: '输入/输出', group: 'basic', width: 156, height: 68, defaultLabel: '输入/输出', fill: '#f1e8ff', stroke: '#805ad5', graphShape: 'polygon', body: { refPoints: '20,0 156,0 136,68 0,68' } },
  { id: 'document', label: '文档', group: 'basic', width: 156, height: 72, defaultLabel: '文档', fill: '#fff7ed', stroke: '#c96d10', graphShape: 'polygon', body: { refPoints: '0,0 156,0 156,56 132,72 0,72' } },
  { id: 'subroutine', label: '预定义过程', group: 'advanced', width: 168, height: 70, defaultLabel: '子过程', fill: '#e8f3ff', stroke: '#2563eb', graphShape: 'rect', body: { rx: 4, ry: 4, strokeWidth: 4 } },
  { id: 'manual-input', label: '手动输入', group: 'advanced', width: 156, height: 68, defaultLabel: '手动输入', fill: '#e6fbf6', stroke: '#0f766e', graphShape: 'polygon', body: { refPoints: '18,0 156,0 156,68 0,68' } },
  { id: 'manual-operation', label: '手动操作', group: 'advanced', width: 156, height: 68, defaultLabel: '手动操作', fill: '#fef3c7', stroke: '#b45309', graphShape: 'polygon', body: { refPoints: '0,0 156,0 132,68 24,68' } },
  { id: 'preparation', label: '准备', group: 'advanced', width: 156, height: 68, defaultLabel: '准备', fill: '#f3e8ff', stroke: '#7e22ce', graphShape: 'polygon', body: { refPoints: '24,0 132,0 156,34 132,68 24,68 0,34' } },
  { id: 'delay', label: '延迟', group: 'advanced', width: 148, height: 68, defaultLabel: '等待', fill: '#fff1f2', stroke: '#be123c', graphShape: 'rect', body: { rx: 34, ry: 34 } },
  { id: 'display', label: '显示', group: 'advanced', width: 156, height: 68, defaultLabel: '显示', fill: '#ecfeff', stroke: '#0e7490', graphShape: 'polygon', body: { refPoints: '22,0 136,0 156,34 136,68 22,68 0,34' } },
  { id: 'database', label: '数据库', group: 'advanced', width: 148, height: 68, defaultLabel: '数据库', fill: '#eef2ff', stroke: '#4338ca', graphShape: 'ellipse', body: {} },
  { id: 'on-page-connector', label: '页内连接符', group: 'connectors', width: 66, height: 66, defaultLabel: 'A', fill: '#f8fafc', stroke: '#475569', graphShape: 'ellipse', body: {} },
  { id: 'off-page-connector', label: '页外连接符', group: 'connectors', width: 112, height: 78, defaultLabel: '下一页', fill: '#f8fafc', stroke: '#475569', graphShape: 'polygon', body: { refPoints: '0,0 112,0 112,54 56,78 0,54' } },
  { id: 'annotation', label: '注释', group: 'connectors', width: 176, height: 72, defaultLabel: '注释', fill: '#ffffff', stroke: '#64748b', graphShape: 'rect', body: { rx: 4, ry: 4, strokeDasharray: '5 3' } },
]

export const flowchartTemplates: FlowchartTemplate[] = [
  { id: 'blank', label: '空白图纸', description: '从空白画板开始' },
  { id: 'approval', label: '审批流程', description: '申请、审批与驳回' },
  { id: 'order', label: '订单处理', description: '下单、支付与发货' },
  { id: 'incident', label: '故障处置', description: '发现、分派与复盘' },
]

export const nodeFillOptions = ['#d9f8ec', '#e5efff', '#fff0c7', '#f1e8ff', '#fee2e2', '#e7edf3', '#ffffff', '#ecfeff']
export const nodeStrokeOptions = ['#16866e', '#3b82f6', '#b7791f', '#805ad5', '#be123c', '#475569', '#0e7490', '#111827']
export const edgeStrokeOptions = ['#334155', '#2563eb', '#16866e', '#b45309', '#7e22ce', '#be123c']
export const portIds = ['top', 'right', 'bottom', 'left'] as const

const shapeMap = new Map(flowShapeDefinitions.map((definition) => [definition.id, definition]))
const legacyShapes: Record<string, FlowShape> = { start: 'terminator', process: 'process', decision: 'decision', data: 'data' }
const validDashes = new Set<StrokeDash>(['solid', 'dashed', 'dotted'])
const validTextAlign = new Set<TextAlign>(['left', 'center', 'right'])
const validMarkers = new Set<EdgeMarker>(['none', 'arrow', 'diamond', 'circle'])

export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`
}

export function shapeDefinition(shape: FlowShape): FlowShapeDefinition {
  return shapeMap.get(shape) ?? flowShapeDefinitions[1]!
}

export function createFlowNode(shape: FlowShape, x: number, y: number, overrides: Partial<FlowNodeState> = {}): FlowNodeState {
  const definition = shapeDefinition(shape)
  return {
    id: createId('node'),
    shape,
    x,
    y,
    width: definition.width,
    height: definition.height,
    label: definition.defaultLabel,
    fill: definition.fill,
    stroke: definition.stroke,
    strokeWidth: 1.5,
    dash: 'solid',
    textColor: '#18212c',
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'center',
    opacity: 1,
    locked: false,
    zIndex: 1,
    ...overrides,
  }
}

export function createFlowEdge(source: FlowNodeState, target: FlowNodeState, overrides: Partial<FlowEdgeState> = {}): FlowEdgeState {
  return {
    id: createId('edge'),
    source: source.id,
    sourcePort: 'right',
    sourcePoint: undefined,
    target: target.id,
    targetPort: 'left',
    targetPoint: undefined,
    vertices: [],
    manualVertices: false,
    route: 'orthogonal',
    label: '',
    stroke: '#475569',
    strokeWidth: 1.5,
    dash: 'solid',
    sourceMarker: 'none',
    targetMarker: 'arrow',
    ...overrides,
  }
}

function approvalTemplate(): FlowchartState {
  const start = createFlowNode('terminator', 80, 180, { label: '提交申请' })
  const review = createFlowNode('process', 285, 172, { label: '资料审核' })
  const decision = createFlowNode('decision', 525, 160, { label: '审批通过？' })
  const approve = createFlowNode('process', 750, 92, { label: '执行审批', fill: '#d9f8ec', stroke: '#16866e' })
  const reject = createFlowNode('process', 750, 292, { label: '退回修改', fill: '#fee2e2', stroke: '#be123c' })
  const end = createFlowNode('terminator', 980, 92, { label: '完成' })
  return {
    title: '审批流程',
    nodes: [start, review, decision, approve, reject, end],
    edges: [
      createFlowEdge(start, review),
      createFlowEdge(review, decision),
      createFlowEdge(decision, approve, { label: '是' }),
      createFlowEdge(decision, reject, { label: '否', stroke: '#be123c' }),
      createFlowEdge(approve, end),
      createFlowEdge(reject, review, { sourcePort: 'left', targetPort: 'bottom', stroke: '#be123c' }),
    ],
  }
}

function orderTemplate(): FlowchartState {
  const start = createFlowNode('terminator', 80, 180, { label: '创建订单' })
  const inventory = createFlowNode('process', 290, 172, { label: '校验库存' })
  const available = createFlowNode('decision', 530, 160, { label: '库存充足？' })
  const payment = createFlowNode('data', 760, 92, { label: '支付确认' })
  const shipping = createFlowNode('process', 980, 92, { label: '安排发货' })
  const end = createFlowNode('terminator', 1200, 92, { label: '订单完成' })
  const notify = createFlowNode('document', 760, 292, { label: '缺货通知' })
  return {
    title: '订单处理',
    nodes: [start, inventory, available, payment, shipping, end, notify],
    edges: [
      createFlowEdge(start, inventory),
      createFlowEdge(inventory, available),
      createFlowEdge(available, payment, { label: '是' }),
      createFlowEdge(payment, shipping),
      createFlowEdge(shipping, end),
      createFlowEdge(available, notify, { label: '否', stroke: '#be123c' }),
    ],
  }
}

function incidentTemplate(): FlowchartState {
  const start = createFlowNode('terminator', 80, 180, { label: '发现故障' })
  const classify = createFlowNode('process', 300, 172, { label: '分级与分派' })
  const decision = createFlowNode('decision', 540, 160, { label: '影响扩大？' })
  const escalate = createFlowNode('manual-operation', 770, 92, { label: '升级响应' })
  const resolve = createFlowNode('process', 770, 292, { label: '修复验证' })
  const review = createFlowNode('document', 1000, 292, { label: '复盘记录' })
  const end = createFlowNode('terminator', 1210, 292, { label: '关闭事件' })
  return {
    title: '故障处置',
    nodes: [start, classify, decision, escalate, resolve, review, end],
    edges: [
      createFlowEdge(start, classify),
      createFlowEdge(classify, decision),
      createFlowEdge(decision, escalate, { label: '是', stroke: '#be123c' }),
      createFlowEdge(decision, resolve, { label: '否' }),
      createFlowEdge(escalate, resolve, { sourcePort: 'bottom', targetPort: 'top', route: 'curve' }),
      createFlowEdge(resolve, review),
      createFlowEdge(review, end),
    ],
  }
}

export function createFlowchartTemplate(template: FlowchartTemplateId): FlowchartState {
  if (template === 'approval') return approvalTemplate()
  if (template === 'order') return orderTemplate()
  if (template === 'incident') return incidentTemplate()
  return { title: '未命名流程图', nodes: [], edges: [] }
}

function numberInRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[\da-fA-F]{6}$/.test(value) ? value : fallback
}

function dash(value: unknown): StrokeDash {
  return typeof value === 'string' && validDashes.has(value as StrokeDash) ? value as StrokeDash : 'solid'
}

function align(value: unknown): TextAlign {
  return typeof value === 'string' && validTextAlign.has(value as TextAlign) ? value as TextAlign : 'center'
}

function marker(value: unknown, fallback: EdgeMarker): EdgeMarker {
  return typeof value === 'string' && validMarkers.has(value as EdgeMarker) ? value as EdgeMarker : fallback
}

function vertices(value: unknown): FlowEdgeVertex[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).flatMap((vertex) => {
    if (!vertex || typeof vertex !== 'object') return []
    const point = vertex as Partial<FlowEdgeVertex>
    if (typeof point.x !== 'number' || !Number.isFinite(point.x) || typeof point.y !== 'number' || !Number.isFinite(point.y)) return []
    return [{ x: numberInRange(point.x, 0, -20_000, 20_000), y: numberInRange(point.y, 0, -20_000, 20_000) }]
  })
}

function point(value: unknown): FlowEdgeVertex | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<FlowEdgeVertex>
  if (typeof candidate.x !== 'number' || !Number.isFinite(candidate.x) || typeof candidate.y !== 'number' || !Number.isFinite(candidate.y)) return undefined
  return {
    x: numberInRange(candidate.x, 0, -20_000, 20_000),
    y: numberInRange(candidate.y, 0, -20_000, 20_000),
  }
}

function readNode(value: unknown): FlowNodeState | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<FlowNodeState>
  const shape = typeof source.shape === 'string' ? legacyShapes[source.shape] ?? source.shape as FlowShape : undefined
  if (typeof source.id !== 'string' || !source.id || !shape || !shapeMap.has(shape)) return null
  const defaults = createFlowNode(shape, 0, 0)
  return {
    ...defaults,
    id: source.id,
    shape,
    x: numberInRange(source.x, 0, -20_000, 20_000),
    y: numberInRange(source.y, 0, -20_000, 20_000),
    width: numberInRange(source.width, defaults.width, 60, 640),
    height: numberInRange(source.height, defaults.height, 32, 480),
    label: typeof source.label === 'string' ? source.label.slice(0, 240) : defaults.label,
    fill: color(source.fill, defaults.fill),
    stroke: color(source.stroke, defaults.stroke),
    strokeWidth: numberInRange(source.strokeWidth, defaults.strokeWidth, 1, 12),
    dash: dash(source.dash),
    textColor: color(source.textColor, defaults.textColor),
    fontSize: numberInRange(source.fontSize, defaults.fontSize, 10, 48),
    fontWeight: source.fontWeight === 400 || source.fontWeight === 700 ? source.fontWeight : 600,
    textAlign: align(source.textAlign),
    opacity: numberInRange(typeof source.opacity === 'number' ? source.opacity * 100 : undefined, 100, 10, 100) / 100,
    locked: source.locked === true,
    zIndex: numberInRange(source.zIndex, 1, 0, 1_000),
  }
}

function readEdge(value: unknown, ids: Set<string>): FlowEdgeState | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<FlowEdgeState>
  if (typeof source.id !== 'string' || !source.id) return null
  const sourceId = typeof source.source === 'string' && ids.has(source.source) ? source.source : ''
  const targetId = typeof source.target === 'string' && ids.has(source.target) ? source.target : ''
  const sourcePoint = sourceId ? undefined : point(source.sourcePoint)
  const targetPoint = targetId ? undefined : point(source.targetPoint)
  if ((!sourceId && !sourcePoint) || (!targetId && !targetPoint)) return null
  return {
    id: source.id,
    source: sourceId,
    sourcePort: sourceId && typeof source.sourcePort === 'string' && portIds.includes(source.sourcePort as typeof portIds[number]) ? source.sourcePort : '',
    sourcePoint,
    target: targetId,
    targetPort: targetId && typeof source.targetPort === 'string' && portIds.includes(source.targetPort as typeof portIds[number]) ? source.targetPort : '',
    targetPoint,
    vertices: vertices(source.vertices),
    manualVertices: source.manualVertices === true,
    route: 'orthogonal',
    label: typeof source.label === 'string' ? source.label.slice(0, 120) : '',
    stroke: color(source.stroke, '#475569'),
    strokeWidth: numberInRange(source.strokeWidth, 1.5, 1, 12),
    dash: dash(source.dash),
    sourceMarker: marker(source.sourceMarker, 'none'),
    targetMarker: marker(source.targetMarker, 'arrow'),
  }
}

export function normalizeFlowchartState(value: Record<string, unknown>): FlowchartState {
  const storedNodes = Array.isArray(value.nodes) ? value.nodes : null
  if (!storedNodes) return createFlowchartTemplate('approval')
  const nodes = storedNodes.map(readNode).filter((node): node is FlowNodeState => Boolean(node)).slice(0, 500)
  const ids = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(value.edges) ? value.edges.map((edge) => readEdge(edge, ids)).filter((edge): edge is FlowEdgeState => Boolean(edge)).slice(0, 1_000) : []
  return {
    title: typeof value.title === 'string' ? value.title.trim().slice(0, 80) || '未命名流程图' : '未命名流程图',
    nodes,
    edges,
  }
}
