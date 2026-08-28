import { desktopApi } from '@/api/desktopApi'

export async function copyText(text: string): Promise<void> {
  if (!text) return
  await navigator.clipboard.writeText(text)
}

export async function copyPngDataUrl(dataUrl: string): Promise<'browser' | 'desktop'> {
  if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('二维码图片不是有效的 PNG 数据')

  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前运行环境不支持图片剪贴板')
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return 'browser'
  } catch (browserError) {
    const fallback = await desktopApi.copyPng(dataUrl)
    if (fallback.ok) return 'desktop'
    throw new Error(fallback.error.message || (browserError instanceof Error ? browserError.message : '无法复制二维码图片'))
  }
}
