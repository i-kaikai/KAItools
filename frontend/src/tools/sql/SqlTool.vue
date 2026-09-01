<script setup lang="ts">
import { ArrowLeftRight, Copy, Trash2 } from '@lucide/vue'
import { computed, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import ToolChainButton from '@/components/ToolChainButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { formatSql } from '@/utils/formatters'
import {
  convertSqlDialect,
  getSqlDialectLabel,
  getSqlFormatterDialect,
  normalizeSqlDatabaseDialect,
  SQL_DIALECT_OPTIONS,
  type SqlDatabaseDialect,
} from '@/utils/sqlDialectConverter'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const migratedState = { ...props.state }
const legacyDialect = normalizeSqlDatabaseDialect(migratedState.dialect)
migratedState.sourceDialect = normalizeSqlDatabaseDialect(migratedState.sourceDialect ?? legacyDialect)
migratedState.targetDialect = normalizeSqlDatabaseDialect(migratedState.targetDialect ?? legacyDialect)
delete migratedState.dialect
const model = useToolState(
  migratedState,
  {
    input: '',
    output: '',
    sourceDialect: 'standard' as SqlDatabaseDialect,
    targetDialect: 'standard' as SqlDatabaseDialect,
    keywordCase: 'upper' as 'upper' | 'lower' | 'preserve',
    tabWidth: 2,
    split: 50,
  },
  (state) => emit('update:state', state),
)
const generated = computed(() => {
  try {
    const conversion = convertSqlDialect(model.input, model.sourceDialect, model.targetDialect)
    return {
      value: formatSql(conversion.sql, getSqlFormatterDialect(model.targetDialect), model.keywordCase, model.tabWidth),
      changes: conversion.changes,
      warnings: conversion.warnings,
      error: '',
    }
  } catch (error) {
    return { value: '', changes: [], warnings: [], error: error instanceof Error ? error.message : 'SQL 转换失败' }
  }
})
const isConversion = computed(() => model.sourceDialect !== model.targetDialect)
const sourceLabel = computed(() => getSqlDialectLabel(model.sourceDialect))
const targetLabel = computed(() => getSqlDialectLabel(model.targetDialect))
const statusText = computed(() => {
  if (generated.value.error) return generated.value.error
  if (!isConversion.value) return 'SQL 排版与关键字规范化'
  if (generated.value.warnings.length) return `已转换为 ${targetLabel.value}，有 ${generated.value.warnings.length} 项需要确认`
  if (generated.value.changes.length) return `已转换为 ${targetLabel.value}，应用 ${generated.value.changes.length} 类规则`
  return `未发现需要改写的 ${sourceLabel.value} 方言语法`
})
if (!model.output) model.output = generated.value.value
watch(
  () => [model.input, model.sourceDialect, model.targetDialect, model.keywordCase, model.tabWidth] as const,
  () => (model.output = generated.value.value),
)

async function copy(): Promise<void> {
  await copyText(model.output)
  toast.show('SQL 已复制', 'success')
}

function swapDialects(): void {
  const source = model.sourceDialect
  model.sourceDialect = model.targetDialect
  model.targetDialect = source
  if (model.output) model.input = model.output
}
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div><h1>SQL 美化与转换</h1><p :class="{ error: generated.error, warning: !generated.error && generated.warnings.length }">{{ statusText }}</p></div>
      <div class="toolbar">
        <label class="sql-dialect-field"><span>源</span><select v-model="model.sourceDialect" class="compact-select" aria-label="源数据库"><option v-for="option in SQL_DIALECT_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        <IconButton :icon="ArrowLeftRight" label="交换源与目标数据库" :disabled="!model.input" @click="swapDialects" />
        <label class="sql-dialect-field"><span>目标</span><select v-model="model.targetDialect" class="compact-select" aria-label="目标数据库"><option v-for="option in SQL_DIALECT_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        <select v-model="model.keywordCase" class="compact-select" aria-label="SQL 关键字大小写"><option value="upper">关键字大写</option><option value="lower">关键字小写</option><option value="preserve">保持原样</option></select>
        <select v-model.number="model.tabWidth" class="compact-select" aria-label="SQL 缩进"><option :value="2">2 空格</option><option :value="4">4 空格</option></select>
        <ToolChainButton :value="model.output" source-name="SQL" />
        <IconButton :icon="Copy" label="复制 SQL" :disabled="!model.output" @click="copy" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.input && !model.output" @click="model.input = ''; model.output = ''" />
      </div>
    </header>
    <div v-if="isConversion && (generated.changes.length || generated.warnings.length)" class="sql-conversion-report" role="status" aria-live="polite">
      <div v-if="generated.changes.length" class="sql-report-group"><strong>已转换</strong><span v-for="change in generated.changes" :key="change">{{ change }}</span></div>
      <div v-if="generated.warnings.length" class="sql-report-group warning"><strong>需确认</strong><span v-for="warning in generated.warnings" :key="warning">{{ warning }}</span></div>
    </div>
    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel"><div class="panel-label">{{ sourceLabel }} SQL</div><CodeEditor v-model="model.input" label="SQL 输入" /></div></template>
      <template #right><div class="editor-panel" :class="{ invalid: generated.error }"><div class="panel-label">{{ isConversion ? `${targetLabel} SQL` : '格式化结果' }}</div><CodeEditor v-model="model.output" label="SQL 格式化结果" /></div></template>
    </ResizableSplit>
  </section>
</template>

<style scoped>
.tool-header p.warning { color: var(--warning); }
.sql-dialect-field { display: inline-flex; align-items: center; gap: 5px; height: 32px; color: var(--text-faint); font-size: 12px; white-space: nowrap; }
.sql-dialect-field .compact-select { min-width: 112px; }
.sql-conversion-report { display: flex; min-height: 34px; max-height: 70px; margin: -6px 0 10px; padding: 6px 9px; border-block: 1px solid var(--border-subtle); gap: 12px; flex: 0 0 auto; color: var(--text-secondary); background: var(--surface-subtle); overflow: auto; }
.sql-report-group { display: flex; align-items: flex-start; gap: 6px; min-width: max-content; font-size: 12px; line-height: 20px; }
.sql-report-group strong { color: var(--accent); font-weight: 700; }
.sql-report-group span::before { margin-right: 6px; color: var(--text-faint); content: '·'; }
.sql-report-group.warning strong { color: var(--warning); }
@media (max-width: 720px) {
  .sql-conversion-report { margin-top: 0; }
  .sql-dialect-field .compact-select { min-width: 104px; }
}
@media (min-width: 721px) and (max-width: 1180px) {
  .tool-header { align-items: stretch; flex: 0 0 auto; flex-direction: column; margin-bottom: 12px; }
  .tool-header .toolbar { width: 100%; padding-bottom: 2px; overflow-x: auto; }
}
</style>
