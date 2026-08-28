function normalizeBase64(value: string): string {
  const payload = value.trim().replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '')
  const standard = payload.replace(/-/g, '+').replace(/_/g, '/')
  if (!standard || /[^A-Za-z0-9+/=]/.test(standard)) throw new Error('Base64 内容包含无效字符')
  const withoutPadding = standard.replace(/=+$/, '')
  if (withoutPadding.length % 4 === 1) throw new Error('Base64 内容长度无效')
  return withoutPadding.padEnd(Math.ceil(withoutPadding.length / 4) * 4, '=')
}

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  const encoded = btoa(binary)
  return urlSafe ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType = 'application/octet-stream'): string {
  return `data:${mimeType || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`
}

export function base64ToBytes(value: string): Uint8Array {
  let binary: string
  try {
    binary = atob(normalizeBase64(value))
  } catch (error) {
    throw new Error(error instanceof Error && error.message.includes('Base64') ? error.message : 'Base64 内容无法解码')
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function encodeBase64Text(value: string, urlSafe = false): string {
  return bytesToBase64(new TextEncoder().encode(value), urlSafe)
}

export function decodeBase64Text(value: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(value))
  } catch (error) {
    if (error instanceof Error && error.message.includes('Base64')) throw error
    throw new Error('解码结果不是有效的 UTF-8 文本')
  }
}

export async function fileToDataUrl(file: File): Promise<string> {
  return bytesToDataUrl(new Uint8Array(await file.arrayBuffer()), file.type)
}

export function parseDataUrl(value: string): { mimeType: string; bytes: Uint8Array } {
  const match = value.trim().match(/^data:([^;,]+)?;base64,([\s\S]+)$/i)
  if (!match) throw new Error('请输入包含 MIME 类型的 Base64 Data URL')
  return { mimeType: match[1] || 'application/octet-stream', bytes: base64ToBytes(match[2] ?? '') }
}

export function parseImageBase64(value: string, fallbackMimeType = 'image/png'): { mimeType: string; bytes: Uint8Array } {
  const trimmed = value.trim()
  if (/^data:/i.test(trimmed)) {
    const data = parseDataUrl(trimmed)
    if (!data.mimeType.toLowerCase().startsWith('image/')) throw new Error('Data URL 不是图片类型')
    return data
  }

  if (!fallbackMimeType.toLowerCase().startsWith('image/')) throw new Error('图片 MIME 类型必须以 image/ 开头')
  return { mimeType: fallbackMimeType, bytes: base64ToBytes(trimmed) }
}

export function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  const copied = new Uint8Array(bytes)
  return new Blob([copied.buffer], { type: mimeType || 'application/octet-stream' })
}
