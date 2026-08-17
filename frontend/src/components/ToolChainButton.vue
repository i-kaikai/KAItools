<script setup lang="ts">
import { Workflow } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import { workspaceTools } from '@/tools/registry'

const props = defineProps<{ value: string; sourceName: string }>()
const app = useAppStore()
const toast = useToastStore()
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const targets = computed(() => workspaceTools.filter((tool) => tool.chainInput))

function close(event?: Event): void {
  if (event && root.value?.contains(event.target as Node)) return
  open.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}

function sendTo(toolId: (typeof workspaceTools)[number]['id']): void {
  const tool = workspaceTools.find((item) => item.id === toolId)
  if (!tool?.chainInput || !props.value) return
  app.openTool(
    tool.id,
    tool.name,
    { ...tool.initialState(), ...tool.chainInput(props.value) },
    tool.singleton,
    true,
  )
  open.value = false
  toast.show(`${props.sourceName}结果已发送到${tool.name}`, 'success')
}

onMounted(() => {
  window.addEventListener('pointerdown', close)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', close)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="tool-chain-control">
    <IconButton
      :icon="Workflow"
      label="发送到其他工具"
      :disabled="!value"
      :active="open"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    />
    <div v-if="open" class="tool-chain-menu" role="menu" aria-label="发送到其他工具" @pointerdown.stop>
      <button v-for="tool in targets" :key="tool.id" type="button" role="menuitem" @click="sendTo(tool.id)">
        <component :is="tool.icon" :size="16" :stroke-width="1.8" aria-hidden="true" />
        <span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span>
      </button>
    </div>
  </div>
</template>
