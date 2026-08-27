<script setup lang="ts">
import { BookOpenText, ChevronDown, ChevronRight, FileText, Folder } from '@lucide/vue'
import { computed } from 'vue'

import type { NotesTreeNode } from '@/tools/notes/notesOperations'

const props = defineProps<{
  node: NotesTreeNode
  nodes: NotesTreeNode[]
  selectedKey: string
  expandedKeys: Set<string>
}>()

const emit = defineEmits<{
  select: [node: NotesTreeNode]
  toggle: [key: string]
}>()

const children = computed(() => props.nodes
  .filter((node) => node.parentKey === props.node.key)
  .sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, 'zh-CN')))
const expandable = computed(() => children.value.length > 0)
const expanded = computed(() => props.expandedKeys.has(props.node.key))
</script>

<template>
  <div class="notes-tree-node" :class="[`kind-${node.kind}`, { selected: selectedKey === node.key }]">
    <div class="notes-tree-row">
      <button v-if="expandable" class="notes-tree-toggle" type="button" :aria-label="expanded ? '折叠' : '展开'" @click.stop="emit('toggle', node.key)"><ChevronDown v-if="expanded" :size="14" /><ChevronRight v-else :size="14" /></button>
      <span v-else class="notes-tree-spacer" />
      <button class="notes-tree-main" type="button" :aria-current="selectedKey === node.key ? 'true' : undefined" @click="emit('select', node)">
        <BookOpenText v-if="node.kind === 'notebook'" :size="15" />
        <Folder v-else-if="node.kind === 'folder'" :size="15" />
        <FileText v-else :size="14" />
        <span>{{ node.title }}</span><i v-if="node.pinned" aria-label="已置顶">●</i>
      </button>
    </div>
    <div v-if="expandable && expanded" class="notes-tree-children">
      <NotesTreeNode v-for="child in children" :key="child.key" :node="child" :nodes="nodes" :selected-key="selectedKey" :expanded-keys="expandedKeys" @select="emit('select', $event)" @toggle="emit('toggle', $event)" />
    </div>
  </div>
</template>
