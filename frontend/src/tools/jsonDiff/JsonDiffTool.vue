<script setup lang="ts">
import { CheckCircle2, Copy, Trash2, TriangleAlert } from '@lucide/vue'
import { computed } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { compareJson } from '@/utils/jsonDiff'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { left: '', right: '', split: 50 }, (state) => emit('update:state', state))
const comparison = computed(() => {
  try { return { result: compareJson(model.left, model.right), error: '' } }
  catch (error) { return { result: null, error: error instanceof Error ? error.message : 'JSON 对比失败' } }
})
const diffText = computed(() => comparison.value.result?.changes.map((part) => `${part.added ? '+ ' : part.removed ? '- ' : '  '}${part.value}`).join('') ?? '')

async function copyResult(): Promise<void> {
  await copyText(diffText.value)
  toast.show('差异结果已复制', 'success')
}
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div>
        <h1>JSON 对比</h1>
        <p :class="{ error: comparison.error }">
          <TriangleAlert v-if="comparison.error" :size="14" />
          <CheckCircle2 v-else :size="14" />
          {{ comparison.error || (comparison.result?.equal ? '两个 JSON 语义一致' : `${comparison.result?.additions ?? 0} 处新增 · ${comparison.result?.removals ?? 0} 处删除`) }}
        </p>
      </div>
      <div class="toolbar">
        <IconButton :icon="Copy" label="复制差异" :disabled="!diffText" @click="copyResult" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.left && !model.right" @click="model.left = ''; model.right = ''" />
      </div>
    </header>
    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel" :class="{ invalid: comparison.error.startsWith('左侧') }">
        <div class="panel-label">原始 JSON</div>
        <CodeEditor v-model="model.left" language="json" label="左侧 JSON" :highlights="comparison.result?.leftHighlights" />
      </div></template>
      <template #right><div class="editor-panel" :class="{ invalid: comparison.error.startsWith('右侧') }">
        <div class="panel-label">目标 JSON</div>
        <CodeEditor v-model="model.right" language="json" label="右侧 JSON" :highlights="comparison.result?.rightHighlights" />
      </div></template>
    </ResizableSplit>
  </section>
</template>
