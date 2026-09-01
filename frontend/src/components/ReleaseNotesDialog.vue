<script setup lang="ts">
import { CalendarDays, Check, ChevronRight, CircleDot, Rocket, ScrollText, Sparkles, Wrench, X } from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'

import { t } from '@/i18n'
import { releaseNotes } from '@/releaseNotes'

const props = defineProps<{ open: boolean; version: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let previouslyFocused: HTMLElement | null = null

const visibleNotes = computed(() => releaseNotes.filter((note) => !note.draft || note.version === props.version))

function publishedChanges(changes: string[]): string[] {
  return changes.filter((change) => change !== 'TBD')
}

function close(): void {
  emit('close')
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
