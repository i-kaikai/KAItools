<script setup lang="ts">
import { ArrowUpRight } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { workspaceTools, type ToolDefinition } from '@/tools/registry'

const emit = defineEmits<{
  open: [tool: ToolDefinition]
  focus: [tool: ToolDefinition]
  release: []
}>()

const stage = ref<HTMLDivElement | null>(null)
const cards: HTMLElement[] = []
let resizeObserver: ResizeObserver | null = null
let frameId = 0
let lastTime = 0
let angle = 0
let wheelVelocity = 0
let reducedMotion = false
let pointerInside = false
let activePointerId: number | null = null
let pointerX = 0
let pointerTime = 0
let dragDistance = 0
let dragged = false

function setCardRef(element: unknown, index: number): void {
  if (element instanceof HTMLElement) cards[index] = element
}

function layoutCards(): void {
  if (!stage.value || !cards.length) return
  const count = cards.length
  const width = stage.value.clientWidth
  const radiusX = Math.min(360, Math.max(185, width * 0.31))

  cards.forEach((card, index) => {
    const phase = angle + (index / count) * Math.PI * 2
    const sine = Math.sin(phase)
    const depth = (Math.cos(phase) + 1) / 2
    const x = sine * radiusX
    const y = (1 - depth) * 18
    const scale = 0.68 + depth * 0.32
    const rotateY = -sine * 22
    const opacity = 0.22 + depth * 0.78
    card.style.transform = `translate3d(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px), ${(depth * 90).toFixed(2)}px) rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(4)})`
    card.style.opacity = opacity.toFixed(3)
    card.style.zIndex = String(Math.round(depth * 100))
    card.toggleAttribute('data-front', depth > 0.88)
  })
}

function render(time: number): void {
  const delta = lastTime ? Math.min(0.032, (time - lastTime) / 1000) : 0.016
  lastTime = time
  if (!reducedMotion) {
    const baseVelocity = pointerInside ? 0 : 0.14
    angle = (angle + (baseVelocity + wheelVelocity) * delta) % (Math.PI * 2)
    wheelVelocity += -wheelVelocity * 10 * delta
    if (Math.abs(wheelVelocity) < 0.03) stage.value?.removeAttribute('data-wheel-active')
  }
  layoutCards()
  frameId = window.requestAnimationFrame(render)
}

function onWheel(event: WheelEvent): void {
  if (!stage.value) return
  event.preventDefault()
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? stage.value.clientHeight
      : 1
  const impulse = clamp((event.deltaY * unit) / 45, -4, 4)
  if (reducedMotion) {
    angle = (angle + impulse * 0.08) % (Math.PI * 2)
    layoutCards()
    return
  }
  wheelVelocity = clamp(wheelVelocity + impulse, -5, 5)
  stage.value.dataset.wheelActive = 'true'
}

function onPointerDown(event: PointerEvent): void {
  if (!stage.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  activePointerId = event.pointerId
  pointerX = event.clientX
  pointerTime = event.timeStamp
  dragDistance = 0
  dragged = false
  wheelVelocity = 0
  pointerInside = true
  stage.value.dataset.dragActive = 'true'
  try {
    stage.value.setPointerCapture(event.pointerId)
  } catch {
    // Synthetic events and older WebViews may not expose pointer capture.
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!stage.value || event.pointerId !== activePointerId) return
  const deltaX = event.clientX - pointerX
  const elapsed = Math.max(8, event.timeStamp - pointerTime)
  pointerX = event.clientX
  pointerTime = event.timeStamp
  dragDistance += Math.abs(deltaX)
  dragged ||= dragDistance > 8
  angle = (angle + deltaX * 0.008) % (Math.PI * 2)
  if (!reducedMotion) wheelVelocity = clamp((deltaX / elapsed) * 3.2, -5, 5)
  layoutCards()
  event.preventDefault()
}

function finishPointer(event: PointerEvent): void {
  if (!stage.value || event.pointerId !== activePointerId) return
  try {
    stage.value.releasePointerCapture(event.pointerId)
  } catch {
    // The browser may already have released capture after pointer cancellation.
  }
  activePointerId = null
  pointerInside = event.pointerType === 'mouse'
  stage.value.removeAttribute('data-drag-active')
  emit('release')
}

function onCardClick(event: MouseEvent, tool: ToolDefinition): void {
  if (dragged) {
    event.preventDefault()
    dragged = false
    return
  }
  emit('open', tool)
}

function onPointerEnter(): void {
  pointerInside = true
}

function onPointerLeave(): void {
  pointerInside = false
  emit('release')
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function onVisibilityChange(): void {
  window.cancelAnimationFrame(frameId)
  if (!document.hidden) {
    lastTime = 0
    frameId = window.requestAnimationFrame(render)
  }
}

onMounted(() => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  resizeObserver = new ResizeObserver(layoutCards)
  if (stage.value) resizeObserver.observe(stage.value)
  document.addEventListener('visibilitychange', onVisibilityChange)
  layoutCards()
  frameId = window.requestAnimationFrame(render)
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(frameId)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  resizeObserver?.disconnect()
})
</script>

<template>
  <section class="home-tools" aria-labelledby="home-tools-title">
    <header class="home-section-heading">
      <div><span>TOOLS</span><h2 id="home-tools-title">工具模块</h2></div>
      <small>{{ workspaceTools.length }} 个本地模块</small>
    </header>
    <div
      ref="stage"
      class="home-tool-orbit"
      aria-label="工具模块动态卡片"
      @pointerenter="onPointerEnter"
      @pointerleave="onPointerLeave"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="finishPointer"
      @pointercancel="finishPointer"
      @wheel="onWheel"
    >
      <button
        v-for="(tool, index) in workspaceTools"
        :key="tool.id"
        :ref="(element) => setCardRef(element, index)"
        class="home-tool-card"
        :class="`tool-${tool.id}`"
        :data-tool="tool.id"
        :style="{ '--home-item-index': index }"
        type="button"
        @pointerenter="emit('focus', tool)"
        @pointerleave="emit('release')"
        @pointercancel="emit('release')"
        @focus="emit('focus', tool)"
        @blur="emit('release')"
        @click="onCardClick($event, tool)"
      >
        <span class="home-card-topline">
          <em>MODULE {{ String(index + 1).padStart(2, '0') }}</em>
          <ArrowUpRight :size="15" aria-hidden="true" />
        </span>
        <span class="home-card-main">
          <span class="home-tool-icon"><component :is="tool.icon" :size="25" :stroke-width="1.65" aria-hidden="true" /></span>
          <span class="home-tool-copy">
            <strong>{{ tool.name }}</strong>
            <small>{{ tool.description }}</small>
          </span>
        </span>
        <span class="home-card-meter" aria-hidden="true">
          <i /><i /><i /><i /><i /><i />
        </span>
        <span class="home-card-footer"><small>LOCAL UTILITY</small><b>OPEN</b></span>
      </button>
    </div>
  </section>
</template>
