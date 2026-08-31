<script setup lang="ts">
import { ArrowRight, Pin, PinOff, Search, X } from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'

import { toolCategories, workspaceTools, type ToolDefinition } from '@/tools/registry'
import { t } from '@/i18n'

const props = defineProps<{ open: boolean; shortcutIds: string[] }>()
const emit = defineEmits<{
  close: []
  select: [tool: ToolDefinition]
  toggleShortcut: [tool: ToolDefinition]
}>()

const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const selectedIndex = ref(0)
const legacySearchNames: Record<string, string> = {
  json: 'JSON 格式化与查看',
  'json-diff': 'JSON 差异对比',
  'json-java': 'JSON 与 JavaBean 互转',
  java: 'Java 字符串转义',
  timestamp: '日期与时间戳转换',
  'base64-text': 'Base64 文本转换',
  'base64-image': 'Base64 图片转换',
  'base64-file': 'Base64 文件转换',
  qrcode: '二维码生成与图片解码',
  'image-studio': '图片裁剪压缩与格式转换',
  'video-audio': '视频转音频',
  'html-pdf': 'HTML 转 PDF',
  'word-pdf': 'Word 转 PDF',
  'pdf-word': 'PDF 转 Word',
  cron: '定时任务表达式',
  sql: 'SQL 语句格式化',
  yaml: 'YAML 配置格式化',
  xml: 'XML 文档格式化',
  'text-diff': '文本差异比较',
  'text-stats': '文本内容统计',
  notes: 'Markdown 笔记与备忘录',
  hosts: 'Hosts 文件编辑',
  calculator: '超级计算器',
  'clipboard-history': '剪切板历史',
  md5: '哈希摘要',
  naming: '变量与代码命名转换',
  identifiers: 'UUID 与 ULID 生成解析',
}
const categoryNames = computed(() => Object.fromEntries(toolCategories.map((category) => [category.id, category.name])))
const results = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  if (!normalized) return workspaceTools
  return workspaceTools.filter((tool) => [
    legacySearchNames[tool.id] ?? tool.name,
    tool.name,
    tool.description,
    categoryNames.value[tool.category] ?? '',
    ...tool.keywords,
  ].some((value) => value.toLowerCase().includes(normalized)))
})

function focusSelected(): void {
  void nextTick(() => document.getElementById(`tool-search-result-${selectedIndex.value}`)?.scrollIntoView({ block: 'nearest' }))
}

function moveSelection(direction: 1 | -1): void {
  if (!results.value.length) return
  selectedIndex.value = (selectedIndex.value + direction + results.value.length) % results.value.length
  focusSelected()
}

function selectTool(tool: ToolDefinition): void {
  emit('select', tool)
}

function isShortcut(tool: ToolDefinition): boolean {
  return props.shortcutIds.includes(tool.id)
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveSelection(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveSelection(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const tool = results.value[selectedIndex.value]
    if (tool) selectTool(tool)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    query.value = ''
    selectedIndex.value = 0
    void nextTick(() => input.value?.focus())
  },
  { immediate: true },
)
watch(query, () => (selectedIndex.value = 0))
</script>

<template>
  <div v-if="open" class="tool-search-backdrop" @pointerdown.self="emit('close')">
    <section class="tool-search-dialog" role="dialog" aria-modal="true" aria-labelledby="tool-search-title">
      <header>
        <Search :size="19" aria-hidden="true" />
        <div>
          <h2 id="tool-search-title">{{ t('search.title') }}</h2>
          <input
            ref="input"
            v-model="query"
            type="search"
            :placeholder="t('search.input')"
            :aria-label="t('search.input')"
            aria-controls="tool-search-results"
            :aria-activedescendant="results.length ? `tool-search-result-${selectedIndex}` : undefined"
            @keydown.stop="onInputKeydown"
          />
        </div>
        <button type="button" :aria-label="t('search.close')" @click="emit('close')"><X :size="17" aria-hidden="true" /></button>
      </header>

      <div class="tool-search-summary">
        <span>{{ query.trim() ? t('search.results') : t('search.allTools') }}</span>
        <small>{{ t('search.found', { count: results.length }) }}</small>
      </div>

      <div id="tool-search-results" class="tool-search-results" role="listbox" :aria-label="t('search.resultList')">
        <div
          v-for="(tool, index) in results"
          :id="`tool-search-result-${index}`"
          :key="tool.id"
          role="option"
          tabindex="-1"
          :aria-selected="index === selectedIndex"
          :class="{ selected: index === selectedIndex }"
          @pointerenter="selectedIndex = index"
          @click="selectTool(tool)"
          @keydown.enter.prevent="selectTool(tool)"
        >
          <span class="tool-search-result-icon"><component :is="tool.icon" :size="18" :stroke-width="1.8" aria-hidden="true" /></span>
          <span class="tool-search-result-copy">
            <strong>{{ tool.name }}</strong>
            <small>{{ tool.name }} · {{ tool.description }}</small>
          </span>
          <span class="tool-search-category">{{ categoryNames[tool.category] }}</span>
          <button
            class="tool-search-shortcut"
            type="button"
            :aria-label="isShortcut(tool) ? t('search.removeSidebar', { tool: tool.name }) : t('search.addSidebar', { tool: tool.name })"
            :title="isShortcut(tool) ? t('search.remove') : t('search.add')"
            @click.stop="emit('toggleShortcut', tool)"
          >
            <PinOff v-if="isShortcut(tool)" :size="15" aria-hidden="true" />
            <Pin v-else :size="15" aria-hidden="true" />
          </button>
          <ArrowRight :size="15" aria-hidden="true" />
        </div>
        <div v-if="!results.length" class="tool-search-empty">
          <Search :size="23" aria-hidden="true" />
          <strong>{{ t('search.empty') }}</strong>
          <span>{{ t('search.emptyHint') }}</span>
        </div>
      </div>

      <footer>
        <span><kbd>↑</kbd><kbd>↓</kbd> {{ t('search.select') }}</span>
        <span><kbd>Enter</kbd> {{ t('search.open') }}</span>
        <span><kbd>Esc</kbd> {{ t('search.dismiss') }}</span>
      </footer>
    </section>
  </div>
</template>
