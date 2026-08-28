export type NamingStyle = 'camel' | 'pascal' | 'snake' | 'kebab' | 'constant' | 'dot' | 'sentence'

export interface NameVariants {
  camel: string
  pascal: string
  snake: string
  kebab: string
  constant: string
  dot: string
  sentence: string
}

function capitalize(word: string): string {
  return word ? `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}` : ''
}

export function splitIdentifier(value: string): string[] {
  const spaced = value
    .trim()
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')

  return spaced
    .match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+|[^\s]+/g)
    ?.map((word) => word.toLocaleLowerCase())
    ?? []
}

export function nameVariants(value: string): NameVariants {
  const words = splitIdentifier(value)
  const lower = words.join(' ')
  return {
    camel: words.map((word, index) => index === 0 ? word : capitalize(word)).join(''),
    pascal: words.map(capitalize).join(''),
    snake: words.join('_'),
    kebab: words.join('-'),
    constant: words.join('_').toUpperCase(),
    dot: words.join('.'),
    sentence: lower ? capitalize(lower) : '',
  }
}

export function convertIdentifier(value: string, style: NamingStyle): string {
  return nameVariants(value)[style]
}

export function convertIdentifierLines(value: string, style: NamingStyle): string {
  return value.split('\n').map((line) => line.trim() ? convertIdentifier(line, style) : '').join('\n')
}
