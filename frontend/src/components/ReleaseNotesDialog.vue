<script setup lang="ts">
import { AlertTriangle, CalendarDays, Check, ChevronRight, CircleCheck, CircleDot, Download, LoaderCircle, RefreshCw, Rocket, ScrollText, Sparkles, Wrench, X } from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'

import { desktopApi } from '@/api/desktopApi'
import { t } from '@/i18n'
import { releaseNotes } from '@/releaseNotes'
import { isWebRuntime } from '@/runtime'
import type { UpdateCheckResult } from '@/types'

const props = defineProps<{ open: boolean; version: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const update = ref<UpdateCheckResult | null>(null)
const updateError = ref<string | null>(null)
const checkingUpdate = ref(false)
const installingUpdate = ref(false)
let previouslyFocused: HTMLElement | null = null

const visibleNotes = computed(() => releaseNotes.filter((note) => !note.draft || note.version === props.version))
const updatePanelState = computed(() => {
  if (installingUpdate.value) return 'installing'
  if (checkingUpdate.value) return 'checking'
  if (updateError.value) return 'error'
  if (isWebRuntime) return 'web'
  if (update.value?.status === 'update-available') return 'available'
  if (update.value?.status === 'repair-available') return 'repair'
  if (update.value?.status === 'newer-local-version') return 'newer'
  return 'current'
})
const updatePanelIcon = computed(() => {
  if (checkingUpdate.value || installingUpdate.value) return LoaderCircle
  if (updateError.value) return AlertTriangle
  if (update.value?.available) return Download
  return CircleCheck
})

function publishedChanges(changes: string[]): string[] {
  return changes.filter((change) => change !== 'TBD')
}

function close(): void {
  emit('close')
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

async function checkForUpdates(): Promise<void> {
  if (isWebRuntime) return
  checkingUpdate.value = true
  updateError.value = null
  try {
    const result = await desktopApi.checkForUpdates()
    if (!result.ok) {
      update.value = null
      updateError.value = result.error.message
      return
    }
    update.value = result.data
  } finally {
    checkingUpdate.value = false
  }
}

async function installUpdate(): Promise<void> {
  if (!update.value?.available || installingUpdate.value) return
  installingUpdate.value = true
  updateError.value = null
  const result = await desktopApi.installUpdate()
  if (!result.ok) {
    installingUpdate.value = false
    updateError.value = result.error.message
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return

  const focusable = Array.from(dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    closeButton.value?.focus()
    void checkForUpdates()
    return
  }
  previouslyFocused?.focus()
  previouslyFocused = null
})
</script>

<template>
  <Transition name="release-notes">
    <div v-if="open" class="release-notes-backdrop" @pointerdown.self="close" @keydown="onKeydown">
      <section ref="dialog" class="release-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="release-notes-title" aria-describedby="release-notes-description">
        <header class="release-notes-header">
          <div class="release-notes-signal" aria-hidden="true">
            <span><Rocket :size="22" :stroke-width="1.7" /></span>
            <i /><i /><i />
          </div>
          <div class="release-notes-heading">
            <span><Sparkles :size="14" />RELEASE LOG</span>
            <h2 id="release-notes-title">{{ t('releaseNotes.title') }}</h2>
            <p id="release-notes-description">{{ t('releaseNotes.description') }}</p>
          </div>
          <button ref="closeButton" class="release-notes-close" type="button" :aria-label="t('releaseNotes.close')" @click="close"><X :size="19" /></button>
        </header>

        <div class="release-notes-summary">
          <span class="release-notes-current"><CircleDot :size="15" /><strong>v{{ version }}</strong><small>{{ t('releaseNotes.current') }}</small></span>
          <span><ScrollText :size="15" />{{ t('releaseNotes.entries', { count: visibleNotes.length }) }}</span>
          <code>KAITOOLS / {{ t('releaseNotes.localBuild') }}</code>
        </div>

        <section v-if="!isWebRuntime" class="release-update-panel" :class="`state-${updatePanelState}`" aria-live="polite">
          <div class="release-update-mark" aria-hidden="true"><component :is="updatePanelIcon" :class="{ 'release-update-spinner': checkingUpdate || installingUpdate }" :size="17" :stroke-width="2" /></div>
          <div class="release-update-copy">
            <div class="release-update-label"><span>{{ t('releaseNotes.updateTitle') }}</span><b v-if="update?.available">v{{ update.latestVersion }}</b></div>
            <strong v-if="installingUpdate">{{ t('releaseNotes.installing') }}</strong>
            <strong v-else-if="checkingUpdate"><LoaderCircle class="release-update-spinner" :size="16" />{{ t('releaseNotes.checking') }}</strong>
            <strong v-else-if="isWebRuntime">{{ t('releaseNotes.webUpdateUnavailable') }}</strong>
            <strong v-else-if="updateError">{{ t('releaseNotes.updateFailed') }}</strong>
            <strong v-else-if="update?.status === 'up-to-date'">{{ t('releaseNotes.upToDate') }}</strong>
            <strong v-else-if="update?.status === 'newer-local-version'">{{ t('releaseNotes.newerLocal') }}</strong>
            <strong v-else-if="update?.status === 'repair-available'">{{ t('releaseNotes.repairAvailable') }}</strong>
            <strong v-else-if="update">{{ t('releaseNotes.updateAvailable', { version: update.latestVersion }) }}</strong>
            <small v-if="updateError">{{ updateError }}</small>
            <small v-else-if="update?.lastInstallError">{{ t('releaseNotes.lastUpdateFailed', { message: update.lastInstallError }) }}</small>
            <small v-else-if="update?.available">{{ t('releaseNotes.updateDetail', { files: update.filesToDownload, size: formatBytes(update.bytesToDownload) }) }}</small>
          </div>
          <button v-if="!isWebRuntime && !installingUpdate" class="release-update-action" type="button" :disabled="checkingUpdate" @click="update?.available ? installUpdate() : checkForUpdates()">
            <Download v-if="update?.available" :size="15" />
            <RefreshCw v-else :size="15" />
            {{ update?.available ? t('releaseNotes.updateNow') : t('releaseNotes.recheck') }}
          </button>
        </section>

        <div class="release-notes-scroll">
          <ol class="release-notes-timeline">
            <li v-for="(note, index) in visibleNotes" :key="note.version" :class="{ current: note.version === version }" :style="{ '--release-index': index }">
              <span class="release-notes-node" aria-hidden="true"><Rocket v-if="note.version === version" :size="14" /><span v-else /></span>
              <article>
                <header class="release-note-meta">
                  <div><strong>v{{ note.version }}</strong><span v-if="note.version === version">{{ t('releaseNotes.latest') }}</span><span v-else-if="note.draft" class="draft">{{ t('releaseNotes.draft') }}</span></div>
                  <time v-if="note.releaseDate && note.releaseDate !== 'TBD'" :datetime="note.releaseDate"><CalendarDays :size="14" />{{ note.releaseDate }}</time>
                  <small v-else><CircleDot :size="13" />{{ t('releaseNotes.draft') }}</small>
                </header>

                <section class="release-note-section">
                  <h3><Sparkles :size="15" />{{ t('releaseNotes.changes') }}</h3>
                  <ul v-if="publishedChanges(note.changes).length">
                    <li v-for="change in publishedChanges(note.changes)" :key="change"><ChevronRight :size="14" />{{ change }}</li>
                  </ul>
                  <p v-else>{{ t('releaseNotes.pending') }}</p>
                </section>

                <section v-if="publishedChanges(note.upgradeNotes).length" class="release-note-section release-note-upgrade">
                  <h3><Wrench :size="15" />{{ t('releaseNotes.upgrade') }}</h3>
                  <ul><li v-for="item in publishedChanges(note.upgradeNotes)" :key="item"><ChevronRight :size="14" />{{ item }}</li></ul>
                </section>
              </article>
            </li>
          </ol>
        </div>

        <footer class="release-notes-footer">
          <span><Sparkles :size="14" />KAI · Keep Approaching Ideal</span>
          <button class="command-button" type="button" @click="close"><Check :size="15" />{{ t('releaseNotes.done') }}</button>
        </footer>
      </section>
    </div>
  </Transition>
</template>
