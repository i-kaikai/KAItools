export function markdownCardPreview(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\\\n/g, '\n')
    .replace(/[`*_~]/g, '')
    .replace(/^[ \t]{0,3}[-+][ \t]+/gm, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
