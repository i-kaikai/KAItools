import { normalizeFlowchartState, type FlowchartState } from './flowchartModel'

const STORAGE_KEY = 'kaitools.flowchart.library.v1'
const MAX_DIAGRAMS = 40

export interface SavedFlowchart {
  id: string
  title: string
  updatedAt: string
  state: FlowchartState
}

function copyState(state: FlowchartState): FlowchartState {
  return {
    title: state.title,
    nodes: state.nodes.map((node) => ({ ...node })),
    edges: state.edges.map((edge) => ({ ...edge, vertices: edge.vertices.map((vertex) => ({ ...vertex })) })),
  }
}

function newId(): string {
  return crypto.randomUUID?.() ?? `flowchart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function parse(value: unknown): SavedFlowchart[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const source = entry as Partial<SavedFlowchart>
    if (typeof source.id !== 'string' || !source.id || typeof source.title !== 'string' || !source.title.trim() || !source.state || typeof source.state !== 'object') return []
    return [{
      id: source.id,
      title: source.title.trim().slice(0, 80),
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date(0).toISOString(),
      state: copyState(normalizeFlowchartState(source.state as unknown as Record<string, unknown>)),
    }]
  }).slice(0, MAX_DIAGRAMS)
}

function write(entries: SavedFlowchart[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.map((entry) => ({ ...entry, state: copyState(entry.state) }))))
}

export function loadFlowchartLibrary(): SavedFlowchart[] {
  try {
    return parse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'))
  } catch {
    return []
  }
}

export function saveFlowchart(library: SavedFlowchart[], state: FlowchartState, id?: string): SavedFlowchart[] {
  const next = {
    id: id ?? newId(),
    title: state.title.trim().slice(0, 80) || '未命名流程图',
    updatedAt: new Date().toISOString(),
    state: copyState(state),
  }
  const entries = [next, ...library.filter((entry) => entry.id !== next.id)].slice(0, MAX_DIAGRAMS)
  write(entries)
  return entries
}

export function deleteFlowchart(library: SavedFlowchart[], id: string): SavedFlowchart[] {
  const entries = library.filter((entry) => entry.id !== id)
  write(entries)
  return entries
}
