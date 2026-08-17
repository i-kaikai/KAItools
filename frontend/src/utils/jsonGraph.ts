import type { JsonTreeItem } from '@/utils/json'

export interface JsonGraphEntry {
  item: JsonTreeItem
  relation: boolean
}

export interface JsonGraphNode {
  item: JsonTreeItem
  entries: JsonGraphEntry[]
  x: number
  y: number
  width: number
  height: number
  collapsed: boolean
  isRoot: boolean
}

export interface JsonGraphEdge {
  id: string
  fromX: number
  fromY: number
  toX: number
  toY: number
}

export interface JsonGraphLayout {
  nodes: JsonGraphNode[]
  edges: JsonGraphEdge[]
  width: number
  height: number
  truncated: boolean
}

interface LayoutTree {
  node: JsonGraphNode
  children: LayoutTree[]
  subtreeHeight: number
}

const NODE_WIDTH = 248
const HEADER_HEIGHT = 48
const ROW_HEIGHT = 31
const EMPTY_ROW_HEIGHT = 34
const COLUMN_GAP = 104
const SUBTREE_GAP = 24
const PADDING = 32

function isContainer(item: JsonTreeItem): boolean {
  return item.type === 'object' || item.type === 'array'
}

function nodeHeight(entries: JsonGraphEntry[]): number {
  return HEADER_HEIGHT + (entries.length ? entries.length * ROW_HEIGHT : EMPTY_ROW_HEIGHT)
}

export function layoutJsonGraph(
  root: JsonTreeItem,
  collapsedIds: ReadonlySet<string>,
  maximumItems = 500,
): JsonGraphLayout {
  const nodes: JsonGraphNode[] = []
  const edges: JsonGraphEdge[] = []
  let visibleItems = 0
  let truncated = false

  function build(item: JsonTreeItem, depth: number, isRoot = false): LayoutTree {
    const sourceEntries = isContainer(item) ? item.children : [item]
    const entries: JsonGraphEntry[] = []
    for (const entry of sourceEntries) {
      if (visibleItems >= maximumItems) {
        truncated = true
        break
      }
      visibleItems += 1
      entries.push({ item: entry, relation: isContainer(entry) })
    }

    const collapsed = collapsedIds.has(item.id)
    const node: JsonGraphNode = {
      item,
      entries,
      x: PADDING + depth * (NODE_WIDTH + COLUMN_GAP),
      y: 0,
      width: NODE_WIDTH,
      height: nodeHeight(entries),
      collapsed,
      isRoot,
    }
    nodes.push(node)
    const children = collapsed
      ? []
      : entries.filter((entry) => entry.relation).map((entry) => build(entry.item, depth + 1))
    return { node, children, subtreeHeight: 0 }
  }

  function measure(tree: LayoutTree): number {
    const childHeight = tree.children.reduce((sum, child, index) => sum + measure(child) + (index ? SUBTREE_GAP : 0), 0)
    tree.subtreeHeight = Math.max(tree.node.height, childHeight)
    return tree.subtreeHeight
  }

  function place(tree: LayoutTree, top: number): void {
    tree.node.y = top + (tree.subtreeHeight - tree.node.height) / 2
    const childrenHeight = tree.children.reduce((sum, child, index) => sum + child.subtreeHeight + (index ? SUBTREE_GAP : 0), 0)
    let childTop = top + (tree.subtreeHeight - childrenHeight) / 2

    for (const child of tree.children) {
      place(child, childTop)
      const entryIndex = tree.node.entries.findIndex((entry) => entry.item.id === child.node.item.id)
      edges.push({
        id: `${tree.node.item.id}->${child.node.item.id}`,
        fromX: tree.node.x + tree.node.width,
        fromY: tree.node.y + HEADER_HEIGHT + Math.max(0, entryIndex) * ROW_HEIGHT + ROW_HEIGHT / 2,
        toX: child.node.x,
        toY: child.node.y + HEADER_HEIGHT / 2,
      })
      childTop += child.subtreeHeight + SUBTREE_GAP
    }
  }

  const tree = build(root, 0, true)
  measure(tree)
  place(tree, PADDING)
  const width = Math.max(...nodes.map((node) => node.x + node.width), NODE_WIDTH) + PADDING
  const height = Math.max(...nodes.map((node) => node.y + node.height), HEADER_HEIGHT) + PADDING
  return { nodes, edges, width, height, truncated }
}
