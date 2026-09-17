<script setup lang="ts">
import { AlertTriangle, Check, ShieldAlert, Trash2, X } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useConfirmStore } from '@/stores/confirm'

const confirm = useConfirmStore()
const current = computed(() => confirm.current)
const dialogRef = ref<HTMLElement | null>(null)
const primaryButton = ref<HTMLButtonElement | null>(null)
const returnFocus = ref<HTMLElement | null>(null)

function settle(confirmed: boolean): void {
  confirm.settle(confirmed)
}

function handleKeydown(event: KeyboardEvent): void {
  if (!current.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    settle(false)
    return
  }
  if (event.key !== 'Tab') return

  const focusable = dialogRef.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
  if (!focusable?.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => current.value?.id, async (id, previousId) => {
  if (id && !previousId) {
    returnFocus.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  if (id) {
    await nextTick()
    primaryButton.value?.focus()
  } else if (previousId) {
    await nextTick()
    if (returnFocus.value?.isConnected) returnFocus.value.focus()
    returnFocus.value = null
  }
})

onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-dialog">
      <div v-if="current" class="confirm-dialog-backdrop" @click.self="settle(false)">
        <section
          ref="dialogRef"
          class="confirm-dialog-surface"
          :class="`tone-${current.tone}`"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          tabindex="-1"
        >
          <header class="confirm-dialog-header">
            <div class="confirm-dialog-icon" aria-hidden="true">
              <AlertTriangle :size="21" stroke-width="2.2" />
            </div>
            <div class="confirm-dialog-heading">
              <span>操作确认</span>
              <h2 id="confirm-dialog-title">{{ current.title }}</h2>
            </div>
            <button class="confirm-dialog-close" type="button" aria-label="关闭" @click="settle(false)">
              <X :size="18" />
            </button>
          </header>

          <div class="confirm-dialog-body">
            <p id="confirm-dialog-message">{{ current.message }}</p>
            <div class="confirm-dialog-note">
              <ShieldAlert :size="15" aria-hidden="true" />
              <span>请确认当前选择，操作结果会立即生效。</span>
            </div>
          </div>

          <footer class="confirm-dialog-footer">
            <button class="confirm-dialog-secondary" type="button" @click="settle(false)">{{ current.cancelLabel }}</button>
            <button ref="primaryButton" class="confirm-dialog-primary" type="button" @click="settle(true)">
              <Trash2 v-if="current.tone === 'danger'" :size="15" aria-hidden="true" />
              <Check v-else :size="15" aria-hidden="true" />
              <span>{{ current.confirmLabel }}</span>
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
