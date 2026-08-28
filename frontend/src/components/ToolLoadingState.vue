<script setup lang="ts">
import { Sparkles } from '@lucide/vue'

import { t } from '@/i18n'
</script>

<template>
  <section class="tool-loading-state" role="status" aria-live="polite" :aria-label="t('shell.toolLoading')">
    <div class="tool-loading-visual" aria-hidden="true">
      <span class="tool-loading-orbit tool-loading-orbit-primary" />
      <span class="tool-loading-orbit tool-loading-orbit-secondary" />
      <span class="tool-loading-core"><Sparkles :size="17" :stroke-width="1.65" /></span>
    </div>
    <div class="tool-loading-copy">
      <strong>{{ t('shell.toolLoading') }}</strong>
      <small>{{ t('shell.toolLoadingDetail') }}</small>
    </div>
    <span class="tool-loading-scan" aria-hidden="true"><i /></span>
  </section>
</template>
