import { describe, expect, it } from 'vitest'

import { supportedAudioOutputFormats } from '@/utils/videoAudio'

describe('video audio output formats', () => {
  it('only exposes MIME types supported by the current recorder', () => {
    const formats = supportedAudioOutputFormats((mimeType) => mimeType === 'audio/webm;codecs=opus')
    expect(formats).toEqual([{ mimeType: 'audio/webm;codecs=opus', extension: 'webm', label: 'WebM / Opus' }])
  })
})
