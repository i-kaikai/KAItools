import * as csstree from 'css-tree'
import DOMPurify from 'dompurify'
import JSZip from 'jszip'

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_ENTRY_BYTES = 50 * 1024 * 1024
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 500
const ZIP_CENTRAL_SIGNATURE = 0x02014b50
const ZIP_END_SIGNATURE = 0x06054b50

const forbiddenElements = ['script', 'iframe', 'object', 'embed', 'base', 'form', 'input', 'textarea', 'select', 'meta']
const mimeTypes: Record<string, string> = {
  css: 'text/css',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  otf: 'font/otf',
  png: 'image/png',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

interface ArchiveEntry {
  bytes: Uint8Array
  mimeType: string
  path: string
  text: string | null
}

export interface HtmlPackage {
  entryPath: string | null
  source: string
  sourceName: string
  render: (source?: string) => PreparedHtmlDocument
  dispose: () => void
}

export interface PreparedHtmlDocument {
  html: string
  warnings: string[]
}

interface PackageOptions {
  createObjectUrl?: (blob: Blob) => string
  revokeObjectUrl?: (url: string) => void
}

interface CentralEntry {
  encrypted: boolean
  isDirectory: boolean
  isSymlink: boolean
  name: string
  uncompressedSize: number
}

function extension(path: string): string {
  return /\.([^.\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
}

function mimeType(path: string): string {
  return mimeTypes[extension(path)] ?? 'application/octet-stream'
}

function normalizeArchivePath(value: string): string | null {
  const source = value.replaceAll('\\', '/')
  if (!source || source.startsWith('/') || /^[a-z]:/i.test(source)) return null
  const parts = source.split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') return null
    normalized.push(part)
  }
  return normalized.join('/') || null
}

function centralEntries(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const entries: CentralEntry[] = []
  let endOffset = -1
  const endSearchStart = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= endSearchStart; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_SIGNATURE) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new Error('资源包缺少有效的 ZIP 中央目录')
  const diskNumber = view.getUint16(endOffset + 4, true)
  const centralDisk = view.getUint16(endOffset + 6, true)
  const diskEntryCount = view.getUint16(endOffset + 8, true)
  const entryCount = view.getUint16(endOffset + 10, true)
  const centralSize = view.getUint32(endOffset + 12, true)
  const centralOffset = view.getUint32(endOffset + 16, true)
  const commentLength = view.getUint16(endOffset + 20, true)
  if (endOffset + 22 + commentLength !== bytes.byteLength || diskNumber || centralDisk || diskEntryCount !== entryCount) {
    throw new Error('不支持分卷或损坏的 ZIP 资源包')
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('暂不支持 ZIP64 资源包')
  }
  if (centralOffset + centralSize > endOffset) throw new Error('ZIP 中央目录范围无效')
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error('ZIP 中央目录条目无效')
    }
    const madeBy = view.getUint16(offset + 4, true)
    const flags = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const externalAttributes = view.getUint32(offset + 38, true)
    const end = offset + 46 + nameLength + extraLength + commentLength
    if (end > bytes.byteLength || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('暂不支持 ZIP64 或损坏的资源包')
    }
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
    let name: string
    try {
      name = decoder.decode(nameBytes)
    } catch {
      throw new Error('资源包文件名必须使用 UTF-8 编码')
    }
    const unixMode = (externalAttributes >>> 16) & 0xffff
    const platform = madeBy >>> 8
    entries.push({
      encrypted: (flags & 1) !== 0,
      isDirectory: name.endsWith('/'),
      isSymlink: platform === 3 && (unixMode & 0xf000) === 0xa000,
      name,
      uncompressedSize,
    })
    offset = end
  }
  if (offset !== centralOffset + centralSize) throw new Error('ZIP 中央目录大小不匹配')
  if (!entries.length) throw new Error('资源包中没有可读取的 ZIP 条目')
  return entries
}

function validateCentralEntries(entries: CentralEntry[]): Map<string, CentralEntry> {
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`资源包最多允许 ${MAX_ARCHIVE_ENTRIES} 个条目`)
  const normalized = new Map<string, CentralEntry>()
  let expandedBytes = 0
  for (const entry of entries) {
    if (entry.encrypted) throw new Error('不支持加密 ZIP 资源包')
    if (entry.isSymlink) throw new Error('资源包不能包含符号链接')
    const path = normalizeArchivePath(entry.name)
    if (!path && !entry.isDirectory) throw new Error(`资源包路径无效：${entry.name}`)
    if (entry.isDirectory) continue
    if (!path) continue
    if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`资源文件过大：${path}`)
    expandedBytes += entry.uncompressedSize
    if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error('资源包解压后不能超过 200 MiB')
    const key = path.toLocaleLowerCase()
    if (normalized.has(key)) throw new Error(`资源包包含重复路径：${path}`)
    normalized.set(key, { ...entry, name: path })
  }
  return normalized
}

function resolveLocalPath(reference: string, basePath: string): string | null {
  const source = reference.trim()
  if (!source || source.startsWith('#') || /^data:/i.test(source)) return source
  if (/^(?:https?|file|blob|javascript|vbscript):/i.test(source) || source.startsWith('//')) return null
  try {
    const base = new URL(`https://kaitools.local/${basePath}`)
    const resolved = new URL(source, base)
    if (resolved.origin !== base.origin) return null
    return normalizeArchivePath(decodeURIComponent(resolved.pathname.slice(1)))
  } catch {
    return null
  }
}

function safeLink(value: string): string | null {
  try {
    const resolved = new URL(value)
    return resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.href : null
  } catch {
    return null
  }
}

function srcsetParts(value: string): Array<{ descriptor: string; source: string }> {
  return value.split(',').map((part) => {
    const [source = '', ...descriptor] = part.trim().split(/\s+/)
    return { source, descriptor: descriptor.join(' ') }
  }).filter((part) => part.source)
}

function createPackage(
  source: string,
  sourceName: string,
  entryPath: string | null,
  entries: Map<string, ArchiveEntry>,
  options: PackageOptions,
): HtmlPackage {
  const createdUrls = new Set<string>()
  const assetUrls = new Map<string, string>()
  const cssUrls = new Map<string, string>()
  const cssProcessing = new Set<string>()
  const createObjectUrl = options.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob))
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url))

  function remember(blob: Blob): string {
    const url = createObjectUrl(blob)
    createdUrls.add(url)
    return url
  }

  function entryFor(path: string): ArchiveEntry | null {
    return entries.get(path.toLocaleLowerCase()) ?? null
  }

  function assetUrl(reference: string, basePath: string, warnings: Set<string>): string {
    if (reference.startsWith('#') || /^data:/i.test(reference)) return reference
    const path = resolveLocalPath(reference, basePath)
    if (!path) {
      warnings.add(`已阻止外部资源：${reference}`)
      return 'data:application/octet-stream;base64,'
    }
    const entry = entryFor(path)
    if (!entry) {
      warnings.add(`资源包中未找到：${path}`)
      return 'data:application/octet-stream;base64,'
    }
    if (entry.mimeType === 'text/css') return cssUrl(entry, warnings)
    const cached = assetUrls.get(path)
    if (cached) return cached
    const url = remember(new Blob([entry.bytes as BlobPart], { type: entry.mimeType }))
    assetUrls.set(path, url)
    return url
  }

  function rewriteCss(css: string, basePath: string, warnings: Set<string>, context: 'stylesheet' | 'declarationList' = 'stylesheet'): string {
    try {
      const ast = csstree.parse(css, { context })
      csstree.walk(ast, {
        visit: 'Url',
        enter(node) {
          node.value = assetUrl(node.value, basePath, warnings)
        },
      })
      if (context === 'stylesheet') {
        csstree.walk(ast, {
          visit: 'Atrule',
          enter(node) {
            if (node.name.toLowerCase() !== 'import' || !node.prelude) return
            csstree.walk(node.prelude, {
              visit: 'String',
              enter(stringNode) {
                stringNode.value = assetUrl(stringNode.value, basePath, warnings)
              },
            })
          },
        })
      }
      return csstree.generate(ast)
    } catch {
      warnings.add('已移除无法解析的 CSS 片段')
      return ''
    }
  }

  function cssUrl(entry: ArchiveEntry, warnings: Set<string>): string {
    const cached = cssUrls.get(entry.path)
    if (cached) return cached
    if (cssProcessing.has(entry.path)) {
      warnings.add(`已忽略循环 CSS 引用：${entry.path}`)
      return 'data:text/css,'
    }
    cssProcessing.add(entry.path)
    const processed = rewriteCss(entry.text ?? '', entry.path, warnings)
    const url = remember(new Blob([processed], { type: 'text/css' }))
    cssProcessing.delete(entry.path)
    cssUrls.set(entry.path, url)
    return url
  }

  function render(value = source): PreparedHtmlDocument {
    const warnings = new Set<string>()
    const sanitized = DOMPurify.sanitize(value, {
      WHOLE_DOCUMENT: true,
      ADD_ATTR: ['href', 'rel'],
      ADD_TAGS: ['link', 'style'],
      FORBID_TAGS: forbiddenElements,
      FORBID_ATTR: ['srcdoc'],
      SANITIZE_DOM: false,
    })
    const documentValue = new DOMParser().parseFromString(sanitized, 'text/html')
    const basePath = entryPath ?? 'document.html'

    documentValue.querySelectorAll<HTMLLinkElement>('link').forEach((link) => {
      if (link.rel.toLowerCase() !== 'stylesheet') {
        link.remove()
        return
      }
      const path = resolveLocalPath(link.getAttribute('href') ?? '', basePath)
      const entry = path ? entryFor(path) : null
      if (!entry || entry.mimeType !== 'text/css') {
        warnings.add(`已移除不可用的样式表：${link.getAttribute('href') ?? ''}`)
        link.remove()
        return
      }
      link.href = cssUrl(entry, warnings)
    })

    documentValue.querySelectorAll<HTMLStyleElement>('style').forEach((style) => {
      style.textContent = rewriteCss(style.textContent ?? '', basePath, warnings)
    })
    documentValue.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
      const value = rewriteCss(element.getAttribute('style') ?? '', basePath, warnings, 'declarationList')
      if (value) element.setAttribute('style', value)
      else element.removeAttribute('style')
    })

    const resourceAttributes = ['src', 'poster'] as const
    documentValue.querySelectorAll<HTMLElement>('*').forEach((element) => {
      for (const attribute of resourceAttributes) {
        const current = element.getAttribute(attribute)
        if (current) element.setAttribute(attribute, assetUrl(current, basePath, warnings))
      }
      const srcset = element.getAttribute('srcset')
      if (srcset) {
        element.setAttribute('srcset', srcsetParts(srcset).map((part) => {
          const resolved = assetUrl(part.source, basePath, warnings)
          return `${resolved}${part.descriptor ? ` ${part.descriptor}` : ''}`
        }).join(', '))
      }
      for (const attribute of ['href', 'data-pdf-link']) {
        const current = element.getAttribute(attribute)
        if (!current) continue
        if (current.startsWith('#')) continue
        const link = safeLink(current)
        if (element instanceof HTMLAnchorElement || attribute === 'data-pdf-link') {
          if (link) element.setAttribute(attribute, link)
          else element.removeAttribute(attribute)
        }
      }
    })

    const csp = documentValue.createElement('meta')
    csp.httpEquiv = 'Content-Security-Policy'
    csp.content = "default-src 'none'; img-src blob: data:; media-src blob: data:; font-src blob: data:; style-src 'unsafe-inline' blob:;"
    documentValue.head.prepend(csp)
    const viewport = documentValue.createElement('meta')
    viewport.name = 'viewport'
    viewport.content = 'width=device-width, initial-scale=1'
    documentValue.head.prepend(viewport)
    if (!documentValue.querySelector('style[data-kaitools-document-base]')) {
      const baseStyle = documentValue.createElement('style')
      baseStyle.dataset.kaitoolsDocumentBase = ''
      baseStyle.textContent = ':root{color-scheme:light}html{background:#f0f3f5}body{min-width:0;margin:0;background:#fff;color:#17212b}*,*::before,*::after{box-sizing:border-box}img,svg,canvas{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}pre{overflow-wrap:anywhere;white-space:pre-wrap}'
      documentValue.head.append(baseStyle)
    }
    return {
      html: `<!doctype html>${documentValue.documentElement.outerHTML}`,
      warnings: [...warnings],
    }
  }

  return {
    entryPath,
    source,
    sourceName,
    render,
    dispose() {
      for (const url of createdUrls) revokeObjectUrl(url)
      createdUrls.clear()
      assetUrls.clear()
      cssUrls.clear()
    },
  }
}

export function createStandaloneHtmlPackage(source: string, sourceName = 'document.html', options: PackageOptions = {}): HtmlPackage {
  return createPackage(source, sourceName, null, new Map(), options)
}

export async function loadHtmlPackage(file: File, options: PackageOptions = {}): Promise<HtmlPackage> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('HTML 或 ZIP 文件不能超过 50 MiB')
  if (!['zip', 'html', 'htm'].includes(extension(file.name))) throw new Error('仅支持 HTML、HTM 或 ZIP 资源包')
  if (extension(file.name) !== 'zip') {
    return createStandaloneHtmlPackage(await file.text(), file.name, options)
  }

  const archiveBytes = new Uint8Array(await file.arrayBuffer())
  const central = validateCentralEntries(centralEntries(archiveBytes))
  const zip = await JSZip.loadAsync(archiveBytes, { checkCRC32: true, createFolders: false })
  const entries = new Map<string, ArchiveEntry>()
  for (const expected of central.values()) {
    const zipEntry = zip.file(expected.name)
    if (!zipEntry || zipEntry.dir) throw new Error(`无法读取资源文件：${expected.name}`)
    const bytes = await zipEntry.async('uint8array')
    if (bytes.byteLength !== expected.uncompressedSize) throw new Error(`资源文件大小校验失败：${expected.name}`)
    const type = mimeType(expected.name)
    entries.set(expected.name.toLocaleLowerCase(), {
      bytes,
      mimeType: type,
      path: expected.name,
      text: type === 'text/css' || ['html', 'htm'].includes(extension(expected.name))
        ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        : null,
    })
  }

  const htmlEntries = [...entries.values()].filter((entry) => ['html', 'htm'].includes(extension(entry.path)))
  const rootIndex = htmlEntries.find((entry) => entry.path.toLocaleLowerCase() === 'index.html')
  const selected = rootIndex ?? (htmlEntries.length === 1 ? htmlEntries[0] : null)
  if (!selected) {
    if (!htmlEntries.length) throw new Error('资源包必须包含 index.html 或一个 HTML 文件')
    throw new Error('资源包包含多个 HTML，请在根目录提供 index.html')
  }
  return createPackage(selected.text ?? '', file.name, selected.path, entries, options)
}
