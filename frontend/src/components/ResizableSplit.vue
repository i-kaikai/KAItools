<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ modelValue: number; label?: string; syncScroll?: boolean }>(), {
  label: '调整左右编辑区域大小',
  syncScroll: true,
})
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const container = ref<HTMLDivElement | null>(null)
const separator = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
const vertical = ref(false)
const position = computed(() => Math.min(80, Math.max(20, props.modelValue)))
let activePointerId: number | null = null
let mediaQuery: MediaQueryList | null = null
let scrollSyncActive = false
let scrollSyncResetFrame: number | undefined
let scrollSyncObserver: MutationObserver | undefined
const suppressedScrollTargets = new Set<HTMLElement>()

interface IframeScrollListener {
  onLoad: () => void
  window: Window | undefined
  onScroll: (() => void) | undefined
}

const iframeScrollListeners = new Map<HTMLIFrameElement, IframeScrollListener>()

function splitPanes(): [HTMLElement, HTMLElement] | undefined {
  const left = separator.value?.previousElementSibling
  const right = separator.value?.nextElementSibling
  if (!(left instanceof HTMLElement) || !(right instanceof HTMLElement)) return undefined
  return [left, right]
}

function scrollElementFor(target: HTMLElement): HTMLElement | undefined {
  if (!(target instanceof HTMLIFrameElement)) return target
  try {
    return (target.contentDocument?.scrollingElement as HTMLElement | null) ?? undefined
  } catch {
    return undefined
  }
}

function scrollTargetsFor(panel: HTMLElement): HTMLElement[] {
  const targets: HTMLElement[] = []
  if (panel.matches('[data-scroll-sync-target]')) targets.push(panel)
  targets.push(...panel.querySelectorAll<HTMLElement>('[data-scroll-sync-target]'))
  return targets
}

function scheduleSuppressionReset(): void {
  if (scrollSyncResetFrame !== undefined) return
  scrollSyncResetFrame = window.requestAnimationFrame(() => {
    suppressedScrollTargets.clear()
    scrollSyncResetFrame = undefined
  })
}

function counterpartTargets(source: HTMLElement, sourceTargets: HTMLElement[], targetTargets: HTMLElement[]): HTMLElement[] {
  if (sourceTargets.length === 1 || targetTargets.length === 1) return targetTargets
  const sourceIndex = sourceTargets.indexOf(source)
  return sourceIndex === -1 ? [] : targetTargets[sourceIndex] ? [targetTargets[sourceIndex]] : []
}

function syncScrollFrom(source: HTMLElement): void {
  if (!props.syncScroll || suppressedScrollTargets.delete(source)) return
  const panes = splitPanes()
  if (!panes) return
  const [left, right] = panes
  const sourcePanel = left.contains(source) ? left : right.contains(source) ? right : undefined
  if (!sourcePanel) return
  const targetPanel = sourcePanel === left ? right : left
  const sourceTargets = scrollTargetsFor(sourcePanel)
  const targetTargets = scrollTargetsFor(targetPanel)
  if (!sourceTargets.includes(source) || !targetTargets.length) return

  const sourceScroller = scrollElementFor(source)
  if (!sourceScroller) return
  const sourceRange = sourceScroller.scrollHeight - sourceScroller.clientHeight
  if (sourceRange <= 0) return
  const progress = Math.min(1, Math.max(0, sourceScroller.scrollTop / sourceRange))

  for (const target of counterpartTargets(source, sourceTargets, targetTargets)) {
    const targetScroller = scrollElementFor(target)
    if (!targetScroller) continue
    const targetRange = targetScroller.scrollHeight - targetScroller.clientHeight
    if (targetRange <= 0) continue
    const nextScrollTop = Math.round(progress * targetRange)
    if (Math.abs(targetScroller.scrollTop - nextScrollTop) < 1) continue
    suppressedScrollTargets.add(target)
    targetScroller.scrollTop = nextScrollTop
  }
  scheduleSuppressionReset()
}

function onContainerScroll(event: Event): void {
  const source = event.target
  if (!(source instanceof HTMLElement)) return
  const target = source.closest<HTMLElement>('[data-scroll-sync-target]')
  if (target && container.value?.contains(target)) syncScrollFrom(target)
}

function attachIframeScroll(frame: HTMLIFrameElement, listener: IframeScrollListener): void {
  listener.window?.removeEventListener('scroll', listener.onScroll ?? (() => undefined))
  listener.window = undefined
  listener.onScroll = undefined
  try {
    const frameWindow = frame.contentWindow
    if (!frameWindow) return
    const onScroll = () => syncScrollFrom(frame)
    frameWindow.addEventListener('scroll', onScroll, { passive: true })
    listener.window = frameWindow
    listener.onScroll = onScroll
  } catch {
    // Cross-origin previews are intentionally left independent.
  }
}

function observeIframe(frame: HTMLIFrameElement): void {
  if (iframeScrollListeners.has(frame)) return
  const listener: IframeScrollListener = {
    onLoad: () => attachIframeScroll(frame, listener),
    window: undefined,
    onScroll: undefined,
  }
  iframeScrollListeners.set(frame, listener)
  frame.addEventListener('load', listener.onLoad)
  attachIframeScroll(frame, listener)
}

function refreshIframeListeners(): void {
  const element = container.value
  if (!element) return
  const frames = new Set(element.querySelectorAll<HTMLIFrameElement>('iframe[data-scroll-sync-target]'))
  for (const frame of frames) observeIframe(frame)
  for (const [frame, listener] of iframeScrollListeners) {
    if (frames.has(frame)) continue
    frame.removeEventListener('load', listener.onLoad)
    listener.window?.removeEventListener('scroll', listener.onScroll ?? (() => undefined))
    iframeScrollListeners.delete(frame)
  }
}

function startScrollSync(): void {
  const element = container.value
  if (!element || scrollSyncActive) return
  scrollSyncActive = true
  element.addEventListener('scroll', onContainerScroll, true)
  refreshIframeListeners()
  scrollSyncObserver = new MutationObserver(refreshIframeListeners)
  scrollSyncObserver.observe(element, { childList: true, subtree: true })
}

function stopScrollSync(): void {
  if (!scrollSyncActive) return
  scrollSyncActive = false
  container.value?.removeEventListener('scroll', onContainerScroll, true)
  scrollSyncObserver?.disconnect()
  scrollSyncObserver = undefined
  if (scrollSyncResetFrame !== undefined) window.cancelAnimationFrame(scrollSyncResetFrame)
  scrollSyncResetFrame = undefined
  suppressedScrollTargets.clear()
  for (const [frame, listener] of iframeScrollListeners) {
    frame.removeEventListener('load', listener.onLoad)
    listener.window?.removeEventListener('scroll', listener.onScroll ?? (() => undefined))
  }
  iframeScrollListeners.clear()
}

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
  if (props.syncScroll) startScrollSync()
})

watch(() => props.syncScroll, (enabled) => {
  if (enabled) startScrollSync()
  else stopScrollSync()
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', updateOrientation)
  stopScrollSync()
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
