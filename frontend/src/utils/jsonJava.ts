import { BaseJavaCstVisitorWithDefaults, parse } from 'java-parser'

interface BeanField {
  name: string
  type: string
  originalName: string
}

interface BeanClass {
  name: string
  fields: BeanField[]
}

function javaIdentifier(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]+(.)?/g, (_, character: string | undefined) => character?.toUpperCase() ?? '')
  const candidate = cleaned.replace(/^[^A-Za-z_$]+/, '')
  return candidate || fallback
}

function classIdentifier(value: string): string {
  const identifier = javaIdentifier(value, 'GeneratedBean')
  return identifier.charAt(0).toUpperCase() + identifier.slice(1)
}

function propertyIdentifier(value: string): string {
  const identifier = javaIdentifier(value, 'value')
  return identifier.charAt(0).toLowerCase() + identifier.slice(1)
}

function scalarType(value: unknown): string {
  if (typeof value === 'string') return 'String'
  if (typeof value === 'boolean') return 'Boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'Long' : 'Double'
  return 'Object'
}

function buildClass(name: string, value: Record<string, unknown>, classes: BeanClass[]): BeanClass {
  const fields = Object.entries(value).map(([key, child]) => {
    let type = scalarType(child)
    if (Array.isArray(child)) {
      const sample = child.find((item) => item !== null && item !== undefined)
      if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
        const nestedName = classIdentifier(key.endsWith('s') ? key.slice(0, -1) : key)
        buildClass(nestedName, sample as Record<string, unknown>, classes)
        type = `List<${nestedName}>`
      } else {
        type = `List<${scalarType(sample)}>`
      }
    } else if (child && typeof child === 'object') {
      const nestedName = classIdentifier(key)
      buildClass(nestedName, child as Record<string, unknown>, classes)
      type = nestedName
    }
    return { name: propertyIdentifier(key), type, originalName: key }
  })
  const bean = { name: classIdentifier(name), fields }
  classes.unshift(bean)
  return bean
}

function accessorName(field: BeanField): string {
  return field.name.charAt(0).toUpperCase() + field.name.slice(1)
}

function renderClass(bean: BeanClass, root: boolean, lombok: boolean): string {
  const prefix = root ? 'public class' : 'public static class'
  const lines = [`${lombok ? '@Data\n' : ''}${prefix} ${bean.name} {`]
  for (const field of bean.fields) {
    if (field.name !== field.originalName) lines.push(`    // JSON key: ${JSON.stringify(field.originalName)}`)
    lines.push(`    private ${field.type} ${field.name};`)
  }
  if (!lombok) {
    for (const field of bean.fields) {
      const accessor = accessorName(field)
      lines.push('', `    public ${field.type} get${accessor}() {`, `        return ${field.name};`, '    }')
      lines.push('', `    public void set${accessor}(${field.type} ${field.name}) {`, `        this.${field.name} = ${field.name};`, '    }')
    }
  }
  lines.push('}')
  return lines.join('\n')
}

export function jsonToJavaBean(source: string, className: string, lombok = false): string {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`JSON 无效：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('根节点必须是 JSON 对象')
  const classes: BeanClass[] = []
  const root = buildClass(className, value as Record<string, unknown>, classes)
  const usesList = classes.some((bean) => bean.fields.some((field) => field.type.startsWith('List<')))
  const imports = [usesList ? 'import java.util.List;' : '', lombok ? 'import lombok.Data;' : ''].filter(Boolean)
  const nested = classes.filter((bean) => bean !== root)
  const rootSource = renderClass(root, true, lombok)
  const nestedSource = nested.map((bean) => renderClass(bean, false, lombok).split('\n').map((line) => `    ${line}`).join('\n'))
  const body = nestedSource.length ? rootSource.replace(/\n}$/, `\n\n${nestedSource.join('\n\n')}\n}`) : rootSource
  return `${imports.length ? `${imports.join('\n')}\n\n` : ''}${body}\n`
}

function sourceRange(value: unknown): { start: number; end: number } | null {
  let start = Number.POSITIVE_INFINITY
  let end = -1
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') return
    const record = item as Record<string, unknown>
    if (typeof record.startOffset === 'number' && typeof record.endOffset === 'number') {
      start = Math.min(start, record.startOffset)
      end = Math.max(end, record.endOffset)
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach(visit)
      else visit(child)
    }
  }
  visit(value)
  return Number.isFinite(start) && end >= start ? { start, end } : null
}

function defaultValue(type: string): unknown {
  const normalized = type.replace(/\s+/g, '')
  if (/^(byte|short|int|long|float|double|Integer|Long|Double|Float|BigDecimal|BigInteger)$/.test(normalized)) return 0
  if (/^(boolean|Boolean)$/.test(normalized)) return false
  if (/^(char|Character|String|LocalDate|LocalDateTime|Date|Instant|UUID)$/.test(normalized)) return ''
  if (/^(List|Set|Collection|Iterable)<|\[\]$/.test(normalized)) return []
  if (/^Map</.test(normalized)) return {}
  return null
}

export function javaBeanToJson(source: string): string {
  try {
    parse(source)
  } catch (error) {
    throw new Error(`Java 语法无效：${error instanceof Error ? error.message : String(error)}`)
  }
  const fields: Array<{ type: string; name: string }> = []
  class FieldVisitor extends BaseJavaCstVisitorWithDefaults {
    constructor() {
      super()
      this.validateVisitor()
    }

    fieldDeclaration(ctx: Record<string, unknown>): void {
      const range = sourceRange(ctx)
      if (!range) return
      const declaration = source.slice(range.start, range.end + 1)
      const match = declaration
        .replace(/@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s*/g, '')
        .match(/(?:public|protected|private|static|final|transient|volatile|\s)+([A-Za-z_$][\w$.]*(?:\s*<[^;=]+?>)?(?:\[\])?)\s+([A-Za-z_$][\w$]*)\s*(?:=[\s\S]*)?;/)
      if (match?.[1] && match[2]) fields.push({ type: match[1].trim(), name: match[2] })
    }
  }
  new FieldVisitor().visit(parse(source))
  if (!fields.length) throw new Error('未找到常见 JavaBean 字段声明')
  return `${JSON.stringify(Object.fromEntries(fields.map((field) => [field.name, defaultValue(field.type)])), null, 2)}\n`
}
