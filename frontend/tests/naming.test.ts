import { describe, expect, it } from 'vitest'

import { convertIdentifierLines, nameVariants, splitIdentifier } from '@/utils/naming'

describe('naming conversion', () => {
  it('splits separators, casing boundaries, and acronyms into stable words', () => {
    expect(splitIdentifier('HTTPServer response_code')).toEqual(['http', 'server', 'response', 'code'])
  })

  it('converts identifiers into the supported code styles', () => {
    expect(nameVariants('HTTPServer response_code')).toMatchObject({
      camel: 'httpServerResponseCode',
      pascal: 'HttpServerResponseCode',
      snake: 'http_server_response_code',
      kebab: 'http-server-response-code',
      constant: 'HTTP_SERVER_RESPONSE_CODE',
      dot: 'http.server.response.code',
    })
  })

  it('converts every input line in order while preserving empty lines', () => {
    expect(convertIdentifierLines('HTTPServer\n\nresponse_code', 'kebab')).toBe('http-server\n\nresponse-code')
  })
})
