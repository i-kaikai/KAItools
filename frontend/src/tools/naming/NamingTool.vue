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
import { convertIdentifierLines, type NamingStyle } from '@/utils/naming'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: 'HTTPServer\nresponse_code\nuser profile', target: 'camel' as NamingStyle, output: '', split: 50 }, (state) => emit('update:state', state))

const targetOptions: Array<{ value: NamingStyle; label: string }> = [
  { value: 'camel', label: 'camelCase' }, { value: 'pascal', label: 'PascalCase' }, { value: 'snake', label: 'snake_case' }, { value: 'kebab', label: 'kebab-case' }, { value: 'constant', label: 'CONSTANT_CASE' }, { value: 'dot', label: 'dot.case' }, { value: 'sentence', label: 'Sentence case' },
]
const formattedOutput = computed(() => convertIdentifierLines(model.input, model.target))

watch(() => [formattedOutput.value, model.target] as const, ([value]) => { model.output = value }, { immediate: true })

async function copyOutput(): Promise<void> {
  await copyText(model.output)
  toast.show('命名转换结果已复制', 'success')
}
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div><h1>命名转换</h1><p>每行独立转换，保留空行与输入顺序</p></div>
      <div class="toolbar">
        <select v-model="model.target" class="compact-select" aria-label="目标命名格式"><option v-for="option in targetOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
        <ToolChainButton :value="model.output" source-name="命名转换" />
        <IconButton :icon="Copy" label="复制全部结果" :disabled="!model.output" @click="copyOutput" />
        <IconButton :icon="Trash2" label="清空输入和结果" :disabled="!model.input && !model.output" @click="model.input = ''; model.output = ''" />
      </div>
    </header>
    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel"><div class="panel-label">每行一个命名或词组</div><CodeEditor v-model="model.input" label="命名转换输入" /></div></template>
      <template #right><div class="editor-panel"><div class="panel-label">{{ targetOptions.find((option) => option.value === model.target)?.label }} 结果</div><CodeEditor v-model="model.output" label="命名转换结果" /></div></template>
    </ResizableSplit>
  </section>
</template>
