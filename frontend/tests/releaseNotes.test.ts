import { describe, expect, it } from 'vitest'

import { parseReleaseNotes, releaseNotes } from '@/releaseNotes'
import { APP_VERSION } from '@/version'

describe('release notes', () => {
  it('parses version entries into safe structured content', () => {
    const notes = parseReleaseNotes(`# KAITools 版本说明

## v2.1.0

发布日期：2026-08-31

### 更新内容

- 新增版本说明入口
- 优化发布流程

### 升级说明

- 无
`)

    expect(notes).toEqual([{
      version: '2.1.0',
      releaseDate: '2026-08-31',
      changes: ['新增版本说明入口', '优化发布流程'],
      upgradeNotes: ['无'],
      draft: false,
    }])
  })

  it('marks placeholders as drafts and ships an entry for the application version', () => {
    expect(parseReleaseNotes('## v2.1.1\n\n发布日期：TBD\n\n### 更新内容\n\n- TBD\n')[0]?.draft).toBe(true)
    expect(releaseNotes.some((note) => note.version === APP_VERSION)).toBe(true)
  })
})
