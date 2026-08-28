const imageMimeTypesByExtension: Record<string, string> = {
  avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', ico: 'image/x-icon', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp',
}

const videoExtensions = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm'])

function extensionOf(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? ''
}

export function imageMimeType(file: File): string | null {
  if (file.type.startsWith('image/')) return file.type
  return imageMimeTypesByExtension[extensionOf(file)] ?? null
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || videoExtensions.has(extensionOf(file))
}
