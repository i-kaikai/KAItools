import { beforeEach, describe, expect, it, vi } from 'vitest'

import { desktopApi } from '@/api/desktopApi'
import { checkLatestVersion, latestUpdate, updateProgress } from '@/updateState'
import type { UpdateLatestResult } from '@/types'

const availableUpdate: UpdateLatestResult = {
  currentVersion: '1.4.20',
  latestVersion: '1.4.21',
  available: true,
  releaseNotes: ['更新程序'],
  publishedAt: '2026-09-28',
}

describe('latest update checks', () => {
  beforeEach(() => {
    latestUpdate.value = null
    updateProgress.value = null
    vi.restoreAllMocks()
  })

  it('uses the startup cache policy by default and stores successful metadata', async () => {
    const check = vi.spyOn(desktopApi, 'checkForLatestVersion').mockResolvedValue({ ok: true, data: availableUpdate })

    await expect(checkLatestVersion()).resolves.toEqual({ ok: true, data: availableUpdate })

    expect(check).toHaveBeenCalledOnce()
    expect(check).toHaveBeenCalledWith(false)
    expect(latestUpdate.value).toEqual(availableUpdate)
  })

  it('forces a manual check and retains a previously known update on failure', async () => {
    const failure = { ok: false as const, error: { code: 'UPDATE_CHECK_FAILED', message: '网络暂不可用' } }
    const check = vi.spyOn(desktopApi, 'checkForLatestVersion')
      .mockResolvedValueOnce({ ok: true, data: availableUpdate })
      .mockResolvedValueOnce(failure)

    await checkLatestVersion()
    await expect(checkLatestVersion(true)).resolves.toEqual(failure)

    expect(check).toHaveBeenNthCalledWith(2, true)
    expect(latestUpdate.value).toEqual(availableUpdate)
  })

  it('coalesces automatic checks and runs a forced check after them', async () => {
    let resolveInitial!: (value: { ok: true; data: UpdateLatestResult }) => void
    const check = vi.spyOn(desktopApi, 'checkForLatestVersion')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve }))
      .mockResolvedValueOnce({ ok: true, data: availableUpdate })

    const startupCheck = checkLatestVersion()
    const dialogCheck = checkLatestVersion()
    const manualCheck = checkLatestVersion(true)

    expect(check).toHaveBeenCalledOnce()
    resolveInitial({ ok: true, data: { ...availableUpdate, available: false, latestVersion: '1.4.20' } })
    await Promise.all([startupCheck, dialogCheck, manualCheck])

    expect(check).toHaveBeenCalledTimes(2)
    expect(check).toHaveBeenNthCalledWith(1, false)
    expect(check).toHaveBeenNthCalledWith(2, true)
    expect(latestUpdate.value).toEqual(availableUpdate)
  })
})
