import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { createStandaloneHtmlPackage, loadHtmlPackage } from '@/utils/documentPackage'

function objectUrlHarness(): {
  blobs: Blob[]
  createObjectUrl: (blob: Blob) => string
  revoked: string[]
  revokeObjectUrl: (url: string) => void
} {
  const blobs: Blob[] = []
  const revoked: string[] = []
  return {
    blobs,
    revoked,
    createObjectUrl(blob) {
      blobs.push(blob)
      return `blob:kaitools-${blobs.length}`
    },
    revokeObjectUrl(url) {
      revoked.push(url)
    },
  }
}

describe('HTML document packages', () => {
  it('preserves head and inline styles while blocking remote resources and active content', () => {
    const source = `<!doctype html><html><head>
      <style>#title { color: rgb(255, 0, 0); background: url(https://example.com/tracker.png) }</style>
      <link rel="stylesheet" href="https://example.com/site.css">
      <script>window.pwned = true</script>
    </head><body>
      <h1 id="title" style="font-size: 41px">Title</h1>
      <img src="https://example.com/image.png" onerror="window.pwned = true">
      <a href="https://example.com/read">Read</a>
    </body></html>`
    const packageValue = createStandaloneHtmlPackage(source)
    const prepared = packageValue.render()
    const documentValue = new DOMParser().parseFromString(prepared.html, 'text/html')

    expect(documentValue.querySelector('script')).toBeNull()
    expect(documentValue.querySelector('#title')?.getAttribute('style')).toContain('font-size:41px')
    expect(documentValue.querySelector('style')?.textContent).toContain('color:rgb(255,0,0)')
    expect(documentValue.querySelector('style')?.textContent).not.toContain('https://example.com/tracker.png')
    expect(documentValue.querySelector('link')).toBeNull()
    expect(documentValue.querySelector('img')?.getAttribute('src')).toBe('data:application/octet-stream;base64,')
    expect(documentValue.querySelector('a')?.getAttribute('href')).toBe('https://example.com/read')
    expect(prepared.warnings).toContain('已阻止外部资源：https://example.com/tracker.png')
    expect(prepared.warnings).toContain('已移除不可用的样式表：https://example.com/site.css')
  })

  it('loads a local ZIP package and rewrites nested CSS, image and font references', async () => {
    const zip = new JSZip()
    zip.file('index.html', '<!doctype html><html><head><link rel="stylesheet" href="assets/main.css"></head><body><img src="assets/logo.png"><h1>Title</h1></body></html>')
    zip.file('assets/main.css', '@import "nested.css"; h1 { background: url(logo.png); font-family: Local; }')
    zip.file('assets/nested.css', '@font-face { font-family: Local; src: url(font.woff2) }')
    zip.file('assets/logo.png', new Uint8Array([137, 80, 78, 71]))
    zip.file('assets/font.woff2', new Uint8Array([119, 79, 70, 50]))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const harness = objectUrlHarness()

    const packageValue = await loadHtmlPackage(new File([bytes as BlobPart], 'site.zip', { type: 'application/zip' }), harness)
    const prepared = packageValue.render()
    const documentValue = new DOMParser().parseFromString(prepared.html, 'text/html')

    expect(packageValue.entryPath).toBe('index.html')
    expect(documentValue.querySelector('link')?.getAttribute('href')).toMatch(/^blob:kaitools-/)
    expect(documentValue.querySelector('img')?.getAttribute('src')).toMatch(/^blob:kaitools-/)
    const css = await Promise.all(harness.blobs.filter((blob) => blob.type === 'text/css').map((blob) => blob.text()))
    expect(css.join('\n')).toContain('blob:kaitools-')
    expect(css.join('\n')).not.toContain('assets/')
    expect(prepared.warnings).toEqual([])

    packageValue.dispose()
    expect(harness.revoked).toHaveLength(harness.blobs.length)
  })

  it('requires an unambiguous HTML entry and rejects escaping paths', async () => {
    const ambiguous = new JSZip()
    ambiguous.file('one.html', '<p>one</p>')
    ambiguous.file('two.html', '<p>two</p>')
    const ambiguousBytes = await ambiguous.generateAsync({ type: 'uint8array' })
    await expect(loadHtmlPackage(new File([ambiguousBytes as BlobPart], 'ambiguous.zip'))).rejects.toThrow('多个 HTML')

    const escaping = new JSZip()
    escaping.file('index.html', '<p>safe</p>')
    escaping.file('../outside.css', 'body { color: red }')
    const escapingBytes = await escaping.generateAsync({ type: 'uint8array' })
    await expect(loadHtmlPackage(new File([escapingBytes as BlobPart], 'escaping.zip'))).rejects.toThrow('路径无效')
  })

  it('rejects oversized standalone HTML before reading it', async () => {
    const file = { name: 'large.html', size: 50 * 1024 * 1024 + 1, text: async () => '' } as File
    await expect(loadHtmlPackage(file)).rejects.toThrow('不能超过 50 MiB')
  })

  it('rejects a ZIP with a missing central directory', async () => {
    const content = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    await expect(loadHtmlPackage(new File([content as BlobPart], 'broken.zip'))).rejects.toThrow('中央目录')
  })
})
