import { describe, expect, it } from 'vitest'

import { hashText, md5Text, utf8ByteLength } from '@/utils/md5'

describe('MD5', () => {
  it('matches standard vectors', () => {
    expect(md5Text('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Text('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
  })

  it('supports uppercase output and UTF-8 byte counts', () => {
    expect(md5Text('abc', true)).toBe('900150983CD24FB0D6963F7D28E17F72')
    expect(utf8ByteLength('工具')).toBe(6)
  })

  it('calculates the supported SHA algorithms locally', async () => {
    await expect(hashText('abc', 'sha1')).resolves.toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    await expect(hashText('abc', 'sha256')).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    await expect(hashText('abc', 'sha384')).resolves.toBe('cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7')
    await expect(hashText('abc', 'sha512', true)).resolves.toBe('DDAF35A193617ABACC417349AE20413112E6FA4E89A97EA20A9EEEE64B55D39A2192992A274FC1A836BA3C23A3FEEBBD454D4423643CE80E2A9AC94FA54CA49F')
  })
})
