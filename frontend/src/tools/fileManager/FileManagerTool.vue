<script setup lang="ts">
import { Copy, File, FilePlus2, Folder, FolderOpen, FolderPlus, Pencil, Search, Trash2 } from '@lucide/vue'
import { computed, ref, toRaw } from 'vue'

import { isArchivableTool } from '@/api/fileManagerStorage'
import IconButton from '@/components/IconButton.vue'
import { useAppStore } from '@/stores/app'
import { useConfirmStore } from '@/stores/confirm'
import { toolsById, workspaceTools } from '@/tools/registry'
import type { FileManagerFile, FileManagerFolder, ToolId } from '@/types'

defineProps<{ state: Record<string, unknown> }>()

type Dialog =
  | { mode: 'folder'; value: string }
  | { mode: 'rename-file'; fileId: string; value: string }
  | { mode: 'rename-folder'; folderId: string; value: string }
  | { mode: 'move-file'; fileId: string; value: string }

const app = useAppStore()
const confirm = useConfirmStore()
const selectedFolderId = ref('all')
const search = ref('')
const toolFilter = ref('all')
const selectedNewToolId = ref<ToolId>('json')
const dialog = ref<Dialog | null>(null)
const fileDateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`
}

const archiveTools = computed(() => workspaceTools.filter((tool) => isArchivableTool(tool.id)))
const folders = computed(() => [...app.fileManager.folders].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')))
const folderById = computed(() => new Map(folders.value.map((folder) => [folder.id, folder])))
const unfiledFileCount = computed(() => app.fileManager.files.reduce((count, file) => count + (file.folderId ? 0 : 1), 0))
const folderOptions = computed(() => folders.value.map((folder) => {
  const names = [folder.name]
  const seen = new Set([folder.id])
  let parentId = folder.parentId
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = folderById.value.get(parentId)
    if (!parent) break
    names.unshift(parent.name)
    parentId = parent.parentId
  }
  return { ...folder, path: names.join(' / ') }
}))
const visibleFiles = computed(() => {
  const query = search.value.trim().toLowerCase()
  return app.fileManager.files
    .filter((file) => selectedFolderId.value === 'all'
      || selectedFolderId.value === 'unfiled' && file.folderId === null
      || file.folderId === selectedFolderId.value)
    .filter((file) => toolFilter.value === 'all' || file.toolId === toolFilter.value)
    .filter((file) => !query || [file.title, toolsById[file.toolId]?.name ?? '', file.toolId].some((value) => value.toLowerCase().includes(query)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})

function save(next: { folders?: FileManagerFolder[]; files?: FileManagerFile[] }): void {
  app.setFileManager({
    schemaVersion: 1,
    folders: next.folders ?? app.fileManager.folders,
    files: next.files ?? app.fileManager.files,
  })
}

function createFolder(): void {
  dialog.value = { mode: 'folder', value: '' }
}

function openNewTool(): void {
  const tool = toolsById[selectedNewToolId.value]
  if (!tool || !isArchivableTool(tool.id)) return
  void tool.preload().catch(() => undefined)
  app.openTool(tool.id, tool.name, tool.initialState(), tool.singleton, true)
}

function openFile(file: FileManagerFile): void {
  const tool = toolsById[file.toolId]
  if (!tool) return
  void tool.preload().catch(() => undefined)
  app.openTool(tool.id, tool.name, {
    ...tool.initialState(),
    ...structuredClone(toRaw(file.state)),
    __fileManagerFileId: file.id,
    ...(file.attachments.length ? { __fileManagerAttachments: structuredClone(toRaw(file.attachments)) } : {}),
  }, tool.singleton, true)
}

function duplicateFile(file: FileManagerFile): void {
  const now = new Date().toISOString()
  const copy: FileManagerFile = {
    ...structuredClone(toRaw(file)),
    id: uid('file'),
    title: `${file.title} 副本`.slice(0, 160),
    createdAt: now,
    updatedAt: now,
  }
  save({ files: [copy, ...app.fileManager.files] })
}

async function deleteFile(file: FileManagerFile): Promise<void> {
  if (!(await confirm.ask({
    title: '删除文件？',
    message: `“${file.title}”删除后无法恢复，请确认是否继续。`,
    confirmLabel: '确认删除',
    tone: 'danger',
  }))) return
  save({ files: app.fileManager.files.filter((item) => item.id !== file.id) })
}

async function deleteFolder(folder: FileManagerFolder): Promise<void> {
  if (!(await confirm.ask({
    title: '删除文件夹？',
    message: `“${folder.name}”及其中所有文件删除后无法恢复，请确认是否继续。`,
    confirmLabel: '删除文件夹',
    tone: 'danger',
  }))) return
  const removed = new Set<string>([folder.id])
  let changed = true
  while (changed) {
    changed = false
    for (const item of app.fileManager.folders) {
      if (item.parentId && removed.has(item.parentId) && !removed.has(item.id)) {
        removed.add(item.id)
        changed = true
      }
    }
  }
  save({
    folders: app.fileManager.folders.filter((item) => !removed.has(item.id)),
    files: app.fileManager.files.filter((item) => !item.folderId || !removed.has(item.folderId)),
  })
  if (removed.has(selectedFolderId.value)) selectedFolderId.value = 'all'
}

function saveDialog(): void {
  const current = dialog.value
  if (!current) return
  const value = current.value.trim()
  if (current.mode === 'folder') {
    if (!value) return
    const now = new Date().toISOString()
    const parentId = selectedFolderId.value === 'all' || selectedFolderId.value === 'unfiled' ? null : selectedFolderId.value
    save({ folders: [...app.fileManager.folders, { id: uid('folder'), parentId, name: value.slice(0, 120), createdAt: now, updatedAt: now }] })
  } else if (current.mode === 'rename-file') {
    if (!value) return
    save({ files: app.fileManager.files.map((file) => file.id === current.fileId ? { ...file, title: value.slice(0, 160), updatedAt: new Date().toISOString() } : file) })
  } else if (current.mode === 'rename-folder') {
    if (!value) return
    save({ folders: app.fileManager.folders.map((folder) => folder.id === current.folderId ? { ...folder, name: value.slice(0, 120), updatedAt: new Date().toISOString() } : folder) })
  } else {
    save({ files: app.fileManager.files.map((file) => file.id === current.fileId ? { ...file, folderId: current.value || null, updatedAt: new Date().toISOString() } : file) })
  }
  dialog.value = null
}

function toolName(file: FileManagerFile): string {
  return toolsById[file.toolId]?.name ?? file.toolId
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知时间' : fileDateFormatter.format(date)
}
</script>

<template>
  <section class="tool-page file-manager-page">
    <header class="tool-header file-manager-header">
      <div>
        <span class="tool-kicker"><FolderOpen :size="14" />LOCAL ARCHIVE</span>
        <h1>文件管理器</h1>
        <p>文件仅保存于当前设备，手动归档后可在对应工具中继续编辑。</p>
      </div>
      <div class="toolbar file-manager-actions">
        <select v-model="selectedNewToolId" aria-label="新建文件的工具类型">
          <option v-for="tool in archiveTools" :key="tool.id" :value="tool.id">{{ tool.name }}</option>
        </select>
        <button class="command-button" type="button" @click="openNewTool"><FilePlus2 :size="16" />新建工具文件</button>
        <button class="command-button subtle" type="button" @click="createFolder"><FolderPlus :size="16" />文件夹</button>
      </div>
    </header>

    <div class="file-manager-workspace">
      <aside class="file-manager-tree" aria-label="文件夹">
        <button type="button" :class="{ active: selectedFolderId === 'all' }" @click="selectedFolderId = 'all'"><FolderOpen :size="16" />全部文件<small>{{ app.fileManager.files.length }}</small></button>
        <button type="button" :class="{ active: selectedFolderId === 'unfiled' }" @click="selectedFolderId = 'unfiled'"><Folder :size="16" />未分类<small>{{ unfiledFileCount }}</small></button>
        <div class="file-manager-folder-list">
          <div v-for="folder in folderOptions" :key="folder.id" class="file-manager-folder-row">
            <button type="button" :class="{ active: selectedFolderId === folder.id }" :style="{ paddingLeft: `${12 + Math.max(0, folder.path.split(' / ').length - 1) * 14}px` }" @click="selectedFolderId = folder.id"><Folder :size="16" /><span>{{ folder.name }}</span></button>
            <span class="file-manager-folder-actions"><IconButton :icon="Pencil" :label="`重命名 ${folder.name}`" size="small" @click="dialog = { mode: 'rename-folder', folderId: folder.id, value: folder.name }" /><IconButton :icon="Trash2" :label="`删除 ${folder.name}`" size="small" danger @click="deleteFolder(folder)" /></span>
          </div>
        </div>
      </aside>

      <section class="file-manager-content" aria-label="档案文件">
        <div class="file-manager-filterbar">
          <label class="file-manager-search"><Search :size="16" /><input v-model="search" type="search" placeholder="搜索文件名或工具" /></label>
          <select v-model="toolFilter" aria-label="按工具筛选"><option value="all">全部工具</option><option v-for="tool in archiveTools" :key="tool.id" :value="tool.id">{{ tool.name }}</option></select>
          <span>{{ visibleFiles.length }} 个文件</span>
        </div>

        <div v-if="visibleFiles.length" class="file-manager-list" role="list">
          <article v-for="file in visibleFiles" :key="file.id" class="file-manager-item" role="listitem">
            <button class="file-manager-open" type="button" @click="openFile(file)"><span class="file-manager-file-icon"><File :size="19" /></span><span><strong>{{ file.title }}</strong><small>{{ toolName(file) }} · {{ formatTime(file.updatedAt) }}</small></span></button>
            <div class="file-manager-item-meta"><span>{{ file.attachments.length ? `${file.attachments.length} 个附件` : '内容快照' }}</span><IconButton :icon="Copy" :label="`另存为 ${file.title}`" size="small" @click="duplicateFile(file)" /><IconButton :icon="FolderOpen" :label="`移动 ${file.title}`" size="small" @click="dialog = { mode: 'move-file', fileId: file.id, value: file.folderId ?? '' }" /><IconButton :icon="Pencil" :label="`重命名 ${file.title}`" size="small" @click="dialog = { mode: 'rename-file', fileId: file.id, value: file.title }" /><IconButton :icon="Trash2" :label="`删除 ${file.title}`" size="small" danger @click="deleteFile(file)" /></div>
          </article>
        </div>
        <div v-else class="file-manager-empty"><FolderOpen :size="30" /><strong>没有匹配的文件</strong><span>在任意工具中手动保存内容，或先新建一个工具文件。</span></div>
      </section>
    </div>

    <div v-if="dialog" class="file-manager-dialog-backdrop" @pointerdown.self="dialog = null">
      <form class="file-manager-dialog" @submit.prevent="saveDialog">
        <header><strong>{{ dialog.mode === 'folder' ? '新建文件夹' : dialog.mode === 'rename-file' || dialog.mode === 'rename-folder' ? '重命名' : '移动文件' }}</strong><button type="button" aria-label="关闭" @click="dialog = null">×</button></header>
        <select v-if="dialog.mode === 'move-file'" v-model="dialog.value" aria-label="目标文件夹"><option value="">未分类</option><option v-for="folder in folderOptions" :key="folder.id" :value="folder.id">{{ folder.path }}</option></select>
        <input v-else v-model="dialog.value" maxlength="160" autofocus :placeholder="dialog.mode === 'folder' ? '文件夹名称' : '文件名称'" />
        <footer><button class="command-button subtle" type="button" @click="dialog = null">取消</button><button class="command-button" type="submit">保存</button></footer>
      </form>
    </div>
  </section>
</template>
