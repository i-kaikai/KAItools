<script setup lang="ts">
import { ArrowUpRight } from '@lucide/vue'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { ToolDefinition } from '@/tools/registry'
import type { DashboardCard, DashboardCarouselMode } from '@/types'

export interface CarouselItem {
  card: DashboardCard
  tool: ToolDefinition
}

interface StepTransition {
  from: number
  to: number
  targetIndex: number
  startedAt: number
  durationMs: number
}

interface RingGeometry {
  radiusX: number
  radiusY: number
  radiusZ: number
}

const props = defineProps<{
  items: CarouselItem[]
  mode: DashboardCarouselMode
  classicRotationSpeed: number
  stepIntervalMs: number
  reducedMotion: boolean
}>()

const emit = defineEmits<{
  open: [tool: ToolDefinition]
  focus: [tool: ToolDefinition]
  release: []
}>()

const stage = ref<HTMLDivElement | null>(null)
const cards = new Map<string, HTMLElement>()
let resizeObserver: ResizeObserver | null = null
let frameId = 0
let lastFrameTime = 0
let angle = 0
let activeIndex = 0
let transition: StepTransition | null = null
let queuedStep = 0
let classicVelocity = 0
let autoRotationTimer: number | undefined
let wheelResetTimer: number | undefined
let wheelDelta = 0
let systemReducedMotion = false
let pointerInside = false
let activePointerId: number | null = null
let dragStartX = 0
let dragStartAngle = 0
let dragDistance = 0
let dragged = false
let geometry: RingGeometry = { radiusX: 160, radiusY: 22, radiusZ: 72 }

const AUTO_ROTATION_INTERVAL_MS = 3_000
const STEP_TRANSITION_MS = 360
const CLASSIC_FRAME_INTERVAL_MS = 1000 / 30
const WHEEL_STEP_THRESHOLD = 40

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function shouldReduceMotion(): boolean {
  return props.reducedMotion || systemReducedMotion
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function normalizeAngle(value: number): number {
  let normalized = value % (Math.PI * 2)
  if (normalized > Math.PI) normalized -= Math.PI * 2
  if (normalized <= -Math.PI) normalized += Math.PI * 2
  return normalized
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2
}

function setCardRef(element: unknown, cardId: string): void {
  if (element instanceof HTMLElement) cards.set(cardId, element)
  else cards.delete(cardId)
}

function cardWidth(): number {
  const firstCard = cards.values().next().value as HTMLElement | undefined
  if (firstCard?.clientWidth) return firstCard.clientWidth
  return Math.min(286, Math.max(160, (stage.value?.clientWidth ?? 520) * 0.54))
}

function stepAngle(): number {
  return props.items.length > 1 ? (Math.PI * 2) / props.items.length : 0
}

function angleForIndex(index: number): number {
  return -index * stepAngle()
}

function nearestIndex(value = angle): number {
  const count = props.items.length
  if (count <= 1) return 0
  return modulo(Math.round(-value / stepAngle()), count)
}

function nearestEquivalentAngle(target: number, current: number): number {
  let result = target
  while (result - current > Math.PI) result -= Math.PI * 2
  while (result - current < -Math.PI) result += Math.PI * 2
  return result
}

function updateGeometry(): void {
  const host = stage.value
  if (!host) return
  const count = props.items.length
  const width = host.clientWidth
  const card = cardWidth()
  if (count <= 1) {
    geometry = { radiusX: 0, radiusY: 0, radiusZ: 0 }
  } else {
    const pitchRatio = width < 420 ? 0.62 : width < 760 ? 0.7 : 0.78
    const targetPitch = clamp(card * pitchRatio, Math.min(94, width * 0.3), card * 0.86)
    const ringFromPitch = targetPitch / (2 * Math.max(Math.sin(Math.PI / count), 0.18))
    const maxRadius = Math.max(card * 0.48, (width - card * 0.58) / 2)
    geometry = {
      radiusX: clamp(ringFromPitch, card * 0.44, maxRadius),
      radiusY: clamp(card * 0.1, 10, 28),
      radiusZ: clamp(card * 0.32, 44, 96),
    }
  }
  host.dataset.cardCount = String(count)
  host.dataset.ringRadius = String(Math.round(geometry.radiusX))
  host.dataset.orbitLayout = window.innerHeight > window.innerWidth ? 'portrait' : width < 640 ? 'compact' : 'landscape'
}

function layoutCards(): void {
  const count = props.items.length
  if (!count) return
  stage.value?.setAttribute('data-active-index', String(nearestIndex()))

  let frontIndex = 0
  let frontDepth = -Infinity
  const states = props.items.map((_, index) => {
    const phase = angle + (index / count) * Math.PI * 2
    const depth = (Math.cos(phase) + 1) / 2
    if (depth > frontDepth) {
      frontDepth = depth
      frontIndex = index
    }
    return {
      x: Math.sin(phase) * geometry.radiusX,
      y: (1 - depth) * geometry.radiusY,
      z: (depth - 0.5) * geometry.radiusZ,
      depth,
      rotateY: -Math.sin(phase) * 14,
    }
  })

  props.items.forEach((item, index) => {
    const card = cards.get(item.card.id)
    const state = states[index]
    if (!card || !state) return
    const scale = 0.68 + state.depth * 0.32
    const opacity = 0.18 + state.depth * 0.82
    card.style.transform = `translate3d(calc(-50% + ${state.x.toFixed(2)}px), calc(-50% + ${state.y.toFixed(2)}px), ${state.z.toFixed(2)}px) rotateY(${state.rotateY.toFixed(2)}deg) scale(${scale.toFixed(4)})`
    card.style.opacity = opacity.toFixed(3)
    card.style.zIndex = String(Math.round(state.depth * 100))
    card.toggleAttribute('data-front', index === frontIndex)
  })
}

function cancelAutoRotation(): void {
  window.clearTimeout(autoRotationTimer)
  autoRotationTimer = undefined
}

function scheduleAutoRotation(): void {
  cancelAutoRotation()
  if (
    props.mode !== 'step' || shouldReduceMotion() || document.hidden ||
    props.items.length < 2 || activePointerId !== null || transition
  ) return
  // Keep automatic stepping opposite to the forward drag direction: the incoming card travels right-to-left.
  autoRotationTimer = window.setTimeout(() => requestStep(-1), Math.max(800, Math.min(6000, props.stepIntervalMs || AUTO_ROTATION_INTERVAL_MS)))
}

function requestFrame(): void {
  if (!frameId && !document.hidden) frameId = window.requestAnimationFrame(render)
}

function beginTransition(targetIndex: number, durationMs = STEP_TRANSITION_MS): void {
  const count = props.items.length
  if (count < 2) return
  cancelAutoRotation()
  const target = modulo(targetIndex, count)
  const targetAngle = nearestEquivalentAngle(angleForIndex(target), angle)
  if (durationMs === 0 || shouldReduceMotion()) {
    angle = normalizeAngle(targetAngle)
    activeIndex = target
    layoutCards()
    scheduleAutoRotation()
    return
  }
  transition = {
    from: angle,
    to: targetAngle,
    targetIndex: target,
    startedAt: performance.now(),
    durationMs,
  }
  stage.value?.setAttribute('data-transitioning', 'true')
  requestFrame()
}

function requestStep(direction: number): void {
  if (props.mode !== 'step' || props.items.length < 2 || !direction) return
  const normalizedDirection = direction > 0 ? 1 : -1
  if (transition) {
    queuedStep = normalizedDirection
    return
  }
  activeIndex = nearestIndex()
  beginTransition(activeIndex + normalizedDirection)
}

function advanceTransition(time: number): void {
  const current = transition
  if (!current) return
  const progress = clamp((time - current.startedAt) / current.durationMs, 0, 1)
  angle = current.from + (current.to - current.from) * easeInOutCubic(progress)
  layoutCards()
  if (progress < 1) {
    requestFrame()
    return
  }
  angle = normalizeAngle(current.to)
  activeIndex = current.targetIndex
  transition = null
  stage.value?.removeAttribute('data-transitioning')
  const nextStep = queuedStep
  queuedStep = 0
  if (nextStep) requestStep(nextStep)
  else scheduleAutoRotation()
}

function render(time: number): void {
  frameId = 0
  if (transition) {
    advanceTransition(time)
    return
  }
  if (props.mode !== 'classic' || shouldReduceMotion() || document.hidden) return
  const elapsed = lastFrameTime ? time - lastFrameTime : CLASSIC_FRAME_INTERVAL_MS
  if (elapsed >= CLASSIC_FRAME_INTERVAL_MS) {
    const delta = Math.min(0.05, elapsed / 1000)
    lastFrameTime = time
    if (!pointerInside || classicVelocity !== 0) {
      const radiansPerSecond = Math.max(6, Math.min(30, props.classicRotationSpeed || 16)) * Math.PI / 180
      angle = normalizeAngle(angle + (radiansPerSecond + classicVelocity) * delta)
      classicVelocity *= Math.pow(0.0003, delta)
      if (Math.abs(classicVelocity) < 0.001) classicVelocity = 0
      layoutCards()
    }
  }
  requestFrame()
}

function startManualMotion(): void {
  cancelAutoRotation()
  stage.value?.setAttribute('data-manual-motion', 'true')
}

function finishManualMotion(): void {
  stage.value?.removeAttribute('data-manual-motion')
  if (props.mode === 'step' && !transition) scheduleAutoRotation()
}

function onWheel(event: WheelEvent): void {
  if (!stage.value) return
  event.preventDefault()
  if (props.mode === 'classic') {
    classicVelocity = clamp(classicVelocity + event.deltaY / 420, -1.4, 1.4)
    requestFrame()
    return
  }
  wheelDelta += event.deltaY
  window.clearTimeout(wheelResetTimer)
  wheelResetTimer = window.setTimeout(() => { wheelDelta = 0 }, 140)
  if (Math.abs(wheelDelta) < WHEEL_STEP_THRESHOLD) return
  // Match the natural vertical wheel direction with the visual card movement.
  const direction = -Math.sign(wheelDelta)
  wheelDelta = 0
  requestStep(direction)
}

function onPointerDown(event: PointerEvent): void {
  if (!stage.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  activePointerId = event.pointerId
  dragStartX = event.clientX
  dragStartAngle = angle
  dragDistance = 0
  dragged = false
  classicVelocity = 0
  startManualMotion()
  stage.value.dataset.dragActive = 'true'
}

function onPointerMove(event: PointerEvent): void {
  if (!stage.value || event.pointerId !== activePointerId) return
  const deltaX = event.clientX - dragStartX
  dragDistance = Math.max(dragDistance, Math.abs(deltaX))
  if (!dragged && dragDistance > 8) {
    dragged = true
    try {
      stage.value.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic events and older WebViews may not expose pointer capture.
    }
  }
  const motionRadius = Math.max(geometry.radiusX, 96)
  angle = normalizeAngle(dragStartAngle + (deltaX / motionRadius) * 0.78)
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
  stage.value.removeAttribute('data-drag-active')
  if (props.mode === 'step') beginTransition(nearestIndex(), 220)
  else requestFrame()
  finishManualMotion()
  emit('release')
}

function onPointerEnter(): void {
  pointerInside = true
}

function onPointerLeave(): void {
  pointerInside = false
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

function resetForMode(): void {
  window.cancelAnimationFrame(frameId)
  frameId = 0
  transition = null
  queuedStep = 0
  classicVelocity = 0
  lastFrameTime = 0
  cancelAutoRotation()
  activeIndex = nearestIndex()
  if (props.mode === 'step') angle = normalizeAngle(angleForIndex(activeIndex))
  stage.value?.setAttribute('data-carousel-mode', props.mode)
  stage.value?.removeAttribute('data-transitioning')
  updateGeometry()
  layoutCards()
  if (props.mode === 'classic' && !shouldReduceMotion()) requestFrame()
  else scheduleAutoRotation()
}

function onVisibilityChange(): void {
  if (document.hidden) {
    window.cancelAnimationFrame(frameId)
    frameId = 0
    if (transition) {
      angle = normalizeAngle(transition.to)
      activeIndex = transition.targetIndex
      transition = null
      queuedStep = 0
      layoutCards()
    }
    classicVelocity = 0
    cancelAutoRotation()
    stage.value?.setAttribute('data-animation-paused', 'true')
    stage.value?.removeAttribute('data-transitioning')
    return
  }
  stage.value?.removeAttribute('data-animation-paused')
  resetForMode()
}

onMounted(async () => {
  systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  await nextTick()
  resizeObserver = new ResizeObserver(() => {
    updateGeometry()
    layoutCards()
  })
  if (stage.value) resizeObserver.observe(stage.value)
  document.addEventListener('visibilitychange', onVisibilityChange)
  resetForMode()
})

watch(() => props.items.map((item) => item.card.id), async () => {
  await nextTick()
  activeIndex = Math.min(activeIndex, Math.max(0, props.items.length - 1))
  angle = normalizeAngle(angleForIndex(activeIndex))
  resetForMode()
}, { deep: true })

watch(() => [props.mode, props.classicRotationSpeed, props.stepIntervalMs, props.reducedMotion], resetForMode)

onBeforeUnmount(() => {
  window.cancelAnimationFrame(frameId)
  window.clearTimeout(wheelResetTimer)
  cancelAutoRotation()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  resizeObserver?.disconnect()
})
</script>

<template>
  <section class="home-tools" aria-labelledby="home-tools-title">
    <header class="home-section-heading">
      <div><span>TOOLS</span><h2 id="home-tools-title">工具模块</h2></div>
      <small>{{ items.length }} 个首页模块</small>
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
        v-for="(item, index) in items"
        :key="item.card.id"
        :ref="(element) => setCardRef(element, item.card.id)"
        class="home-tool-card"
        :class="`tool-${item.tool.id}`"
        :data-tool="item.tool.id"
        :style="{ '--home-item-index': index, '--tool-accent': item.card.accentColor }"
        type="button"
        @pointerenter="emit('focus', item.tool)"
        @pointerleave="emit('release')"
        @pointercancel="emit('release')"
        @focus="emit('focus', item.tool)"
        @blur="emit('release')"
        @click="onCardClick($event, item.tool)"
      >
        <span class="home-card-topline">
          <em>MODULE {{ String(index + 1).padStart(2, '0') }}</em>
          <ArrowUpRight :size="15" aria-hidden="true" />
        </span>
        <span class="home-card-main">
          <span class="home-tool-icon"><component :is="item.tool.icon" :size="25" :stroke-width="1.65" aria-hidden="true" /></span>
          <span class="home-tool-copy">
            <strong>{{ item.card.title }}</strong>
            <small>{{ item.card.description || item.tool.description }}</small>
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
