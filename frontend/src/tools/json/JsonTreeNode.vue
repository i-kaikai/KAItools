<script setup lang="ts">
import { ChevronDown, ChevronRight, Copy } from '@lucide/vue'
import { ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import type { JsonTreeItem } from '@/utils/json'

const props = defineProps<{ item: JsonTreeItem; depth?: number }>()
const open = ref((props.depth ?? 0) < 2)
const toast = useToastStore()

async function copyValue(): Promise<void> {
  await copyText(props.item.valueText || props.item.path)
  toast.show(props.item.valueText ? '值已复制' : '路径已复制', 'success')
}
</script>

<template>
  <div class="tree-node">
    <div class="tree-row" :style="{ '--tree-depth': depth ?? 0 }">
      <button
        v-if="item.children.length"
        class="tree-toggle"
        type="button"
        :aria-label="open ? '折叠节点' : '展开节点'"
        :aria-expanded="open"
        @click="open = !open"
      >
        <ChevronDown v-if="open" :size="15" aria-hidden="true" />
        <ChevronRight v-else :size="15" aria-hidden="true" />
      </button>
      <span v-else class="tree-spacer" />
      <span class="tree-key">{{ item.key }}</span>
      <span class="tree-separator">:</span>
      <span v-if="item.children.length" class="tree-summary">
        {{ item.type === 'array' ? `Array(${item.children.length})` : `Object(${item.children.length})` }}
      </span>
      <span v-else class="tree-value" :class="`type-${item.type}`">{{ item.valueText }}</span>
      <IconButton :icon="Copy" :label="item.valueText ? '复制值' : '复制路径'" size="small" @click="copyValue" />
    </div>
    <div v-if="open && item.children.length" class="tree-children">
      <JsonTreeNode v-for="child in item.children" :key="child.id" :item="child" :depth="(depth ?? 0) + 1" />
    </div>
  </div>
</template>

