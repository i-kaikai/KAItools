<script setup lang="ts">
import { Atom, Binary, Calculator, Copy, Delete, History, Pi, RotateCcw, Sigma, Trash2, WalletCards } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useToolState } from '@/composables/useToolState'
import { useToastStore } from '@/stores/toast'
import { copyText } from '@/utils/clipboard'
import {
  calculateDate,
  calculateEngineering,
  calculateFinance,
  calculateProgrammerOperation,
  convertProgrammerBase,
  convertProgrammerInput,
  convertUnit,
  evaluateCalculatorExpression,
  loadCalculatorHistory,
  saveCalculatorHistory,
  type CalculatorHistoryEntry,
} from '@/utils/calculator'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(props.state, {
  section: 'scientific', expression: 'sqrt(2)^2 + sin(pi / 2)', expressionResult: '', unitValue: '1024 byte', unitTarget: 'KB',
  programmerView: 'convert', baseInput: '255', baseFrom: 10, bitWidth: 32, signed: false, left: '255', right: '15', bitOperation: '&',
  financeKind: 'compound', principal: '10000', annualRate: '3.5', periods: '12', taxRate: '10',
  dateStart: new Date().toISOString().slice(0, 10), dateEnd: new Date().toISOString().slice(0, 10), dateOffset: '30', dateUnit: 'days',
  engineeringKind: 'matrix', engineeringSource: '[[1, 2], [3, 4]]', engineeringOperation: 'det',
}, (state) => emit('update:state', state))
const error = ref('')
const history = ref<CalculatorHistoryEntry[]>(loadCalculatorHistory())

const sectionOptions = [
  { value: 'scientific', label: '科学' }, { value: 'programmer', label: '程序员' }, { value: 'finance', label: '金融/日期' }, { value: 'engineering', label: '工程' },
]
const programmerViewOptions = [
  { value: 'convert', label: '进制转换' }, { value: 'bitwise', label: '位运算' },
]
const calculatorKeys = [
  ['sin(', 'cos(', 'tan(', 'sqrt('], ['log(', 'ln(', 'abs(', 'π'], ['7', '8', '9', '/'], ['4', '5', '6', '*'], ['1', '2', '3', '-'], ['0', '.', '(', ')'], ['^', '!', '%', '+'],
]
const programmerOutput = computed(() => {
  try { return convertProgrammerBase(model.baseInput, Number(model.baseFrom), Number(model.bitWidth) as 8 | 16 | 32 | 64, model.signed) } catch { return null }
})
const programmerInputHint = computed(() => {
  const base = Number(model.baseFrom)
  if (base === 2) return '二进制输入仅使用 0 和 1；支持 0b 前缀。'
  if (base === 8) return '八进制输入仅使用 0 到 7；支持 0o 前缀。'
  if (base === 16) return '十六进制可使用 0 到 9 与 A 到 F；支持 0x 前缀。'
  return '切换输入进制时，当前数值会自动转换。'
})
const bitOperationOutput = computed(() => {
  try {
    const decimal = calculateProgrammerOperation(model.left, model.right, model.bitOperation as '&' | '|' | '^' | '<<' | '>>', Number(model.baseFrom), Number(model.bitWidth) as 8 | 16 | 32 | 64)
    return convertProgrammerBase(decimal, 10, Number(model.bitWidth) as 8 | 16 | 32 | 64, false)
  } catch {
    return null
  }
})
const financeResult = computed(() => {
  try { return calculateFinance(model.financeKind as 'simple' | 'compound' | 'loan' | 'tax', model.principal, model.annualRate, model.periods, model.taxRate) } catch (cause) { return cause instanceof Error ? cause.message : '计算失败' }
})
const dateResult = computed(() => {
  try { return calculateDate(model.dateStart, model.dateEnd, model.dateOffset, model.dateUnit as 'days' | 'months' | 'years') } catch (cause) { return { difference: cause instanceof Error ? cause.message : '计算失败', shifted: '' } }
})
const engineeringResult = computed(() => {
  try { return calculateEngineering(model.engineeringKind as 'matrix' | 'complex' | 'statistics', model.engineeringSource, model.engineeringOperation) } catch (cause) { return cause instanceof Error ? cause.message : '计算失败' }
})

watch(() => Number(model.baseFrom), (nextBase, previousBase) => {
  if (!previousBase || nextBase === previousBase) return
  // Preserve the represented value while the user changes the radix for all programmer inputs.
  ;(['baseInput', 'left', 'right'] as const).forEach((field) => {
    const value = model[field]
    if (typeof value !== 'string') return
    try {
      model[field] = convertProgrammerInput(value, previousBase, nextBase)
    } catch {
      // Leave unfinished user input untouched; the field reports a specific validation message.
    }
  })
})

function evaluateExpression(): void {
  try {
    error.value = ''
    model.expressionResult = evaluateCalculatorExpression(model.expression)
    const entry: CalculatorHistoryEntry = { id: `calc-${Date.now()}`, expression: model.expression, result: model.expressionResult, createdAt: new Date().toISOString() }
    history.value = [entry, ...history.value.filter((item) => item.expression !== entry.expression || item.result !== entry.result)].slice(0, 100)
    saveCalculatorHistory(history.value)
  } catch (cause) {
    model.expressionResult = ''
    error.value = cause instanceof Error ? cause.message : '表达式计算失败'
  }
}

function insertKey(key: string): void {
  model.expression += key === 'π' ? 'pi' : key
}

function backspace(): void { model.expression = model.expression.slice(0, -1) }
function clearExpression(): void { model.expression = ''; model.expressionResult = ''; error.value = '' }
function unitResult(): string { try { return convertUnit(model.unitValue, model.unitTarget) } catch (cause) { return cause instanceof Error ? cause.message : '单位换算失败' } }
async function copy(value: string): Promise<void> { if (value) { await copyText(value); toast.show('结果已复制') } }
function restoreHistory(item: CalculatorHistoryEntry): void { model.section = 'scientific'; model.expression = item.expression; model.expressionResult = item.result }
function clearHistory(): void { history.value = []; saveCalculatorHistory([]) }
</script>

<template>
  <section class="tool-page calculator-tool" :data-section="model.section">
    <header class="calculator-header">
      <div class="calculator-brand"><span><Calculator :size="18" /></span><div><small>LOCAL COMPUTE ENGINE</small><h1>超级计算器</h1><p>科学、程序员、金融、日期与工程计算均在本地完成</p></div></div>
      <div class="calculator-header-actions"><span><Pi :size="14" />BigNumber</span><IconButton :icon="Trash2" label="清空计算历史" :disabled="!history.length" danger @click="clearHistory" /></div>
    </header>

    <div class="calculator-nav"><SegmentedControl v-model="model.section" label="计算器模块" :options="sectionOptions" /></div>

    <div v-if="model.section === 'scientific'" class="calculator-scientific-layout">
      <section class="calculator-console">
        <div class="calculator-console-topline"><span>EXPRESSION</span><small>Enter 计算</small></div>
        <label class="calculator-expression"><input v-model="model.expression" aria-label="科学计算表达式" spellcheck="false" @keydown.enter.prevent="evaluateExpression" /><button type="button" aria-label="退格" @click="backspace"><Delete :size="16" /></button></label>
        <div class="calculator-keypad"><button v-for="key in calculatorKeys.flat()" :key="key" type="button" :class="{ operator: ['/', '*', '-', '+', '^', '!'].includes(key), function: key.includes('(') || key === 'π' }" @click="insertKey(key)">{{ key }}</button></div>
        <div class="calculator-console-actions"><button class="command-button secondary" type="button" @click="clearExpression"><RotateCcw :size="15" />清空</button><button class="command-button primary" type="button" @click="evaluateExpression"><Calculator :size="16" />计算</button></div>
        <p v-if="error" class="calculator-error">{{ error }}</p>
      </section>
      <aside class="calculator-output-stack">
        <section class="calculator-result-stage"><header><span>RESULT</span><small>{{ model.expressionResult ? 'LOCAL' : 'READY' }}</small></header><code>{{ model.expressionResult || '等待计算' }}</code><button type="button" aria-label="复制科学计算结果" :disabled="!model.expressionResult" @click="copy(model.expressionResult)"><Copy :size="16" /></button></section>
        <section class="calculator-unit-card"><header><span>UNIT CONVERTER</span><Atom :size="15" /></header><label>数值与单位<input v-model="model.unitValue" aria-label="单位换算数值" /></label><label>目标单位<input v-model="model.unitTarget" aria-label="目标单位" /></label><output><span>{{ unitResult() }}</span><IconButton :icon="Copy" label="复制单位换算结果" size="small" @click="copy(unitResult())" /></output></section>
      </aside>
    </div>

    <div v-else-if="model.section === 'programmer'" class="calculator-module-layout">
      <section class="calculator-module-main calculator-programmer-main"><header><Binary :size="17" /><div><strong>程序员计算器</strong><small>进制转换与位运算使用同一套 BigInt 精确计算</small></div></header><SegmentedControl v-model="model.programmerView" class="calculator-programmer-tabs" label="程序员计算模式" :options="programmerViewOptions" /><template v-if="model.programmerView === 'convert'"><div class="calculator-control-grid"><label>输入值<input v-model="model.baseInput" aria-label="程序员输入整数" /></label><label>当前进制<select v-model.number="model.baseFrom" aria-label="程序员输入进制"><option :value="2">二进制</option><option :value="8">八进制</option><option :value="10">十进制</option><option :value="16">十六进制</option></select></label><label>位宽<select v-model.number="model.bitWidth" aria-label="位宽"><option :value="8">8 位</option><option :value="16">16 位</option><option :value="32">32 位</option><option :value="64">64 位</option></select></label><label class="calculator-toggle"><input v-model="model.signed" type="checkbox" /><span>按有符号整数解释</span></label></div><p class="calculator-input-hint">{{ programmerInputHint }}</p><div v-if="programmerOutput" class="calculator-base-grid"><div v-for="(value, key) in programmerOutput" :key="key"><small>{{ key === 'bin' ? '二进制' : key === 'oct' ? '八进制' : key === 'dec' ? '十进制' : '十六进制' }}</small><code>{{ value }}</code><IconButton :icon="Copy" :label="`复制 ${key}`" size="small" @click="copy(value)" /></div></div><p v-else class="calculator-error">请检查输入值与当前进制。</p></template><template v-else><div class="calculator-control-grid calculator-bitwise-grid"><label>左操作数<input v-model="model.left" aria-label="左操作数" /></label><label>操作<select v-model="model.bitOperation" aria-label="位运算操作"><option value="&">按位与 AND (&amp;)</option><option value="|">按位或 OR (|)</option><option value="^">按位异或 XOR (^)</option><option value="<<">左移 (&lt;&lt;)</option><option value=">>">右移 (&gt;&gt;)</option></select></label><label>右操作数<input v-model="model.right" aria-label="右操作数" /></label><label>输入进制<select v-model.number="model.baseFrom" aria-label="位运算输入进制"><option :value="2">二进制</option><option :value="8">八进制</option><option :value="10">十进制</option><option :value="16">十六进制</option></select></label><label>位宽<select v-model.number="model.bitWidth" aria-label="位运算位宽"><option :value="8">8 位</option><option :value="16">16 位</option><option :value="32">32 位</option><option :value="64">64 位</option></select></label></div><p class="calculator-input-hint">左值与右值按当前进制读取；例如十进制下 <code>12 &amp; 10</code> 的结果是 <code>8</code>。</p><div v-if="bitOperationOutput" class="calculator-base-grid"><div v-for="(value, key) in bitOperationOutput" :key="key"><small>{{ key === 'bin' ? '二进制结果' : key === 'oct' ? '八进制结果' : key === 'dec' ? '十进制结果' : '十六进制结果' }}</small><code>{{ value }}</code><IconButton :icon="Copy" :label="`复制位运算 ${key}`" size="small" @click="copy(value)" /></div></div><p v-else class="calculator-error">请检查两个操作数与输入进制。</p></template></section>
      <aside class="calculator-module-side calculator-programmer-guide"><header><span>{{ model.programmerView === 'convert' ? '使用说明' : '位运算说明' }}</span></header><template v-if="model.programmerView === 'convert'"><p>先选择输入值当前使用的进制，再输入数值。切换进制会自动保留数值含义并转换输入框内容。</p><dl><div><dt>十进制</dt><dd><code>255</code></dd></div><div><dt>二进制</dt><dd><code>0b11111111</code></dd></div><div><dt>十六进制</dt><dd><code>0xFF</code></dd></div></dl></template><template v-else><p><code>&amp;</code> 同位都为 1 才为 1；<code>|</code> 任一位为 1；<code>^</code> 两位不同时为 1。</p><dl><div><dt>示例</dt><dd><code>12 &amp; 10 = 8</code></dd></div><div><dt>左移</dt><dd><code>3 &lt;&lt; 1 = 6</code></dd></div></dl></template></aside>
    </div>

    <div v-else-if="model.section === 'finance'" class="calculator-module-layout">
      <section class="calculator-module-main"><header><WalletCards :size="17" /><div><strong>金融计算</strong><small>本地 BigNumber 利率与本息模型</small></div></header><div class="calculator-control-grid"><label>金融计算<select v-model="model.financeKind" aria-label="金融计算类型"><option value="simple">单利本息</option><option value="compound">复利本息</option><option value="loan">等额本息月供</option><option value="tax">税后金额</option></select></label><label>本金/金额<input v-model="model.principal" aria-label="本金金额" /></label><label>年利率 (%)<input v-model="model.annualRate" aria-label="年利率" /></label><label>期数（年；贷款为月）<input v-model="model.periods" aria-label="期数" /></label><label v-if="model.financeKind === 'tax'">税率 (%)<input v-model="model.taxRate" aria-label="税率" /></label></div><div class="calculator-inline-result"><span>{{ model.financeKind === 'loan' ? '月供' : '计算结果' }}</span><code>{{ financeResult }}</code><IconButton :icon="Copy" label="复制金融结果" size="small" @click="copy(financeResult)" /></div></section>
      <aside class="calculator-module-side"><header><span>DATE LAB</span></header><label>开始日期<input v-model="model.dateStart" type="date" aria-label="开始日期" /></label><label>结束日期<input v-model="model.dateEnd" type="date" aria-label="结束日期" /></label><label>偏移量<input v-model="model.dateOffset" aria-label="日期偏移量" /></label><label>偏移单位<select v-model="model.dateUnit" aria-label="日期偏移单位"><option value="days">天</option><option value="months">月</option><option value="years">年</option></select></label><output><span>间隔 {{ dateResult.difference }}</span><code>{{ dateResult.shifted }}</code></output></aside>
    </div>

    <div v-else class="calculator-module-layout">
      <section class="calculator-module-main"><header><Sigma :size="17" /><div><strong>工程计算</strong><small>矩阵、复数与统计聚合</small></div></header><div class="calculator-control-grid"><label>工程模块<select v-model="model.engineeringKind" aria-label="工程模块"><option value="matrix">矩阵</option><option value="complex">复数</option><option value="statistics">统计</option></select></label><label>操作<select v-model="model.engineeringOperation" aria-label="工程操作"><template v-if="model.engineeringKind === 'matrix'"><option value="det">行列式</option><option value="transpose">转置</option><option value="inv">逆矩阵</option><option value="square">平方</option></template><template v-else-if="model.engineeringKind === 'complex'"><option value="add">相加</option><option value="sub">相减</option><option value="mul">相乘</option><option value="div">相除</option></template><template v-else><option value="mean">平均值</option><option value="median">中位数</option><option value="variance">方差</option><option value="std">标准差</option></template></select></label></div><label class="calculator-wide-input">输入<input v-model="model.engineeringSource" aria-label="工程计算输入" /></label><div class="calculator-inline-result"><span>计算结果</span><code>{{ engineeringResult }}</code><IconButton :icon="Copy" label="复制工程计算结果" size="small" @click="copy(engineeringResult)" /></div></section>
      <aside class="calculator-module-side calculator-example"><header><span>INPUT GUIDE</span></header><p v-if="model.engineeringKind === 'matrix'">矩阵使用 <code>[[1, 2], [3, 4]]</code></p><p v-else-if="model.engineeringKind === 'complex'">复数使用逗号分隔，例如 <code>2 + 3i, 1 - i</code></p><p v-else>统计数值用逗号或空格分隔，例如 <code>1, 3, 5, 7</code></p><Atom :size="36" aria-hidden="true" /></aside>
    </div>

    <section class="calculator-history"><header><span><History :size="15" />EXPRESSION HISTORY</span><small>当前设备 · {{ history.length }} / 100</small></header><div v-if="history.length" class="calculator-history-list"><button v-for="item in history" :key="item.id" type="button" @click="restoreHistory(item)"><span><strong>{{ item.expression }}</strong><small>{{ new Date(item.createdAt).toLocaleString() }}</small></span><code>{{ item.result }}</code></button></div><p v-else>输入表达式并计算后，历史会显示在这里。</p></section>
  </section>
</template>
