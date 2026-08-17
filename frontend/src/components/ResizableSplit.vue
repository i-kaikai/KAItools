<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ modelValue: number; label?: string }>(), {
  label: '调整左右编辑区域大小',
})
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const container = ref<HTMLDivElement | null>(null)
const separator = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
const vertical = ref(false)
const position = computed(() => Math.min(80, Math.max(20, props.modelValue)))
let activePointerId: number | null = null
let mediaQuery: MediaQueryList | null = null

function setPosition(value: number): void {
  emit('update:modelValue', Math.round(Math.min(80, Math.max(20, value)) * 10) / 10)
}

function updateFromPointer(event: PointerEvent): void {
  const element = container.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const value = vertical.value
    ? ((event.clientY - rect.top) / rect.height) * 100
    : ((event.clientX - rect.left) / rect.width) * 100
  setPosition(value)
}

function onPointerDown(event: PointerEvent): void {
  if (activePointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return
  activePointerId = event.pointerId
  dragging.value = true
  separator.value?.setPointerCapture(event.pointerId)
  document.documentElement.classList.add(vertical.value ? 'is-resizing-rows' : 'is-resizing-columns')
  updateFromPointer(event)
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return
  updateFromPointer(event)
  event.preventDefault()
}

function finishPointer(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return
  try {
    separator.value?.releasePointerCapture(event.pointerId)
  } catch {
    // The browser may release capture before pointer cancellation arrives.
  }
  activePointerId = null
  dragging.value = false
  document.documentElement.classList.remove('is-resizing-columns', 'is-resizing-rows')
}

function onKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 5 : 2
  const decrease = vertical.value ? event.key === 'ArrowUp' : event.key === 'ArrowLeft'
  const increase = vertical.value ? event.key === 'ArrowDown' : event.key === 'ArrowRight'
  if (decrease) setPosition(position.value - step)
  else if (increase) setPosition(position.value + step)
  else if (event.key === 'Home') setPosition(20)
  else if (event.key === 'End') setPosition(80)
  else return
  event.preventDefault()
}

function updateOrientation(event?: MediaQueryListEvent): void {
  vertical.value = event?.matches ?? mediaQuery?.matches ?? false
}

onMounted(() => {
  mediaQuery = window.matchMedia('(max-width: 720px)')
  updateOrientation()
  mediaQuery.addEventListener('change', updateOrientation)
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', updateOrientation)
  document.documentElement.classList.remove('is-resizing-columns', 'is-resizing-rows')
})
</script>

<template>
  <div
    ref="container"
    class="editor-split"
    :class="{ 'is-dragging': dragging }"
    :style="{ '--split-position': `${position}%` }"
  >
    <slot name="left" />
    <div
      ref="separator"
      class="split-separator"
      role="separator"
      tabindex="0"
      :aria-label="label"
      :aria-orientation="vertical ? 'horizontal' : 'vertical'"
      aria-valuemin="20"
      aria-valuemax="80"
      :aria-valuenow="Math.round(position)"
      @dblclick="setPosition(50)"
      @keydown="onKeydown"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="finishPointer"
      @pointercancel="finishPointer"
    />
    <slot name="right" />
  </div>
</template>
