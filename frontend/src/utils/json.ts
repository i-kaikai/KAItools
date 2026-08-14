import {
  applyEdits,
  createScanner,
  format,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from 'jsonc-parser'

export interface JsonIssue {
  message: string
  offset: number
  length: number
  line: number
  column: number
}

export interface JsonTreeItem {
  id: string
  key: string
  path: string
  type: Node['type']
  valueText: string
  children: JsonTreeItem[]
}

export interface JsonDocument {
  root: Node | undefined
  issues: JsonIssue[]
  tree: JsonTreeItem | null
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset)
  const lines = before.split('\n')
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

function issue(text: string, error: ParseError): JsonIssue {
  const position = lineColumn(text, error.offset)
  const errorName = printParseErrorCode(error.error)
  const messages: Record<string, string> = {
    InvalidSymbol: '存在无效符号',
    InvalidNumberFormat: '数字格式无效',
    PropertyNameExpected: '缺少属性名称',
    ValueExpected: '缺少值',
    ColonExpected: '缺少冒号',
    CommaExpected: '缺少逗号',
    CloseBraceExpected: '缺少右花括号',
    CloseBracketExpected: '缺少右方括号',
    EndOfFileExpected: 'JSON 结束后存在多余内容',
    InvalidCommentToken: '严格 JSON 不允许注释',
    UnexpectedEndOfComment: '注释未结束',
    UnexpectedEndOfString: '字符串未结束',
    UnexpectedEndOfNumber: '数字未结束',
    InvalidUnicode: 'Unicode 转义无效',
    InvalidEscapeCharacter: '转义字符无效',
    InvalidCharacter: '字符无效',
  }
  return {
    message: messages[errorName] ?? errorName,
    offset: error.offset,
    length: error.length,
    ...position,
  }
}

function valueText(text: string, node: Node): string {
  if (node.type === 'string') return JSON.stringify(node.value)
  if (node.type === 'number' || node.type === 'boolean' || node.type === 'null') {
    return text.slice(node.offset, node.offset + node.length)
  }
  return ''
}

function pathKey(parent: string, key: string, arrayIndex: boolean): string {
  if (arrayIndex) return `${parent}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`
}

function buildTree(text: string, node: Node, key = '$', path = '$'): JsonTreeItem {
  const children: JsonTreeItem[] = []
  if (node.type === 'object') {
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0]
      const valueNode = property.children?.[1]
      if (!keyNode || !valueNode) continue
      const propertyKey = String(keyNode.value)
      children.push(buildTree(text, valueNode, propertyKey, pathKey(path, propertyKey, false)))
    }
  } else if (node.type === 'array') {
    for (const [index, child] of (node.children ?? []).entries()) {
      children.push(buildTree(text, child, String(index), pathKey(path, String(index), true)))
    }
  }
  return {
    id: `${node.offset}:${node.length}:${path}`,
    key,
    path,
    type: node.type,
    valueText: valueText(text, node),
    children,
  }
}

export function parseJsonDocument(text: string): JsonDocument {
  if (!text.trim()) return { root: undefined, issues: [], tree: null }
  const errors: ParseError[] = []
  const root = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true })
  const issues = errors.map((error) => issue(text, error))
  return { root, issues, tree: root && !issues.length ? buildTree(text, root) : null }
}

export function formatJson(text: string, indent: 2 | 4): string {
  const document = parseJsonDocument(text)
  if (!document.root || document.issues.length) {
    throw new Error(document.issues[0]?.message ?? '请输入有效 JSON')
  }
  return applyEdits(
    text,
    format(text, undefined, {
      insertSpaces: true,
      tabSize: indent,
      eol: '\n',
      keepLines: false,
    }),
  )
}

export function minifyJson(text: string): string {
  const document = parseJsonDocument(text)
  if (!document.root || document.issues.length) {
    throw new Error(document.issues[0]?.message ?? '请输入有效 JSON')
  }
  const scanner = createScanner(text, false)
  const parts: string[] = []
  const tokenLineBreak = 14
  const tokenTrivia = 15
  const tokenEof = 17
  while (true) {
    const token = scanner.scan()
    if (token === tokenEof) break
    if (token === tokenTrivia || token === tokenLineBreak) continue
    parts.push(text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()))
  }
  return parts.join('')
}
