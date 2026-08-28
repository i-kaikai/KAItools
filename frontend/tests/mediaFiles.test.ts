import { describe, expect, it } from 'vitest'

import { imageMimeType, isVideoFile } from '@/utils/mediaFiles'

describe('media file detection', () => {
  it('recognizes images supplied without an operating-system MIME type', () => {
    expect(imageMimeType(new File(['image'], 'paste.PNG'))).toBe('image/png')
  })

  it('recognizes common video file extensions without MIME metadata', () => {
    expect(isVideoFile(new File(['video'], 'clip.MP4'))).toBe(true)
    expect(isVideoFile(new File(['text'], 'notes.txt'))).toBe(false)
  })
})
