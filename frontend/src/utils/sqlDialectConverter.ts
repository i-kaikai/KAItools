import type { SqlDialect } from '@/utils/formatters'

export type SqlDatabaseDialect =
  | 'standard'
  | 'mysql'
  | 'mariadb'
  | 'postgresql'
  | 'oracle'
  | 'sqlserver'
  | 'sqlite'

export interface SqlDialectOption {
  value: SqlDatabaseDialect
  label: string
}

export interface SqlConversionResult {
  sql: string
  changes: string[]
  warnings: string[]
}

export const SQL_DIALECT_OPTIONS: SqlDialectOption[] = [
  { value: 'standard', label: '标准 SQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'sqlserver', label: 'SQL Server' },
  { value: 'sqlite', label: 'SQLite' },
]

const formatterDialect: Record<SqlDatabaseDialect, SqlDialect> = {
  standard: 'sql',
  mysql: 'mysql',
  mariadb: 'mariadb',
  postgresql: 'postgresql',
  oracle: 'plsql',
  sqlserver: 'transactsql',
  sqlite: 'sqlite',
}

const legacyDialect: Record<string, SqlDatabaseDialect> = {
  sql: 'standard',
  mysql: 'mysql',
  mariadb: 'mariadb',
  postgresql: 'postgresql',
  plsql: 'oracle',
  oracle: 'oracle',
  transactsql: 'sqlserver',
  sqlserver: 'sqlserver',
  sqlite: 'sqlite',
}

type SqlTokenKind = 'space' | 'comment' | 'string' | 'quotedIdentifier' | 'word' | 'number' | 'parameter' | 'operator' | 'symbol'
type IdentifierQuote = 'double' | 'backtick' | 'bracket'

interface SqlToken {
  kind: SqlTokenKind
  text: string
  quote?: IdentifierQuote
}

interface TypeReplacement {
  text: string
  preserveArguments?: boolean
}

class ChangeCounter {
  private readonly changes = new Map<string, number>()

  add(label: string): void {
    this.changes.set(label, (this.changes.get(label) ?? 0) + 1)
  }

  list(): string[] {
    return Array.from(this.changes, ([label, count]) => (count > 1 ? `${label} x${count}` : label))
  }
}

export function normalizeSqlDatabaseDialect(value: unknown): SqlDatabaseDialect {
  return typeof value === 'string' && legacyDialect[value] ? legacyDialect[value] : 'standard'
}

export function getSqlFormatterDialect(dialect: SqlDatabaseDialect): SqlDialect {
  return formatterDialect[dialect]
}

export function getSqlDialectLabel(dialect: SqlDatabaseDialect): string {
  return SQL_DIALECT_OPTIONS.find((option) => option.value === dialect)?.label ?? '标准 SQL'
}

function isWordStart(character: string): boolean {
  return /[A-Za-z_@$#]/.test(character)
}

function isWordPart(character: string): boolean {
  return /[A-Za-z0-9_@$#]/.test(character)
}

function readQuoted(value: string, start: number, delimiter: string): number {
  let index = start + 1
  while (index < value.length) {
    if (value[index] === '\\' && delimiter !== ']') {
      index += 2
      continue
    }
    if (value[index] === delimiter) {
      if (value[index + 1] === delimiter) {
        index += 2
        continue
      }
      return index + 1
    }
    index += 1
  }
  return value.length
}

function tokenizeSql(value: string, source: SqlDatabaseDialect): SqlToken[] {
  const tokens: SqlToken[] = []
  let index = 0
  while (index < value.length) {
    const character = value[index] ?? ''
    const next = value[index + 1] ?? ''

    if (/\s/.test(character)) {
      let end = index + 1
      while (end < value.length && /\s/.test(value[end] ?? '')) end += 1
      tokens.push({ kind: 'space', text: value.slice(index, end) })
      index = end
      continue
    }
    if ((character === '-' && next === '-') || (character === '#' && (source === 'mysql' || source === 'mariadb'))) {
      let end = value.indexOf('\n', index)
      if (end === -1) end = value.length
      tokens.push({ kind: 'comment', text: value.slice(index, end) })
      index = end
      continue
    }
    if (character === '/' && next === '*') {
      let end = index + 2
      let depth = 1
      while (end < value.length && depth > 0) {
        if (value[end] === '/' && value[end + 1] === '*') {
          depth += 1
          end += 2
        } else if (value[end] === '*' && value[end + 1] === '/') {
          depth -= 1
          end += 2
        } else {
          end += 1
        }
      }
      tokens.push({ kind: 'comment', text: value.slice(index, end) })
      index = end
      continue
    }
    if (character === "'") {
      const end = readQuoted(value, index, "'")
      tokens.push({ kind: 'string', text: value.slice(index, end) })
      index = end
      continue
    }
    if (character === '$' && (source === 'postgresql' || source === 'standard')) {
      const delimiter = value.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
      if (delimiter) {
        const closing = value.indexOf(delimiter, index + delimiter.length)
        const end = closing === -1 ? value.length : closing + delimiter.length
        tokens.push({ kind: 'string', text: value.slice(index, end) })
        index = end
        continue
      }
    }
    if (character === '"' || character === '`' || character === '[') {
      const delimiter = character === '[' ? ']' : character
      const end = readQuoted(value, index, delimiter)
      tokens.push({
        kind: 'quotedIdentifier',
        text: value.slice(index, end),
        quote: character === '"' ? 'double' : character === '`' ? 'backtick' : 'bracket',
      })
      index = end
      continue
    }
    if (character === ':' && next !== ':' && isWordStart(next)) {
      let end = index + 2
      while (end < value.length && isWordPart(value[end] ?? '')) end += 1
      tokens.push({ kind: 'parameter', text: value.slice(index, end) })
      index = end
      continue
    }
    if (character === '$' && /\d/.test(next)) {
      let end = index + 2
      while (end < value.length && /\d/.test(value[end] ?? '')) end += 1
      tokens.push({ kind: 'parameter', text: value.slice(index, end) })
      index = end
      continue
    }
    if (character === '?') {
      tokens.push({ kind: 'parameter', text: character })
      index += 1
      continue
    }
    if (isWordStart(character)) {
      let end = index + 1
      while (end < value.length && isWordPart(value[end] ?? '')) end += 1
      tokens.push({ kind: 'word', text: value.slice(index, end) })
      index = end
      continue
    }
    if (/\d/.test(character)) {
      let end = index + 1
      while (end < value.length && /\d/.test(value[end] ?? '')) end += 1
      if (value[end] === '.') {
        end += 1
        while (end < value.length && /\d/.test(value[end] ?? '')) end += 1
      }
      if ((value[end] === 'e' || value[end] === 'E') && /[\d+-]/.test(value[end + 1] ?? '')) {
        end += 1
        if (value[end] === '+' || value[end] === '-') end += 1
        while (end < value.length && /\d/.test(value[end] ?? '')) end += 1
      }
      tokens.push({ kind: 'number', text: value.slice(index, end) })
      index = end
      continue
    }
    const pair = `${character}${next}`
    if (['::', '||', '!=', '<>', '<=', '>=', ':=', '=>', '!~'].includes(pair)) {
      tokens.push({ kind: 'operator', text: pair })
      index += 2
      continue
    }
    tokens.push({ kind: /[(),.;]/.test(character) ? 'symbol' : 'operator', text: character })
    index += 1
  }
  return tokens
}

function isSignificant(token: SqlToken | undefined): token is SqlToken {
  return Boolean(token && token.text && token.kind !== 'space' && token.kind !== 'comment')
}

function nextSignificant(tokens: SqlToken[], index: number, end = tokens.length): number {
  for (let current = index + 1; current < end; current += 1) {
    if (isSignificant(tokens[current])) return current
  }
  return -1
}

function previousSignificant(tokens: SqlToken[], index: number, start = 0): number {
  for (let current = index - 1; current >= start; current -= 1) {
    if (isSignificant(tokens[current])) return current
  }
  return -1
}

function upper(token: SqlToken | undefined): string {
  return token?.kind === 'word' ? token.text.toUpperCase() : ''
}

function matchingParenthesis(tokens: SqlToken[], openIndex: number, end = tokens.length): number {
  let depth = 0
  for (let index = openIndex; index < end; index += 1) {
    if (tokens[index]?.text === '(') depth += 1
    else if (tokens[index]?.text === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function removeRange(tokens: SqlToken[], start: number, end: number): void {
  for (let index = start; index <= end; index += 1) tokens[index]!.text = ''
}

function decodeIdentifier(token: SqlToken): string {
  if (token.quote === 'bracket') return token.text.slice(1, -1).replace(/]]/g, ']')
  if (token.quote === 'backtick') return token.text.slice(1, -1).replace(/``/g, '`')
  return token.text.slice(1, -1).replace(/""/g, '"')
}

function encodeIdentifier(value: string, target: SqlDatabaseDialect): { text: string; quote: IdentifierQuote } {
  if (target === 'mysql' || target === 'mariadb') return { text: `\`${value.replace(/`/g, '``')}\``, quote: 'backtick' }
  if (target === 'sqlserver') return { text: `[${value.replace(/]/g, ']]')}]`, quote: 'bracket' }
  return { text: `"${value.replace(/"/g, '""')}"`, quote: 'double' }
}

function rewriteQuotedIdentifiers(tokens: SqlToken[], target: SqlDatabaseDialect, changes: ChangeCounter): void {
  for (const token of tokens) {
    if (token.kind !== 'quotedIdentifier') continue
    const encoded = encodeIdentifier(decodeIdentifier(token), target)
    if (encoded.text === token.text) continue
    token.text = encoded.text
    token.quote = encoded.quote
    changes.add('标识符引号')
  }
}

function targetFunctionName(name: string, target: SqlDatabaseDialect): string | undefined {
  if (['IFNULL', 'NVL', 'ISNULL'].includes(name)) {
    if (target === 'mysql' || target === 'mariadb' || target === 'sqlite') return 'IFNULL'
    if (target === 'oracle') return 'NVL'
    if (target === 'sqlserver') return 'ISNULL'
    return 'COALESCE'
  }
  if (['LEN', 'LENGTH'].includes(name)) return target === 'sqlserver' ? 'LEN' : 'LENGTH'
  if (['SUBSTR', 'SUBSTRING'].includes(name)) return target === 'oracle' || target === 'sqlite' ? 'SUBSTR' : 'SUBSTRING'
  return undefined
}

function rewriteFunctions(tokens: SqlToken[], target: SqlDatabaseDialect, changes: ChangeCounter): void {
  const temporalNames = new Set(['NOW', 'GETDATE', 'SYSDATETIME', 'SYSDATETIMEOFFSET', 'SYSDATE', 'SYSTIMESTAMP', 'CURRENT_TIMESTAMP'])
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token?.kind !== 'word') continue
    const name = upper(token)
    const open = nextSignificant(tokens, index)
    const isCall = tokens[open]?.text === '('
    if (isCall) {
      const replacement = targetFunctionName(name, target)
      if (replacement && replacement !== name) {
        token.text = replacement
        changes.add('内置函数')
      }
    }
    if (!temporalNames.has(name)) continue
    if (isCall) {
      const close = nextSignificant(tokens, open)
      if (tokens[close]?.text !== ')') continue
      removeRange(tokens, open, close)
    }
    if (token.text !== 'CURRENT_TIMESTAMP' || isCall) {
      token.text = 'CURRENT_TIMESTAMP'
      changes.add('当前时间函数')
    }
  }
}

function rewriteBooleanLiterals(tokens: SqlToken[], target: SqlDatabaseDialect, changes: ChangeCounter): void {
  if (target !== 'oracle' && target !== 'sqlserver') return
  for (const token of tokens) {
    const name = upper(token)
    if (name !== 'TRUE' && name !== 'FALSE') continue
    token.text = name === 'TRUE' ? '1' : '0'
    token.kind = 'number'
    changes.add('布尔值')
  }
}

function typeArguments(tokens: SqlToken[], typeIndex: number): { start: number; end: number; value: string } | undefined {
  const open = nextSignificant(tokens, typeIndex)
  if (tokens[open]?.text !== '(') return undefined
  const close = matchingParenthesis(tokens, open)
  if (close === -1) return undefined
  return {
    start: open,
    end: close,
    value: tokens.slice(open + 1, close).filter(isSignificant).map((token) => token.text).join('').toUpperCase(),
  }
}

function booleanType(target: SqlDatabaseDialect): string {
  if (target === 'mysql' || target === 'mariadb') return 'TINYINT(1)'
  if (target === 'oracle') return 'NUMBER(1)'
  if (target === 'sqlserver') return 'BIT'
  if (target === 'sqlite') return 'INTEGER'
  return 'BOOLEAN'
}

function targetType(name: string, args: string, target: SqlDatabaseDialect): TypeReplacement | undefined {
  const maxLength = args === 'MAX'
  if (name === 'SERIAL' || name === 'BIGSERIAL') {
    const base = name === 'BIGSERIAL' ? 'BIGINT' : 'INTEGER'
    if (target === 'postgresql') return { text: name }
    if (target === 'mysql' || target === 'mariadb') return { text: `${base} AUTO_INCREMENT` }
    if (target === 'oracle') return { text: `${name === 'BIGSERIAL' ? 'NUMBER(19)' : 'NUMBER'} GENERATED BY DEFAULT AS IDENTITY` }
    if (target === 'sqlserver') return { text: `${base} IDENTITY(1,1)` }
    if (target === 'sqlite') return { text: 'INTEGER' }
    return { text: `${base} GENERATED BY DEFAULT AS IDENTITY` }
  }
  if (['BOOLEAN', 'BOOL'].includes(name) || (name === 'TINYINT' && args === '1') || (name === 'BIT' && (!args || args === '1'))) {
    return { text: booleanType(target) }
  }
  if (['TINYINT', 'SMALLINT', 'INT', 'INTEGER', 'BIGINT'].includes(name)) {
    if (target === 'oracle') {
      const precision = name === 'BIGINT' ? 19 : name === 'INT' || name === 'INTEGER' ? 10 : name === 'SMALLINT' ? 5 : 3
      return { text: `NUMBER(${precision})` }
    }
    if (target === 'sqlite') return { text: 'INTEGER' }
    if (name === 'TINYINT' && target !== 'mysql' && target !== 'mariadb' && target !== 'sqlserver') return { text: 'SMALLINT' }
    const integerName = name === 'INT' && (target === 'postgresql' || target === 'standard') ? 'INTEGER' : name
    return { text: integerName, preserveArguments: target === 'mysql' || target === 'mariadb' }
  }
  if (['DOUBLE', 'BINARY_DOUBLE'].includes(name)) {
    if (target === 'oracle') return { text: 'BINARY_DOUBLE' }
    if (target === 'postgresql' || target === 'standard') return { text: 'DOUBLE PRECISION' }
    if (target === 'sqlserver') return { text: 'FLOAT' }
    if (target === 'sqlite') return { text: 'REAL' }
    return { text: 'DOUBLE' }
  }
  if (['UUID', 'UNIQUEIDENTIFIER'].includes(name)) {
    if (target === 'postgresql') return { text: 'UUID' }
    if (target === 'sqlserver') return { text: 'UNIQUEIDENTIFIER' }
    if (target === 'oracle') return { text: 'VARCHAR2(36)' }
    if (target === 'sqlite') return { text: 'TEXT' }
    return { text: 'CHAR(36)' }
  }
  if (['VARCHAR', 'VARCHAR2', 'NVARCHAR', 'NVARCHAR2'].includes(name)) {
    const national = name.startsWith('N')
    if (maxLength) {
      if (target === 'oracle') return { text: national ? 'NCLOB' : 'CLOB' }
      if (target === 'mysql' || target === 'mariadb') return { text: 'LONGTEXT' }
      if (target === 'sqlserver') return { text: national ? 'NVARCHAR(MAX)' : 'VARCHAR(MAX)' }
      return { text: 'TEXT' }
    }
    if (target === 'oracle') return { text: national ? 'NVARCHAR2' : 'VARCHAR2', preserveArguments: true }
    return { text: national && target === 'sqlserver' ? 'NVARCHAR' : 'VARCHAR', preserveArguments: true }
  }
  if (['TEXT', 'LONGTEXT', 'CLOB', 'NCLOB'].includes(name)) {
    if (target === 'oracle') return { text: name === 'NCLOB' ? 'NCLOB' : 'CLOB' }
    if (target === 'mysql' || target === 'mariadb') return { text: 'LONGTEXT' }
    if (target === 'sqlserver') return { text: 'NVARCHAR(MAX)' }
    return { text: 'TEXT' }
  }
  if (['BLOB', 'LONGBLOB', 'BYTEA', 'VARBINARY', 'RAW'].includes(name)) {
    if (target === 'postgresql') return { text: 'BYTEA' }
    if (target === 'sqlserver') return { text: 'VARBINARY(MAX)' }
    if (target === 'mysql' || target === 'mariadb') return { text: 'LONGBLOB' }
    return { text: 'BLOB' }
  }
  if (['DATETIME', 'DATETIME2', 'SMALLDATETIME', 'TIMESTAMP'].includes(name)) {
    if (target === 'mysql' || target === 'mariadb') return { text: name === 'TIMESTAMP' ? 'TIMESTAMP' : 'DATETIME', preserveArguments: true }
    if (target === 'sqlserver') return { text: 'DATETIME2', preserveArguments: true }
    if (target === 'sqlite') return { text: 'TEXT' }
    return { text: 'TIMESTAMP', preserveArguments: true }
  }
  if (name === 'NUMBER' || name === 'DECIMAL' || name === 'NUMERIC') {
    return { text: target === 'oracle' ? 'NUMBER' : 'DECIMAL', preserveArguments: true }
  }
  return undefined
}

function collectCreateTableTypes(tokens: SqlToken[]): Set<number> {
  const indices = new Set<number>()
  for (let index = 0; index < tokens.length; index += 1) {
    if (upper(tokens[index]) !== 'CREATE') continue
    let cursor = nextSignificant(tokens, index)
    if (upper(tokens[cursor]) === 'OR') {
      cursor = nextSignificant(tokens, cursor)
      if (upper(tokens[cursor]) === 'REPLACE') cursor = nextSignificant(tokens, cursor)
    }
    if (upper(tokens[cursor]) !== 'TABLE') continue
    while (cursor !== -1 && tokens[cursor]?.text !== '(') cursor = nextSignificant(tokens, cursor)
    if (cursor === -1) continue
    const close = matchingParenthesis(tokens, cursor)
    if (close === -1) continue
    let depth = 1
    let expectColumn = true
    let expectType = false
    let skipDefinition = false
    for (let current = cursor + 1; current < close; current += 1) {
      const token = tokens[current]
      if (token?.text === '(') {
        depth += 1
        continue
      }
      if (token?.text === ')') {
        depth -= 1
        continue
      }
      if (depth !== 1 || !isSignificant(token)) continue
      if (token.text === ',') {
        expectColumn = true
        expectType = false
        skipDefinition = false
        continue
      }
      if (skipDefinition) continue
      if (expectColumn) {
        expectColumn = false
        if (['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK'].includes(upper(token))) skipDefinition = true
        else expectType = true
        continue
      }
      if (expectType && token.kind === 'word') {
        indices.add(current)
        expectType = false
      }
    }
    index = close
  }
  return indices
}

function collectCastTypes(tokens: SqlToken[], indices: Set<number>): void {
  for (let index = 0; index < tokens.length; index += 1) {
    if (upper(tokens[index]) !== 'CAST') continue
    const open = nextSignificant(tokens, index)
    if (tokens[open]?.text !== '(') continue
    const close = matchingParenthesis(tokens, open)
    if (close === -1) continue
    let depth = 1
    for (let current = open + 1; current < close; current += 1) {
      if (tokens[current]?.text === '(') depth += 1
      else if (tokens[current]?.text === ')') depth -= 1
      else if (depth === 1 && upper(tokens[current]) === 'AS') {
        const typeIndex = nextSignificant(tokens, current, close)
        if (tokens[typeIndex]?.kind === 'word') indices.add(typeIndex)
        break
      }
    }
  }
}

function generatedIdentityStart(tokens: SqlToken[], identityIndex: number): number {
  const asIndex = previousSignificant(tokens, identityIndex)
  if (upper(tokens[asIndex]) !== 'AS') return -1
  const modeIndex = previousSignificant(tokens, asIndex)
  if (upper(tokens[modeIndex]) === 'ALWAYS') {
    const generatedIndex = previousSignificant(tokens, modeIndex)
    return upper(tokens[generatedIndex]) === 'GENERATED' ? generatedIndex : -1
  }
  if (upper(tokens[modeIndex]) !== 'DEFAULT') return -1
  const byIndex = previousSignificant(tokens, modeIndex)
  const generatedIndex = previousSignificant(tokens, byIndex)
  return upper(tokens[byIndex]) === 'BY' && upper(tokens[generatedIndex]) === 'GENERATED' ? generatedIndex : -1
}

function identityReplacement(target: SqlDatabaseDialect): string {
  if (target === 'mysql' || target === 'mariadb') return 'AUTO_INCREMENT'
  if (target === 'sqlserver') return 'IDENTITY(1,1)'
  if (target === 'sqlite') return 'AUTOINCREMENT'
  return 'GENERATED BY DEFAULT AS IDENTITY'
}

function currentColumnTypeIndex(tokens: SqlToken[], beforeIndex: number): number {
  let depth = 0
  let start = 0
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index]
    if (!isSignificant(token)) continue
    if (token.text === ')') depth += 1
    else if (token.text === '(') {
      if (depth > 0) depth -= 1
      else {
        start = index + 1
        break
      }
    } else if (depth === 0 && token.text === ',') {
      start = index + 1
      break
    }
  }
  const columnNameIndex = nextSignificant(tokens, start - 1, beforeIndex)
  return columnNameIndex === -1 ? -1 : nextSignificant(tokens, columnNameIndex, beforeIndex)
}

function followingPrimaryKey(tokens: SqlToken[], afterIndex: number): number {
  let depth = 0
  for (let index = afterIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!isSignificant(token)) continue
    if (token.text === '(') depth += 1
    else if (token.text === ')') {
      if (depth === 0) return -1
      depth -= 1
    } else if (depth === 0 && token.text === ',') return -1
    else if (depth === 0 && upper(token) === 'PRIMARY') {
      const keyIndex = nextSignificant(tokens, index)
      return upper(tokens[keyIndex]) === 'KEY' ? keyIndex : -1
    }
  }
  return -1
}

function rewriteTypes(tokens: SqlToken[], target: SqlDatabaseDialect, changes: ChangeCounter, warnings: Set<string>): void {
  const typeIndices = collectCreateTableTypes(tokens)
  collectCastTypes(tokens, typeIndices)
  for (const index of typeIndices) {
    const token = tokens[index]
    if (!token) continue
    const sourceType = upper(token)
    const precisionIndex = sourceType === 'DOUBLE' ? nextSignificant(tokens, index) : -1
    const hasDoublePrecision = precisionIndex !== -1 && upper(tokens[precisionIndex]) === 'PRECISION'
    const args = typeArguments(tokens, index)
    const replacement = targetType(sourceType, args?.value ?? '', target)
    if (!replacement) continue
    const original = `${token.text}${hasDoublePrecision ? ' PRECISION' : ''}${args ? `(${args.value})` : ''}`.toUpperCase()
    const next = replacement.preserveArguments && args ? `${replacement.text}(${args.value})` : replacement.text
    if (original === next.toUpperCase()) continue
    token.text = replacement.text
    if (hasDoublePrecision && replacement.text !== 'DOUBLE PRECISION') tokens[precisionIndex]!.text = ''
    if (args && !replacement.preserveArguments) removeRange(tokens, args.start, args.end)
    changes.add('数据类型')
    if (sourceType === 'SERIAL' || sourceType === 'BIGSERIAL') changes.add('自增语法')
    if ((upper(token) === 'INTEGER' && target === 'sqlite') || replacement.text === 'INTEGER') {
      const originalType = original.replace(/\(.*/, '')
      if (originalType === 'SERIAL' || originalType === 'BIGSERIAL') warnings.add('SQLite 自增列必须同时是 INTEGER PRIMARY KEY，请确认主键约束')
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const name = upper(tokens[index])
    if (name !== 'AUTO_INCREMENT' && name !== 'IDENTITY' && name !== 'AUTOINCREMENT') continue
    const standardStart = name === 'IDENTITY' ? generatedIdentityStart(tokens, index) : -1
    const identityArgs = name === 'IDENTITY' ? typeArguments(tokens, index) : undefined
    if ((target === 'standard' || target === 'postgresql' || target === 'oracle') && standardStart !== -1) continue
    if ((target === 'mysql' || target === 'mariadb') && name === 'AUTO_INCREMENT') continue
    if (target === 'sqlserver' && name === 'IDENTITY' && standardStart === -1) continue
    if (target === 'sqlite' && name === 'AUTOINCREMENT') continue

    const replacement = identityReplacement(target)
    const sourceStart = standardStart === -1 ? index : standardStart
    const sourceEnd = identityArgs?.end ?? index
    if (target === 'sqlite') {
      const typeIndex = currentColumnTypeIndex(tokens, sourceStart)
      if (typeIndex !== -1) {
        const args = typeArguments(tokens, typeIndex)
        tokens[typeIndex]!.text = 'INTEGER'
        if (args) removeRange(tokens, args.start, args.end)
      }
      const primaryKeyIndex = followingPrimaryKey(tokens, sourceEnd)
      removeRange(tokens, sourceStart, sourceEnd)
      if (primaryKeyIndex === -1) warnings.add('SQLite 自增列必须同时是 INTEGER PRIMARY KEY；未自动增加主键约束')
      else tokens[primaryKeyIndex]!.text = `${tokens[primaryKeyIndex]!.text} AUTOINCREMENT`
      changes.add('自增语法')
      continue
    }

    const keyIndex = name === 'AUTOINCREMENT' ? previousSignificant(tokens, index) : -1
    const primaryIndex = upper(tokens[keyIndex]) === 'KEY' ? previousSignificant(tokens, keyIndex) : -1
    if (name === 'AUTOINCREMENT' && upper(tokens[primaryIndex]) === 'PRIMARY') {
      tokens[primaryIndex]!.text = `${replacement} ${tokens[primaryIndex]!.text}`
      tokens[index]!.text = ''
    } else {
      tokens[sourceStart]!.text = replacement
      if (sourceStart < index) removeRange(tokens, sourceStart + 1, index)
    }
    if (identityArgs) removeRange(tokens, identityArgs.start, identityArgs.end)
    changes.add('自增语法')
  }
}

function statementRanges(tokens: SqlToken[]): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let start = 0
  let depth = 0
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isSignificant(tokens[index])) continue
    if (tokens[index]?.text === '(') depth += 1
    else if (tokens[index]?.text === ')') depth = Math.max(0, depth - 1)
    else if (tokens[index]?.text === ';' && depth === 0) {
      ranges.push({ start, end: index })
      start = index + 1
    }
  }
  if (start < tokens.length) ranges.push({ start, end: tokens.length })
  return ranges
}

function topLevelIndices(tokens: SqlToken[], start: number, end: number): number[] {
  const indices: number[] = []
  let depth = 0
  for (let index = start; index < end; index += 1) {
    const token = tokens[index]
    if (!isSignificant(token)) continue
    if (token.text === '(') depth += 1
    else if (token.text === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0) indices.push(index)
  }
  return indices
}

function isPaginationValue(token: SqlToken | undefined): boolean {
  return Boolean(token && ['word', 'number', 'parameter'].includes(token.kind))
}

function appendClause(tokens: SqlToken[], start: number, end: number, clause: string): void {
  const last = previousSignificant(tokens, end, start)
  if (last !== -1) tokens[last]!.text = `${tokens[last]!.text} ${clause}`
}

function rewritePaginationStatement(
  tokens: SqlToken[],
  start: number,
  end: number,
  target: SqlDatabaseDialect,
  changes: ChangeCounter,
  warnings: Set<string>,
): void {
  const top = topLevelIndices(tokens, start, end)
  const topIndex = (position: number): number | undefined => top[position]
  const topToken = (position: number): SqlToken | undefined => {
    const index = topIndex(position)
    return index === undefined ? undefined : tokens[index]
  }
  const selectPosition = top.findIndex((index) => upper(tokens[index]) === 'SELECT')
  if (selectPosition === -1) return
  let count: string | undefined
  let offset: string | undefined
  let sourceKind: 'top' | 'limit' | 'fetch' | undefined

  let cursor = selectPosition + 1
  if (['ALL', 'DISTINCT'].includes(upper(topToken(cursor)))) cursor += 1
  const sourceTopIndex = topIndex(cursor)
  if (sourceTopIndex !== undefined && upper(tokens[sourceTopIndex]) === 'TOP') {
    const afterTop = nextSignificant(tokens, sourceTopIndex, end)
    let valueIndex = afterTop
    let rangeEnd = afterTop
    if (tokens[afterTop]?.text === '(') {
      valueIndex = nextSignificant(tokens, afterTop, end)
      const close = nextSignificant(tokens, valueIndex, end)
      if (isPaginationValue(tokens[valueIndex]) && tokens[close]?.text === ')') rangeEnd = close
      else valueIndex = -1
    }
    if (isPaginationValue(tokens[valueIndex])) count = tokens[valueIndex]!.text
    const modifierIndex = rangeEnd === -1 ? -1 : nextSignificant(tokens, rangeEnd, end)
    const modifier = upper(tokens[modifierIndex])
    if (count && modifier !== 'PERCENT' && modifier !== 'WITH') {
      removeRange(tokens, sourceTopIndex, rangeEnd)
      sourceKind = 'top'
    } else if (count) {
      warnings.add('TOP PERCENT/WITH TIES 无法可靠转换，已保留原语法')
      count = undefined
    }
  }

  const limitPosition = top.findIndex((index) => upper(tokens[index]) === 'LIMIT')
  if (!sourceKind && limitPosition !== -1) {
    const limitIndex = topIndex(limitPosition)
    const firstIndex = topIndex(limitPosition + 1)
    if (limitIndex !== undefined && firstIndex !== undefined && isPaginationValue(tokens[firstIndex])) {
      const first = tokens[firstIndex]!.text
      let rangeEnd = firstIndex
      const separatorIndex = topIndex(limitPosition + 2)
      const secondIndex = topIndex(limitPosition + 3)
      if (separatorIndex !== undefined && secondIndex !== undefined && tokens[separatorIndex]?.text === ',' && isPaginationValue(tokens[secondIndex])) {
        offset = first
        count = tokens[secondIndex]!.text
        rangeEnd = secondIndex
      } else {
        count = first
        if (separatorIndex !== undefined && secondIndex !== undefined && upper(tokens[separatorIndex]) === 'OFFSET' && isPaginationValue(tokens[secondIndex])) {
          offset = tokens[secondIndex]!.text
          rangeEnd = secondIndex
        }
      }
      if (count?.toUpperCase() === 'ALL') count = undefined
      removeRange(tokens, limitIndex, rangeEnd)
      sourceKind = 'limit'
    }
  }

  const offsetPosition = top.findIndex((index) => upper(tokens[index]) === 'OFFSET')
  const fetchPosition = top.findIndex((index) => upper(tokens[index]) === 'FETCH')
  const offsetIndex = topIndex(offsetPosition)
  const offsetValueIndex = topIndex(offsetPosition + 1)
  const fetchModeIndex = topIndex(fetchPosition + 1)
  const fetchValueIndex = topIndex(fetchPosition + 2)
  if (!sourceKind && offsetPosition !== -1 && offsetIndex !== undefined && offsetValueIndex !== undefined && isPaginationValue(tokens[offsetValueIndex])) {
    offset = tokens[offsetValueIndex]!.text
    let rangeEnd = offsetValueIndex
    const rowsIndex = topIndex(offsetPosition + 2)
    if (rowsIndex !== undefined && ['ROW', 'ROWS'].includes(upper(tokens[rowsIndex]))) rangeEnd = rowsIndex
    if (fetchPosition > offsetPosition && fetchModeIndex !== undefined && fetchValueIndex !== undefined && ['FIRST', 'NEXT'].includes(upper(tokens[fetchModeIndex])) && isPaginationValue(tokens[fetchValueIndex])) {
      count = tokens[fetchValueIndex]!.text
      const onlyPosition = top.findIndex((index, position) => position > fetchPosition && upper(tokens[index]) === 'ONLY')
      rangeEnd = onlyPosition === -1 ? fetchValueIndex : (topIndex(onlyPosition) ?? fetchValueIndex)
    }
    removeRange(tokens, offsetIndex, rangeEnd)
    sourceKind = 'fetch'
  } else if (!sourceKind && fetchPosition !== -1 && fetchModeIndex !== undefined && fetchValueIndex !== undefined && ['FIRST', 'NEXT'].includes(upper(tokens[fetchModeIndex])) && isPaginationValue(tokens[fetchValueIndex])) {
    count = tokens[fetchValueIndex]!.text
    const onlyPosition = top.findIndex((index, position) => position > fetchPosition && upper(tokens[index]) === 'ONLY')
    const sourceFetchIndex = topIndex(fetchPosition)
    if (sourceFetchIndex !== undefined) {
      removeRange(tokens, sourceFetchIndex, onlyPosition === -1 ? fetchValueIndex : (topIndex(onlyPosition) ?? fetchValueIndex))
      sourceKind = 'fetch'
    }
  }

  if (!sourceKind) return
  if (!count && !offset) {
    changes.add('分页语法')
    return
  }
  const zeroOffset = !offset || /^0+$/.test(offset)
  if (target === 'sqlserver' && count && zeroOffset) {
    const distinctIndex = topIndex(selectPosition + 1)
    const selectIndex = topIndex(selectPosition)
    const insertionIndex = distinctIndex !== undefined && ['ALL', 'DISTINCT'].includes(upper(tokens[distinctIndex])) ? distinctIndex : selectIndex
    if (insertionIndex !== undefined) tokens[insertionIndex]!.text = `${tokens[insertionIndex]!.text} TOP (${count})`
  } else if (target === 'sqlserver') {
    const hasOrderBy = top.some((index, position) => upper(tokens[index]) === 'ORDER' && upper(topToken(position + 1)) === 'BY')
    const clauses: string[] = []
    if (!hasOrderBy) {
      clauses.push('ORDER BY (SELECT NULL)')
      warnings.add('SQL Server OFFSET 必须包含 ORDER BY；已补占位排序，请替换为稳定排序列')
    }
    clauses.push(`OFFSET ${offset ?? '0'} ROWS`)
    if (count) clauses.push(`FETCH NEXT ${count} ROWS ONLY`)
    appendClause(tokens, start, end, clauses.join(' '))
  } else if (target === 'oracle' || target === 'standard') {
    const clauses: string[] = []
    if (!zeroOffset) clauses.push(`OFFSET ${offset} ROWS`)
    if (count) clauses.push(`FETCH FIRST ${count} ROWS ONLY`)
    appendClause(tokens, start, end, clauses.join(' '))
  } else {
    if (!count) {
      if (target === 'postgresql') appendClause(tokens, start, end, `OFFSET ${offset}`)
      else if (target === 'sqlite') appendClause(tokens, start, end, `LIMIT -1 OFFSET ${offset}`)
      else appendClause(tokens, start, end, `LIMIT 18446744073709551615 OFFSET ${offset}`)
    } else {
      appendClause(tokens, start, end, `LIMIT ${count}${zeroOffset ? '' : ` OFFSET ${offset}`}`)
    }
  }
  changes.add('分页语法')
}

function rewritePagination(tokens: SqlToken[], target: SqlDatabaseDialect, changes: ChangeCounter, warnings: Set<string>): void {
  const ranges = statementRanges(tokens)
  const stack: number[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isSignificant(tokens[index])) continue
    if (tokens[index]?.text === '(') stack.push(index)
    else if (tokens[index]?.text === ')') {
      const open = stack.pop()
      if (open !== undefined && topLevelIndices(tokens, open + 1, index).some((tokenIndex) => upper(tokens[tokenIndex]) === 'SELECT')) {
        ranges.push({ start: open + 1, end: index })
      }
    }
  }
  ranges.sort((left, right) => (left.end - left.start) - (right.end - right.start))
  for (const range of ranges) rewritePaginationStatement(tokens, range.start, range.end, target, changes, warnings)
}

function collectWarnings(tokens: SqlToken[], source: SqlDatabaseDialect, target: SqlDatabaseDialect, warnings: Set<string>): void {
  const code = tokens
    .filter((token) => token.kind !== 'space' && token.kind !== 'comment' && token.kind !== 'string' && token.kind !== 'quotedIdentifier')
    .map((token) => token.text)
    .join(' ')
    .toUpperCase()
  if (/\bCREATE\s+(OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|TRIGGER|PACKAGE)\b/.test(code)) {
    warnings.add('存储过程、函数、触发器和包的过程体未自动迁移，请按目标数据库语法复核')
  }
  if (/\bCONNECT\s+BY\b/.test(code)) warnings.add('Oracle CONNECT BY 未自动改写为递归 CTE')
  if (/\bROWNUM\b/.test(code) && source === 'oracle' && target !== 'oracle') warnings.add('Oracle ROWNUM 的取数顺序语义未自动改写，请按目标数据库分页或窗口函数复核')
  if (/\bILIKE\b/.test(code) && target !== 'postgresql') warnings.add('ILIKE 的大小写语义依赖排序规则，未自动改写')
  if (code.includes('::') && target !== 'postgresql') warnings.add('PostgreSQL :: 类型转换未自动改写，请改用 CAST')
  if (/\bON\s+DUPLICATE\s+KEY\b/.test(code) && target !== 'mysql' && target !== 'mariadb') warnings.add('ON DUPLICATE KEY 未自动迁移为目标数据库 UPSERT')
  if (/\bON\s+CONFLICT\b/.test(code) && target !== 'postgresql' && target !== 'sqlite') warnings.add('ON CONFLICT 未自动迁移为目标数据库 UPSERT')
  if (/\bOUTPUT\b/.test(code) && target !== 'sqlserver') warnings.add('SQL Server OUTPUT 子句未自动迁移')
  if (/\bRETURNING\b/.test(code) && target !== 'postgresql' && target !== 'sqlite') warnings.add('RETURNING 子句需按目标数据库能力复核')
  if (/\bMERGE\b/.test(code) && source !== target) warnings.add('各数据库 MERGE 语义差异较大，请人工验证匹配与并发行为')
  if (/\b(DELIMITER|GO)\b/.test(code)) warnings.add('脚本批次分隔符未转换，请按目标客户端要求调整')
  if (code.includes('||') && (target === 'mysql' || target === 'mariadb' || target === 'sqlserver')) warnings.add('字符串连接运算符的 NULL 与 SQL 模式语义不同，未自动改写')
}

export function convertSqlDialect(value: string, source: SqlDatabaseDialect, target: SqlDatabaseDialect): SqlConversionResult {
  if (!value.trim() || source === target) return { sql: value, changes: [], warnings: [] }
  const tokens = tokenizeSql(value, source)
  const changes = new ChangeCounter()
  const warnings = new Set<string>()
  if (tokens.some((token) => token.kind === 'parameter' || (token.kind === 'word' && /^@[A-Za-z_]/.test(token.text)))) {
    warnings.add('参数占位符由驱动或框架决定，已原样保留，请按目标客户端绑定语法复核')
  }
  if ((source === 'mysql' || source === 'mariadb') && tokens.some((token) => token.kind === 'quotedIdentifier' && token.quote === 'double')) {
    warnings.add('MySQL 双引号受 ANSI_QUOTES 模式影响，当前按标识符处理，请确认原 SQL 模式')
  }
  rewriteQuotedIdentifiers(tokens, target, changes)
  rewriteFunctions(tokens, target, changes)
  rewriteBooleanLiterals(tokens, target, changes)
  rewriteTypes(tokens, target, changes, warnings)
  rewritePagination(tokens, target, changes, warnings)
  collectWarnings(tokens, source, target, warnings)
  return {
    sql: tokens.map((token) => token.text).join('').trim(),
    changes: changes.list(),
    warnings: Array.from(warnings),
  }
}
