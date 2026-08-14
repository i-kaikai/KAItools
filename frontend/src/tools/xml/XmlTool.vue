<script setup lang="ts">
import { Copy, Trash2 } from '@lucide/vue'
import { computed } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { formatXml } from '@/utils/formatters'
const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: '', indent: 2, compact: false }, (state) => emit('update:state', state))
const output = computed(() => { try { return { value: formatXml(model.input, model.indent, model.compact), error: '' } } catch (error) { return { value: '', error: error instanceof Error ? error.message : 'XML 格式化失败' } } })
async function copy(): Promise<void> { await copyText(output.value.value); toast.show('XML 已复制', 'success') }
</script>
<template><section class="tool-page"><header class="tool-header"><div><h1>XML 格式化</h1><p :class="{ error: output.error }">{{ output.error || 'XML 校验、格式化与压缩' }}</p></div><div class="toolbar"><SegmentedControl :model-value="model.compact ? 'compact' : 'pretty'" label="输出样式" :options="[{ value: 'pretty', label: '格式化' }, { value: 'compact', label: '压缩' }]" @update:model-value="model.compact = $event === 'compact'" /><select v-model.number="model.indent" class="compact-select" aria-label="XML 缩进" :disabled="model.compact"><option :value="2">2 空格</option><option :value="4">4 空格</option></select><IconButton :icon="Copy" label="复制 XML" :disabled="!output.value" @click="copy" /><IconButton :icon="Trash2" label="清空" :disabled="!model.input" @click="model.input = ''" /></div></header><div class="editor-split"><div class="editor-panel"><div class="panel-label">XML 输入</div><CodeEditor v-model="model.input" label="XML 输入" /></div><div class="editor-panel" :class="{ invalid: output.error }"><div class="panel-label">处理结果</div><CodeEditor :model-value="output.value" readonly label="XML 格式化结果" /></div></div></section></template>
