<script setup lang="ts">
import { Copy, Trash2 } from '@lucide/vue'
import { computed } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { getTextStatistics } from '@/utils/text'
const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: '' }, (state) => emit('update:state', state))
const stats = computed(() => getTextStatistics(model.input))
const items = computed(() => [{ label: '字符', value: stats.value.characters }, { label: '不含空白', value: stats.value.charactersWithoutWhitespace }, { label: '单词', value: stats.value.words }, { label: '中文字符', value: stats.value.chineseCharacters }, { label: '行数', value: stats.value.lines }, { label: '段落', value: stats.value.paragraphs }, { label: 'UTF-8 字节', value: stats.value.bytes }])
async function copy(): Promise<void> { await copyText(items.value.map((item) => `${item.label}: ${item.value}`).join('\n')); toast.show('统计结果已复制', 'success') }
</script>
<template><section class="tool-page narrow-tool"><header class="tool-header"><div><h1>文本统计</h1><p>实时统计字符、单词、行、段落与字节</p></div><div class="toolbar"><IconButton :icon="Copy" label="复制统计结果" @click="copy" /><IconButton :icon="Trash2" label="清空" :disabled="!model.input" @click="model.input = ''" /></div></header><div class="stats-grid" aria-label="文本统计结果"><div v-for="item in items" :key="item.label"><strong>{{ item.value.toLocaleString() }}</strong><span>{{ item.label }}</span></div></div><div class="single-editor-panel"><div class="panel-label">待统计文本</div><CodeEditor v-model="model.input" label="文本统计输入" /></div></section></template>
