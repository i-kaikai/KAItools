<script setup lang="ts">
import { Copy, Regex, Trash2 } from '@lucide/vue'
import { computed, watch } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ResizableSplit from '@/components/ResizableSplit.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import ToolChainButton from '@/components/ToolChainButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { evaluateRegex, serializeRegexMatches } from '@/utils/regex'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(
  props.state,
  { input: '', pattern: '', flags: 'g', replacement: '', mode: 'matches' as 'matches' | 'replace', output: '', split: 50 },
  (state) => emit('update:state', state),
)
const flagOptions = [
  { value: 'g', label: '全局' },
  { value: 'i', label: '忽略大小写' },
  { value: 'm', label: '多行' },
  { value: 's', label: '跨行' },
  { value: 'u', label: 'Unicode' },
] as const
const evaluation = computed(() => evaluateRegex(model.input, model.pattern, model.flags, model.replacement))

function generateOutput(): string {
  if (evaluation.value.error) return ''
  return model.mode === 'matches'
    ? serializeRegexMatches(evaluation.value.matches)
    : evaluation.value.replacement
}

if (!model.output) model.output = generateOutput()
watch(
  () => [model.input, model.pattern, model.flags, model.replacement, model.mode] as const,
  () => (model.output = generateOutput()),
)

function toggleFlag(flag: string): void {
  model.flags = model.flags.includes(flag)
    ? model.flags.replace(flag, '')
    : `${model.flags}${flag}`
}

async function copyOutput(): Promise<void> {
  await copyText(model.output)
  toast.show(model.mode === 'matches' ? '匹配结果已复制' : '替换结果已复制', 'success')
}
</script>

<template>
  <section class="tool-page regex-tool">
    <header class="tool-header">
      <div>
        <h1>正则工作台</h1>
        <p :class="{ error: evaluation.error }">
          {{ evaluation.error || `${evaluation.matches.length} 个匹配 · /${model.flags}` }}
        </p>
      </div>
      <div class="toolbar">
        <SegmentedControl
          :model-value="model.mode"
          label="结果模式"
          :options="[{ value: 'matches', label: '匹配' }, { value: 'replace', label: '替换' }]"
          @update:model-value="model.mode = $event as 'matches' | 'replace'"
        />
        <ToolChainButton :value="model.output" source-name="正则" />
        <IconButton :icon="Copy" label="复制结果" :disabled="!model.output" @click="copyOutput" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.input && !model.pattern" @click="model.input = ''; model.pattern = ''; model.output = ''" />
      </div>
    </header>

    <div class="regex-config" :class="{ invalid: evaluation.error }">
      <Regex :size="17" aria-hidden="true" />
      <label class="regex-pattern-field">
        <span>/</span>
        <input v-model="model.pattern" aria-label="正则表达式" spellcheck="false" />
        <span>/</span>
      </label>
      <div class="regex-flags" role="group" aria-label="正则标志">
        <label v-for="flag in flagOptions" :key="flag.value" :title="flag.label">
          <input
            type="checkbox"
            :checked="model.flags.includes(flag.value)"
            :aria-label="flag.label"
            @change="toggleFlag(flag.value)"
          />
          <span>{{ flag.value }}</span>
        </label>
      </div>
      <label v-if="model.mode === 'replace'" class="regex-replacement-field">
        <span>替换为</span>
        <input v-model="model.replacement" aria-label="替换内容" spellcheck="false" />
      </label>
    </div>

    <ResizableSplit v-model="model.split">
      <template #left>
        <div class="editor-panel" :class="{ invalid: evaluation.error }">
          <div class="panel-label">测试文本</div>
          <CodeEditor v-model="model.input" label="正则测试文本" :highlights="evaluation.highlights" />
        </div>
      </template>
      <template #right>
        <div class="editor-panel result-panel">
          <div class="panel-label">
            {{ model.mode === 'matches' ? `匹配明细 · ${evaluation.matches.length}` : '替换预览' }}
          </div>
          <CodeEditor
            v-model="model.output"
            :language="model.mode === 'matches' ? 'json' : 'plain'"
            :label="model.mode === 'matches' ? '正则匹配结果' : '正则替换结果'"
          />
        </div>
      </template>
    </ResizableSplit>
  </section>
</template>
