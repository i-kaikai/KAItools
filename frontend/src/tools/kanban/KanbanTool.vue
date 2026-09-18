<script setup lang="ts">
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Circle, CircleDot, GripVertical, ListTodo, Pencil, Plus, Search, Trash2, X } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useToastStore } from '@/stores/toast'
import {
  clearCompletedKanbanTasks,
  createKanbanTask,
  emptyKanbanDraft,
  isKanbanTaskOverdue,
  kanbanStatuses,
  moveKanbanTask,
  normalizeKanbanState,
  removeKanbanTask,
  updateKanbanTask,
  type KanbanPriority,
  type KanbanStatus,
  type KanbanTask,
  type KanbanTaskDraft,
} from '@/utils/kanban'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = reactive(normalizeKanbanState(props.state))
const formOpen = ref(false)
const editingTaskId = ref<string | null>(null)
const draggedTaskId = ref<string | null>(null)
const draft = reactive<KanbanTaskDraft>(emptyKanbanDraft())
const formError = ref('')
const dialogRef = ref<HTMLElement | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)
const dueDateInput = ref<HTMLInputElement | null>(null)
const returnFocus = ref<HTMLElement | null>(null)

const statusLabels: Record<KanbanStatus, string> = { todo: '待办', doing: '进行中', done: '已完成' }
const statusDescriptions: Record<KanbanStatus, string> = { todo: '收集下一步', doing: '正在推进', done: '已归档' }
const statusIcons = { todo: Circle, doing: CircleDot, done: CheckCircle2 } satisfies Record<KanbanStatus, typeof Circle>
const priorityLabels: Record<KanbanPriority, string> = { high: '高优先级', medium: '中优先级', low: '低优先级' }

watch(model, () => emit('update:state', {
  tasks: model.tasks.map((task) => ({ ...task })),
  filter: model.filter,
  query: model.query,
}), { deep: true, immediate: true })

const totalOpen = computed(() => model.tasks.filter((task) => task.status !== 'done').length)
const completedCount = computed(() => model.tasks.filter((task) => task.status === 'done').length)
const overdueCount = computed(() => model.tasks.filter((task) => isKanbanTaskOverdue(task)).length)
const completionRate = computed(() => model.tasks.length ? Math.round((completedCount.value / model.tasks.length) * 100) : 0)
const queryNeedle = computed(() => model.query.trim().toLocaleLowerCase())

function taskMatches(task: KanbanTask): boolean {
  if (model.filter === 'open' && task.status === 'done') return false
  if (model.filter === 'overdue' && !isKanbanTaskOverdue(task)) return false
  const needle = queryNeedle.value
  return !needle || `${task.title}\n${task.note}`.toLocaleLowerCase().includes(needle)
}

function tasksFor(status: KanbanStatus): KanbanTask[] {
  return model.tasks.filter((task) => task.status === status && taskMatches(task))
}

function statusCount(status: KanbanStatus): number {
  return model.tasks.filter((task) => task.status === status).length
}

function statusIndex(status: KanbanStatus): number {
  return kanbanStatuses.indexOf(status)
}

function resetDraft(status: KanbanStatus = 'todo'): void {
  Object.assign(draft, emptyKanbanDraft(status))
  editingTaskId.value = null
  formError.value = ''
}

function openCreate(status: KanbanStatus = 'todo'): void {
  resetDraft(status)
  formOpen.value = true
}

function openEdit(task: KanbanTask): void {
  Object.assign(draft, {
    title: task.title,
    note: task.note,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
  })
  editingTaskId.value = task.id
  formError.value = ''
  formOpen.value = true
}

function closeForm(): void {
  formOpen.value = false
  resetDraft()
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

function handleDialogKeydown(event: KeyboardEvent): void {
  if (!formOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeForm()
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

watch(formOpen, async (open, previousOpen) => {
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

function saveTask(): void {
  if (!draft.title.trim()) {
    formError.value = '请填写任务名称后再保存'
    return
  }
  if (editingTaskId.value) {
    model.tasks = updateKanbanTask(model.tasks, editingTaskId.value, draft)
    toast.show('任务已更新', 'success')
  } else {
    const task = createKanbanTask(draft)
    if (!task) return
    model.tasks = [task, ...model.tasks]
    toast.show('任务已添加到看板', 'success')
  }
  closeForm()
}

function moveTask(task: KanbanTask, status: KanbanStatus): void {
  model.tasks = moveKanbanTask(model.tasks, task.id, status)
}

function moveTaskByOffset(task: KanbanTask, offset: -1 | 1): void {
  const target = kanbanStatuses[statusIndex(task.status) + offset]
  if (target) moveTask(task, target)
}

function dropTask(status: KanbanStatus): void {
  if (!draggedTaskId.value) return
  model.tasks = moveKanbanTask(model.tasks, draggedTaskId.value, status)
  draggedTaskId.value = null
}

function deleteTask(task: KanbanTask): void {
  model.tasks = removeKanbanTask(model.tasks, task.id)
  if (editingTaskId.value === task.id) closeForm()
  toast.show('任务已删除', 'success')
}

function clearCompleted(): void {
  if (!completedCount.value) return
  model.tasks = clearCompletedKanbanTasks(model.tasks)
  toast.show('已清除完成任务', 'success')
}

function dueText(task: KanbanTask): string {
  if (!task.dueDate) return '未设置截止日'
  const [yearText, monthText, dayText] = task.dueDate.split('-')
  const year = Number(yearText ?? 0)
  const month = Number(monthText ?? 0)
  const day = Number(dayText ?? 0)
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', year: year === new Date().getFullYear() ? undefined : 'numeric' }).format(new Date(year, month - 1, day))
}

function dueState(task: KanbanTask): 'none' | 'overdue' | 'done' | 'active' {
  if (!task.dueDate) return 'none'
  if (task.status === 'done') return 'done'
  return isKanbanTaskOverdue(task) ? 'overdue' : 'active'
}
</script>

<template>
  <section class="tool-page kanban-tool kanban-modern">
    <header class="tool-header kanban-modern-header">
      <div class="kanban-header-copy">
        <div class="kanban-eyebrow"><ListTodo :size="15" aria-hidden="true" />LOCAL BOARD</div>
        <h1>轻量任务看板</h1>
        <p>任务仅保存在当前工作区。{{ totalOpen ? `还有 ${totalOpen} 项待处理${overdueCount ? `，其中 ${overdueCount} 项已逾期` : ''}` : '当前没有待处理任务。' }}</p>
      </div>
      <section class="kanban-overview kanban-header-overview" aria-label="任务概览">
        <div class="kanban-overview-lead"><strong>{{ completionRate }}%</strong><div><b>{{ completedCount ? '持续推进中' : '从第一项开始' }}</b><span>{{ model.tasks.length ? `${completedCount} / ${model.tasks.length} 项任务已完成` : '准备好后，任务会显示在这里' }}</span></div></div>
        <div class="kanban-overview-stats"><div><span>待处理</span><b>{{ totalOpen }}</b></div><div><span>进行中</span><b>{{ statusCount('doing') }}</b></div><div class="warning"><span>已逾期</span><b>{{ overdueCount }}</b></div></div>
        <div class="kanban-overview-bar" aria-hidden="true"><i><b :style="{ width: `${completionRate}%` }" /></i></div>
      </section>
      <div class="toolbar">
        <IconButton :icon="Trash2" label="清除已完成任务" :disabled="!completedCount" danger @click="clearCompleted" />
        <button class="command-button primary" type="button" @click="openCreate()"><Plus :size="16" />新建任务</button>
      </div>
    </header>

    <div class="kanban-controls kanban-modern-controls">
      <label class="kanban-search"><Search :size="16" aria-hidden="true" /><input v-model="model.query" type="search" aria-label="搜索任务" placeholder="搜索任务名称或备注" /></label>
      <label class="kanban-filter"><span>查看</span><select v-model="model.filter" aria-label="任务筛选"><option value="all">全部任务</option><option value="open">未完成</option><option value="overdue">已逾期</option></select></label>
      <small>{{ model.tasks.length }} 项任务 · {{ completedCount }} 项完成</small>
    </div>

    <section class="kanban-board kanban-modern-board" aria-label="任务看板">
      <section v-for="status in kanbanStatuses" :key="status" class="kanban-column kanban-modern-column" :class="`status-${status}`" @dragover.prevent @drop.prevent="dropTask(status)">
        <header class="kanban-column-header"><div class="kanban-column-heading"><span class="kanban-column-icon"><component :is="statusIcons[status]" :size="17" aria-hidden="true" /></span><div><strong>{{ statusLabels[status] }}</strong><small>{{ statusDescriptions[status] }}</small></div><b>{{ tasksFor(status).length }}</b></div><IconButton :icon="Plus" :label="`在${statusLabels[status]}中添加任务`" size="small" @click="openCreate(status)" /></header>
        <div class="kanban-task-list" role="list" :aria-label="statusLabels[status]">
          <article v-for="task in tasksFor(status)" :key="task.id" class="kanban-task kanban-modern-task" draggable="true" role="listitem" @dragstart="draggedTaskId = task.id" @dragend="draggedTaskId = null" @dblclick="openEdit(task)">
            <header class="kanban-task-topline"><span class="kanban-priority" :class="task.priority"><i aria-hidden="true" />{{ priorityLabels[task.priority] }}</span><div class="kanban-task-actions"><GripVertical :size="15" aria-hidden="true" /><IconButton :icon="Pencil" :label="`编辑任务：${task.title}`" size="small" @click="openEdit(task)" /><IconButton :icon="Trash2" :label="`删除任务：${task.title}`" size="small" danger @click="deleteTask(task)" /></div></header>
            <div class="kanban-task-title"><span class="kanban-status-dot" aria-hidden="true" /><strong>{{ task.title }}</strong></div>
            <p v-if="task.note">{{ task.note }}</p>
            <footer><span :class="['kanban-due', dueState(task)]"><CalendarDays :size="13" aria-hidden="true" />{{ dueText(task) }}</span><div class="kanban-task-movers"><IconButton :icon="ArrowLeft" :label="`将 ${task.title} 移到上一列`" size="small" :disabled="statusIndex(task.status) === 0" @click="moveTaskByOffset(task, -1)" /><IconButton :icon="ArrowRight" :label="`将 ${task.title} 移到下一列`" size="small" :disabled="statusIndex(task.status) === kanbanStatuses.length - 1" @click="moveTaskByOffset(task, 1)" /></div></footer>
          </article>
          <div v-if="!tasksFor(status).length" class="kanban-empty"><ListTodo :size="22" aria-hidden="true" /><strong>{{ model.query || model.filter !== 'all' ? '没有匹配任务' : `暂无${statusLabels[status]}任务` }}</strong><span>{{ model.query || model.filter !== 'all' ? '调整搜索或筛选条件' : '拖入任务，或使用下方按钮添加' }}</span></div>
          <button class="kanban-column-add" type="button" :aria-label="`在${statusLabels[status]}列底部添加任务`" @click="openCreate(status)"><Plus :size="15" aria-hidden="true" />添加任务</button>
        </div>
      </section>
    </section>

    <Teleport to="body">
      <Transition name="kanban-task-dialog">
        <div v-if="formOpen" class="modal-backdrop kanban-task-dialog-backdrop" @pointerdown.self="closeForm">
          <form ref="dialogRef" class="modal kanban-task-dialog" role="dialog" aria-modal="true" aria-labelledby="kanban-task-dialog-title" @submit.prevent="saveTask">
            <header>
              <div class="kanban-dialog-heading-mark" aria-hidden="true"><ListTodo :size="19" /></div>
              <div><span class="kanban-editor-kicker">任务详情</span><h2 id="kanban-task-dialog-title">{{ editingTaskId ? '编辑任务' : '新建任务' }}</h2><p>{{ formError || '把下一步安排清楚，再开始推进。' }}</p></div>
              <IconButton :icon="X" label="关闭任务编辑器" @click="closeForm" />
            </header>
            <div class="kanban-task-dialog-body">
              <div class="kanban-draft-fields">
                <label class="kanban-draft-title"><span>任务名称</span><input ref="titleInput" v-model="draft.title" maxlength="120" placeholder="例如：整理本周会议纪要" /></label>
                <div class="kanban-task-dialog-meta">
                  <label><span>状态</span><select v-model="draft.status"><option value="todo">待办</option><option value="doing">进行中</option><option value="done">已完成</option></select></label>
                  <label><span>优先级</span><select v-model="draft.priority"><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
                  <div class="kanban-date-field">
                    <label class="kanban-date-label" for="kanban-due-date">截止日期</label><div class="kanban-date-control" @click="openDueDatePicker"><CalendarDays :size="15" aria-hidden="true" /><input id="kanban-due-date" ref="dueDateInput" v-model="draft.dueDate" type="date" /><IconButton :icon="X" label="清除日期" size="small" :disabled="!draft.dueDate" @click.stop="clearDueDate" /></div>
                    <div class="kanban-date-presets"><button type="button" @click="setDueDateOffset(0)">今天</button><button type="button" @click="setDueDateOffset(1)">明天</button></div>
                  </div>
                </div>
                <label class="kanban-draft-note"><span>备注 <small>可选</small></span><textarea v-model="draft.note" maxlength="1200" rows="3" placeholder="补充下一步、联系人或交付说明" /></label>
              </div>
            </div>
            <footer><button class="command-button subtle" type="button" @click="closeForm">取消</button><button class="command-button primary" type="submit">{{ editingTaskId ? '保存修改' : '添加任务' }}</button></footer>
          </form>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>
