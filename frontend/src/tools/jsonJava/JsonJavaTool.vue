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
import { javaBeanToJson, jsonToJavaBean } from '@/utils/jsonJava'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: '', output: '', mode: 'json-to-java' as 'json-to-java' | 'java-to-json', className: 'RootBean', lombok: false, split: 50 }, (state) => emit('update:state', state))
const transformed = computed(() => {
  try {
    const value = model.mode === 'json-to-java' ? jsonToJavaBean(model.input, model.className, model.lombok) : javaBeanToJson(model.input)
    return { value, error: '' }
  } catch (error) { return { value: '', error: error instanceof Error ? error.message : '转换失败' } }
})
if (!model.output) model.output = transformed.value.value
watch(
  () => [model.input, model.mode, model.className, model.lombok] as const,
  () => (model.output = transformed.value.value),
)

function swap(): void {
  if (!model.output) return
  model.input = model.output
  model.mode = model.mode === 'json-to-java' ? 'java-to-json' : 'json-to-java'
}
async function copyOutput(): Promise<void> {
  await copyText(model.output)
  toast.show('转换结果已复制', 'success')
}
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div><h1>JSON / JavaBean</h1><p :class="{ error: transformed.error }">{{ transformed.error || '常见字段类型、嵌套对象与集合互转' }}</p></div>
      <div class="toolbar">
        <SegmentedControl :model-value="model.mode" label="转换方向" :options="[{ value: 'json-to-java', label: 'JSON → Java' }, { value: 'java-to-json', label: 'Java → JSON' }]" @update:model-value="model.mode = $event as 'json-to-java' | 'java-to-json'" />
        <input v-if="model.mode === 'json-to-java'" v-model="model.className" class="compact-input" aria-label="Java 类名" placeholder="RootBean" />
        <label v-if="model.mode === 'json-to-java'" class="toggle-label"><input v-model="model.lombok" type="checkbox" /><span>Lombok</span></label>
        <IconButton :icon="ArrowLeftRight" label="交换并反向转换" :disabled="!model.output" @click="swap" />
        <IconButton :icon="Copy" label="复制结果" :disabled="!model.output" @click="copyOutput" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.input && !model.output" @click="model.input = ''; model.output = ''" />
      </div>
    </header>
    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel"><div class="panel-label">{{ model.mode === 'json-to-java' ? 'JSON 输入' : 'JavaBean 输入' }}</div><CodeEditor v-model="model.input" :language="model.mode === 'json-to-java' ? 'json' : 'plain'" :label="model.mode === 'json-to-java' ? 'JSON 转 JavaBean 输入' : 'JavaBean 转 JSON 输入'" /></div></template>
      <template #right><div class="editor-panel" :class="{ invalid: transformed.error }"><div class="panel-label">转换结果</div><CodeEditor v-model="model.output" :language="model.mode === 'java-to-json' ? 'json' : 'plain'" label="JSON JavaBean 转换结果" /></div></template>
    </ResizableSplit>
  </section>
</template>
