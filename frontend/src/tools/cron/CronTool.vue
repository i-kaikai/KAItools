<script setup lang="ts">
import { CalendarClock, Copy, RotateCcw } from '@lucide/vue'
import { computed, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { buildCronExpression, describeCronExpression, getNextCronRuns, parseCronExpression, type CronFields } from '@/utils/cron'
import { copyText } from '@/utils/clipboard'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const model = useToolState(
  props.state,
  { minute: '0', hour: '9', day: '*', month: '*', weekday: '1-5', expression: '', timeZone: localTimeZone, runCount: 10 },
  (state) => emit('update:state', state),
)

const fieldDefinitions: Array<{ key: keyof CronFields; name: string; hint: string; examples: Array<{ label: string; value: string }> }> = [
  { key: 'minute', name: '分钟', hint: '0-59', examples: [{ label: '每分钟', value: '*' }, { label: '整点', value: '0' }, { label: '每 5 分钟', value: '*/5' }, { label: '每 15 分钟', value: '*/15' }, { label: '每 30 分钟', value: '*/30' }] },
  { key: 'hour', name: '小时', hint: '0-23', examples: [{ label: '每小时', value: '*' }, { label: '00 点', value: '0' }, { label: '09 点', value: '9' }, { label: '工作时段', value: '9-18' }, { label: '上午和下午', value: '9,18' }] },
  { key: 'day', name: '日期', hint: '1-31', examples: [{ label: '每天', value: '*' }, { label: '每月 1 日', value: '1' }, { label: '每月 15 日', value: '15' }, { label: '每隔 2 天', value: '*/2' }, { label: '月初和月中', value: '1,15' }] },
  { key: 'month', name: '月份', hint: '1-12 / JAN-DEC', examples: [{ label: '每月', value: '*' }, { label: '一月', value: '1' }, { label: '每季度', value: '1,4,7,10' }, { label: '上半年', value: '1-6' }, { label: '下半年', value: '7-12' }] },
  { key: 'weekday', name: '星期', hint: '0-7 / SUN-SAT', examples: [{ label: '每天', value: '*' }, { label: '工作日', value: '1-5' }, { label: '周末', value: '0,6' }, { label: '周一', value: '1' }, { label: '周五', value: '5' }] },
]
const presets = [
  { label: '每分钟', expression: '* * * * *' },
  { label: '每 5 分钟', expression: '*/5 * * * *' },
  { label: '每 15 分钟', expression: '*/15 * * * *' },
  { label: '每小时整点', expression: '0 * * * *' },
  { label: '每天 00:00', expression: '0 0 * * *' },
  { label: '每天 09:00', expression: '0 9 * * *' },
  { label: '工作日 09:00', expression: '0 9 * * 1-5' },
  { label: '周末 10:00', expression: '0 10 * * 0,6' },
  { label: '每月 1 日', expression: '0 0 1 * *' },
  { label: '每季度首日', expression: '0 0 1 1,4,7,10 *' },
]
const timeZones = [...new Set([localTimeZone, 'Asia/Shanghai', 'UTC', 'Asia/Tokyo', 'Europe/London', 'America/New_York'])]

if (!model.expression) model.expression = buildCronExpression(model)
let syncingFrom: 'fields' | 'expression' | null = null
const fieldExpression = computed(() => buildCronExpression(model))
watch(fieldExpression, (value) => {
  if (syncingFrom === 'expression') return
  syncingFrom = 'fields'
  model.expression = value
  syncingFrom = null
}, { flush: 'sync' })
watch(() => model.expression, (value) => {
  if (syncingFrom === 'fields') return
  try {
    const fields = parseCronExpression(value)
    syncingFrom = 'expression'
    Object.assign(model, fields)
    syncingFrom = null
  } catch {
    syncingFrom = null
  }
}, { flush: 'sync' })

const schedule = computed(() => {
  try {
    return {
      dates: getNextCronRuns(model.expression, model.runCount, new Date(), model.timeZone),
      description: describeCronExpression(model.expression),
      error: '',
    }
  } catch (error) {
    return { dates: [] as Date[], description: '', error: error instanceof Error ? error.message : 'Cron 表达式无效' }
  }
})
const formatter = computed(() => new Intl.DateTimeFormat('zh-CN', {
  timeZone: model.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
}))
const dayMatchWarning = computed(() => model.day !== '*' && model.weekday !== '*')

function setExpression(expression: string): void {
  model.expression = expression
}
function setField(key: keyof CronFields, event: Event): void {
  const select = event.currentTarget as HTMLSelectElement
  if (select.value) model[key] = select.value
  select.value = ''
}
function reset(): void {
  model.timeZone = localTimeZone
  model.runCount = 10
  setExpression('0 9 * * 1-5')
}
function relativeTime(date: Date): string {
  const minutes = Math.max(1, Math.round((date.getTime() - Date.now()) / 60_000))
  if (minutes < 60) return `${minutes} 分钟后`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} 小时后`
  return `${Math.round(hours / 24)} 天后`
}
async function copy(): Promise<void> {
  await copyText(model.expression.trim())
  toast.show('Cron 表达式已复制', 'success')
}
</script>

<template>
  <section class="tool-page cron-tool">
    <header class="tool-header">
      <div><h1>Crontab 生成器</h1><p :class="{ error: schedule.error }">{{ schedule.error || 'Linux 标准五段式 · 表达式与字段双向编辑' }}</p></div>
      <div class="toolbar">
        <IconButton :icon="Copy" label="复制表达式" :disabled="!!schedule.error" @click="copy" />
        <IconButton :icon="RotateCcw" label="恢复默认" @click="reset" />
      </div>
    </header>

    <div class="cron-expression" :class="{ invalid: schedule.error }">
      <CalendarClock :size="22" aria-hidden="true" />
      <input v-model="model.expression" aria-label="Cron 表达式" spellcheck="false" />
      <span>{{ schedule.error ? 'INVALID' : 'VALID' }}</span>
    </div>

    <div class="cron-summary">
      <div><strong>{{ schedule.description || '等待有效表达式' }}</strong><small v-if="dayMatchWarning">日期与星期同时受限时按 OR 规则匹配</small></div>
      <label><span>时区</span><select v-model="model.timeZone" aria-label="Cron 时区"><option v-for="zone in timeZones" :key="zone" :value="zone">{{ zone }}</option></select></label>
      <label><span>次数</span><select v-model="model.runCount" aria-label="执行次数"><option :value="5">5 次</option><option :value="10">10 次</option><option :value="20">20 次</option></select></label>
    </div>

    <div class="cron-fields">
      <label v-for="field in fieldDefinitions" :key="field.key">
        <span>{{ field.name }}</span><small>{{ field.hint }}</small>
        <input v-model="model[field.key]" :aria-label="field.name" spellcheck="false" />
        <select :aria-label="`${field.name}快速设置`" @change="setField(field.key, $event)">
          <option value="">快速设置</option>
          <option v-for="example in field.examples" :key="example.value" :value="example.value">{{ example.label }} · {{ example.value }}</option>
        </select>
      </label>
    </div>

    <div class="cron-presets" aria-label="常用 Cron 预设">
      <button v-for="preset in presets" :key="preset.label" type="button" @click="setExpression(preset.expression)">{{ preset.label }}</button>
    </div>

    <section class="cron-runs">
      <div class="panel-label"><span>未来 {{ model.runCount }} 次执行时间</span><small>{{ model.timeZone }}</small></div>
      <ol v-if="schedule.dates.length">
        <li v-for="(date, index) in schedule.dates" :key="date.toISOString()">
          <span>{{ index + 1 }}</span>
          <time :datetime="date.toISOString()">{{ formatter.format(date) }}</time>
          <small>{{ relativeTime(date) }}</small>
        </li>
      </ol>
      <div v-else class="empty-state">请修正表达式后查看执行时间</div>
    </section>
  </section>
</template>
