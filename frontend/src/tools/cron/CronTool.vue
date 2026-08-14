<script setup lang="ts">
import { CalendarClock, Copy, RotateCcw } from '@lucide/vue'
import { computed } from 'vue'
import IconButton from '@/components/IconButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { buildCronExpression, getNextCronRuns } from '@/utils/cron'
import { copyText } from '@/utils/clipboard'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, { minute: '0', hour: '9', day: '*', month: '*', weekday: '1-5' }, (state) => emit('update:state', state))
const expression = computed(() => buildCronExpression(model))
const schedule = computed(() => { try { return { dates: getNextCronRuns(expression.value), error: '' } } catch (error) { return { dates: [], error: error instanceof Error ? error.message : 'Cron 表达式无效' } } })
const formatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const presets = [
  { label: '每 5 分钟', fields: ['*/5', '*', '*', '*', '*'] },
  { label: '每天 09:00', fields: ['0', '9', '*', '*', '*'] },
  { label: '工作日 09:00', fields: ['0', '9', '*', '*', '1-5'] },
  { label: '每月 1 日', fields: ['0', '0', '1', '*', '*'] },
]
function apply(fields: string[]): void { [model.minute, model.hour, model.day, model.month, model.weekday] = fields as [string, string, string, string, string] }
async function copy(): Promise<void> { await copyText(expression.value); toast.show('Cron 表达式已复制', 'success') }
</script>
<template>
  <section class="tool-page cron-tool">
    <header class="tool-header"><div><h1>Crontab 生成器</h1><p :class="{ error: schedule.error }">{{ schedule.error || '标准五段式 Cron 表达式' }}</p></div><div class="toolbar"><IconButton :icon="Copy" label="复制表达式" :disabled="!!schedule.error" @click="copy" /><IconButton :icon="RotateCcw" label="恢复默认" @click="apply(['0', '9', '*', '*', '1-5'])" /></div></header>
    <div class="cron-expression"><CalendarClock :size="22" /><code>{{ expression }}</code><span>{{ schedule.error ? 'INVALID' : 'VALID' }}</span></div>
    <div class="cron-fields">
      <label v-for="field in [{ key: 'minute', name: '分钟', hint: '0–59' }, { key: 'hour', name: '小时', hint: '0–23' }, { key: 'day', name: '日期', hint: '1–31' }, { key: 'month', name: '月份', hint: '1–12' }, { key: 'weekday', name: '星期', hint: '0–7' }]" :key="field.key"><span>{{ field.name }}</span><input v-model="model[field.key as keyof typeof model]" :aria-label="field.name" /><small>{{ field.hint }}</small></label>
    </div>
    <div class="cron-presets"><button v-for="preset in presets" :key="preset.label" type="button" @click="apply(preset.fields)">{{ preset.label }}</button></div>
    <section class="cron-runs"><div class="panel-label">未来 5 次执行时间</div><ol v-if="schedule.dates.length"><li v-for="(date, index) in schedule.dates" :key="date.toISOString()"><span>{{ index + 1 }}</span><time :datetime="date.toISOString()">{{ formatter.format(date) }}</time></li></ol><div v-else class="empty-state">请修正表达式后查看执行时间</div></section>
  </section>
</template>
