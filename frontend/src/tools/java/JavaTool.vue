<script setup lang="ts">
import { ArrowLeftRight, Copy, Trash2 } from '@lucide/vue'
import { computed, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { escapeJava, unescapeJavaWithJsonFormat } from '@/utils/javaEscape'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(
  props.state,
  { input: '', output: '', mode: 'escape' as 'escape' | 'unescape', unicode: false, autoFormatJson: true, split: 50 },
  (state) => emit('update:state', state),
)
const transformed = computed(() =>
  model.mode === 'escape'
    ? { value: escapeJava(model.input, model.unicode) }
    : unescapeJavaWithJsonFormat(model.input, model.autoFormatJson),
)
if (!model.output) model.output = transformed.value.error ? '' : transformed.value.value
watch(
  () => [model.input, model.mode, model.unicode, model.autoFormatJson] as const,
  () => (model.output = transformed.value.error ? '' : transformed.value.value),
)

function updateOutput(value: string): void {
  model.output = value
}

async function copyOutput(): Promise<void> {
  await copyText(model.output)
  toast.show('转换结果已复制', 'success')
}

function swap(): void {
  if (transformed.value.error || !model.output) return
  model.input = model.output
  model.mode = model.mode === 'escape' ? 'unescape' : 'escape'
}
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div>
        <h1>Java 转义</h1>
        <p :class="{ error: transformed.error }">
          {{ transformed.error ? `位置 ${transformed.error.offset + 1} · ${transformed.error.message}` : 'Java 字符串字面量规则' }}
        </p>
      </div>
      <div class="toolbar">
        <SegmentedControl
          :model-value="model.mode"
          label="转换方向"
          :options="[
            { value: 'escape', label: '转义' },
            { value: 'unescape', label: '反转义' },
          ]"
          @update:model-value="model.mode = $event as 'escape' | 'unescape'"
        />
        <label v-if="model.mode === 'escape'" class="toggle-label">
          <input v-model="model.unicode" type="checkbox" />
          <span>Unicode</span>
        </label>
        <label v-else class="toggle-label">
          <input v-model="model.autoFormatJson" type="checkbox" />
          <span>自动格式化 JSON</span>
        </label>
        <IconButton :icon="ArrowLeftRight" label="交换并反向转换" :disabled="!!transformed.error || !model.output" @click="swap" />
        <IconButton :icon="Copy" label="复制结果" :disabled="!!transformed.error || !model.output" @click="copyOutput" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.input && !model.output" @click="model.input = ''; model.output = ''" />
      </div>
    </header>
    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel">
        <div class="panel-label">输入</div>
        <CodeEditor v-model="model.input" label="Java 转义输入" />
      </div></template>
      <template #right><div class="editor-panel" :class="{ invalid: transformed.error }">
        <div class="panel-label">结果 · 可编辑</div>
        <CodeEditor :model-value="model.output" label="Java 转义结果" @update:model-value="updateOutput" />
      </div></template>
    </ResizableSplit>
  </section>
</template>
