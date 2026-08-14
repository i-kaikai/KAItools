import { describe, expect, it } from 'vitest'

import { md5Text, utf8ByteLength } from '@/utils/md5'

describe('MD5', () => {
  it('matches standard vectors', () => {
    expect(md5Text('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Text('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
  })

  it('supports uppercase output and UTF-8 byte counts', () => {
    expect(md5Text('abc', true)).toBe('900150983CD24FB0D6963F7D28E17F72')
    expect(utf8ByteLength('工具')).toBe(6)
  })
})

