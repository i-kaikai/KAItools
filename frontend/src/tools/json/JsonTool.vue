<script setup lang="ts">
import { Braces, Check, Copy, GitFork, ListTree, Minimize2, Trash2 } from '@lucide/vue'
import { computed, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { formatJson, minifyJson, parseJsonDocument } from '@/utils/json'
import JsonGraphView from './JsonGraphView.vue'
import JsonTreeNode from './JsonTreeNode.vue'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(
  props.state,
  { input: '', output: '', indent: 2 as 2 | 4, outputMode: 'code', outputStyle: 'formatted', split: 50 },
  (state) => emit('update:state', state),
)

const document = computed(() => parseJsonDocument(model.input))
const outputDocument = computed(() => parseJsonDocument(model.output))

function generateOutput(): string {
  if (!model.input.trim() || document.value.issues.length) return ''
  try {
    return model.outputStyle === 'minified' ? minifyJson(model.input) : formatJson(model.input, model.indent)
  } catch {
    return ''
  }
}

if (!model.output) model.output = generateOutput()
watch(
  () => [model.input, model.indent, model.outputStyle] as const,
  () => (model.output = generateOutput()),
)
const firstIssue = computed(() => document.value.issues[0])

async function copyOutput(): Promise<void> {
  await copyText(model.output)
  toast.show('JSON 已复制', 'success')
}
</script>

<template>
  <section class="tool-page json-tool">
    <header class="tool-header">
      <div>
        <h1>JSON</h1>
        <p :class="{ error: firstIssue }">
          <template v-if="firstIssue">第 {{ firstIssue.line }} 行，第 {{ firstIssue.column }} 列 · {{ firstIssue.message }}</template>
          <template v-else-if="model.input.trim()"><Check :size="14" aria-hidden="true" /> 语法有效</template>
          <template v-else>等待输入</template>
        </p>
      </div>
      <div class="toolbar">
        <SegmentedControl
          :model-value="model.outputStyle"
          label="输出样式"
          :options="[
            { value: 'formatted', label: '格式化' },
            { value: 'minified', label: '压缩' },
          ]"
          @update:model-value="model.outputStyle = $event as 'formatted' | 'minified'"
        />
        <select v-model.number="model.indent" class="compact-select" aria-label="缩进空格">
          <option :value="2">2 空格</option>
          <option :value="4">4 空格</option>
        </select>
        <IconButton :icon="Copy" label="复制结果" :disabled="!model.output" @click="copyOutput" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.input && !model.output" @click="model.input = ''; model.output = ''" />
      </div>
    </header>

    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel" :class="{ invalid: firstIssue }">
        <div class="panel-label"><Braces :size="14" />输入</div>
        <CodeEditor
          v-model="model.input"
          language="json"
          label="JSON 输入"
          :selection-offset="firstIssue?.offset"
        />
      </div></template>
      <template #right><div class="editor-panel result-panel">
        <div class="panel-label panel-label-tabs">
          <button type="button" :class="{ active: model.outputMode === 'code' }" @click="model.outputMode = 'code'">
            <Minimize2 :size="14" />代码
          </button>
          <button type="button" :class="{ active: model.outputMode === 'tree' }" @click="model.outputMode = 'tree'">
            <ListTree :size="14" />树视图
          </button>
          <button type="button" :class="{ active: model.outputMode === 'graph' }" @click="model.outputMode = 'graph'">
            <GitFork :size="14" />关系图
          </button>
        </div>
        <CodeEditor
          v-if="model.outputMode === 'code'"
          v-model="model.output"
          language="json"
          label="JSON 格式化结果"
        />
        <div v-else-if="model.outputMode === 'tree'" class="json-tree" aria-label="JSON 树视图">
          <JsonTreeNode v-if="outputDocument.tree" :item="outputDocument.tree" />
          <div v-else class="empty-state"><ListTree :size="22" /><span>暂无可展示的 JSON</span></div>
        </div>
        <JsonGraphView v-else :root="outputDocument.tree" :source="model.output" @update:source="model.output = $event" />
      </div></template>
    </ResizableSplit>
  </section>
</template>
