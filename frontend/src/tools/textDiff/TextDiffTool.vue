<script setup lang="ts">
import { Copy, Trash2 } from '@lucide/vue'
import { computed } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { compareText, getTextComparisonHighlights } from '@/utils/text'
const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { left: '', right: '', mode: 'lines' as 'lines' | 'characters', ignoreWhitespace: false, split: 50 }, (state) => emit('update:state', state))
const changes = computed(() => compareText(model.left, model.right, model.mode, model.ignoreWhitespace))
const highlights = computed(() => getTextComparisonHighlights(model.left, model.right, model.mode, model.ignoreWhitespace))
const summary = computed(() => ({ added: changes.value.filter((part) => part.added).reduce((sum, part) => sum + (part.count ?? 0), 0), removed: changes.value.filter((part) => part.removed).reduce((sum, part) => sum + (part.count ?? 0), 0) }))
const output = computed(() => changes.value.map((part) => `${part.added ? '+ ' : part.removed ? '- ' : '  '}${part.value}`).join(''))
async function copy(): Promise<void> { await copyText(output.value); toast.show('差异结果已复制', 'success') }
</script>
<template>
  <section class="tool-page">
    <header class="tool-header">
      <div><h1>文本比较</h1><p>{{ summary.added }} 处新增 · {{ summary.removed }} 处删除</p></div>
      <div class="toolbar">
        <SegmentedControl :model-value="model.mode" label="比较粒度" :options="[{ value: 'lines', label: '按行' }, { value: 'characters', label: '按字符' }]" @update:model-value="model.mode = $event as 'lines' | 'characters'" />
        <label class="toggle-label"><input v-model="model.ignoreWhitespace" type="checkbox" /><span>忽略空白</span></label>
        <IconButton :icon="Copy" label="复制差异" :disabled="!output" @click="copy" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.left && !model.right" @click="model.left = ''; model.right = ''" />
      </div>
    </header>
    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel">
        <div class="panel-label">原始文本</div>
        <CodeEditor v-model="model.left" label="左侧文本" :highlights="highlights.left" />
      </div></template>
      <template #right><div class="editor-panel">
        <div class="panel-label">目标文本</div>
        <CodeEditor v-model="model.right" label="右侧文本" :highlights="highlights.right" />
      </div></template>
    </ResizableSplit>
  </section>
</template>
