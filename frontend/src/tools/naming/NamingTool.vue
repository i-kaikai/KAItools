<script setup lang="ts">
import { Copy, Trash2 } from '@lucide/vue'
import { computed, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import ToolChainButton from '@/components/ToolChainButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { nameVariants } from '@/utils/naming'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: 'HTTPServer response_code user profile', output: '', split: 50 }, (state) => emit('update:state', state))

const variants = computed(() => nameVariants(model.input))
const formattedOutput = computed(() => [
  ['camelCase', variants.value.camel],
  ['PascalCase', variants.value.pascal],
  ['snake_case', variants.value.snake],
  ['kebab-case', variants.value.kebab],
  ['CONSTANT_CASE', variants.value.constant],
  ['dot.case', variants.value.dot],
  ['Sentence case', variants.value.sentence],
].map(([label, value]) => `${label}: ${value}`).join('\n'))

watch(formattedOutput, (value) => { model.output = value }, { immediate: true })

async function copyOutput(): Promise<void> {
  await copyText(model.output)
  toast.show('命名转换结果已复制', 'success')
}
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div><h1>命名转换</h1><p>自动拆分 camelCase、PascalCase、snake_case、kebab-case 与缩写</p></div>
      <div class="toolbar">
        <ToolChainButton :value="model.output" source-name="命名转换" />
        <IconButton :icon="Copy" label="复制全部结果" :disabled="!model.output" @click="copyOutput" />
        <IconButton :icon="Trash2" label="清空输入和结果" :disabled="!model.input && !model.output" @click="model.input = ''; model.output = ''" />
      </div>
    </header>
    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel"><div class="panel-label">任意命名或词组</div><CodeEditor v-model="model.input" label="命名转换输入" /></div></template>
      <template #right><div class="editor-panel"><div class="panel-label">转换结果</div><CodeEditor v-model="model.output" label="命名转换结果" /></div></template>
    </ResizableSplit>
  </section>
</template>
