<script setup lang="ts">
import { Copy, Trash2 } from '@lucide/vue'
import { computed, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { formatSql, type SqlDialect } from '@/utils/formatters'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(
  props.state,
  { input: '', output: '', dialect: 'sql' as SqlDialect, keywordCase: 'upper' as 'upper' | 'lower' | 'preserve', tabWidth: 2, split: 50 },
  (state) => emit('update:state', state),
)
const generated = computed(() => {
  try {
    return { value: formatSql(model.input, model.dialect, model.keywordCase, model.tabWidth), error: '' }
  } catch (error) {
    return { value: '', error: error instanceof Error ? error.message : 'SQL 格式化失败' }
  }
})
if (!model.output) model.output = generated.value.value
watch(
  () => [model.input, model.dialect, model.keywordCase, model.tabWidth] as const,
  () => (model.output = generated.value.value),
)

async function copy(): Promise<void> {
  await copyText(model.output)
  toast.show('SQL 已复制', 'success')
}
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div><h1>SQL 美化</h1><p :class="{ error: generated.error }">{{ generated.error || 'SQL 排版与关键字规范化' }}</p></div>
      <div class="toolbar">
        <select v-model="model.dialect" class="compact-select" aria-label="SQL 方言"><option value="sql">标准 SQL</option><option value="mysql">MySQL</option><option value="postgresql">PostgreSQL</option><option value="sqlite">SQLite</option><option value="mariadb">MariaDB</option><option value="transactsql">SQL Server</option><option value="plsql">PL/SQL</option></select>
        <select v-model="model.keywordCase" class="compact-select" aria-label="SQL 关键字大小写"><option value="upper">关键字大写</option><option value="lower">关键字小写</option><option value="preserve">保持原样</option></select>
        <select v-model.number="model.tabWidth" class="compact-select" aria-label="SQL 缩进"><option :value="2">2 空格</option><option :value="4">4 空格</option></select>
        <IconButton :icon="Copy" label="复制 SQL" :disabled="!model.output" @click="copy" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.input && !model.output" @click="model.input = ''; model.output = ''" />
      </div>
    </header>
    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel"><div class="panel-label">原始 SQL</div><CodeEditor v-model="model.input" label="SQL 输入" /></div></template>
      <template #right><div class="editor-panel" :class="{ invalid: generated.error }"><div class="panel-label">格式化结果</div><CodeEditor v-model="model.output" label="SQL 格式化结果" /></div></template>
    </ResizableSplit>
  </section>
</template>
