<script setup lang="ts">
import { ArrowLeftRight, Copy, Trash2 } from '@lucide/vue'
import { computed } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { decodeBase64Text, encodeBase64Text } from '@/utils/base64'
import { copyText } from '@/utils/clipboard'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: '', mode: 'encode' as 'encode' | 'decode', urlSafe: false }, (state) => emit('update:state', state))
const transformed = computed(() => { try { return { value: model.mode === 'encode' ? encodeBase64Text(model.input, model.urlSafe) : decodeBase64Text(model.input), error: '' } } catch (error) { return { value: '', error: error instanceof Error ? error.message : '转换失败' } } })
function swap(): void { if (transformed.value.value) { model.input = transformed.value.value; model.mode = model.mode === 'encode' ? 'decode' : 'encode' } }
async function copyOutput(): Promise<void> { await copyText(transformed.value.value); toast.show('转换结果已复制', 'success') }
</script>
<template>
  <section class="tool-page">
    <header class="tool-header"><div><h1>Base64 文本</h1><p :class="{ error: transformed.error }">{{ transformed.error || 'UTF-8 文本安全编码与解码' }}</p></div><div class="toolbar">
      <SegmentedControl :model-value="model.mode" label="转换方向" :options="[{ value: 'encode', label: '编码' }, { value: 'decode', label: '解码' }]" @update:model-value="model.mode = $event as 'encode' | 'decode'" />
      <label v-if="model.mode === 'encode'" class="toggle-label"><input v-model="model.urlSafe" type="checkbox" /><span>URL 安全</span></label>
      <IconButton :icon="ArrowLeftRight" label="交换并反向转换" :disabled="!transformed.value" @click="swap" /><IconButton :icon="Copy" label="复制结果" :disabled="!transformed.value" @click="copyOutput" /><IconButton :icon="Trash2" label="清空" :disabled="!model.input" @click="model.input = ''" />
    </div></header>
    <div class="editor-split"><div class="editor-panel"><div class="panel-label">{{ model.mode === 'encode' ? 'UTF-8 文本' : 'Base64 文本' }}</div><CodeEditor v-model="model.input" label="Base64 文本输入" /></div><div class="editor-panel" :class="{ invalid: transformed.error }"><div class="panel-label">转换结果</div><CodeEditor :model-value="transformed.value" readonly label="Base64 文本结果" /></div></div>
  </section>
</template>
