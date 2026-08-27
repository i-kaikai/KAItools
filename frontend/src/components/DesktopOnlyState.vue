<script setup lang="ts">
import { Download, Laptop } from '@lucide/vue'

import { desktopApi } from '@/api/desktopApi'
import { useToastStore } from '@/stores/toast'

defineProps<{ title: string; description: string }>()
const toast = useToastStore()

async function openDownload(): Promise<void> {
  const result = await desktopApi.openDesktopDownload()
  if (!result.ok) toast.show(result.error.message, 'error')
}
</script>

<template>
  <div class="desktop-only-state" role="status">
    <Laptop :size="28" :stroke-width="1.6" aria-hidden="true" />
    <div>
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
      <button class="command-button secondary desktop-download-button" type="button" @click="openDownload"><Download :size="15" />下载 Windows 桌面版</button>
    </div>
  </div>
</template>
