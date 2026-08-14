<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, X } from '@lucide/vue'

import IconButton from '@/components/IconButton.vue'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
</script>

<template>
  <div class="toast-viewport" aria-live="polite" aria-atomic="false">
    <div v-for="message in toast.messages" :key="message.id" class="toast" :class="message.type">
      <CircleCheck v-if="message.type === 'success'" :size="17" aria-hidden="true" />
      <CircleAlert v-else-if="message.type === 'error'" :size="17" aria-hidden="true" />
      <Info v-else :size="17" aria-hidden="true" />
      <span>{{ message.message }}</span>
      <IconButton :icon="X" label="关闭通知" size="small" @click="toast.dismiss(message.id)" />
    </div>
  </div>
</template>

