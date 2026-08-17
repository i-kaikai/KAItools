<script setup lang="ts">
import { Copy, X } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import CodeEditor from '@/components/CodeEditor.vue'
import IconButton from '@/components/IconButton.vue'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { formatJson, parseJsonDocument, type JsonTreeItem } from '@/utils/json'

const props = defineProps<{ item: JsonTreeItem; source: string }>()
const emit = defineEmits<{ close: []; apply: [value: string] }>()
const toast = useToastStore()
const original = props.source.slice(props.item.offset, props.item.offset + props.item.length)
const draft = ref((() => {
  try {
    return formatJson(original, 2)
  } catch {
    return original
  }
})())
const document = computed(() => parseJsonDocument(draft.value))
const firstIssue = computed(() => document.value.issues[0])

async function copyContent(): Promise<void> {
  await copyText(draft.value)
  toast.show('节点内容已复制', 'success')
}

async function copyPath(): Promise<void> {
  await copyText(props.item.path)
  toast.show('JSON Path 已复制', 'success')
}

function apply(): void {
  if (!draft.value.trim() || firstIssue.value) return
  emit('apply', draft.value)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault()
    apply()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop json-node-backdrop" @mousedown.self="emit('close')">
      <section class="modal json-node-modal" role="dialog" aria-modal="true" aria-labelledby="json-node-title">
        <header>
          <div>
            <h2 id="json-node-title">节点内容</h2>
            <p :class="{ error: firstIssue }">
              <template v-if="firstIssue">第 {{ firstIssue.line }} 行，第 {{ firstIssue.column }} 列 · {{ firstIssue.message }}</template>
              <template v-else>可编辑并应用到 JSON 结果</template>
            </p>
          </div>
          <IconButton :icon="X" label="关闭节点编辑" @click="emit('close')" />
        </header>

        <div class="json-node-content">
          <div class="json-node-section-label"><span>Content</span><IconButton :icon="Copy" label="复制节点内容" size="small" @click="copyContent" /></div>
          <div class="json-node-editor" :class="{ invalid: firstIssue }">
            <CodeEditor v-model="draft" language="json" label="节点 JSON 内容" :selection-offset="firstIssue?.offset" />
          </div>
          <div class="json-node-section-label"><span>JSON Path</span><IconButton :icon="Copy" label="复制 JSON Path" size="small" @click="copyPath" /></div>
          <div class="json-node-path"><code>{{ item.path }}</code></div>
        </div>

        <footer class="json-node-actions">
          <button class="command-button secondary" type="button" @click="emit('close')">取消</button>
          <button class="command-button primary" type="button" :disabled="!draft.trim() || !!firstIssue" @click="apply">应用到结果</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
