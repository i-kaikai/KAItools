<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    icon: Component
    label: string
    active?: boolean
    disabled?: boolean
    danger?: boolean
    size?: 'small' | 'normal'
  }>(),
  { active: false, disabled: false, danger: false, size: 'normal' },
)

defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <button
    class="icon-button tooltip-anchor"
    :class="{ active, danger, small: size === 'small' }"
    type="button"
    :aria-label="label"
    :aria-pressed="active || undefined"
    :data-tooltip="label"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <component :is="icon" :size="size === 'small' ? 15 : 17" :stroke-width="1.8" aria-hidden="true" />
  </button>
</template>

