<script setup lang="ts">
import { Copy, Trash2 } from '@lucide/vue'
import { computed } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { formatYaml } from '@/utils/formatters'
const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: '', indent: 2 }, (state) => emit('update:state', state))
const output = computed(() => { try { return { value: formatYaml(model.input, model.indent), error: '' } } catch (error) { return { value: '', error: error instanceof Error ? error.message : 'YAML 格式化失败' } } })
async function copy(): Promise<void> { await copyText(output.value.value); toast.show('YAML 已复制', 'success') }
</script>
<template><section class="tool-page"><header class="tool-header"><div><h1>YAML 美化</h1><p :class="{ error: output.error }">{{ output.error || 'YAML 语法校验与规范排版' }}</p></div><div class="toolbar"><select v-model.number="model.indent" class="compact-select" aria-label="YAML 缩进"><option :value="2">2 空格</option><option :value="4">4 空格</option></select><IconButton :icon="Copy" label="复制 YAML" :disabled="!output.value" @click="copy" /><IconButton :icon="Trash2" label="清空" :disabled="!model.input" @click="model.input = ''" /></div></header><div class="editor-split"><div class="editor-panel"><div class="panel-label">YAML 输入</div><CodeEditor v-model="model.input" label="YAML 输入" /></div><div class="editor-panel" :class="{ invalid: output.error }"><div class="panel-label">美化结果</div><CodeEditor :model-value="output.value" readonly label="YAML 格式化结果" /></div></div></section></template>
