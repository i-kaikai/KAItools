import { ref } from 'vue'

import { desktopApi } from '@/api/desktopApi'
import { isWebRuntime } from '@/runtime'
import type { UpdateLatestResult, UpdateProgress } from '@/types'

export const updateProgress = ref<UpdateProgress | null>(null)
export const latestUpdate = ref<UpdateLatestResult | null>(null)

let progressTimer: number | undefined

export async function checkLatestVersion(): Promise<{ ok: true; data: UpdateLatestResult } | { ok: false; error: { message: string } }> {
  if (isWebRuntime) return { ok: false, error: { message: '浏览器版不支持应用内更新' } }
  const result = await desktopApi.checkForLatestVersion()
  if (result.ok) latestUpdate.value = result.data
  return result
}

export async function refreshUpdateProgress(): Promise<void> {
  if (isWebRuntime) return
  try {
    const result = await desktopApi.getUpdateProgress()
    if (result.ok) updateProgress.value = result.data
  } catch {
    // Progress polling is advisory and must not surface as an application error.
  }
}

export function startUpdateProgressPolling(): void {
  if (isWebRuntime || progressTimer !== undefined) return
  void refreshUpdateProgress()
  progressTimer = window.setInterval(() => { void refreshUpdateProgress() }, 400)
}

export function stopUpdateProgressPolling(): void {
  if (progressTimer === undefined) return
  window.clearInterval(progressTimer)
  progressTimer = undefined
}
