<script setup lang="ts">
import type { FlowShape } from './flowchartModel'

defineProps<{ shape: FlowShape }>()
</script>

<template>
  <span class="flow-shape-symbol" :class="`is-${shape}`" aria-hidden="true">
    <span class="flow-shape-symbol-body" />
    <span class="flow-shape-symbol-detail" />
  </span>
</template>

<style scoped>
.flow-shape-symbol { position: relative; display: block; width: 58px; height: 36px; color: currentcolor; }
.flow-shape-symbol-body, .flow-shape-symbol-detail { position: absolute; box-sizing: border-box; }
.flow-shape-symbol-body { inset: 5px 4px; border: 1.5px solid currentcolor; background: color-mix(in srgb, currentcolor 7%, var(--surface)); }
.is-terminator .flow-shape-symbol-body, .is-delay .flow-shape-symbol-body { border-radius: 999px; }
.is-process .flow-shape-symbol-body { border-radius: 3px; }
.is-decision .flow-shape-symbol-body { width: 24px; height: 24px; inset: 6px auto auto 17px; transform: rotate(45deg); }
.is-data .flow-shape-symbol-body, .is-manual-input .flow-shape-symbol-body { inset: 6px 6px; transform: skewX(-14deg); }
.is-document .flow-shape-symbol-body { inset: 4px 7px 5px; border-radius: 2px; }
.is-document .flow-shape-symbol-detail { right: 8px; top: 5px; width: 8px; height: 8px; border-left: 1.5px solid currentcolor; border-bottom: 1.5px solid currentcolor; background: var(--surface); }
.is-subroutine .flow-shape-symbol-body { inset: 5px 3px; }.is-subroutine .flow-shape-symbol-detail { inset: 6px 8px; border-inline: 1px solid currentcolor; }
.is-manual-operation .flow-shape-symbol-body { inset: 6px 6px; clip-path: polygon(12% 0, 88% 0, 100% 100%, 0 100%); }
.is-preparation .flow-shape-symbol-body { inset: 5px 4px; clip-path: polygon(20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%); }
.is-display .flow-shape-symbol-body { inset: 5px 4px; border-radius: 50% / 40%; clip-path: polygon(15% 0, 84% 0, 100% 50%, 84% 100%, 15% 100%, 0 50%); }
.is-database .flow-shape-symbol-body { inset: 4px 8px; border-radius: 50% / 18%; }.is-database .flow-shape-symbol-detail { inset: 10px 8px 5px; border-inline: 1.5px solid currentcolor; border-bottom: 1.5px solid currentcolor; border-radius: 0 0 50% 50% / 0 0 18% 18%; }
.is-on-page-connector .flow-shape-symbol-body { width: 24px; height: 24px; inset: 6px auto auto 17px; border-radius: 50%; }.is-on-page-connector .flow-shape-symbol-detail { width: 6px; height: 6px; inset: 15px auto auto 26px; border-radius: 50%; background: currentcolor; }
.is-off-page-connector .flow-shape-symbol-body { inset: 4px 12px; clip-path: polygon(0 0, 100% 0, 100% 70%, 50% 100%, 0 70%); }.is-annotation .flow-shape-symbol-body { inset: 5px 5px; border-style: dashed; }.is-annotation .flow-shape-symbol-detail { left: 11px; right: 11px; top: 15px; border-top: 1px solid currentcolor; box-shadow: 0 5px 0 color-mix(in srgb, currentcolor 65%, transparent); }
</style>
