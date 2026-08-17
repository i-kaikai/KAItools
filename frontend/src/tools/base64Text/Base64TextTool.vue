<script setup lang="ts">
import { ArrowLeftRight, Copy, Trash2 } from '@lucide/vue'
import { computed, watch } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import ToolChainButton from '@/components/ToolChainButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { decodeBase64Text, encodeBase64Text } from '@/utils/base64'
import { copyText } from '@/utils/clipboard'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: '', output: '', mode: 'encode' as 'encode' | 'decode', urlSafe: false, split: 50 }, (state) => emit('update:state', state))
const transformed = computed(() => { try { return { value: model.mode === 'encode' ? encodeBase64Text(model.input, model.urlSafe) : decodeBase64Text(model.input), error: '' } } catch (error) { return { value: '', error: error instanceof Error ? error.message : '转换失败' } } })
if (!model.output) model.output = transformed.value.value
watch(() => [model.input, model.mode, model.urlSafe] as const, () => (model.output = transformed.value.value))
function swap(): void { if (model.output) { model.input = model.output; model.mode = model.mode === 'encode' ? 'decode' : 'encode' } }
async function copyOutput(): Promise<void> { await copyText(model.output); toast.show('转换结果已复制', 'success') }
</script>
<template>
  <section class="tool-page">
    <header class="tool-header"><div><h1>Base64 文本</h1><p :class="{ error: transformed.error }">{{ transformed.error || 'UTF-8 文本安全编码与解码' }}</p></div><div class="toolbar">
      <SegmentedControl :model-value="model.mode" label="转换方向" :options="[{ value: 'encode', label: '编码' }, { value: 'decode', label: '解码' }]" @update:model-value="model.mode = $event as 'encode' | 'decode'" />
      <label v-if="model.mode === 'encode'" class="toggle-label"><input v-model="model.urlSafe" type="checkbox" /><span>URL 安全</span></label>
      <IconButton :icon="ArrowLeftRight" label="交换并反向转换" :disabled="!model.output" @click="swap" /><ToolChainButton :value="model.output" source-name="Base64" /><IconButton :icon="Copy" label="复制结果" :disabled="!model.output" @click="copyOutput" /><IconButton :icon="Trash2" label="清空" :disabled="!model.input && !model.output" @click="model.input = ''; model.output = ''" />
    </div></header>
    <ResizableSplit v-model="model.split"><template #left><div class="editor-panel"><div class="panel-label">{{ model.mode === 'encode' ? 'UTF-8 文本' : 'Base64 文本' }}</div><CodeEditor v-model="model.input" label="Base64 文本输入" /></div></template><template #right><div class="editor-panel" :class="{ invalid: transformed.error }"><div class="panel-label">转换结果</div><CodeEditor v-model="model.output" label="Base64 文本结果" /></div></template></ResizableSplit>
  </section>
</template>
