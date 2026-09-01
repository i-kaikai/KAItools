import { describe, expect, it } from 'vitest'

import { markdownCardPreview } from '@/utils/markdownPreview'

describe('markdownCardPreview', () => {
  it('preserves note line breaks and paragraph spacing in a card preview', () => {
    expect(markdownCardPreview('# 标题\r\n\r\n第一行  \r\n第二行\\\n第三行\r\n\r\n- 列表项'))
      .toBe('标题\n\n第一行\n第二行\n第三行\n\n列表项')
  })

  it('keeps readable link and image labels without Markdown syntax', () => {
    expect(markdownCardPreview('[KAITools](https://tools.imkai.top/)\n![图标](mark.svg)')).toBe('KAITools\n图标')
  })
})
