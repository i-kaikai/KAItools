import { afterEach, describe, expect, it, vi } from 'vitest'

import { desktopApi } from '@/api/desktopApi'
import { copyPngDataUrl } from '@/utils/clipboard'

const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo='
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  vi.restoreAllMocks()
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

describe('PNG clipboard copy', () => {
  it('uses the desktop bridge when the browser cannot write image clipboard items', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} })
    const copyPng = vi.spyOn(desktopApi, 'copyPng').mockResolvedValue({ ok: true, data: undefined })

    await expect(copyPngDataUrl(pngDataUrl)).resolves.toBe('desktop')
    expect(copyPng).toHaveBeenCalledWith(pngDataUrl)
  })

  it('rejects non-PNG payloads before calling a desktop bridge', async () => {
    const copyPng = vi.spyOn(desktopApi, 'copyPng')
    await expect(copyPngDataUrl('data:image/jpeg;base64,AAAA')).rejects.toThrow('PNG')
    expect(copyPng).not.toHaveBeenCalled()
  })
})
