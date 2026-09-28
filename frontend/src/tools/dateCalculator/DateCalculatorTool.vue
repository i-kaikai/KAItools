<script setup lang="ts">
import { CalendarClock, CalendarDays, Clock3, Copy, RefreshCw } from '@lucide/vue'
import { DateTime } from 'luxon'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import {
  addChinaWorkdays,
  calculateAge,
  calculateDateInterval,
  getCountdown,
  getDateInformation,
  shiftCalendarDate,
  type CalendarOffsetUnit,
  type DateMode,
} from '@/utils/dateCalculator'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const today = DateTime.local().toISODate() ?? ''
const model = useToolState(props.state, {
  mode: 'add' as DateMode,
  startDate: today,
  offset: '1',
  offsetUnit: 'days' as CalendarOffsetUnit | 'workdays',
  intervalStart: today,
  intervalEnd: today,
  countdownTarget: DateTime.local().plus({ days: 1 }).startOf('day').toFormat("yyyy-LL-dd'T'HH:mm:ss"),
  birthDate: '',
  ageAsOf: today,
  infoDate: today,
}, (state) => emit('update:state', state))

const modeOptions = [
  { value: 'add', label: '日期加减' },
  { value: 'interval', label: '日期间隔' },
  { value: 'countdown', label: '日期倒计时' },
  { value: 'age', label: '年龄与日期信息' },
]
const addResult = ref('')
const addError = ref('')
const calendarStatus = ref('')
const addLoading = ref(false)
const nowMillis = ref(DateTime.local().toMillis())
let addRunId = 0
let countdownTimer = 0

const intervalResult = computed(() => {
  try { return calculateDateInterval(model.intervalStart, model.intervalEnd) }
  catch (error) { return { error: error instanceof Error ? error.message : '日期间隔计算失败' } }
})
const countdownResult = computed(() => {
  try { return getCountdown(model.countdownTarget, nowMillis.value) }
  catch (error) { return { error: error instanceof Error ? error.message : '倒计时计算失败' } }
})
const ageResult = computed(() => {
  if (!model.birthDate) return null
  try { return calculateAge(model.birthDate, model.ageAsOf) }
  catch (error) { return { error: error instanceof Error ? error.message : '年龄计算失败' } }
})
const dateInformation = computed(() => {
  try { return getDateInformation(model.infoDate) }
  catch (error) { return { error: error instanceof Error ? error.message : '日期信息计算失败' } }
})

function formatCalendarStatus(updatedAt: number[], staleYears: number[], refreshErrors: string[]): string {
  if (refreshErrors.length) return `缓存可用，更新失败：${refreshErrors[0]}`
  const earliestUpdate = updatedAt.length ? Math.min(...updatedAt) : 0
  const updated = earliestUpdate ? DateTime.fromMillis(earliestUpdate).toFormat('yyyy-LL-dd HH:mm') : ''
  if (staleYears.length) return `正在更新缓存数据 · 上次更新 ${updated}`
  return updated ? `数据更新于 ${updated}` : '工作日历数据已就绪'
}

async function calculateAddedDate(forceRefresh = false): Promise<void> {
  const runId = ++addRunId
  addError.value = ''
  calendarStatus.value = ''
  addResult.value = ''
  if (!model.startDate || model.offset === '') return

  if (model.offsetUnit !== 'workdays') {
    try { addResult.value = shiftCalendarDate(model.startDate, model.offset, model.offsetUnit) }
    catch (error) { addError.value = error instanceof Error ? error.message : '日期计算失败' }
    return
  }

  addLoading.value = true
  try {
    const result = await addChinaWorkdays(model.startDate, model.offset, { forceRefresh })
    if (runId !== addRunId) return
    addResult.value = result.date
    calendarStatus.value = formatCalendarStatus(result.updatedAt, result.staleYears, result.refreshErrors)
    addLoading.value = false

    if (result.refreshes.length) {
      void Promise.allSettled(result.refreshes).then(async (refreshResults) => {
        if (runId !== addRunId) return
        if (refreshResults.some((item) => item.status === 'rejected')) {
          calendarStatus.value = formatCalendarStatus(result.updatedAt, result.staleYears, ['日历服务暂不可用'])
          return
        }
        await calculateAddedDate()
      })
    }
  } catch (error) {
    if (runId === addRunId) addError.value = error instanceof Error ? error.message : '工作日历暂不可用'
  } finally {
    if (runId === addRunId) addLoading.value = false
  }
}

async function copy(value: string): Promise<void> {
  if (!value) return
  await copyText(value)
  toast.show('结果已复制', 'success')
}

watch(() => [model.startDate, model.offset, model.offsetUnit], () => { void calculateAddedDate() }, { immediate: true })
watch(() => model.mode, (mode) => {
  if (countdownTimer) window.clearInterval(countdownTimer)
  countdownTimer = 0
  if (mode === 'countdown') {
    nowMillis.value = DateTime.local().toMillis()
    countdownTimer = window.setInterval(() => { nowMillis.value = DateTime.local().toMillis() }, 1000)
  }
}, { immediate: true })
onBeforeUnmount(() => {
  if (countdownTimer) window.clearInterval(countdownTimer)
  addRunId += 1
})
</script>

<template>
  <section class="tool-page date-calculator-tool">
    <header class="date-calculator-header">
      <div class="date-calculator-title">
        <span class="date-calculator-title-icon"><CalendarClock :size="19" aria-hidden="true" /></span>
        <div><small>DATE CALCULATOR</small><h1>日期计算器</h1></div>
      </div>
      <span class="date-calculator-local"><Clock3 :size="14" aria-hidden="true" />本地计算</span>
    </header>

    <nav class="date-calculator-nav" aria-label="日期计算模式">
      <SegmentedControl v-model="model.mode" label="日期计算模式" :options="modeOptions" />
    </nav>

    <div v-if="model.mode === 'add'" class="date-calculator-workspace">
      <section class="date-calculator-main">
        <header><CalendarDays :size="17" aria-hidden="true" /><div><strong>日期加减</strong><small>按自然日或中国工作日计算目标日期</small></div></header>
        <div class="date-calculator-fields">
          <label>开始日期<input v-model="model.startDate" type="date" aria-label="开始日期" /></label>
          <label>{{ model.offsetUnit === 'months' ? '偏移月数' : model.offsetUnit === 'years' ? '偏移年数' : '偏移天数' }}<input v-model="model.offset" type="number" step="1" aria-label="日期偏移量" /></label>
          <label>计算方式<select v-model="model.offsetUnit" aria-label="计算方式"><option value="days">自然日</option><option value="months">自然月</option><option value="years">自然年</option><option value="workdays">中国工作日</option></select></label>
        </div>
        <div class="date-calculator-result">
          <div><span>计算结果</span><code>{{ addLoading ? '正在加载工作日历…' : addError || addResult || '—' }}</code></div>
          <IconButton :icon="Copy" label="复制日期计算结果" :disabled="!addResult" @click="copy(addResult)" />
        </div>
        <p v-if="model.offsetUnit === 'workdays'" class="date-calculator-source-status" aria-live="polite">
          <span>{{ calendarStatus || (addLoading ? '正在读取工作日历' : '结果不计入开始日期') }}</span>
          <IconButton :icon="RefreshCw" label="刷新中国工作日历" size="small" :disabled="addLoading" @click="calculateAddedDate(true)" />
          <a href="https://github.com/NateScarlet/holiday-cn" target="_blank" rel="noopener noreferrer">数据来源</a>
        </p>
        <p v-else class="date-calculator-note">正数向后计算，负数向前计算。</p>
      </section>
      <aside class="date-calculator-side">
        <header><span>日期规则</span></header>
        <p v-if="model.offsetUnit === 'workdays'">工作日包含周一至周五，法定放假日除外；调休上班日计入。起始日期不计为第 1 天。</p>
        <p v-else>起始日期不计入偏移量。自然月和自然年按公历日期计算。</p>
        <dl><div><dt>向后</dt><dd>正数</dd></div><div><dt>向前</dt><dd>负数</dd></div><div><dt>起始日期</dt><dd>不计入</dd></div></dl>
      </aside>
    </div>

    <div v-else-if="model.mode === 'interval'" class="date-calculator-workspace">
      <section class="date-calculator-main">
        <header><CalendarDays :size="17" aria-hidden="true" /><div><strong>日期间隔</strong><small>计算结束日期与开始日期之间的时间</small></div></header>
        <div class="date-calculator-fields">
          <label>开始日期<input v-model="model.intervalStart" type="date" aria-label="间隔开始日期" /></label>
          <label>结束日期<input v-model="model.intervalEnd" type="date" aria-label="间隔结束日期" /></label>
        </div>
        <template v-if="'totalDays' in intervalResult">
          <div class="date-calculator-result"><div><span>相差天数（结束 − 开始）</span><code>{{ intervalResult.totalDays }} 天</code></div><IconButton :icon="Copy" label="复制相差天数" @click="copy(String(intervalResult.totalDays))" /></div>
          <dl class="date-calculator-breakdown"><div><dt>年</dt><dd>{{ intervalResult.years }}</dd></div><div><dt>月</dt><dd>{{ intervalResult.months }}</dd></div><div><dt>天</dt><dd>{{ intervalResult.days }}</dd></div></dl>
        </template>
        <p v-else class="date-calculator-error">{{ intervalResult.error }}</p>
      </section>
      <aside class="date-calculator-side"><header><span>间隔方向</span></header><p>结果按“结束日期减开始日期”计算，结束日期早于开始日期时显示负数。</p></aside>
    </div>

    <div v-else-if="model.mode === 'countdown'" class="date-calculator-workspace">
      <section class="date-calculator-main">
        <header><Clock3 :size="17" aria-hidden="true" /><div><strong>日期倒计时</strong><small>使用当前设备的本地时区</small></div></header>
        <div class="date-calculator-fields date-calculator-fields-single">
          <label>目标日期和时间<input v-model="model.countdownTarget" type="datetime-local" step="1" aria-label="倒计时目标日期和时间" /></label>
        </div>
        <template v-if="'days' in countdownResult">
          <div class="date-countdown-display" :class="{ expired: countdownResult.expired }" aria-live="polite">
            <span>{{ countdownResult.expired ? '已过去' : '剩余' }}</span>
            <div><strong>{{ countdownResult.days }}</strong><small>天</small><strong>{{ String(countdownResult.hours).padStart(2, '0') }}</strong><small>时</small><strong>{{ String(countdownResult.minutes).padStart(2, '0') }}</strong><small>分</small><strong>{{ String(countdownResult.seconds).padStart(2, '0') }}</strong><small>秒</small></div>
          </div>
          <IconButton class="date-calculator-copy-countdown" :icon="Copy" label="复制倒计时" @click="copy(`${countdownResult.days}天 ${countdownResult.hours}时 ${countdownResult.minutes}分 ${countdownResult.seconds}秒`)" />
        </template>
        <p v-else class="date-calculator-error">{{ countdownResult.error }}</p>
      </section>
      <aside class="date-calculator-side"><header><span>目标时刻</span></header><p>倒计时每秒更新。目标时间到达后，计时方向会切换为已过去时长。</p></aside>
    </div>

    <div v-else class="date-calculator-workspace date-calculator-age-workspace">
      <section class="date-calculator-main">
        <header><CalendarDays :size="17" aria-hidden="true" /><div><strong>年龄与日期信息</strong><small>按公历计算</small></div></header>
        <div class="date-calculator-fields">
          <label>出生日期<input v-model="model.birthDate" type="date" aria-label="出生日期" /></label>
          <label>截至日期<input v-model="model.ageAsOf" type="date" aria-label="年龄截至日期" /></label>
          <label class="date-calculator-info-date">查询日期<input v-model="model.infoDate" type="date" aria-label="日期信息查询日期" /></label>
        </div>
        <p v-if="ageResult && 'error' in ageResult" class="date-calculator-error">{{ ageResult.error }}</p>
        <div v-else-if="ageResult" class="date-age-result"><span>年龄</span><strong>{{ ageResult.years }} 岁 {{ ageResult.months }} 个月 {{ ageResult.days }} 天</strong><IconButton :icon="Copy" label="复制年龄" @click="copy(`${ageResult.years}岁${ageResult.months}个月${ageResult.days}天`)" /></div>
        <dl v-if="'weekday' in dateInformation" class="date-information-grid"><div><dt>星期</dt><dd>{{ dateInformation.weekday }}</dd></div><div><dt>ISO 周</dt><dd>第 {{ dateInformation.isoWeek }} 周</dd></div><div><dt>年内日序</dt><dd>第 {{ dateInformation.dayOfYear }} 天</dd></div><div><dt>闰年</dt><dd>{{ dateInformation.leapYear ? '是' : '否' }}</dd></div></dl>
        <p v-else class="date-calculator-error">{{ dateInformation.error }}</p>
      </section>
      <aside class="date-calculator-side"><header><span>年龄计算</span></header><p>截至日期不能早于出生日期。2 月 29 日生日在非闰年按 2 月 28 日作为生日边界。</p></aside>
    </div>
  </section>
</template>
