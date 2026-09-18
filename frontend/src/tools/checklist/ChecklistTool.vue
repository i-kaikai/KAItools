<script setup lang="ts">
import { AlertCircle, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, FileUp, FolderPlus, GripVertical, ListChecks, ListTodo, Pencil, Plus, Search, Trash2, X } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Component } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useToastStore } from '@/stores/toast'
import {
  checklistDefaultSection,
  checklistViews,
  clearCompletedChecklistItems,
  createChecklistItem,
  createChecklistList,
  emptyChecklistItemDraft,
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

function updateActiveItems(items: ChecklistItem[]): void {
  const list = activeList.value
  if (!list) return
  list.items = items
  list.updatedAt = Date.now()
}

function selectView(view: ChecklistView): void {
  model.view = view
  model.query = ''
}

function selectList(listId: string): void {
  model.activeListId = listId
  model.view = 'all'
  model.query = ''
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

function handleEditorKeydown(event: KeyboardEvent): void {
  if (!editorOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeEditor()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = dialogRef.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
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

onMounted(() => window.addEventListener('keydown', handleEditorKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleEditorKeydown))

function saveItem(): void {
  const list = activeList.value
  if (!list || !draft.title.trim()) {
    formError.value = '请填写条目名称后再保存'
    return
  }
  if (editingItemId.value) {
    updateActiveItems(updateChecklistItem(list.items, editingItemId.value, draft))
    toast.show('条目已更新', 'success')
  } else {
    const item = createChecklistItem(draft)
    if (!item) return
    updateActiveItems([{ ...item, order: -1 }, ...list.items.map((existing, index) => ({ ...existing, order: index }))])
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
        <button class="command-button primary" type="button" @click="openCreate()"><Plus :size="16" />添加条目</button>
      </div>
    </header>

    <section class="checklist-workbench" aria-label="清单工作台">
      <aside class="checklist-sidebar" aria-label="清单导航">
        <div class="checklist-sidebar-heading">
          <div><ClipboardList :size="15" aria-hidden="true" /><strong>我的清单</strong></div>
          <IconButton :icon="FolderPlus" label="新建清单" size="small" @click="startNewList" />
        </div>

        <form v-if="newListOpen" class="checklist-new-list" aria-label="新建清单" @submit.prevent="saveNewList">
          <input v-model="newListTitle" autofocus aria-label="新清单名称" maxlength="80" placeholder="例如：旅行准备" />
          <div><IconButton :icon="X" label="取消新建清单" size="small" @click="cancelNewList" /><IconButton :icon="Check" label="保存新清单" size="small" :disabled="!newListTitle.trim()" @click="saveNewList" /></div>
        </form>

        <nav class="checklist-smart-nav" aria-label="智能视图">
          <button v-for="view in checklistViews" :key="view" type="button" :class="{ active: model.view === view }" :aria-current="model.view === view ? 'page' : undefined" @click="selectView(view)">
            <component :is="viewIcons[view]" :size="15" aria-hidden="true" /><span>{{ viewLabels[view] }}</span><b>{{ view === 'all' ? openCount : view === 'today' ? todayCount : view === 'overdue' ? overdueCount : completedCount }}</b>
          </button>
        </nav>

        <div class="checklist-list-nav">
          <small>清单</small>
          <button v-for="list in model.lists" :key="list.id" type="button" :class="{ active: list.id === activeList?.id && model.view === 'all' }" @click="selectList(list.id)">
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
          <div class="checklist-view-switch" role="tablist" aria-label="清单视图">
            <button v-for="view in checklistViews" :key="view" type="button" role="tab" :aria-selected="model.view === view" :class="{ active: model.view === view }" @click="selectView(view)">{{ viewLabels[view] }}</button>
          </div>
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

        <button v-else class="checklist-add-entry" type="button" aria-label="添加清单条目" @click="openCreate()">
          <span class="checklist-add-entry-copy"><Plus :size="17" aria-hidden="true" /><span><strong>添加条目</strong><small>打开弹窗填写分类、优先级和截止日期</small></span></span>
          <ChevronRight :size="17" aria-hidden="true" />
        </button>

        <div class="checklist-item-area" role="list" aria-label="清单条目">
          <section v-for="section in filteredSections" :key="section.key" class="checklist-section">
            <header><button type="button" class="checklist-section-toggle" :aria-expanded="!isSectionCollapsed(section.key)" @click="toggleSection(section.key)"><component :is="isSectionCollapsed(section.key) ? ChevronRight : ChevronDown" :size="14" aria-hidden="true" /><strong>{{ section.title }}</strong><span>{{ section.items.filter((item) => item.completed).length }}/{{ section.items.length }}</span></button><IconButton :icon="Plus" :label="`在${section.title}中添加条目`" size="small" @click="openCreate(section.key === '__no_category__' ? '' : section.key)" /></header>
            <div v-show="!isSectionCollapsed(section.key)" class="checklist-items">
              <article v-for="item in section.items" :key="item.id" class="checklist-item" :class="{ completed: item.completed, dragging: draggedItemId === item.id }" :draggable="canReorder" role="listitem" @dragstart="startDrag(item)" @dragend="endDrag" @dragover.prevent @drop.prevent="dropItem(item)" @dblclick="openEdit(item)">
                <label class="checklist-check-control"><input type="checkbox" :checked="item.completed" :aria-label="`${item.completed ? '取消完成' : '完成'}：${item.title}`" @change="toggleItem(item)" /><span class="checklist-check-box"><Check :size="14" aria-hidden="true" /></span></label>
                <div class="checklist-item-main"><button class="checklist-item-title" type="button" @click="openEdit(item)">{{ item.title }}</button><p v-if="item.note">{{ item.note }}</p><footer><span v-if="item.dueDate" class="checklist-due" :class="dueState(item)"><CalendarDays :size="12" aria-hidden="true" />{{ dueState(item) === 'today' ? '今天' : dueState(item) === 'overdue' ? '已逾期' : dueText(item) }}</span><span v-if="item.priority !== 'medium'" class="checklist-priority" :class="item.priority">{{ item.priority === 'high' ? '高优先级' : '低优先级' }}</span></footer></div>
                <div class="checklist-item-actions"><GripVertical v-if="canReorder" :size="15" aria-hidden="true" /><IconButton :icon="Pencil" :label="`编辑条目：${item.title}`" size="small" @click="openEdit(item)" /><IconButton :icon="Trash2" :label="`删除条目：${item.title}`" size="small" danger @click="deleteItem(item)" /></div>
              </article>
            </div>
          </section>
          <div v-if="!filteredSections.length" class="checklist-empty"><ListChecks :size="26" aria-hidden="true" /><strong>{{ model.query ? '没有匹配条目' : model.view === 'completed' ? '还没有完成的条目' : model.view === 'today' ? '今天没有安排' : model.view === 'overdue' ? '没有逾期条目' : '从第一项开始建立清单' }}</strong><span>{{ model.query ? '调整搜索条件' : '准备好后，条目会显示在这里' }}</span></div>
        </div>
      </main>
    </section>

    <Teleport to="body">
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
                <label><span>分类</span><input v-model="draft.section" maxlength="60" placeholder="可留空" /></label>
                <label><span>优先级</span><select v-model="draft.priority"><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
                <div class="checklist-date-field">
                  <label class="checklist-date-label" for="checklist-due-date">截止日期</label><div class="checklist-date-control" @click="openDueDatePicker"><CalendarDays :size="15" aria-hidden="true" /><input id="checklist-due-date" ref="dueDateInput" v-model="draft.dueDate" type="date" /><IconButton :icon="X" label="清除日期" size="small" :disabled="!draft.dueDate" @click.stop="clearDueDate" /></div>
                  <div class="checklist-date-presets"><button type="button" @click="setDueDateOffset(0)">今天</button><button type="button" @click="setDueDateOffset(1)">明天</button></div>
                </div>
                <label class="checklist-editor-note"><span>备注</span><textarea v-model="draft.note" maxlength="1200" rows="3" placeholder="可选：补充下一步、联系人或交付说明" /></label>
              </div>
            </div>
            <footer><button class="command-button subtle" type="button" @click="closeEditor">取消</button><button class="command-button primary" type="submit">{{ editingItemId ? '保存修改' : '保存条目' }}</button></footer>
          </form>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>
