import SparkMD5 from 'spark-md5'

export const hashAlgorithms = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const
export type HashAlgorithm = (typeof hashAlgorithms)[number]

const webCryptoAlgorithms: Record<Exclude<HashAlgorithm, 'md5'>, AlgorithmIdentifier> = {
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
}

export function md5Text(input: string, uppercase = false): string {
  const value = SparkMD5.hash(input)
  return uppercase ? value.toUpperCase() : value
}

export async function hashText(input: string, algorithm: HashAlgorithm, uppercase = false): Promise<string> {
  if (algorithm === 'md5') return md5Text(input, uppercase)

  if (!globalThis.crypto?.subtle) throw new Error('当前运行环境不支持 SHA 摘要')
  const digest = await globalThis.crypto.subtle.digest(webCryptoAlgorithms[algorithm], new TextEncoder().encode(input))
  const value = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return uppercase ? value.toUpperCase() : value
}

export function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).length
}
