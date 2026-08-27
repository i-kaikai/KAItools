<script setup lang="ts">
import { Clipboard, Keyboard, MonitorDown, Palette, PanelLeft, RotateCcw, Sparkles, Type, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import SegmentedControl from '@/components/SegmentedControl.vue'
import { isWebRuntime } from '@/runtime'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import type { ParticleQuality, SidebarStartup, ThemeMode } from '@/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const toast = useToastStore()
const hotkey = ref('Ctrl+Alt+K')
const capturing = ref(false)
const saving = ref(false)
const message = ref('点击组合键区域，然后按下新的快捷键。')

const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]
const particleOptions: Array<{ value: ParticleQuality; label: string }> = [
  { value: 'high', label: '高质量' },
  { value: 'balanced', label: '均衡' },
  { value: 'off', label: '关闭' },
]
const sidebarStartupOptions: Array<{ value: SidebarStartup; label: string }> = [
  { value: 'remember', label: '记住状态' },
  { value: 'collapsed', label: '默认收起' },
  { value: 'expanded', label: '默认展开' },
]
const formattedHotkey = computed(() => hotkey.value.replaceAll('+', ' + '))

watch(() => props.open, (open) => {
  if (!open) return
  hotkey.value = app.settings.activationHotkey || 'Ctrl+Alt+K'
  capturing.value = false
  message.value = isWebRuntime
    ? '网页环境由浏览器管理系统快捷键，无法注册全局唤起。'
    : '点击组合键区域，然后按下新的快捷键。'
}, { immediate: true })

function normalizeKey(key: string): string | null {
  const value = key.toUpperCase()
  return /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/.test(value) ? value : null
}

function beginCapture(event: MouseEvent): void {
  if (isWebRuntime) return
  if (event.currentTarget instanceof HTMLButtonElement) event.currentTarget.focus()
  capturing.value = true
  message.value = '请按 Ctrl 或 Alt 加字母、数字或 F1-F12。'
}

function captureHotkey(event: KeyboardEvent): void {
  if (!capturing.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    capturing.value = false
    message.value = '已取消修改。'
    return
  }
  if (event.metaKey) {
    message.value = '暂不支持 Windows 徽标键，请使用 Ctrl、Alt 或 Shift。'
    return
  }
  const key = normalizeKey(event.key)
  if (!key || (!event.ctrlKey && !event.altKey)) {
    message.value = '需要 Ctrl 或 Alt 加字母、数字或 F1-F12。'
    return
  }
  hotkey.value = [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key]
    .filter(Boolean)
    .join('+')
  capturing.value = false
  message.value = `已录入 ${formattedHotkey.value}，保存后立即生效。`
}

async function saveHotkey(): Promise<void> {
  if (isWebRuntime || saving.value) return
  saving.value = true
  const saved = await app.setActivationHotkey(hotkey.value)
  saving.value = false
  if (!saved) {
    message.value = '未能注册该组合键，请换一个后重试。'
    return
  }
  message.value = `${formattedHotkey.value} 已生效，可在应用最小化或后台时唤起 KAITools。`
  toast.show('全局唤起快捷键已更新')
}

function restoreHotkeyDefault(): void {
  hotkey.value = 'Ctrl+Alt+K'
  capturing.value = false
  message.value = '已恢复默认组合键，保存后生效。'
}
</script>

<template>
  <div v-if="open" class="application-settings-backdrop" @pointerdown.self="emit('close')">
    <section class="application-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="application-settings-title">
      <header>
        <div>
          <span><Sparkles :size="14" />APPLICATION SETTINGS</span>
          <h2 id="application-settings-title">应用设置</h2>
          <p>偏好仅保存在当前设备，调整后立即生效。</p>
        </div>
        <button type="button" aria-label="关闭应用设置" @click="emit('close')"><X :size="18" /></button>
      </header>

      <div class="application-settings-body">
        <section class="application-settings-section">
          <div class="application-settings-heading"><Palette :size="17" /><span><strong>外观与性能</strong><small>主题、粒子背景与动态效果</small></span></div>
          <div class="application-settings-option"><span><strong>主题</strong><small>侧栏快捷切换与此处保持同步</small></span><SegmentedControl :model-value="app.settings.theme" label="主题" :options="themeOptions" @update:model-value="app.setTheme($event as ThemeMode)" /></div>
          <div class="application-settings-option"><span><strong>背景粒子</strong><small>高质量保持当前视觉密度；均衡档降低渲染负载</small></span><SegmentedControl :model-value="app.settings.particleQuality" label="背景粒子质量" :options="particleOptions" @update:model-value="app.setParticleQuality($event as ParticleQuality)" /></div>
          <label class="application-settings-switch"><span><strong>减少动态效果</strong><small>跟随系统的减少动态效果偏好；启用后保留静态首帧</small></span><input :checked="app.settings.motionMode === 'reduced'" type="checkbox" aria-label="减少动态效果" @change="app.setMotionMode(($event.target as HTMLInputElement).checked ? 'reduced' : 'system')" /></label>
        </section>

        <section class="application-settings-section">
          <div class="application-settings-heading"><Clipboard :size="17" /><span><strong>桌面与状态</strong><small>仅当前设备生效</small></span></div>
          <label class="application-settings-switch" :class="{ disabled: isWebRuntime }"><span><strong>记录剪切板历史</strong><small>{{ isWebRuntime ? '浏览器无法持续监听系统剪切板，请使用 Windows 桌面版。' : '默认记录纯文本，隐藏到托盘后继续运行，退出应用自动清空。' }}</small></span><input :checked="app.settings.clipboardMonitoringEnabled" type="checkbox" aria-label="记录剪切板历史" :disabled="isWebRuntime" @change="app.setClipboardMonitoringEnabled(($event.target as HTMLInputElement).checked)" /></label>
          <label class="application-settings-option"><span><strong>系统状态自动刷新</strong><small>手动刷新可随时使用；自动刷新只在首页停留时运行</small></span><select :value="app.settings.systemStatusRefreshSeconds" aria-label="系统状态自动刷新" @change="app.setSystemStatusRefreshSeconds(Number(($event.target as HTMLSelectElement).value) as 0 | 30 | 60 | 300)"><option :value="0">仅手动</option><option :value="30">30 秒</option><option :value="60">60 秒</option><option :value="300">5 分钟</option></select></label>
        </section>

        <section class="application-settings-section">
          <div class="application-settings-heading"><PanelLeft :size="17" /><span><strong>工作台</strong><small>侧栏与标签恢复方式</small></span></div>
          <div class="application-settings-option"><span><strong>侧栏启动状态</strong><small>当前选择在下一次启动时应用</small></span><SegmentedControl :model-value="app.settings.sidebarStartup" label="侧栏启动状态" :options="sidebarStartupOptions" @update:model-value="app.setSidebarStartup($event as SidebarStartup)" /></div>
          <label class="application-settings-switch"><span><strong>恢复固定标签</strong><small>关闭后每次从干净首页开始，固定标签仍会保留在本机</small></span><input :checked="app.settings.restorePinnedTabsOnLaunch" type="checkbox" aria-label="启动时恢复固定标签" @change="app.setRestorePinnedTabsOnLaunch(($event.target as HTMLInputElement).checked)" /></label>
        </section>

        <section class="application-settings-section">
          <div class="application-settings-heading"><Type :size="17" /><span><strong>编辑器</strong><small>适用于所有代码和 Markdown 编辑区域</small></span></div>
          <label class="application-settings-option"><span><strong>编辑器字号</strong><small>只影响编辑内容和行号，不缩放应用界面</small></span><select :value="app.settings.editorFontSize" aria-label="编辑器字号" @change="app.setEditorFontSize(Number(($event.target as HTMLSelectElement).value))"><option v-for="size in [12, 13, 14, 15, 16]" :key="size" :value="size">{{ size }} px</option></select></label>
          <label class="application-settings-switch"><span><strong>自动换行</strong><small>关闭后保留长行，使用编辑器底部横向滚动查看</small></span><input :checked="app.settings.editorLineWrapping" type="checkbox" aria-label="编辑器自动换行" @change="app.setEditorLineWrapping(($event.target as HTMLInputElement).checked)" /></label>
        </section>

        <section class="application-settings-section">
          <div class="application-settings-heading"><MonitorDown :size="17" /><span><strong>唤起应用</strong><small>最小化或后台运行时恢复窗口</small></span></div>
          <button class="hotkey-capture" :class="{ capturing }" type="button" :disabled="isWebRuntime || saving" aria-label="录入全局唤起快捷键" @click="beginCapture" @keydown="captureHotkey"><Keyboard :size="17" aria-hidden="true" /><strong>{{ formattedHotkey }}</strong><small>{{ capturing ? '正在录入' : '点击修改' }}</small></button>
          <p class="application-settings-status" role="status">{{ message }}</p>
          <div class="application-settings-actions"><button class="command-button subtle" type="button" :disabled="isWebRuntime || saving" @click="restoreHotkeyDefault"><RotateCcw :size="14" />恢复默认</button><button class="command-button" type="button" :disabled="isWebRuntime || saving" @click="saveHotkey">{{ saving ? '正在注册…' : '保存并启用' }}</button></div>
        </section>

        <section class="application-settings-section application-minimize-hint"><Keyboard :size="16" /><span><strong>应用内最小化</strong><small>没有打开搜索、菜单或弹层时，按 <kbd>Esc</kbd> 最小化应用窗口。</small></span></section>
      </div>
      <footer><button class="command-button" type="button" @click="emit('close')">完成</button></footer>
    </section>
  </div>
</template>
