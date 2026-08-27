<script setup lang="ts">
import { ArrowDown, ArrowUp, BookOpenText, FilePlus2, FolderPlus, Menu, Pencil, Pin, Plus, Search, Trash2, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import { useAppStore } from '@/stores/app'
import NotesTreeNode from '@/tools/notes/NotesTreeNode.vue'
import {
  createFolder, createNote, createNotebook, deleteNode, moveNote, noteTree, renameNode, togglePinnedNote,
  updateNote as updateNoteDocument, type NotesTreeNode as TreeNode,
} from '@/tools/notes/notesOperations'

defineProps<{ state: Record<string, unknown> }>()

const app = useAppStore()
const selectedKey = ref('')
const activeNoteId = ref('')
const search = ref('')
const viewMode = ref<'edit' | 'preview' | 'split'>('edit')
const treeCollapsed = ref(false)
const mobileTreeOpen = ref(false)
const expandedKeys = ref(new Set<string>())
const dialog = ref<{ mode: 'notebook' | 'folder' | 'rename' | 'delete'; value: string } | null>(null)

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`
}

const nodes = computed(() => noteTree(app.notes, search.value))
const selectedNode = computed(() => nodes.value.find((node) => node.key === selectedKey.value) ?? null)
const activeNote = computed(() => app.notes.notes.find((note) => note.id === activeNoteId.value) ?? app.notes.notes[0] ?? null)
const activeNotebookId = computed(() => {
  const selected = selectedNode.value
  if (!selected) return activeNote.value?.notebookId ?? app.notes.notebooks[0]?.id ?? ''
  if (selected.kind === 'notebook') return selected.id
  if (selected.kind === 'folder') return app.notes.folders.find((folder) => folder.id === selected.id)?.notebookId ?? ''
  return app.notes.notes.find((note) => note.id === selected.id)?.notebookId ?? ''
})
const activeFolderId = computed<string | null>(() => {
  const selected = selectedNode.value
  if (!selected) return activeNote.value?.folderId ?? null
  if (selected.kind === 'folder') return selected.id
  if (selected.kind === 'note') return app.notes.notes.find((note) => note.id === selected.id)?.folderId ?? null
  return null
})
const folderOptions = computed(() => app.notes.folders
  .filter((folder) => folder.notebookId === activeNote.value?.notebookId)
  .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN')))
const canDeleteSelected = computed(() => selectedNode.value?.kind !== 'notebook' || app.notes.notebooks.length > 1)

watch(nodes, (tree) => {
  if (!tree.length) { selectedKey.value = ''; activeNoteId.value = ''; return }
  const keys = new Set(tree.map((node) => node.key))
  if (!keys.has(selectedKey.value)) selectedKey.value = tree.find((node) => node.kind === 'note')?.key ?? tree[0]!.key
  if (!tree.some((node) => node.kind === 'note' && node.id === activeNoteId.value)) activeNoteId.value = tree.find((node) => node.kind === 'note')?.id ?? ''
  const next = new Set(expandedKeys.value)
  for (const node of tree) if (node.kind !== 'note') next.add(node.key)
  expandedKeys.value = next
}, { immediate: true })

function descendantsOf(parentKey: string): TreeNode[] {
  const result: TreeNode[] = []
  const visit = (key: string) => {
    for (const node of nodes.value.filter((item) => item.parentKey === key)) { result.push(node); visit(node.key) }
  }
  visit(parentKey)
  return result
}

function expandAncestors(key: string): void {
  const next = new Set(expandedKeys.value)
  let current = nodes.value.find((node) => node.key === key)
  while (current?.parentKey) { next.add(current.parentKey); current = nodes.value.find((node) => node.key === current?.parentKey) }
  expandedKeys.value = next
}

function selectNode(node: TreeNode): void {
  selectedKey.value = node.key
  expandAncestors(node.key)
  if (node.kind === 'note') activeNoteId.value = node.id
  else {
    const firstChildNote = descendantsOf(node.key).find((item) => item.kind === 'note')
    if (firstChildNote) activeNoteId.value = firstChildNote.id
  }
  mobileTreeOpen.value = false
}

function toggleExpanded(key: string): void {
  const next = new Set(expandedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedKeys.value = next
}

function toggleTree(): void {
  if (window.matchMedia('(max-width: 900px)').matches) {
    mobileTreeOpen.value = !mobileTreeOpen.value
    return
  }
  treeCollapsed.value = !treeCollapsed.value
}

function save(next: typeof app.notes): void { app.setNotes(next) }
function openCreate(mode: 'notebook' | 'folder'): void { dialog.value = { mode, value: '' } }

function createNewNote(): void {
  const notebookId = activeNotebookId.value || app.notes.notebooks[0]?.id
  if (!notebookId) return
  const noteId = uid('note')
  save(createNote(app.notes, noteId, notebookId, activeFolderId.value))
  selectedKey.value = `note:${noteId}`
  activeNoteId.value = noteId
  expandAncestors(selectedKey.value)
}

function openRename(): void {
  if (selectedNode.value) dialog.value = { mode: 'rename', value: selectedNode.value.title }
}
function requestDelete(): void {
  if (selectedNode.value && canDeleteSelected.value) dialog.value = { mode: 'delete', value: selectedNode.value.title }
}

function saveDialog(): void {
  const current = dialog.value
  const name = current?.value.trim()
  if (!current || !name) return
  if (current.mode === 'notebook') {
    const notebookId = uid('notebook')
    save(createNotebook(app.notes, notebookId, name))
    selectedKey.value = `notebook:${notebookId}`
    expandedKeys.value = new Set([...expandedKeys.value, selectedKey.value])
  } else if (current.mode === 'folder') {
    const notebookId = activeNotebookId.value || app.notes.notebooks[0]?.id
    if (!notebookId) return
    const folderId = uid('folder')
    save(createFolder(app.notes, folderId, notebookId, activeFolderId.value, name))
    selectedKey.value = `folder:${folderId}`
    expandAncestors(selectedKey.value)
    expandedKeys.value = new Set([...expandedKeys.value, selectedKey.value])
  } else if (current.mode === 'rename' && selectedNode.value) {
    save(renameNode(app.notes, selectedNode.value.key, name))
  }
  dialog.value = null
}

function confirmDelete(): void {
  if (!selectedNode.value) return
  save(deleteNode(app.notes, selectedNode.value.key))
  dialog.value = null
}
function updateCurrentNote(patch: Parameters<typeof updateNoteDocument>[2]): void {
  if (activeNote.value) save(updateNoteDocument(app.notes, activeNote.value.id, patch))
}
function togglePinned(): void { if (activeNote.value) save(togglePinnedNote(app.notes, activeNote.value.id)) }
function reorder(direction: -1 | 1): void { if (activeNote.value) save(moveNote(app.notes, activeNote.value.id, direction)) }

function renderMarkdown(content: string): string {
  const escape = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character)
  const inline = (value: string) => escape(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return content.split('\n').map((line) => {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) return `<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`
    if (/^[-*]\s+/.test(line)) return `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`
    return line.trim() ? `<p>${inline(line)}</p>` : ''
  }).join('')
}
</script>

<template>
  <section class="tool-page notes-page">
    <header class="tool-header notes-header">
      <div><span class="tool-kicker"><BookOpenText :size="14" />LOCAL NOTES</span><h1>笔记</h1><p>Markdown 内容仅保存在当前设备；服务不可用时仍可继续编辑。</p></div>
      <div class="toolbar notes-toolbar"><button class="command-button" type="button" @click="createNewNote"><FilePlus2 :size="16" />新建笔记</button><button class="command-button subtle" type="button" @click="openCreate('folder')"><FolderPlus :size="16" />文件夹</button><IconButton :icon="Menu" :label="treeCollapsed ? '展开笔记树' : '收起笔记树'" size="small" @click="toggleTree" /></div>
    </header>

    <div class="notes-workspace" :class="{ 'tree-collapsed': treeCollapsed, 'tree-open-mobile': mobileTreeOpen }">
      <aside class="notes-tree-panel" aria-label="笔记树">
        <div class="notes-tree-toolbar"><label class="notes-search"><Search :size="15" /><input v-model="search" type="search" placeholder="搜索笔记" /></label><IconButton :icon="Plus" label="新建笔记本" size="small" @click="openCreate('notebook')" /></div>
        <div class="notes-tree-scroll" role="tree" aria-label="笔记本、文件夹和笔记"><NotesTreeNode v-for="node in nodes.filter((item) => item.parentKey === null)" :key="node.key" :node="node" :nodes="nodes" :selected-key="selectedKey" :expanded-keys="expandedKeys" @select="selectNode" @toggle="toggleExpanded" /><div v-if="!nodes.length" class="notes-tree-empty">没有匹配的笔记</div></div>
        <div v-if="selectedNode" class="notes-context-actions" aria-label="当前节点命令"><span>{{ selectedNode.kind === 'notebook' ? '笔记本' : selectedNode.kind === 'folder' ? '文件夹' : '笔记' }}</span><div><button type="button" @click="createNewNote"><FilePlus2 :size="14" />新建笔记</button><button v-if="selectedNode.kind !== 'note'" type="button" @click="openCreate('folder')"><FolderPlus :size="14" />新建文件夹</button><button type="button" @click="openRename"><Pencil :size="14" />重命名</button><button class="danger" type="button" :disabled="!canDeleteSelected" @click="requestDelete"><Trash2 :size="14" />删除</button></div></div>
      </aside>

      <section v-if="activeNote" class="notes-editor-panel" aria-label="Markdown 笔记编辑器">
        <header class="notes-editor-toolbar"><input :value="activeNote.title" aria-label="笔记标题" @input="updateCurrentNote({ title: ($event.target as HTMLInputElement).value || '未命名笔记' })" /><div><select :value="activeNote.folderId ?? ''" aria-label="移动到文件夹" @change="updateCurrentNote({ folderId: ($event.target as HTMLSelectElement).value || null })"><option value="">未分类</option><option v-for="folder in folderOptions" :key="folder.id" :value="folder.id">{{ folder.name }}</option></select><IconButton :icon="Pin" :active="activeNote.pinned" :label="activeNote.pinned ? '取消置顶' : '置顶到首页'" size="small" @click="togglePinned" /><IconButton :icon="ArrowUp" label="上移笔记" size="small" @click="reorder(-1)" /><IconButton :icon="ArrowDown" label="下移笔记" size="small" @click="reorder(1)" /><IconButton :icon="Pencil" label="重命名笔记" size="small" @click="selectedKey = `note:${activeNote.id}`; openRename()" /><IconButton :icon="Trash2" label="删除笔记" size="small" danger @click="selectedKey = `note:${activeNote.id}`; requestDelete()" /></div></header>
        <div class="notes-mode-switch" role="tablist" aria-label="笔记视图"><button type="button" :class="{ active: viewMode === 'edit' }" @click="viewMode = 'edit'">编辑</button><button type="button" :class="{ active: viewMode === 'split' }" @click="viewMode = 'split'">分栏</button><button type="button" :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">预览</button><small><i class="local" />本地保存</small></div>
        <div class="notes-content" :class="`mode-${viewMode}`"><div v-show="viewMode !== 'preview'" class="notes-code"><CodeEditor :model-value="activeNote.content" language="markdown" label="Markdown 笔记内容" @update:model-value="updateCurrentNote({ content: $event })" /></div><article v-show="viewMode !== 'edit'" class="notes-preview markdown-preview" v-html="renderMarkdown(activeNote.content)" /></div>
      </section>
      <section v-else class="notes-no-selection"><BookOpenText :size="28" /><strong>选择或新建一篇笔记</strong><button class="command-button" type="button" @click="createNewNote">新建笔记</button></section>
    </div>

    <div v-if="dialog" class="notes-dialog-backdrop" @pointerdown.self="dialog = null"><form class="notes-dialog" @submit.prevent="dialog.mode === 'delete' ? confirmDelete() : saveDialog()"><header><strong>{{ dialog.mode === 'delete' ? `删除 ${dialog.value}` : dialog.mode === 'rename' ? '重命名' : dialog.mode === 'notebook' ? '新建笔记本' : '新建文件夹' }}</strong><button type="button" aria-label="关闭" @click="dialog = null"><X :size="17" /></button></header><p v-if="dialog.mode === 'delete'">{{ selectedNode?.kind === 'folder' ? '将递归删除其中的子文件夹和笔记，此操作无法撤销。' : '此操作无法撤销。' }}</p><input v-else v-model="dialog.value" maxlength="200" autofocus @keydown.enter.prevent="saveDialog" /><footer><button type="button" class="command-button subtle" @click="dialog = null">取消</button><button class="command-button" :class="{ danger: dialog.mode === 'delete' }" type="button" @click="dialog.mode === 'delete' ? confirmDelete() : saveDialog()">{{ dialog.mode === 'delete' ? '确认删除' : '保存' }}</button></footer></form></div>
  </section>
</template>
