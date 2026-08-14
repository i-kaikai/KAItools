<script setup lang="ts">
import { Copy, Download, ImageUp, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { bytesToBlob, fileToDataUrl, parseDataUrl } from '@/utils/base64'
import { copyText } from '@/utils/clipboard'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const picker = ref<HTMLInputElement | null>(null)
const model = useToolState(props.state, { dataUrl: '', fileName: 'image.png' }, (state) => emit('update:state', state))
const parsed = computed(() => { try { return model.dataUrl ? { data: parseDataUrl(model.dataUrl), error: '' } : { data: null, error: '' } } catch (error) { return { data: null, error: error instanceof Error ? error.message : '图片解码失败' } } })
async function selectFile(event: Event): Promise<void> { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; if (!file.type.startsWith('image/')) { toast.show('请选择图片文件', 'error'); return }; model.fileName = file.name; model.dataUrl = await fileToDataUrl(file) }
function download(): void { if (!parsed.value.data) return; const url = URL.createObjectURL(bytesToBlob(parsed.value.data.bytes, parsed.value.data.mimeType)); const link = document.createElement('a'); link.href = url; link.download = model.fileName || 'image'; link.click(); URL.revokeObjectURL(url) }
async function copy(): Promise<void> { await copyText(model.dataUrl); toast.show('图片 Data URL 已复制', 'success') }
</script>
<template>
  <section class="tool-page">
    <header class="tool-header"><div><h1>Base64 图片</h1><p :class="{ error: parsed.error }">{{ parsed.error || (parsed.data ? `${parsed.data.mimeType} · ${parsed.data.bytes.length.toLocaleString()} 字节` : '图片与 Base64 Data URL 互转') }}</p></div><div class="toolbar"><input ref="picker" class="visually-hidden" type="file" accept="image/*" @change="selectFile" /><IconButton :icon="ImageUp" label="选择图片" @click="picker?.click()" /><IconButton :icon="Copy" label="复制 Data URL" :disabled="!parsed.data" @click="copy" /><IconButton :icon="Download" label="下载图片" :disabled="!parsed.data" @click="download" /><IconButton :icon="Trash2" label="清空" :disabled="!model.dataUrl" @click="model.dataUrl = ''" /></div></header>
    <div class="media-workspace"><div class="editor-panel"><div class="panel-label">Base64 Data URL</div><CodeEditor v-model="model.dataUrl" label="图片 Base64 Data URL" /></div><div class="media-preview" :class="{ invalid: parsed.error }"><div class="panel-label">图片预览</div><img v-if="parsed.data" :src="model.dataUrl" alt="Base64 解码预览" /><div v-else class="empty-state"><ImageUp :size="28" /><span>选择图片或粘贴 Data URL</span></div></div></div>
  </section>
</template>
