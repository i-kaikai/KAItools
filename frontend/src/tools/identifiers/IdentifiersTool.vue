<script setup lang="ts">
import { Copy, Fingerprint, RefreshCw, Trash2 } from '@lucide/vue'
import { computed } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { generateUlid, generateUuidV4, generateUuidV7, parseIdentifier, type IdentifierKind } from '@/utils/identifiers'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(
  props.state,
  { kind: 'uuid-v7' as IdentifierKind, count: 1, output: '', inspectInput: '', split: 50 },
  (state) => emit('update:state', state),
)

const inspection = computed(() => parseIdentifier(model.inspectInput))
const inspectionRows = computed(() => {
  if (!model.inspectInput.trim()) return [['状态', '输入 UUID v4、UUID v7 或 ULID 进行解析']]
  if (inspection.value.kind === 'unknown') return [['状态', '无法识别为有效 UUID 或 ULID']]
  return [
    ['类型', inspection.value.kind === 'uuid-v4' ? 'UUID v4' : inspection.value.kind === 'uuid-v7' ? 'UUID v7' : inspection.value.kind === 'ulid' ? 'ULID' : '其他 UUID'],
    ['规范值', inspection.value.normalized],
    ['时间', inspection.value.timestamp === null ? '该标识符不包含可解析时间' : new Date(inspection.value.timestamp).toLocaleString()],
    ...(inspection.value.timestamp === null ? [] : [['Unix 毫秒', String(inspection.value.timestamp)]]),
  ]
})

function generateOne(kind: IdentifierKind): string {
  if (kind === 'uuid-v4') return generateUuidV4()
  if (kind === 'uuid-v7') return generateUuidV7()
  return generateUlid()
}

function generate(): void {
  const count = Math.min(100, Math.max(1, Math.floor(Number(model.count) || 1)))
  model.count = count
  model.output = Array.from({ length: count }, () => generateOne(model.kind)).join('\n')
  model.inspectInput = model.output.split('\n')[0] ?? ''
}

async function copyOutput(): Promise<void> {
  await copyText(model.output)
  toast.show('标识符已复制', 'success')
}

generate()
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div><h1>UUID / ULID</h1><p>生成 UUID v4、时间有序 UUID v7、ULID，并解析其中的时间信息</p></div>
      <div class="toolbar">
        <SegmentedControl :model-value="model.kind" label="标识符类型" :options="[{ value: 'uuid-v4', label: 'UUID v4' }, { value: 'uuid-v7', label: 'UUID v7' }, { value: 'ulid', label: 'ULID' }]" @update:model-value="model.kind = $event as IdentifierKind" />
        <input v-model.number="model.count" class="compact-input" aria-label="生成数量" type="number" min="1" max="100" />
        <IconButton :icon="RefreshCw" label="生成标识符" @click="generate" />
        <IconButton :icon="Copy" label="复制标识符" :disabled="!model.output" @click="copyOutput" />
        <IconButton :icon="Trash2" label="清空标识符" :disabled="!model.output && !model.inspectInput" @click="model.output = ''; model.inspectInput = ''" />
      </div>
    </header>
    <ResizableSplit v-model="model.split">
      <template #left><div class="editor-panel"><div class="panel-label">生成结果</div><CodeEditor v-model="model.output" label="生成的 UUID 或 ULID" /></div></template>
      <template #right>
        <div class="identifier-inspector">
          <div class="panel-label"><Fingerprint :size="14" />标识符解析</div>
          <CodeEditor v-model="model.inspectInput" label="待解析 UUID 或 ULID" />
          <dl><div v-for="[label, value] in inspectionRows" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></div></dl>
        </div>
      </template>
    </ResizableSplit>
  </section>
</template>
