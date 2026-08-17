<script setup lang="ts">
import { Copy, Hash, Trash2 } from '@lucide/vue'
import { computed } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import ToolChainButton from '@/components/ToolChainButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { md5Text, utf8ByteLength } from '@/utils/md5'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { input: '', uppercase: false }, (state) => emit('update:state', state))
const digest = computed(() => md5Text(model.input, model.uppercase))
const byteLength = computed(() => utf8ByteLength(model.input))

async function copyDigest(): Promise<void> {
  await copyText(digest.value)
  toast.show('MD5 摘要已复制', 'success')
}
</script>

<template>
  <section class="tool-page narrow-tool">
    <header class="tool-header">
      <div>
        <h1>MD5 摘要</h1>
        <p>{{ model.input.length.toLocaleString() }} 字符 · {{ byteLength.toLocaleString() }} UTF-8 字节</p>
      </div>
      <div class="toolbar">
        <label class="toggle-label">
          <input v-model="model.uppercase" type="checkbox" />
          <span>大写</span>
        </label>
        <ToolChainButton :value="digest" source-name="MD5" />
        <IconButton :icon="Trash2" label="清空" :disabled="!model.input" @click="model.input = ''" />
      </div>
    </header>
    <div class="single-editor-panel">
      <div class="panel-label">UTF-8 文本</div>
      <CodeEditor v-model="model.input" label="MD5 文本输入" />
    </div>
    <div class="digest-output">
      <Hash :size="19" aria-hidden="true" />
      <code>{{ digest }}</code>
      <IconButton :icon="Copy" label="复制摘要" @click="copyDigest" />
    </div>
  </section>
</template>
