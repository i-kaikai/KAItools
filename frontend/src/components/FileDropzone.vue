<script setup lang="ts">
import { FilePlus2 } from '@lucide/vue'
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    accept?: string
    label: string
    prompt: string
    detail?: string
    disabled?: boolean
  }>(),
  { accept: '', detail: '', disabled: false },
)
const emit = defineEmits<{ file: [file: File] }>()
const picker = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

function firstFile(transfer: DataTransfer | null): File | null {
  if (!transfer) return null
  const direct = transfer.files.item(0)
  if (direct) return direct
  return Array.from(transfer.items)
    .map((item) => item.kind === 'file' ? item.getAsFile() : null)
    .find((file): file is File => Boolean(file))
    ?? null
}

function receive(file: File | null): void {
  if (!file || props.disabled) return
  emit('file', file)
}

function select(event: Event): void {
  const input = event.target as HTMLInputElement
  receive(input.files?.item(0) ?? null)
  input.value = ''
}

function drop(event: DragEvent): void {
  dragging.value = false
  receive(firstFile(event.dataTransfer))
}

function paste(event: ClipboardEvent): void {
  const file = firstFile(event.clipboardData)
  if (!file) return
  event.preventDefault()
  receive(file)
}

function openPicker(): void {
  if (!props.disabled) picker.value?.click()
}

function keydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  openPicker()
}
</script>

<template>
  <div
    class="file-dropzone"
    :class="{ dragging, disabled }"
    role="button"
    tabindex="0"
    :aria-label="label"
    @click="openPicker"
    @keydown="keydown"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="drop"
    @paste="paste"
  >
    <input ref="picker" class="visually-hidden" type="file" :accept="accept" @change="select" />
    <FilePlus2 :size="18" aria-hidden="true" />
    <span><strong>{{ prompt }}</strong><small v-if="detail">{{ detail }}</small></span>
  </div>
</template>
