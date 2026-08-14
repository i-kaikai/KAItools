<script setup lang="ts">
import { Copy, Download, FileUp, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { base64ToBytes, bytesToBase64, bytesToBlob } from '@/utils/base64'
import { copyText } from '@/utils/clipboard'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const picker = ref<HTMLInputElement | null>(null)
const model = useToolState(props.state, { base64: '', fileName: 'decoded.bin', mimeType: 'application/octet-stream' }, (state) => emit('update:state', state))
const decoded = computed(() => { try { return model.base64 ? { bytes: base64ToBytes(model.base64), error: '' } : { bytes: null, error: '' } } catch (error) { return { bytes: null, error: error instanceof Error ? error.message : '文件解码失败' } } })
async function selectFile(event: Event): Promise<void> { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; model.fileName = file.name; model.mimeType = file.type || 'application/octet-stream'; model.base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer())) }
function download(): void { if (!decoded.value.bytes) return; const url = URL.createObjectURL(bytesToBlob(decoded.value.bytes, model.mimeType)); const link = document.createElement('a'); link.href = url; link.download = model.fileName || 'decoded.bin'; link.click(); URL.revokeObjectURL(url) }
async function copy(): Promise<void> { await copyText(model.base64); toast.show('Base64 内容已复制', 'success') }
</script>
<template>
  <section class="tool-page narrow-tool">
    <header class="tool-header"><div><h1>Base64 文件</h1><p :class="{ error: decoded.error }">{{ decoded.error || (decoded.bytes ? `${decoded.bytes.length.toLocaleString()} 字节，可下载还原` : '任意文件与 Base64 互转') }}</p></div><div class="toolbar"><input ref="picker" class="visually-hidden" type="file" @change="selectFile" /><IconButton :icon="FileUp" label="选择文件" @click="picker?.click()" /><IconButton :icon="Copy" label="复制 Base64" :disabled="!decoded.bytes" @click="copy" /><IconButton :icon="Download" label="下载还原文件" :disabled="!decoded.bytes" @click="download" /><IconButton :icon="Trash2" label="清空" :disabled="!model.base64" @click="model.base64 = ''" /></div></header>
    <div class="file-meta-band"><label>文件名<input v-model="model.fileName" aria-label="还原文件名" /></label><label>MIME 类型<input v-model="model.mimeType" aria-label="文件 MIME 类型" /></label></div>
    <div class="single-editor-panel" :class="{ invalid: decoded.error }"><div class="panel-label">Base64 内容</div><CodeEditor v-model="model.base64" label="文件 Base64 内容" /></div>
  </section>
</template>
