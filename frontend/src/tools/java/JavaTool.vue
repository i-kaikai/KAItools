<script setup lang="ts">
import { ArrowLeftRight, Copy, Trash2 } from '@lucide/vue'
import { computed } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { escapeJava, unescapeJava } from '@/utils/javaEscape'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(
  props.state,
  { input: '', mode: 'escape' as 'escape' | 'unescape', unicode: false },
  (state) => emit('update:state', state),
)
const transformed = computed(() =>
  model.mode === 'escape'
    ? { value: escapeJava(model.input, model.unicode) }
    : unescapeJava(model.input),
)

async function copyOutput(): Promise<void> {
  await copyText(transformed.value.value)
  toast.show('转换结果已复制', 'success')
}

function swap(): void {
  if (transformed.value.error) return
  model.input = transformed.value.value
  model.mode = model.mode === 'escape' ? 'unescape' : 'escape'
}
</script>

<template>
  <section class="tool-page">
    <header class="tool-header">
      <div>
        <h1>Java 转义</h1>
        <p :class="{ error: transformed.error }">
          {{ transformed.error ? `位置 ${transformed.error.offset + 1} · ${transformed.error.message}` : 'Java 字符串字面量规则' }}
        </p>
      </div>
      <div class="toolbar">
        <SegmentedControl
          :model-value="model.mode"
          label="转换方向"
          :options="[
            { value: 'escape', label: '转义' },
            { value: 'unescape', label: '反转义' },
          ]"
          @update:model-value="model.mode = $event as 'escape' | 'unescape'"
        />
        <label v-if="model.mode === 'escape'" class="toggle-label">
          <input v-model="model.unicode" type="checkbox" />
          <span>Unicode</span>
        </label>
        <IconButton :icon="ArrowLeftRight" label="交换并反向转换" :disabled="!!transformed.error || !transformed.value" @click="swap" />
        <IconButton :icon="Copy" label="复制结果" :disabled="!!transformed.error || !transformed.value" @click="copyOutput" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.input" @click="model.input = ''" />
      </div>
    </header>
    <div class="editor-split">
      <div class="editor-panel">
        <div class="panel-label">输入</div>
        <CodeEditor v-model="model.input" label="Java 转义输入" />
      </div>
      <div class="editor-panel" :class="{ invalid: transformed.error }">
        <div class="panel-label">结果</div>
        <CodeEditor :model-value="transformed.error ? '' : transformed.value" readonly label="Java 转义结果" />
      </div>
    </div>
  </section>
</template>

