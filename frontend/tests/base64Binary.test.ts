import { describe, expect, it } from 'vitest'

import { base64ToBytes, bytesToBase64, bytesToDataUrl, parseImageBase64 } from '@/utils/base64'

describe('Base64 binary conversion', () => {
  it('round-trips arbitrary file bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes))
  })

  it('accepts both raw image Base64 and image Data URLs', () => {
    const bytes = new Uint8Array([137, 80, 78, 71])
    const raw = bytesToBase64(bytes)
    expect(parseImageBase64(raw, 'image/png')).toEqual({ mimeType: 'image/png', bytes })
    expect(parseImageBase64(bytesToDataUrl(bytes, 'image/png'))).toEqual({ mimeType: 'image/png', bytes })
  })

  it('rejects non-image Data URLs in the image tool', () => {
    expect(() => parseImageBase64('data:text/plain;base64,SGVsbG8=')).toThrow('Data URL 不是图片类型')
  })
})
