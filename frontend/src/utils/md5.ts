import SparkMD5 from 'spark-md5'

export function md5Text(input: string, uppercase = false): string {
  const value = SparkMD5.hash(input)
  return uppercase ? value.toUpperCase() : value
}

export function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).length
}

