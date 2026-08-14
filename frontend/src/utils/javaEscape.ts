export interface JavaTransformResult {
  value: string
  error?: { message: string; offset: number }
}

function unicodeEscape(codeUnit: number): string {
  return `\\u${codeUnit.toString(16).padStart(4, '0').toUpperCase()}`
}

export function escapeJava(input: string, escapeUnicode = false): string {
  let output = ''
  for (let index = 0; index < input.length; index += 1) {
    const codeUnit = input.charCodeAt(index)
    const character = input[index] ?? ''
    if (character === '\b') output += '\\b'
    else if (character === '\t') output += '\\t'
    else if (character === '\n') output += '\\n'
    else if (character === '\f') output += '\\f'
    else if (character === '\r') output += '\\r'
    else if (character === '"') output += '\\"'
    else if (character === '\\') output += '\\\\'
    else if (codeUnit < 0x20 || codeUnit === 0x7f || (escapeUnicode && codeUnit > 0x7e)) {
      output += unicodeEscape(codeUnit)
    } else output += character
  }
  return output
}

export function unescapeJava(input: string): JavaTransformResult {
  let output = ''
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? ''
    if (character !== '\\') {
      output += character
      continue
    }
    const start = index
    index += 1
    if (index >= input.length) {
      return { value: output, error: { message: '字符串末尾存在不完整的转义符', offset: start } }
    }
    const escaped = input[index] ?? ''
    const simple: Record<string, string> = {
      b: '\b',
      t: '\t',
      n: '\n',
      f: '\f',
      r: '\r',
      '"': '"',
      "'": "'",
      '\\': '\\',
    }
    if (escaped in simple) {
      output += simple[escaped]
      continue
    }
    if (escaped === 'u') {
      while (input[index + 1] === 'u') index += 1
      const digits = input.slice(index + 1, index + 5)
      if (!/^[0-9a-fA-F]{4}$/.test(digits)) {
        return { value: output, error: { message: 'Unicode 转义必须包含 4 位十六进制数字', offset: start } }
      }
      output += String.fromCharCode(Number.parseInt(digits, 16))
      index += 4
      continue
    }
    if (/[0-7]/.test(escaped)) {
      let digits = escaped
      const maximum = escaped <= '3' ? 3 : 2
      while (digits.length < maximum && /[0-7]/.test(input[index + 1] ?? '')) {
        digits += input[index + 1]
        index += 1
      }
      output += String.fromCharCode(Number.parseInt(digits, 8))
      continue
    }
    return { value: output, error: { message: `不支持的 Java 转义：\\${escaped}`, offset: start } }
  }
  return { value: output }
}

