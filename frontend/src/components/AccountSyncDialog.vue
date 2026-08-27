<script setup lang="ts">
import { Cloud, CloudOff, LogIn, MailCheck, UserPlus, X } from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import {
  checkService,
  loginLocalAccount,
  registerLocalAccount,
  requestEmailVerification,
  type RemoteAccount,
  type RemoteSession,
  type ShortcutSnapshot,
} from '@/api/remoteApi'
import { useAppStore } from '@/stores/app'

const props = defineProps<{
  open: boolean
  account: RemoteAccount | null
  migrationRequired: boolean
  shortcutConflict: { localToolIds: string[]; server: ShortcutSnapshot } | null
  shortcutSyncMode: 'pending' | 'enabled' | 'paused'
  shortcutSyncing: boolean
}>()
const emit = defineEmits<{
  close: []
  'signed-in': [session: RemoteSession]
  'signed-out': []
  'migration-choice': [choice: 'local' | 'server' | 'later']
  'conflict-choice': [choice: 'local' | 'server']
  'retry-shortcut-sync': []
}>()
const app = useAppStore()
const connectionState = ref<'idle' | 'checking' | 'ready' | 'error'>('idle')
const connectionMessage = ref('尚未检测同步服务')
const authMode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const displayName = ref('')
const verificationCode = ref('')
const verificationSent = ref(false)
const authPending = ref(false)
const authMessage = ref('')
const resendSeconds = ref(0)
let resendTimer: number | undefined

const serviceReady = computed(() => connectionState.value === 'ready')

watch(() => props.open, (open) => {
  if (!open) return
  connectionState.value = 'idle'
  connectionMessage.value = '尚未检测同步服务'
  authMessage.value = ''
  void testConnection()
}, { immediate: true })

async function testConnection(): Promise<void> {
  connectionState.value = 'checking'
  connectionMessage.value = app.usingLocalDeveloperService ? '正在检测本机开发服务…' : '正在连接同步服务…'
  const result = await checkService(app.apiOrigin)
  if (result.ok) {
    connectionState.value = 'ready'
    connectionMessage.value = `${app.usingLocalDeveloperService ? '本机开发服务' : '同步服务'}已就绪 · ${result.data.status}`
  } else {
    connectionState.value = 'error'
    connectionMessage.value = app.usingLocalDeveloperService
      ? `本机开发服务不可用：${result.error.message}`
      : '同步服务暂时不可用，已保持本地模式。'
  }
}

async function sendVerificationCode(): Promise<void> {
  if (!serviceReady.value || resendSeconds.value > 0) return
  authPending.value = true
  authMessage.value = ''
  const result = await requestEmailVerification(app.apiOrigin, email.value)
  authPending.value = false
  if (result.ok) {
    verificationSent.value = true
    startResendCooldown()
    authMessage.value = result.data.captured && result.data.code
      ? `测试验证码：${result.data.code}`
      : '验证码请求已提交，请通过配置的邮件服务获取验证码。'
  } else authMessage.value = result.error.message
}

async function submitAuthentication(): Promise<void> {
  if (!serviceReady.value) return
  if (!password.value) {
    authMessage.value = '请输入密码'
    return
  }
  if (authMode.value === 'register' && (password.value.length < 10 || password.value.length > 128)) {
    authMessage.value = '密码长度应为 10 至 128 位'
    return
  }
  if (authMode.value === 'register' && !/^\d{6}$/.test(verificationCode.value)) {
    authMessage.value = '验证码应为 6 位数字'
    return
  }
  authPending.value = true
  authMessage.value = ''
  const result = authMode.value === 'login'
    ? await loginLocalAccount(app.apiOrigin, email.value, password.value)
    : await registerLocalAccount(app.apiOrigin, { email: email.value, password: password.value, code: verificationCode.value, displayName: displayName.value })
  authPending.value = false
  if (result.ok) {
    emit('signed-in', result.data)
    authMessage.value = `已登录为 ${result.data.user.displayName || result.data.user.email}`
    password.value = ''
    verificationCode.value = ''
  } else authMessage.value = result.error.message
}

async function signOut(): Promise<void> {
  emit('signed-out')
  authMessage.value = '已退出账户'
}

function startResendCooldown(): void {
  window.clearInterval(resendTimer)
  resendSeconds.value = 60
  resendTimer = window.setInterval(() => {
    resendSeconds.value = Math.max(0, resendSeconds.value - 1)
    if (resendSeconds.value === 0) window.clearInterval(resendTimer)
  }, 1000)
}

onBeforeUnmount(() => window.clearInterval(resendTimer))
</script>

<template>
  <div v-if="open" class="account-sync-backdrop" @pointerdown.self="emit('close')">
    <section class="account-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="account-sync-title">
      <header>
        <div>
          <span><Cloud :size="14" />ACCOUNT & SYNC</span>
          <h2 id="account-sync-title">账户与同步</h2>
          <p>快捷方式可选择同步；笔记、工具输入、Hosts 和设备文件始终留在本机。</p>
        </div>
        <button type="button" aria-label="关闭账户与同步" @click="emit('close')"><X :size="18" /></button>
      </header>

      <section v-if="account" class="account-identity">
        <span class="account-avatar">{{ (account.displayName || account.email).slice(0, 1).toUpperCase() }}</span>
        <span><strong>{{ account.displayName || '账户' }}</strong><small>{{ account.email }}</small></span>
        <button class="command-button subtle" type="button" @click="signOut">退出</button>
      </section>

      <section v-if="account && migrationRequired" class="account-shortcut-choice">
        <strong>选择快捷方式同步方式</strong><p>首次登录不会覆盖本地快捷方式，请明确选择要使用的来源。</p>
        <div><button class="command-button" type="button" @click="emit('migration-choice', 'local')">上传本地快捷方式</button><button class="command-button subtle" type="button" @click="emit('migration-choice', 'server')">使用服务端快捷方式</button><button class="command-button subtle" type="button" @click="emit('migration-choice', 'later')">暂不同步</button></div>
      </section>
      <section v-else-if="account && shortcutConflict" class="account-shortcut-choice conflict">
        <strong>快捷方式发生冲突</strong><p>本地 {{ shortcutConflict.localToolIds.length }} 个，服务端 {{ shortcutConflict.server.toolIds.length }} 个。请选择要保留的版本。</p>
        <div><button class="command-button" type="button" @click="emit('conflict-choice', 'local')">保留本地</button><button class="command-button subtle" type="button" @click="emit('conflict-choice', 'server')">保留服务端</button></div>
      </section>
      <section v-else-if="account" class="account-shortcut-status">
        <span><Cloud :size="16" /><strong>{{ shortcutSyncMode === 'enabled' ? (shortcutSyncing ? '正在同步快捷方式' : '快捷方式同步已启用') : '快捷方式尚未同步' }}</strong></span>
        <button class="command-button subtle" type="button" :disabled="shortcutSyncing" @click="emit('retry-shortcut-sync')">{{ shortcutSyncMode === 'paused' ? '开始同步' : '立即重试' }}</button>
      </section>

      <template v-else>
        <section class="account-auth">
          <div class="account-mode-tabs" role="tablist" aria-label="账户操作">
            <button type="button" :class="{ active: authMode === 'login' }" role="tab" :aria-selected="authMode === 'login'" @click="authMode = 'login'; authMessage = ''"><LogIn :size="15" />登录</button>
            <button type="button" :class="{ active: authMode === 'register' }" role="tab" :aria-selected="authMode === 'register'" @click="authMode = 'register'; authMessage = ''"><UserPlus :size="15" />注册</button>
          </div>
          <div class="account-auth-fields" :class="{ disabled: !serviceReady }">
            <label>邮箱<input v-model="email" type="email" autocomplete="email" placeholder="name@example.com" :disabled="!serviceReady || authPending" /></label>
            <label v-if="authMode === 'register'">显示名称<input v-model="displayName" autocomplete="nickname" placeholder="可选" :disabled="!serviceReady || authPending" /></label>
            <label>密码<input v-model="password" type="password" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" :minlength="authMode === 'register' ? 10 : undefined" maxlength="128" placeholder="10 至 128 位" :disabled="!serviceReady || authPending" @keydown.enter.prevent="submitAuthentication" /></label>
            <label v-if="authMode === 'register'">验证码
              <span class="account-code-input"><input v-model="verificationCode" inputmode="numeric" maxlength="6" placeholder="6 位验证码" :disabled="!serviceReady || authPending" /><button type="button" :disabled="!serviceReady || authPending || !email || resendSeconds > 0" @click="sendVerificationCode"><MailCheck :size="14" />{{ resendSeconds > 0 ? `${resendSeconds} 秒后重发` : verificationSent ? '重新发送' : '获取验证码' }}</button></span>
            </label>
            <p v-if="!serviceReady" class="account-auth-hint"><CloudOff :size="14" />{{ connectionMessage }} 工具、笔记和工作台仍只保存在当前设备。</p>
            <p v-else-if="authMessage" class="account-auth-hint" :class="{ error: !authMessage.startsWith('测试验证码') && !authMessage.startsWith('验证码请求') && !authMessage.startsWith('已登录') && !authMessage.startsWith('已退出') }">{{ authMessage }}</p>
            <button class="command-button account-auth-submit" type="button" :disabled="!serviceReady || authPending" @click="submitAuthentication">{{ authPending ? '正在处理…' : authMode === 'login' ? '登录' : '注册并登录' }}</button>
          </div>
        </section>
      </template>

      <footer><span>LOCAL-FIRST · 同步服务不可用时继续使用本地工作台</span></footer>
    </section>
  </div>
</template>
