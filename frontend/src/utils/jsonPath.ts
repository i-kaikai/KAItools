import { JSONPath } from 'jsonpath-plus'

export interface JsonPathQueryResult {
  count: number
  output: string
  error: string
}

type JsonValue = null | boolean | number | string | object | unknown[]

export function queryJsonPath(source: string, path: string, indent = 2): JsonPathQueryResult {
  if (!source.trim()) return { count: 0, output: '', error: '' }
  try {
    const json = JSON.parse(source) as JsonValue
    const values = JSONPath<unknown[]>({ path: path.trim() || '$', json, wrap: true, eval: 'safe' })
    const result = values.length === 1 ? values[0] : values
    return {
      count: values.length,
      output: JSON.stringify(result, null, indent) ?? 'null',
      error: '',
    }
  } catch (error) {
    return {
      count: 0,
      output: '',
      error: error instanceof Error ? error.message : 'JSONPath 查询失败',
    }
  }
}
