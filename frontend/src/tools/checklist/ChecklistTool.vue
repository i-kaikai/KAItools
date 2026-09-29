<script setup lang="ts">
import { AlertCircle, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Download, FileUp, FolderPlus, GripVertical, ListChecks, ListTodo, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Search, Trash2, X } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Component } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useToastStore } from '@/stores/toast'
import { downloadBlob } from '@/utils/download'
import {
  checklistDefaultSection,
  checklistViews,
  clearCompletedChecklistItems,
  createChecklistItem,
  createChecklistList,
  emptyChecklistItemDraft,
  formatChecklistMarkdown,
  isChecklistItemOverdue,
  isChecklistItemToday,
  moveChecklistItem,
  normalizeChecklistState,
  parseChecklistImport,
  removeChecklistItem,
  renameChecklistList,
  toggleChecklistItem,
  updateChecklistItem,
  type ChecklistItem,
  type ChecklistItemDraft,
  type ChecklistList,
  type ChecklistView,
} from '@/utils/checklist'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = reactive(normalizeChecklistState(props.state))
const editorOpen = ref(false)
const editingItemId = ref<string | null>(null)
const draggedItemId = ref<string | null>(null)
const draft = reactive<ChecklistItemDraft>(emptyChecklistItemDraft())
const formError = ref('')
const newListOpen = ref(false)
const newListTitle = ref('')
const renamingList = ref(false)
const listTitleDraft = ref('')
const importOpen = ref(false)
const importText = ref('')
const importCategory = ref('')
const newImportCategory = ref('')
const importError = ref('')
const importFileInput = ref<HTMLInputElement | null>(null)
const dialogRef = ref<HTMLElement | null>(null)
const exportOpen = ref(false)
const exportSelectedIds = ref<string[]>([])
const exportDialogRef = ref<HTMLElement | null>(null)
const sidebarCollapsed = ref(false)
const inspectorItemId = ref<string | null>(null)
const inspectorTrigger = ref<HTMLElement | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)
const dueDateInput = ref<HTMLInputElement | null>(null)
const returnFocus = ref<HTMLElement | null>(null)

const viewLabels: Record<ChecklistView, string> = { all: '全部', today: '今天', overdue: '已逾期', completed: '已完成' }
const viewIcons: Record<ChecklistView, Component> = { all: ListTodo, today: CalendarDays, overdue: AlertCircle, completed: CheckCircle2 }

watch(model, () => emit('update:state', {
  lists: model.lists.map((list) => ({ ...list, items: list.items.map((item) => ({ ...item })) })),
  activeListId: model.activeListId,
  view: model.view,
  query: model.query,
  collapsedSections: [...model.collapsedSections],
}), { deep: true, immediate: true })

const activeList = computed<ChecklistList | null>(() => model.lists.find((list) => list.id === model.activeListId) ?? model.lists[0] ?? null)
const allItems = computed(() => activeList.value?.items ?? [])
const inspectorItem = computed(() => allItems.value.find((item) => item.id === inspectorItemId.value) ?? null)
inspectorItemId.value = allItems.value[1]?.id ?? allItems.value[0]?.id ?? null
const categoryOptions = computed(() => [...new Set(allItems.value.map((item) => item.section).filter(Boolean))])
const importTitles = computed(() => parseChecklistImport(importText.value))
const openCount = computed(() => allItems.value.filter((item) => !item.completed).length)
const completedCount = computed(() => allItems.value.filter((item) => item.completed).length)
const overdueCount = computed(() => allItems.value.filter((item) => isChecklistItemOverdue(item)).length)
const todayCount = computed(() => allItems.value.filter((item) => isChecklistItemToday(item)).length)
const completionPercent = computed(() => allItems.value.length ? Math.round((completedCount.value / allItems.value.length) * 100) : 0)
const queryNeedle = computed(() => model.query.trim().toLocaleLowerCase())
const pageTitle = computed(() => model.view === 'all' ? activeList.value?.title ?? '清单' : viewLabels[model.view])
const pageSubtitle = computed(() => {
  if (model.view === 'completed') return `${completedCount.value} 项已完成`
  if (model.view === 'today') return todayCount.value ? `今天有 ${todayCount.value} 项待完成` : '今天没有安排'
  if (model.view === 'overdue') return overdueCount.value ? `${overdueCount.value} 项需要尽快处理` : '没有逾期条目'
  return openCount.value ? `${openCount.value} 项待完成 · ${completionPercent.value}% 已完成` : '清单已清空，可以开始添加条目'
})
const canReorder = computed(() => model.view === 'all' && !queryNeedle.value)

const filteredItems = computed(() => allItems.value.filter((item) => {
  if (model.view === 'completed' ? !item.completed : item.completed) return false
  if (model.view === 'today' && !isChecklistItemToday(item)) return false
  if (model.view === 'overdue' && !isChecklistItemOverdue(item)) return false
  const needle = queryNeedle.value
  return !needle || `${item.title}\n${item.note}\n${item.section}`.toLocaleLowerCase().includes(needle)
}))

const filteredSections = computed(() => {
  const sections = new Map<string, ChecklistItem[]>()
  for (const item of filteredItems.value) {
    const section = item.section || checklistDefaultSection()
    const items = sections.get(section) ?? []
    items.push(item)
    sections.set(section, items)
  }
  return [...sections.entries()].map(([key, items]) => ({ key: key || '__no_category__', title: key || '无分类', items }))
})
const exportSections = computed(() => {
  const sections = new Map<string, ChecklistItem[]>()
  for (const item of allItems.value) {
    const items = sections.get(item.section) ?? []
    items.push(item)
    sections.set(item.section, items)
  }
  return [...sections.entries()].map(([key, items]) => ({ key, title: key || '无分类', items }))
})
const exportSelectedCount = computed(() => exportSelectedIds.value.length)

watch(() => activeList.value?.id, () => {
  inspectorItemId.value = allItems.value[1]?.id ?? allItems.value[0]?.id ?? null
})

function updateActiveItems(items: ChecklistItem[]): void {
  const list = activeList.value
  if (!list) return
  list.items = items
  list.updatedAt = Date.now()
}

function updateInlineItem(item: ChecklistItem, changes: Partial<ChecklistItemDraft>): void {
  const list = activeList.value
  const current = list?.items.find((candidate) => candidate.id === item.id)
  if (!list || !current) return
  const draft: ChecklistItemDraft = {
    title: current.title,
    note: current.note,
    section: current.section,
    priority: current.priority,
    dueDate: current.dueDate,
    ...changes,
  }
  updateActiveItems(updateChecklistItem(list.items, current.id, draft))
}

function selectView(view: ChecklistView): void {
  model.view = view
  model.query = ''
  inspectorItemId.value = filteredItems.value[0]?.id ?? null
}

function selectList(listId: string): void {
  model.activeListId = listId
  model.view = 'all'
  model.query = ''
}

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function selectInspectorItem(item: ChecklistItem, event: MouseEvent): void {
  inspectorItemId.value = item.id
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, input, select') : null
  const row = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  inspectorTrigger.value = target ?? row?.querySelector<HTMLElement>('.checklist-item-title') ?? row
}

async function closeInspector(): Promise<void> {
  const itemId = inspectorItemId.value
  inspectorItemId.value = null
  await nextTick()
  const fallback = [...document.querySelectorAll<HTMLElement>('[data-checklist-inspector-trigger]')].find((element) => element.dataset.checklistInspectorTrigger === itemId)
  const target = inspectorTrigger.value?.isConnected ? inspectorTrigger.value : fallback
  if (target?.isConnected) target.focus()
}

function resetDraft(section = checklistDefaultSection()): void {
  Object.assign(draft, emptyChecklistItemDraft(section))
  editingItemId.value = null
  formError.value = ''
}

function openCreate(section = checklistDefaultSection()): void {
  resetDraft(section)
  editorOpen.value = true
}

function openEdit(item: ChecklistItem): void {
  inspectorItemId.value = item.id
  Object.assign(draft, {
    title: item.title,
    note: item.note,
    section: item.section,
    priority: item.priority,
    dueDate: item.dueDate,
  })
  editingItemId.value = item.id
  formError.value = ''
  editorOpen.value = true
}

function closeEditor(): void {
  editorOpen.value = false
  resetDraft()
}

function handleDialogKeydown(event: KeyboardEvent): void {
  const dialog = editorOpen.value ? dialogRef.value : exportOpen.value ? exportDialogRef.value : null
  if (!dialog) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (exportOpen.value) closeExportDialog()
    else closeEditor()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
  if (!focusable?.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(editorOpen, async (open, previousOpen) => {
  if (open) {
    if (!previousOpen) returnFocus.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    titleInput.value?.focus()
  } else if (previousOpen) {
    await nextTick()
    if (returnFocus.value?.isConnected) returnFocus.value.focus()
    returnFocus.value = null
  }
})

onMounted(() => window.addEventListener('keydown', handleDialogKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleDialogKeydown))

watch(exportOpen, async (open, previousOpen) => {
  if (open) {
    if (!previousOpen) returnFocus.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    exportDialogRef.value?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')?.focus()
  } else if (previousOpen) {
    await nextTick()
    if (returnFocus.value?.isConnected) returnFocus.value.focus()
    returnFocus.value = null
  }
})

function saveItem(): void {
  const list = activeList.value
  if (!list || !draft.title.trim()) {
    formError.value = '请填写条目名称后再保存'
    return
  }
  if (editingItemId.value) {
    updateActiveItems(updateChecklistItem(list.items, editingItemId.value, draft))
    inspectorItemId.value = editingItemId.value
    toast.show('条目已更新', 'success')
  } else {
    const item = createChecklistItem(draft)
    if (!item) return
    updateActiveItems([{ ...item, order: -1 }, ...list.items.map((existing, index) => ({ ...existing, order: index }))])
    inspectorItemId.value = item.id
    if (model.view !== 'all') model.view = 'all'
    toast.show('条目已添加', 'success')
  }
  closeEditor()
}

function openDueDatePicker(): void {
  const input = dueDateInput.value
  if (!input) return
  input.focus()
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void }
  pickerInput.showPicker?.()
}

function setDueDateOffset(offset: number): void {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  draft.dueDate = `${year}-${month}-${day}`
}

function clearDueDate(): void {
  draft.dueDate = ''
}

function toggleItem(item: ChecklistItem): void {
  updateActiveItems(toggleChecklistItem(allItems.value, item.id))
}

function deleteItem(item: ChecklistItem): void {
  updateActiveItems(removeChecklistItem(allItems.value, item.id))
  if (editingItemId.value === item.id) closeEditor()
  toast.show('条目已删除', 'success')
}

function clearCompleted(): void {
  if (!completedCount.value) return
  updateActiveItems(clearCompletedChecklistItems(allItems.value))
  toast.show('已清除完成条目', 'success')
}

function downloadChecklistItems(items: ChecklistItem[], suffix = ''): void {
  const list = activeList.value
  if (!list || !items.length) return
  const fileName = `${list.title}${suffix ? `-${suffix}` : ''}`.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || '清单'
  downloadBlob(new Blob([formatChecklistMarkdown(list.title, items)], { type: 'text/markdown;charset=utf-8' }), `${fileName}.md`)
  toast.show(`已导出 ${items.length} 项`, 'success')
}

function exportSection(sectionKey: string, title: string): void {
  const section = sectionKey === '__no_category__' ? '' : sectionKey
  downloadChecklistItems(allItems.value.filter((item) => item.section === section), title)
}

function exportItem(item: ChecklistItem): void {
  downloadChecklistItems([item], item.title)
}

function toggleSection(key: string): void {
  model.collapsedSections = model.collapsedSections.includes(key)
    ? model.collapsedSections.filter((item) => item !== key)
    : [...model.collapsedSections, key]
}

function isSectionCollapsed(key: string): boolean {
  return model.collapsedSections.includes(key)
}

function startDrag(item: ChecklistItem): void {
  if (canReorder.value) draggedItemId.value = item.id
}

function dropItem(target: ChecklistItem): void {
  if (!draggedItemId.value || !canReorder.value) return
  updateActiveItems(moveChecklistItem(allItems.value, draggedItemId.value, target.id))
  draggedItemId.value = null
}

function endDrag(): void {
  draggedItemId.value = null
}

function startNewList(): void {
  newListTitle.value = ''
  newListOpen.value = true
}

function saveNewList(): void {
  const list = createChecklistList(newListTitle.value)
  if (!list) return
  model.lists = [...model.lists, list]
  model.activeListId = list.id
  model.view = 'all'
  newListOpen.value = false
  newListTitle.value = ''
  toast.show('清单已创建', 'success')
}

function cancelNewList(): void {
  newListOpen.value = false
  newListTitle.value = ''
}

function openImporter(): void {
  importOpen.value = true
  importError.value = ''
}

function closeImporter(): void {
  importOpen.value = false
  importText.value = ''
  importCategory.value = ''
  newImportCategory.value = ''
  importError.value = ''
}

function chooseImportFile(): void {
  importFileInput.value?.click()
}

async function readImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    importError.value = '文件不能超过 2 MB'
    return
  }
  try {
    importText.value = await file.text()
    importError.value = ''
  } catch {
    importError.value = '文件读取失败'
  }
}

function saveImport(): void {
  const list = activeList.value
  if (!list) return
  if (!importTitles.value.length) {
    importError.value = '没有可导入的条目'
    return
  }
  const section = importCategory.value === '__new__' ? newImportCategory.value.trim().slice(0, 60) : importCategory.value
  if (importCategory.value === '__new__' && !section) {
    importError.value = '请填写新分类名称，或选择无分类'
    return
  }
  const now = Date.now()
  const imported = importTitles.value.flatMap((title, index) => {
    const item = createChecklistItem({ ...emptyChecklistItemDraft(section), title }, now + index)
    return item ? [{ ...item, order: index }] : []
  })
  updateActiveItems([
    ...imported,
    ...list.items.map((item, index) => ({ ...item, order: index + imported.length })),
  ])
  model.view = 'all'
  toast.show(`已导入 ${imported.length} 条目`, 'success')
  closeImporter()
}

function startRenameList(): void {
  listTitleDraft.value = activeList.value?.title ?? ''
  renamingList.value = true
}

function saveRenameList(): void {
  if (!activeList.value || !listTitleDraft.value.trim()) return
  model.lists = renameChecklistList(model.lists, activeList.value.id, listTitleDraft.value)
  renamingList.value = false
}

function cancelRenameList(): void {
  renamingList.value = false
}

function openExportDialog(): void {
  exportSelectedIds.value = []
  exportOpen.value = true
}

function closeExportDialog(): void {
  exportOpen.value = false
  exportSelectedIds.value = []
}

function isExportItemSelected(itemId: string): boolean {
  return exportSelectedIds.value.includes(itemId)
}

function isExportSectionSelected(sectionKey: string): boolean {
  const section = exportSections.value.find((item) => item.key === sectionKey)
  return Boolean(section?.items.length && section.items.every((item) => isExportItemSelected(item.id)))
}

function isExportSectionIndeterminate(sectionKey: string): boolean {
  const section = exportSections.value.find((item) => item.key === sectionKey)
  return Boolean(section?.items.some((item) => isExportItemSelected(item.id)) && !isExportSectionSelected(sectionKey))
}

function toggleExportItem(itemId: string, checked: boolean): void {
  exportSelectedIds.value = checked
    ? [...new Set([...exportSelectedIds.value, itemId])]
    : exportSelectedIds.value.filter((id) => id !== itemId)
}

function toggleExportSection(sectionKey: string, checked: boolean): void {
  const section = exportSections.value.find((item) => item.key === sectionKey)
  if (!section) return
  const sectionIds = new Set(section.items.map((item) => item.id))
  exportSelectedIds.value = checked
    ? [...new Set([...exportSelectedIds.value, ...sectionIds])]
    : exportSelectedIds.value.filter((id) => !sectionIds.has(id))
}

function selectAllExportItems(): void {
  exportSelectedIds.value = allItems.value.map((item) => item.id)
}

function clearExportSelection(): void {
  exportSelectedIds.value = []
}

function exportSelected(): void {
  if (!activeList.value || !exportSelectedIds.value.length) return
  const selected = new Set(exportSelectedIds.value)
  const items = activeList.value.items.filter((item) => selected.has(item.id))
  closeExportDialog()
  downloadChecklistItems(items)
}

function dueText(item: ChecklistItem): string {
  if (!item.dueDate) return ''
  const [yearText, monthText, dayText] = item.dueDate.split('-')
  const year = Number(yearText ?? 0)
  const month = Number(monthText ?? 0)
  const day = Number(dayText ?? 0)
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', year: year === new Date().getFullYear() ? undefined : 'numeric' }).format(new Date(year, month - 1, day))
}

function dueState(item: ChecklistItem): 'today' | 'overdue' | 'normal' | 'done' {
  if (item.completed) return 'done'
  if (isChecklistItemOverdue(item)) return 'overdue'
  if (isChecklistItemToday(item)) return 'today'
  return 'normal'
}
</script>

<template>
  <section class="tool-page checklist-tool">
    <header class="tool-header checklist-header">
      <div>
        <div class="checklist-kicker"><ListChecks :size="15" aria-hidden="true" />本地清单</div>
        <h1>清单工作台</h1>
        <p>{{ pageSubtitle }}</p>
      </div>
      <div class="toolbar">
        <IconButton :icon="Trash2" label="清除已完成条目" :disabled="!completedCount" danger @click="clearCompleted" />
        <button class="command-button secondary" type="button" @click="openImporter"><FileUp :size="16" />批量导入</button>
        <button class="command-button secondary" type="button" :disabled="!allItems.length" @click="openExportDialog"><Download :size="16" />导出清单</button>
        <button class="command-button primary" type="button" @click="openCreate()"><Plus :size="16" />添加条目</button>
      </div>
    </header>

    <section class="checklist-workbench" :class="{ 'checklist-sidebar-collapsed': sidebarCollapsed }" aria-label="清单工作台">
      <aside class="checklist-sidebar" aria-label="清单导航">
        <div class="checklist-sidebar-heading">
          <div><ClipboardList :size="15" aria-hidden="true" /><strong>我的清单</strong></div>
          <div class="checklist-sidebar-actions">
            <IconButton :icon="FolderPlus" label="新建清单" size="small" @click="startNewList" />
            <IconButton :icon="sidebarCollapsed ? PanelLeftOpen : PanelLeftClose" :label="sidebarCollapsed ? '展开侧栏' : '折叠侧栏'" size="small" @click="toggleSidebar" />
          </div>
        </div>

        <form v-if="newListOpen" class="checklist-new-list" aria-label="新建清单" @submit.prevent="saveNewList">
          <input v-model="newListTitle" autofocus aria-label="新清单名称" maxlength="80" placeholder="例如：旅行准备" />
          <div><IconButton :icon="X" label="取消新建清单" size="small" @click="cancelNewList" /><IconButton :icon="Check" label="保存新清单" size="small" :disabled="!newListTitle.trim()" @click="saveNewList" /></div>
        </form>

        <nav class="checklist-smart-nav" aria-label="智能视图">
          <button v-for="view in checklistViews" :key="view" type="button" :class="{ active: model.view === view }" :aria-label="viewLabels[view]" :title="viewLabels[view]" :aria-current="model.view === view ? 'page' : undefined" @click="selectView(view)">
            <component :is="viewIcons[view]" :size="15" aria-hidden="true" /><span>{{ viewLabels[view] }}</span><b>{{ view === 'all' ? openCount : view === 'today' ? todayCount : view === 'overdue' ? overdueCount : completedCount }}</b>
          </button>
        </nav>

        <div class="checklist-list-nav">
          <small>清单</small>
          <button v-for="list in model.lists" :key="list.id" type="button" :class="{ active: list.id === activeList?.id && model.view === 'all' }" :aria-label="list.title" :title="list.title" @click="selectList(list.id)">
            <i aria-hidden="true" /><span>{{ list.title }}</span><b>{{ list.items.filter((item) => !item.completed).length }}</b>
          </button>
        </div>

        <div class="checklist-local-note"><CheckCircle2 :size="14" aria-hidden="true" /><span>数据只保存在当前工作区</span></div>
      </aside>

      <main class="checklist-content">
        <header class="checklist-content-header">
          <div class="checklist-title-wrap">
            <div class="checklist-title-mark" aria-hidden="true"><ListChecks :size="18" /></div>
            <div v-if="!renamingList || model.view !== 'all'" class="checklist-title-copy">
              <div><h2>{{ pageTitle }}</h2><IconButton v-if="model.view === 'all'" :icon="Pencil" label="重命名清单" size="small" @click="startRenameList" /></div>
              <small>{{ model.view === 'all' ? `${allItems.length} 项条目` : `来自 ${activeList?.title ?? '清单'}` }}</small>
            </div>
            <form v-else class="checklist-rename-form" @submit.prevent="saveRenameList">
              <input v-model="listTitleDraft" autofocus aria-label="清单名称" maxlength="80" @keydown.esc="cancelRenameList" />
              <IconButton :icon="Check" label="保存清单名称" size="small" @click="saveRenameList" />
              <IconButton :icon="X" label="取消重命名" size="small" @click="cancelRenameList" />
            </form>
          </div>
          <div class="checklist-progress" aria-label="完成进度">
            <div><strong>{{ completionPercent }}%</strong><span>{{ completedCount }}/{{ allItems.length || 0 }}</span></div>
            <i><b :style="{ width: `${completionPercent}%` }" /></i>
          </div>
        </header>

        <div class="checklist-controls">
          <label class="checklist-search"><Search :size="15" aria-hidden="true" /><input v-model="model.query" type="search" aria-label="搜索清单条目" placeholder="搜索条目、备注或分类" /></label>
        </div>

        <section v-if="importOpen" class="checklist-importer" aria-label="批量导入">
          <header><div><strong>批量导入</strong><small>{{ importTitles.length }} 条待导入</small></div><IconButton :icon="X" label="关闭批量导入" size="small" @click="closeImporter" /></header>
          <div class="checklist-importer-body">
            <textarea v-model="importText" aria-label="批量导入内容" rows="6" placeholder="粘贴条目" />
            <div class="checklist-importer-options">
              <label><span>导入分类</span><select v-model="importCategory" aria-label="导入分类"><option value="">无分类</option><option v-for="category in categoryOptions" :key="category" :value="category">{{ category }}</option><option value="__new__">新建分类...</option></select></label>
              <label v-if="importCategory === '__new__'"><span>新分类名称</span><input v-model="newImportCategory" aria-label="新分类名称" maxlength="60" placeholder="分类名称" /></label>
              <input ref="importFileInput" class="checklist-file-input" type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json" aria-label="选择导入文件" @change="readImportFile" />
              <button class="command-button subtle checklist-file-button" type="button" @click="chooseImportFile"><FileUp :size="14" />选择文本文件</button>
              <small :class="{ error: importError }">{{ importError || '支持 TXT、CSV、JSON 文本' }}</small>
            </div>
          </div>
          <footer><button class="command-button subtle" type="button" @click="closeImporter">取消</button><button class="command-button primary" type="button" :disabled="!importTitles.length" @click="saveImport">导入条目</button></footer>
        </section>

        <button v-if="!allItems.length" class="checklist-first-add" type="button" aria-label="添加第一条清单条目" @click="openCreate()">
          <span class="checklist-first-add-copy"><span class="checklist-first-add-icon" aria-hidden="true"><ListChecks :size="19" /></span><span><strong>新建第一项</strong><small>先写下要完成的事情，详情稍后也可以修改</small></span></span>
          <Plus :size="18" aria-hidden="true" />
        </button>

        <div class="checklist-table-scroll">
          <div class="checklist-table-header" aria-hidden="true"><span></span><span>事项</span><span>分类</span><span>截止日期</span><span>优先级</span><span>操作</span></div>
          <div class="checklist-item-area" role="list" aria-label="清单条目">
            <section v-for="section in filteredSections" :key="section.key" class="checklist-section">
              <header>
                <button type="button" class="checklist-section-toggle" :aria-expanded="!isSectionCollapsed(section.key)" @click="toggleSection(section.key)">
                  <component :is="isSectionCollapsed(section.key) ? ChevronRight : ChevronDown" :size="14" aria-hidden="true" /><strong>{{ section.title }}</strong><span>{{ section.items.filter((item) => item.completed).length }}/{{ section.items.length }}</span>
                </button>
                <div class="checklist-section-actions"><button class="checklist-section-export" type="button" :disabled="!section.items.length" @click="exportSection(section.key, section.title)"><Download :size="13" />导出分类</button><IconButton :icon="Plus" :label="`在${section.title}中添加条目`" size="small" @click="openCreate(section.key === '__no_category__' ? '' : section.key)" /></div>
              </header>
              <div v-show="!isSectionCollapsed(section.key)" class="checklist-items">
                <article v-for="item in section.items" :key="item.id" class="checklist-item" :class="{ completed: item.completed, dragging: draggedItemId === item.id, selected: item.id === inspectorItem?.id }" :draggable="canReorder" role="listitem" @click="selectInspectorItem(item, $event)" @dragstart="startDrag(item)" @dragend="endDrag" @dragover.prevent @drop.prevent="dropItem(item)" @dblclick="openEdit(item)">
                  <label class="checklist-check-control"><input type="checkbox" :checked="item.completed" :aria-label="`${item.completed ? '取消完成' : '完成'}：${item.title}`" @change="toggleItem(item)" /><span class="checklist-check-box"><Check :size="14" aria-hidden="true" /></span></label>
                  <div class="checklist-item-main"><button class="checklist-item-title" type="button" :data-checklist-inspector-trigger="item.id" :aria-pressed="item.id === inspectorItem?.id">{{ item.title }}</button><p v-if="item.note">{{ item.note }}</p></div>
                  <select class="checklist-table-select checklist-table-category" :value="item.section" :aria-label="`分类：${item.title}`" @change="updateInlineItem(item, { section: ($event.target as HTMLSelectElement).value })"><option value="">无分类</option><option v-for="category in categoryOptions" :key="category" :value="category">{{ category }}</option></select>
                  <input class="checklist-table-select checklist-table-due" :class="dueState(item)" type="date" :value="item.dueDate" :aria-label="`截止日期：${item.title}`" @change="updateInlineItem(item, { dueDate: ($event.target as HTMLInputElement).value })" />
                  <select class="checklist-table-select checklist-table-priority" :class="item.priority" :value="item.priority" :aria-label="`优先级：${item.title}`" @change="updateInlineItem(item, { priority: ($event.target as HTMLSelectElement).value as ChecklistItemDraft['priority'] })"><option value="high">高</option><option value="medium">普通</option><option value="low">低</option></select>
                  <div class="checklist-item-actions" @click.stop><GripVertical v-if="canReorder" :size="14" aria-hidden="true" /><button class="checklist-row-export" type="button" :aria-label="`导出条目：${item.title}`" @click="exportItem(item)"><Download :size="13" />导出</button><IconButton :icon="Pencil" :label="`编辑条目：${item.title}`" :tooltip="false" size="small" @click="openEdit(item)" /><IconButton :icon="Trash2" :label="`删除条目：${item.title}`" :tooltip="false" size="small" danger @click="deleteItem(item)" /></div>
                </article>
              </div>
            </section>
            <div v-if="!filteredSections.length && allItems.length" class="checklist-empty"><ListChecks :size="26" aria-hidden="true" /><strong>{{ model.query ? '没有匹配条目' : model.view === 'completed' ? '还没有完成的条目' : model.view === 'today' ? '今天没有安排' : model.view === 'overdue' ? '没有逾期条目' : '从第一项开始建立清单' }}</strong><span>{{ model.query ? '调整搜索条件' : '准备好后，条目会显示在这里' }}</span></div>
          </div>
        </div>
      </main>

      <aside v-if="inspectorItem" class="checklist-inspector" aria-label="条目详情">
        <header><strong>条目详情</strong><IconButton :icon="X" label="关闭条目详情" size="small" @click="closeInspector" /></header>
        <div class="checklist-inspector-position"><span>当前事项</span><small>{{ String(allItems.findIndex((item) => item.id === inspectorItemId) + 1).padStart(2, '0') }} / {{ String(allItems.length).padStart(2, '0') }}</small></div>
        <div class="checklist-inspector-status"><button type="button" class="checklist-check-control" :aria-label="`${inspectorItem.completed ? '取消完成' : '完成'}：${inspectorItem.title}`" @click="toggleItem(inspectorItem)"><span class="checklist-check-box" :class="{ checked: inspectorItem.completed }"><Check :size="14" aria-hidden="true" /></span></button><span>{{ inspectorItem.completed ? '已完成' : '待完成' }}</span></div>
        <h3>{{ inspectorItem.title }}</h3>
        <p class="checklist-inspector-note">{{ inspectorItem.note || '尚无备注' }}</p>
        <dl class="checklist-inspector-facts"><div><dt>分类</dt><dd>{{ inspectorItem.section || '无分类' }}</dd></div><div><dt>截止日期</dt><dd>{{ inspectorItem.dueDate ? dueText(inspectorItem) : '未设置' }}</dd></div><div><dt>优先级</dt><dd>{{ inspectorItem.priority === 'high' ? '高' : inspectorItem.priority === 'low' ? '低' : '普通' }}</dd></div></dl>
        <footer><button class="command-button primary" type="button" @click="openEdit(inspectorItem)"><Pencil :size="14" />编辑条目</button><button class="command-button subtle" type="button" @click="exportItem(inspectorItem)"><Download :size="14" />导出此条</button></footer>
      </aside>
      <aside v-else class="checklist-inspector checklist-inspector-empty" aria-label="条目详情"><div><ListTodo :size="19" aria-hidden="true" /><strong>选择一项查看详情</strong><span>事项说明和截止日期会显示在这里。</span></div></aside>
    </section>

    <Teleport to="body">
      <Transition name="checklist-export-dialog">
        <div v-if="exportOpen" class="modal-backdrop checklist-export-backdrop" @pointerdown.self="closeExportDialog">
          <form ref="exportDialogRef" class="modal checklist-export-dialog" role="dialog" aria-modal="true" aria-labelledby="checklist-export-title" tabindex="-1" @submit.prevent="exportSelected">
            <header>
              <div><h2 id="checklist-export-title">导出清单</h2><p>{{ activeList?.title }} · 已选 {{ exportSelectedCount }} 项</p></div>
              <IconButton :icon="X" label="关闭导出选择" @click="closeExportDialog" />
            </header>
            <div class="checklist-export-tools">
              <span>选择分类或单项</span>
              <div><button type="button" class="command-button subtle" @click="selectAllExportItems">全选</button><button type="button" class="command-button subtle" @click="clearExportSelection">清空</button></div>
            </div>
            <div class="checklist-export-list" role="group" aria-label="选择要导出的分类和条目">
              <section v-for="section in exportSections" :key="section.key ? `section:${section.key}` : 'uncategorized'" class="checklist-export-section">
                <label class="checklist-export-section-label">
                  <input type="checkbox" :checked="isExportSectionSelected(section.key)" :indeterminate="isExportSectionIndeterminate(section.key)" :aria-label="`选择分类：${section.title}`" @change="toggleExportSection(section.key, ($event.target as HTMLInputElement).checked)" />
                  <strong>{{ section.title }}</strong><small>{{ section.items.filter((item) => isExportItemSelected(item.id)).length }}/{{ section.items.length }}</small>
                </label>
                <label v-for="item in section.items" :key="item.id" class="checklist-export-item">
                  <input type="checkbox" :checked="isExportItemSelected(item.id)" :aria-label="`选择条目：${item.title}`" @change="toggleExportItem(item.id, ($event.target as HTMLInputElement).checked)" />
                  <span>{{ item.title }}</span><small v-if="item.completed">已完成</small>
                </label>
              </section>
            </div>
            <footer><button class="command-button subtle" type="button" @click="closeExportDialog">取消</button><button class="command-button primary" type="submit" :disabled="!exportSelectedCount"><Download :size="14" />导出所选（{{ exportSelectedCount }}）</button></footer>
          </form>
        </div>
      </Transition>
      <Transition name="checklist-editor-dialog">
        <div v-if="editorOpen" class="modal-backdrop checklist-editor-backdrop" @pointerdown.self="closeEditor">
          <form ref="dialogRef" class="modal checklist-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="checklist-editor-title" @submit.prevent="saveItem">
            <header>
              <div><span class="checklist-editor-kicker">条目详情</span><h2 id="checklist-editor-title">{{ editingItemId ? '编辑条目' : '新增条目' }}</h2><p>{{ formError || '补充信息后，条目会保存到当前工作区。' }}</p></div>
              <IconButton :icon="X" label="关闭条目编辑器" @click="closeEditor" />
            </header>
            <div class="checklist-editor-dialog-body">
              <div class="checklist-editor-fields">
                <label class="checklist-editor-title"><span>条目名称</span><input ref="titleInput" v-model="draft.title" maxlength="160" /></label>
                <label><span>分类</span><input v-model="draft.section" list="checklist-category-options" maxlength="60" autocomplete="off" placeholder="搜索或输入分类" /><datalist id="checklist-category-options"><option v-for="category in categoryOptions" :key="category" :value="category" /></datalist></label>
                <label><span>优先级</span><select v-model="draft.priority"><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
                <div class="checklist-date-field">
                  <label class="checklist-date-label" for="checklist-due-date">截止日期</label><div class="checklist-date-control" @click="openDueDatePicker"><CalendarDays :size="15" aria-hidden="true" /><input id="checklist-due-date" ref="dueDateInput" v-model="draft.dueDate" type="date" /><IconButton :icon="X" label="清除日期" size="small" :disabled="!draft.dueDate" @click.stop="clearDueDate" /></div>
                  <div class="checklist-date-presets"><button type="button" @click="setDueDateOffset(0)">今天</button><button type="button" @click="setDueDateOffset(1)">明天</button></div>
                </div>
                <label class="checklist-editor-note"><span class="checklist-editor-note-label"><span>备注</span><small>{{ draft.note.length }} / 1200</small></span><textarea v-model="draft.note" maxlength="1200" rows="8" placeholder="可选：补充下一步、联系人或交付说明" /></label>
              </div>
            </div>
            <footer><button class="command-button subtle" type="button" @click="closeEditor">取消</button><button class="command-button primary" type="submit">{{ editingItemId ? '保存修改' : '保存条目' }}</button></footer>
          </form>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>
