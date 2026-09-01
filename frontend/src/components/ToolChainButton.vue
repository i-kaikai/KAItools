<script setup lang="ts">
import { Workflow } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import { workspaceTools } from '@/tools/registry'

const props = defineProps<{ value: string; sourceName: string }>()
const app = useAppStore()
const toast = useToastStore()
const root = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
const menuStyle = ref<Record<string, string>>({})
const targets = computed(() => workspaceTools.filter((tool) => tool.chainInput))

function positionMenu(): void {
  if (!open.value || !root.value) return

  const trigger = root.value.getBoundingClientRect()
  const margin = 12
  const gap = 7
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const compact = window.matchMedia('(max-width: 720px)').matches
  const width = Math.min(compact ? viewportWidth - margin * 2 : 232, viewportWidth - margin * 2)
  const maximumHeight = Math.min(420, viewportHeight - margin * 2)
  const menuHeight = Math.min(menu.value?.getBoundingClientRect().height || maximumHeight, maximumHeight)
  const spaceAbove = trigger.top - margin - gap
  const spaceBelow = viewportHeight - trigger.bottom - margin - gap
  const above = spaceBelow < menuHeight && spaceAbove >= spaceBelow
  const availableHeight = Math.max(1, above ? spaceAbove : spaceBelow)
  const maxHeight = Math.min(maximumHeight, availableHeight)
  const height = Math.min(menuHeight, maxHeight)
  const top = above ? trigger.top - gap - height : trigger.bottom + gap
  const left = Math.min(Math.max(margin, trigger.right - width), viewportWidth - margin - width)

  menuStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    right: 'auto',
    bottom: 'auto',
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.floor(maxHeight)}px`,
  }
}

async function toggleMenu(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  await nextTick()
  positionMenu()
}

function close(event?: Event): void {
  if (event && (root.value?.contains(event.target as Node) || menu.value?.contains(event.target as Node))) return
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
  window.addEventListener('resize', positionMenu)
  window.addEventListener('scroll', positionMenu, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', close)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', positionMenu)
  window.removeEventListener('scroll', positionMenu, true)
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
      @click="toggleMenu"
    />
  </div>
  <Teleport to="body">
    <div v-if="open" ref="menu" class="tool-chain-menu" :style="menuStyle" role="menu" aria-label="发送到其他工具" @pointerdown.stop>
      <button v-for="tool in targets" :key="tool.id" type="button" role="menuitem" @click="sendTo(tool.id)">
        <component :is="tool.icon" :size="16" :stroke-width="1.8" aria-hidden="true" />
        <span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span>
      </button>
    </div>
  </Teleport>
</template>
