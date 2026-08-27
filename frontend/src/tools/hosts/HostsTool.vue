<script setup lang="ts">
import { Check, Copy, DatabaseBackup, Eye, FileText, RefreshCw, RotateCcw, ShieldCheck, X } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import { desktopApi } from '@/api/desktopApi'
import CodeEditor from '@/components/CodeEditor.vue'
import DesktopOnlyState from '@/components/DesktopOnlyState.vue'
import IconButton from '@/components/IconButton.vue'
import { useToolState } from '@/composables/useToolState'
import { isWebRuntime } from '@/runtime'
import { useToastStore } from '@/stores/toast'
import type { HostsBackup, HostsPreview, HostsSnapshot } from '@/types'
import { copyText } from '@/utils/clipboard'

const props = defineProps<{ state: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:state': [state: Record<string, unknown>] }>()
const toast = useToastStore()
const model = useToolState(
  props.state,
  { content: '', sourceSha256: '' },
  (state) => emit('update:state', state),
)
const snapshot = ref<HostsSnapshot | null>(null)
const preview = ref<HostsPreview | null>(null)
const baseContent = ref('')
const busy = ref(false)
const backupOpen = ref(false)
const previewOpen = ref(false)
const errorMessage = ref('')
const dirty = computed(() => model.content !== baseContent.value)
const backups = computed(() => snapshot.value?.backups ?? [])

async function loadSnapshot(force = false): Promise<void> {
  busy.value = true
  errorMessage.value = ''
  const result = await desktopApi.readHosts()
  busy.value = false
  if (!result.ok) {
    errorMessage.value = result.error.message
    return
  }
  snapshot.value = result.data
  if (force || !model.sourceSha256 || model.sourceSha256 === result.data.sha256) {
    if (force || !model.sourceSha256) model.content = result.data.content
    model.sourceSha256 = result.data.sha256
    baseContent.value = result.data.content
  } else {
    errorMessage.value = '系统 Hosts 已在外部发生变化，请重新加载后编辑'
  }
}

async function reload(): Promise<void> {
  if (dirty.value && !window.confirm('放弃当前未应用的 Hosts 修改并重新加载？')) return
  await loadSnapshot(true)
}

async function requestPreview(open = true): Promise<boolean> {
  if (!model.sourceSha256) return false
  busy.value = true
  errorMessage.value = ''
  const result = await desktopApi.applyHosts(model.content, model.sourceSha256, true)
  busy.value = false
  if (!result.ok) {
    errorMessage.value = result.error.message
    toast.show(result.error.message, 'error')
    return false
  }
  preview.value = result.data
  previewOpen.value = open
  return true
}

async function apply(): Promise<void> {
  if (!(await requestPreview(false))) return
  if (!preview.value?.changed) {
    toast.show('系统 Hosts 已是当前内容', 'info')
    return
  }
  if (!window.confirm('确认写入完整系统 Hosts 文件？写入前会自动创建备份。')) return
  busy.value = true
  const result = await desktopApi.applyHosts(model.content, model.sourceSha256, false)
  busy.value = false
  if (!result.ok) {
    errorMessage.value = result.error.message
    toast.show(result.error.message, 'error')
    return
  }
  toast.show('Hosts 文件已保存', 'success')
  await loadSnapshot(true)
}

async function openBackups(): Promise<void> {
  const result = await desktopApi.listHostsBackups()
  if (!result.ok) {
    toast.show(result.error.message, 'error')
    return
  }
  if (snapshot.value) snapshot.value.backups = result.data
  backupOpen.value = true
}

async function restore(backup: HostsBackup): Promise<void> {
  if (!window.confirm(`恢复 ${new Date(backup.createdAt).toLocaleString()} 的完整 Hosts 文件？`)) return
  busy.value = true
  const result = await desktopApi.restoreHostsBackup(backup.id)
  busy.value = false
  if (!result.ok) {
    toast.show(result.error.message, 'error')
    return
  }
  backupOpen.value = false
  toast.show(result.data.changed ? '完整 Hosts 文件已恢复' : '当前文件无需恢复', 'success')
  await loadSnapshot(true)
}

async function copyDesired(): Promise<void> {
  await copyText(preview.value?.desiredContent ?? '')
  toast.show('目标 Hosts 内容已复制', 'success')
}

onMounted(() => {
  if (!isWebRuntime) void loadSnapshot(!model.sourceSha256)
})
</script>

<template>
  <section class="tool-page hosts-tool">
    <header class="tool-header">
      <div>
        <h1>Hosts</h1>
        <p :class="{ error: errorMessage }">
          <template v-if="isWebRuntime">Windows 系统文件工具</template>
          <template v-else-if="errorMessage">{{ errorMessage }}</template>
          <template v-else-if="dirty">文件有未应用修改</template>
          <template v-else-if="snapshot"><Check :size="14" />{{ snapshot.path }}</template>
          <template v-else>正在读取系统 Hosts</template>
        </p>
      </div>
      <div v-if="!isWebRuntime" class="toolbar">
        <IconButton :icon="RefreshCw" label="重新加载 Hosts" :disabled="busy" @click="reload" />
        <button class="command-button secondary" type="button" :disabled="busy || !snapshot" @click="requestPreview(true)">
          <Eye :size="16" />预览
        </button>
        <button class="command-button secondary" type="button" :disabled="busy || !snapshot" @click="openBackups">
          <DatabaseBackup :size="16" />备份
        </button>
        <button class="command-button primary" type="button" :disabled="busy || !snapshot || !dirty" @click="apply">
          <ShieldCheck :size="16" />{{ busy ? '处理中' : '保存' }}
        </button>
      </div>
    </header>

    <DesktopOnlyState v-if="isWebRuntime" title="仅 Windows 桌面版可用" description="浏览器无法读取或修改当前设备的 Hosts 文件。" />

    <template v-else>
      <div class="editor-panel hosts-file-panel">
        <div class="panel-label hosts-file-label">
          <span><FileText :size="14" />本地 Hosts 文件</span>
          <small v-if="snapshot">{{ snapshot.encoding.toUpperCase() }} · {{ snapshot.newline }} · {{ model.content.length }} 字符</small>
        </div>
        <CodeEditor v-model="model.content" language="plain" label="本地 Hosts 文件内容" />
      </div>

      <div v-if="previewOpen && preview" class="modal-backdrop" @mousedown.self="previewOpen = false">
        <section class="modal preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title">
          <header>
            <div><h2 id="preview-title">完整 Hosts 文件预览</h2><p>{{ preview.changed ? '存在待保存变更' : '当前内容已同步' }}</p></div>
            <div class="toolbar">
              <IconButton :icon="Copy" label="复制目标内容" @click="copyDesired" />
              <IconButton :icon="X" label="关闭" @click="previewOpen = false" />
            </div>
          </header>
          <div class="preview-columns">
            <div><span>当前文件</span><pre>{{ preview.currentContent }}</pre></div>
            <div><span>保存后</span><pre>{{ preview.desiredContent }}</pre></div>
          </div>
        </section>
      </div>

      <div v-if="backupOpen" class="modal-backdrop" @mousedown.self="backupOpen = false">
        <section class="modal backup-modal" role="dialog" aria-modal="true" aria-labelledby="backup-title">
          <header>
            <div><h2 id="backup-title">Hosts 备份</h2><p>恢复时会替换完整系统 Hosts 文件</p></div>
            <IconButton :icon="X" label="关闭" @click="backupOpen = false" />
          </header>
          <div class="backup-list">
            <div v-for="backup in backups" :key="backup.id" class="backup-row">
              <DatabaseBackup :size="17" />
              <div><strong>{{ new Date(backup.createdAt).toLocaleString() }}</strong><small>{{ backup.size }} B · {{ backup.sha256.slice(0, 12) }}</small></div>
              <IconButton :icon="RotateCcw" label="恢复此备份" :disabled="busy" @click="restore(backup)" />
            </div>
            <div v-if="!backups.length" class="empty-state"><DatabaseBackup :size="22" /><span>暂无 Hosts 备份</span></div>
          </div>
        </section>
      </div>
    </template>
  </section>
</template>
