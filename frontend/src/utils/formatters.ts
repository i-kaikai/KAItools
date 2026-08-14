import { format as formatSqlSource, type FormatOptionsWithLanguage } from 'sql-formatter'
import { parseDocument } from 'yaml'

export type SqlDialect = FormatOptionsWithLanguage['language']

export function formatSql(
  value: string,
  language: SqlDialect,
  keywordCase: 'upper' | 'lower' | 'preserve',
  tabWidth: number,
): string {
  if (!value.trim()) return ''
  try {
    return formatSqlSource(value, { language, keywordCase, tabWidth, linesBetweenQueries: 1 })
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'SQL 格式化失败')
  }
}

export function formatYaml(value: string, indent: number): string {
  if (!value.trim()) return ''
  const document = parseDocument(value, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length) throw new Error(document.errors[0]?.message ?? 'YAML 无效')
  return document.toString({ indent, lineWidth: 0 })
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function serializeXmlNode(node: Node, level: number, indent: string): string {
  const padding = indent.repeat(level)
  if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) return `${padding}<?${node.nodeName} ${node.nodeValue ?? ''}?>`
  if (node.nodeType === Node.COMMENT_NODE) return `${padding}<!--${node.nodeValue ?? ''}-->`
  if (node.nodeType === Node.TEXT_NODE) return `${padding}${escapeXmlText(node.nodeValue ?? '')}`
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as Element
  const attributes = Array.from(element.attributes)
    .map((attribute) => ` ${attribute.name}="${attribute.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
    .join('')
  const children = Array.from(element.childNodes).filter(
    (child) => child.nodeType !== Node.TEXT_NODE || Boolean(child.nodeValue?.trim()),
  )
  if (!children.length) return `${padding}<${element.tagName}${attributes}/>`
  if (children.length === 1 && children[0]?.nodeType === Node.TEXT_NODE) {
    return `${padding}<${element.tagName}${attributes}>${escapeXmlText(children[0].nodeValue ?? '')}</${element.tagName}>`
  }
  const content = children.map((child) => serializeXmlNode(child, level + 1, indent)).filter(Boolean).join('\n')
  return `${padding}<${element.tagName}${attributes}>\n${content}\n${padding}</${element.tagName}>`
}

export function formatXml(value: string, indentSize: number, compact = false): string {
  if (!value.trim()) return ''
  const document = new DOMParser().parseFromString(value, 'application/xml')
  const parserError = document.querySelector('parsererror')
  if (parserError) throw new Error(parserError.textContent?.replace(/\s+/g, ' ').trim() || 'XML 无效')
  if (compact) return new XMLSerializer().serializeToString(document).replace(/>\s+</g, '><').trim()
  const indent = ' '.repeat(indentSize)
  return Array.from(document.childNodes)
    .map((node) => serializeXmlNode(node, 0, indent))
    .filter(Boolean)
    .join('\n')
}
