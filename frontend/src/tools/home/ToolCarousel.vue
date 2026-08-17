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
const phaseOffsets = workspaceTools.map((_, index) => (index / workspaceTools.length) * Math.PI * 2)
const cardStates = workspaceTools.map(() => ({ sine: 0, depth: 0, x: 0 }))
let resizeObserver: ResizeObserver | null = null
let frameId = 0
let lastTime = 0
let angle = 0
let wheelVelocity = 0
let radiusX = 255
let centerSpread = 2.2
let spreadLimit = Math.tanh(centerSpread)
let autoVelocity = 0.14
let layoutDirty = true
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

function smoothstep(start: number, end: number, value: number): number {
  const progress = clamp((value - start) / (end - start), 0, 1)
  return progress * progress * (3 - 2 * progress)
}

function updateStageGeometry(): void {
  if (!stage.value) return
  const width = stage.value.clientWidth
  const compact = width < 640
  const portrait = window.innerHeight > window.innerWidth
  if (compact) {
    radiusX = portrait
      ? Math.min(245, Math.max(205, width * 0.5))
      : Math.min(290, Math.max(220, width * 0.56))
    centerSpread = portrait ? 1.75 : 1.55
  } else if (portrait) {
    radiusX = Math.min(315, Math.max(220, width * 0.28))
    centerSpread = 1.15
  } else {
    radiusX = Math.min(390, Math.max(230, width * 0.33))
    centerSpread = 1.35
  }
  spreadLimit = Math.tanh(centerSpread)
  autoVelocity = portrait ? 0.075 : 0.14
  stage.value.dataset.orbitLayout = portrait ? 'portrait' : compact ? 'compact' : 'landscape'
  layoutDirty = true
}

function setStyleProperty(card: HTMLElement, property: string, value: string): void {
  if (card.style.getPropertyValue(property) !== value) card.style.setProperty(property, value)
}

function clearHandoverMask(card: HTMLElement): void {
  if (!card.dataset.handoverRole) return
  delete card.dataset.handoverRole
  card.style.removeProperty('--card-left-edge-alpha')
  card.style.removeProperty('--card-right-edge-alpha')
  card.style.removeProperty('--card-left-edge-width')
  card.style.removeProperty('--card-right-edge-width')
}

function layoutCards(): void {
  if (!cards.length) return
  const count = cards.length
  let frontIndex = -1
  let secondIndex = -1
  let frontDepth = -1
  let secondDepth = -1

  for (let index = 0; index < count; index += 1) {
    const phase = angle + phaseOffsets[index]!
    const sine = Math.sin(phase)
    const depth = (Math.cos(phase) + 1) / 2
    const x = (Math.tanh(sine * centerSpread) / spreadLimit) * radiusX
    const state = cardStates[index]!
    state.sine = sine
    state.depth = depth
    state.x = x

    if (depth > frontDepth) {
      secondDepth = frontDepth
      secondIndex = frontIndex
      frontDepth = depth
      frontIndex = index
    } else if (depth > secondDepth) {
      secondDepth = depth
      secondIndex = index
    }
  }

  const handoverDepthGap = frontDepth - secondDepth
  const handoverStrength = 1 - smoothstep(0.004, 0.028, handoverDepthGap)

  cards.forEach((card, index) => {
    const { sine, depth, x } = cardStates[index]!
    const y = (1 - depth) * 18
    const scale = 0.68 + depth * 0.32
    const rotateY = -sine * 22
    const isFront = index === frontIndex
    const edgeFeather = smoothstep(0.12, 0.8, Math.abs(x) / radiusX)
    const edgeAlpha = 1 - edgeFeather * 0.9
    const edgeWidth = 12 + edgeFeather * 22
    const edgeAlphaValue = edgeAlpha.toFixed(3)
    const edgeWidthValue = `${edgeWidth.toFixed(2)}%`
    const isHandoverCard = handoverStrength > 0 && (index === frontIndex || index === secondIndex)

    setStyleProperty(card, '--card-edge-alpha', edgeAlphaValue)
    setStyleProperty(card, '--card-edge-width', edgeWidthValue)

    if (isHandoverCard) {
      const handoverAlpha = 1 - handoverStrength * 0.9
      const handoverWidth = 12 + handoverStrength * 24
      const handoverAlphaValue = Math.min(edgeAlpha, handoverAlpha).toFixed(3)
      const handoverWidthValue = `${Math.max(edgeWidth, handoverWidth).toFixed(2)}%`
      if (x < 0) {
        setStyleProperty(card, '--card-left-edge-alpha', '1')
        setStyleProperty(card, '--card-left-edge-width', '0%')
        setStyleProperty(card, '--card-right-edge-alpha', handoverAlphaValue)
        setStyleProperty(card, '--card-right-edge-width', handoverWidthValue)
        if (card.dataset.handoverRole !== 'incoming') card.dataset.handoverRole = 'incoming'
      } else {
        setStyleProperty(card, '--card-left-edge-alpha', handoverAlphaValue)
        setStyleProperty(card, '--card-left-edge-width', handoverWidthValue)
        setStyleProperty(card, '--card-right-edge-alpha', '1')
        setStyleProperty(card, '--card-right-edge-width', '0%')
        if (card.dataset.handoverRole !== 'outgoing') card.dataset.handoverRole = 'outgoing'
      }
    } else clearHandoverMask(card)

    card.style.transform = `translate3d(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px), ${(depth * 90).toFixed(2)}px) rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(4)})`
    const zIndex = String(Math.round(depth * 100))
    if (card.style.zIndex !== zIndex) card.style.zIndex = zIndex
    if (card.hasAttribute('data-front') !== isFront) card.toggleAttribute('data-front', isFront)
  })
  layoutDirty = false
}

function render(time: number): void {
  const delta = lastTime ? Math.min(0.032, (time - lastTime) / 1000) : 0.016
  lastTime = time
  if (!reducedMotion) {
    const baseVelocity = pointerInside ? 0 : autoVelocity
    const angularVelocity = baseVelocity + wheelVelocity
    if (Math.abs(angularVelocity) > 0.0001) {
      angle = (angle + angularVelocity * delta) % (Math.PI * 2)
      layoutDirty = true
    }
    if (wheelVelocity !== 0) {
      wheelVelocity += -wheelVelocity * 10 * delta
      if (Math.abs(wheelVelocity) < 0.03) {
        wheelVelocity = 0
        stage.value?.removeAttribute('data-wheel-active')
      }
    }
  }
  if (layoutDirty) layoutCards()
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
    layoutDirty = true
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
}

function onPointerMove(event: PointerEvent): void {
  if (!stage.value || event.pointerId !== activePointerId) return
  const deltaX = event.clientX - pointerX
  const elapsed = Math.max(8, event.timeStamp - pointerTime)
  pointerX = event.clientX
  pointerTime = event.timeStamp
  dragDistance += Math.abs(deltaX)
  if (!dragged && dragDistance > 8) {
    dragged = true
    try {
      stage.value.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic events and older WebViews may not expose pointer capture.
    }
  }
  angle = (angle + deltaX * 0.008) % (Math.PI * 2)
  if (!reducedMotion) wheelVelocity = clamp((deltaX / elapsed) * 3.2, -5, 5)
  layoutDirty = true
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
  resizeObserver = new ResizeObserver(updateStageGeometry)
  if (stage.value) resizeObserver.observe(stage.value)
  document.addEventListener('visibilitychange', onVisibilityChange)
  updateStageGeometry()
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
