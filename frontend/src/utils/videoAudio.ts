export interface AudioOutputFormat {
  mimeType: string
  extension: string
  label: string
}

const audioOutputFormats: AudioOutputFormat[] = [
  { mimeType: 'audio/webm;codecs=opus', extension: 'webm', label: 'WebM / Opus' },
  { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg', label: 'Ogg / Opus' },
  { mimeType: 'audio/webm', extension: 'webm', label: 'WebM 音频' },
]

export function supportedAudioOutputFormats(isSupported: (mimeType: string) => boolean): AudioOutputFormat[] {
  return audioOutputFormats.filter((format) => isSupported(format.mimeType))
}
