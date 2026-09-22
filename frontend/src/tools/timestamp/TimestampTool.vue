<script setup lang="ts">
import { Check, Clock3, Copy, RefreshCw } from '@lucide/vue'
import { DateTime } from 'luxon'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import { parseFlexibleDateTime, type TimeResult } from '@/utils/timestamp'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const legacyInput = typeof props.state.input === 'string'
  ? props.state.input
  : props.state.mode === 'datetime' && typeof props.state.dateTime === 'string'
    ? props.state.dateTime
    : typeof props.state.timestamp === 'string'
      ? props.state.timestamp
      : ''
const model = useToolState(
  props.state,
  { input: legacyInput, zone: typeof props.state.zone === 'string' ? props.state.zone : localZone },
  (state) => emit('update:state', state),
)
const now = ref(Date.now())
let timer = 0
onMounted(() => {
  if (!model.input) model.input = DateTime.local().toFormat('yyyy-LL-dd HH:mm:ss')
  timer = window.setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => window.clearInterval(timer))

const conversion = computed<{ value?: TimeResult; error?: string }>(() => {
  try {
    return { value: parseFlexibleDateTime(model.input, model.zone) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
})

const resultRows = computed(() => {
  const value = conversion.value.value
  if (!value) return []
  return [
    { label: '识别格式', value: value.detectedFormat, copyOnClick: true },
    { label: '秒时间戳', value: String(value.seconds), copyOnClick: true },
    { label: '毫秒时间戳', value: String(value.milliseconds), copyOnClick: true },
    { label: 'yyyy-MM-dd HH:mm:ss', value: value.dateTime, copyOnClick: true },
    { label: 'ISO 8601', value: value.iso, copyOnClick: true },
    { label: '本地时间', value: value.local, copyOnClick: true },
    { label: 'UTC', value: value.utc, copyOnClick: true },
    { label: value.zone, value: value.zoned, copyOnClick: true },
    { label: 'UTC 偏移', value: value.offset, copyOnClick: true },
  ]
})

async function copy(value: string): Promise<void> {
  await copyText(value)
  toast.show('时间值已复制', 'success')
}

function useNow(): void {
  model.input = DateTime.local().toFormat('yyyy-LL-dd HH:mm:ss')
}
</script>

<template>
  <section class="tool-page timestamp-tool">
    <header class="tool-header">
      <div>
        <h1>日期转换</h1>
        <p :class="{ error: conversion.error }">
          <template v-if="conversion.error">{{ conversion.error }}</template>
          <template v-else><Check :size="14" />自动识别完成</template>
        </p>
      </div>
      <div class="timestamp-now-strip">
        <div class="timestamp-now-item">
          <Clock3 :size="15" aria-hidden="true" />
          <span class="timestamp-now-label">当前时间</span>
          <time>{{ DateTime.fromMillis(now).toFormat('yyyy-LL-dd HH:mm:ss') }}</time>
        </div>
        <div class="timestamp-now-item timestamp-now-item-epoch">
          <span class="timestamp-now-label">Linux 秒时间戳</span>
          <code>{{ Math.floor(now / 1000) }}</code>
          <IconButton :icon="Copy" label="复制当前秒时间戳" size="small" @click="copy(String(Math.floor(now / 1000)))" />
        </div>
      </div>
    </header>

    <div class="timestamp-input-band">
      <div class="field-group grow">
        <label for="datetime-input">日期、时间或时间戳</label>
        <div class="input-with-action">
          <input id="datetime-input" v-model="model.input" autocomplete="off" spellcheck="false" />
          <IconButton :icon="RefreshCw" label="使用当前时间" size="small" @click="useNow" />
        </div>
      </div>
      <div class="field-group timezone-field">
        <label for="timezone-input">目标时区</label>
        <input id="timezone-input" v-model="model.zone" autocomplete="off" />
      </div>
    </div>

    <div class="result-table" :class="{ disabled: !conversion.value }">
      <div v-for="row in resultRows" :key="row.label" class="result-row">
        <span>{{ row.label }}</span>
        <button v-if="row.copyOnClick" class="copyable-result" type="button" @click="copy(row.value)">{{ row.value }}</button>
        <code v-else>{{ row.value }}</code>
        <IconButton :icon="Copy" :label="`复制${row.label}`" size="small" @click="copy(row.value)" />
      </div>
      <div v-if="!resultRows.length" class="empty-state"><Clock3 :size="22" /><span>暂无转换结果</span></div>
    </div>
  </section>
</template>
