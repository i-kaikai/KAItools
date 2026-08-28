import {
  Binary,
  BookOpenText,
  Braces,
  CalendarClock,
  Calculator,
  CaseSensitive,
  ChartNoAxesColumn,
  Clipboard,
  Clock3,
  Code2,
  CodeXml,
  Crop,
  Database,
  Diff,
  FileAudio,
  FileJson,
  FileType2,
  FileUp,
  Fingerprint,
  GitCompareArrows,
  Hash,
  House,
  Image,
  Network,
  QrCode,
  Regex,
} from '@lucide/vue'
import { defineAsyncComponent, type Component } from 'vue'

import ToolLoadingState from '@/components/ToolLoadingState.vue'
import { t } from '@/i18n'
import type { ToolId } from '@/types'

export type ToolCategoryId = 'data' | 'encoding' | 'developer' | 'text' | 'system'

export interface ToolCategory {
  id: ToolCategoryId
  name: string
  description: string
}

const toolCategoryDefinitions: ToolCategory[] = [
  { id: 'data', name: '数据格式', description: '结构化数据、配置与查询语句' },
  { id: 'encoding', name: '编码转换', description: '文本、图片、文件与摘要处理' },
  { id: 'developer', name: '开发辅助', description: '代码、时间、任务与系统配置' },
  { id: 'text', name: '文本处理', description: '差异分析与内容统计' },
  { id: 'system', name: '系统工具', description: '本机环境与网络配置' },
]

function localizeCategory(category: ToolCategory): ToolCategory {
  return Object.defineProperties(category, {
    name: { enumerable: true, get: () => t(`category.${category.id}.name`) },
    description: { enumerable: true, get: () => t(`category.${category.id}.description`) },
  }) as ToolCategory
}

export interface ToolDefinition {
  id: ToolId
  name: string
  description: string
  keywords: string[]
  category: ToolCategoryId
  icon: Component
  component: Component
  preload: () => Promise<Component>
  singleton?: boolean
  initialState: () => Record<string, unknown>
  chainInput?: (value: string) => Record<string, unknown>
  desktopOnly?: boolean
}

function localizeTool(tool: ToolDefinition): ToolDefinition {
  return Object.defineProperties(tool, {
    name: { enumerable: true, get: () => t(`tool.${tool.id}.name`) },
    description: { enumerable: true, get: () => t(`tool.${tool.id}.description`) },
  }) as ToolDefinition
}

function lazyTool(loader: () => Promise<{ default: Component }>): Pick<ToolDefinition, 'component' | 'preload'> {
  let pendingLoad: Promise<Component> | undefined
  const preload = (): Promise<Component> => {
    pendingLoad ??= loader()
      .then(({ default: component }) => component)
      .catch((error: unknown) => {
        pendingLoad = undefined
        throw error
      })
    return pendingLoad
  }

  return {
    // Reusing this Promise lets intent-based prefetching and the visible async component share one request.
    component: defineAsyncComponent({
      loader: preload,
      loadingComponent: ToolLoadingState,
      delay: 120,
      timeout: 30_000,
      suspensible: false,
    }),
    preload,
  }
}

export const toolCategories = toolCategoryDefinitions.map(localizeCategory)

export const homeTool: ToolDefinition = localizeTool({
  id: 'home',
  name: '首页',
  description: '开发工具工作台',
  keywords: ['home', '首页', '工作台'],
  category: 'developer',
  icon: House,
  ...lazyTool(() => import('./home/HomeTool.vue')),
  singleton: true,
  initialState: () => ({}),
})

const workspaceToolDefinitions: ToolDefinition[] = [
  {
    id: 'json',
    name: 'JSON',
    description: '格式化、关系图与 JSONPath',
    keywords: ['json', 'jsonpath', '查询', '格式化', '校验', 'tree', 'graph', '关系图'],
    category: 'data',
    icon: Braces,
    ...lazyTool(() => import('./json/JsonTool.vue')),
    initialState: () => ({ input: '{\n  "name": "KAITools",\n  "ready": true,\n  "count": 5\n}', indent: 2, outputMode: 'code', queryPath: '$' }),
    chainInput: (value) => ({ input: value, outputMode: 'code' }),
  },
  {
    id: 'json-diff',
    name: 'JSON 对比',
    description: '语义化比较 JSON 差异',
    keywords: ['json', 'diff', 'compare', '对比', '差异'],
    category: 'data',
    icon: GitCompareArrows,
    ...lazyTool(() => import('./jsonDiff/JsonDiffTool.vue')),
    initialState: () => ({ left: '{\n  "name": "KAITools",\n  "version": 1\n}', right: '{\n  "name": "KAITools",\n  "version": 2\n}', ignoreOrder: true }),
  },
  {
    id: 'json-java',
    name: 'JSON / JavaBean',
    description: 'JSON 与 JavaBean 互转',
    keywords: ['json', 'java', 'javabean', 'pojo', '互转'],
    category: 'data',
    icon: FileJson,
    ...lazyTool(() => import('./jsonJava/JsonJavaTool.vue')),
    initialState: () => ({ input: '{\n  "id": 1,\n  "name": "demo",\n  "enabled": true\n}', mode: 'json-to-java', className: 'RootBean', lombok: false }),
    chainInput: (value) => ({ input: value, mode: 'json-to-java' }),
  },
  {
    id: 'java',
    name: 'Java 转义',
    description: '字符串转义与反转义',
    keywords: ['java', 'escape', 'unicode', '转义'],
    category: 'developer',
    icon: Code2,
    ...lazyTool(() => import('./java/JavaTool.vue')),
    initialState: () => ({ input: '', mode: 'escape', unicode: false, autoFormatJson: true }),
    chainInput: (value) => ({ input: value }),
  },
  {
    id: 'timestamp',
    name: '日期转换',
    description: '多格式日期与时间戳转换',
    keywords: ['date', 'datetime', 'timestamp', 'utc', '时区', '日期', '时间戳'],
    category: 'developer',
    icon: Clock3,
    ...lazyTool(() => import('./timestamp/TimestampTool.vue')),
    initialState: () => ({ mode: 'timestamp', timestamp: '', unit: 'auto', zone: Intl.DateTimeFormat().resolvedOptions().timeZone, dateTime: '' }),
  },
  {
    id: 'base64-text',
    name: 'Base64 文本',
    description: 'UTF-8 文本编码与解码',
    keywords: ['base64', 'text', 'utf8', '编码', '解码', '文本'],
    category: 'encoding',
    icon: Binary,
    ...lazyTool(() => import('./base64Text/Base64TextTool.vue')),
    initialState: () => ({ input: '', mode: 'encode', urlSafe: false }),
    chainInput: (value) => ({ input: value }),
  },
  {
    id: 'base64-image',
    name: 'Base64 图片',
    description: '图片与 Data URL 互转',
    keywords: ['base64', 'image', 'dataurl', '图片', '编码', '解码'],
    category: 'encoding',
    icon: Image,
    ...lazyTool(() => import('./base64Image/Base64ImageTool.vue')),
    initialState: () => ({ sourceDataUrl: '', base64: '', mode: 'encode', outputFormat: 'base64', fileName: 'image.png', mimeType: 'image/png', split: 50 }),
  },
  {
    id: 'base64-file',
    name: 'Base64 文件',
    description: '任意文件与 Base64 互转',
    keywords: ['base64', 'file', 'blob', '文件', '转换'],
    category: 'encoding',
    icon: FileUp,
    ...lazyTool(() => import('./base64File/Base64FileTool.vue')),
    initialState: () => ({ sourceBase64: '', base64: '', mode: 'encode', fileName: 'decoded.bin', mimeType: 'application/octet-stream', split: 50 }),
  },
  {
    id: 'qrcode',
    name: '二维码工具',
    description: '生成二维码并从图片识别内容',
    keywords: ['qr', 'qrcode', '二维码', '扫码', '生成', '识别', '解码'],
    category: 'encoding',
    icon: QrCode,
    ...lazyTool(() => import('./qr/QrTool.vue')),
    initialState: () => ({ mode: 'generate', text: 'https://tools.imkai.top', output: '', errorCorrection: 'M', size: 320, margin: 2, foreground: '#111827', background: '#ffffff', split: 50 }),
  },
  {
    id: 'image-studio',
    name: '图片工作台',
    description: '裁剪、缩放、压缩与格式转换',
    keywords: ['image', 'crop', 'resize', 'compress', 'webp', 'png', 'jpeg', '图片', '裁剪', '缩放', '压缩', '格式', '无损'],
    category: 'encoding',
    icon: Crop,
    ...lazyTool(() => import('./imageStudio/ImageStudioTool.vue')),
    initialState: () => ({ sourceName: '', outputName: '', cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0, targetWidth: 0, targetHeight: 0, lockAspect: true, outputFormat: 'image/png', quality: 90, split: 50 }),
  },
  {
    id: 'video-audio',
    name: '视频转音频',
    description: '本地提取视频音轨为音频文件',
    keywords: ['video', 'audio', 'mediarecorder', '视频', '音频', '提取', '转音频'],
    category: 'encoding',
    icon: FileAudio,
    ...lazyTool(() => import('./videoAudio/VideoAudioTool.vue')),
    initialState: () => ({ mimeType: '', outputName: '' }),
  },
  {
    id: 'cron',
    name: 'Crontab 生成器',
    description: '生成并校验 Cron 表达式',
    keywords: ['cron', 'crontab', 'schedule', '定时', '表达式'],
    category: 'developer',
    icon: CalendarClock,
    ...lazyTool(() => import('./cron/CronTool.vue')),
    initialState: () => ({ minute: '0', hour: '9', day: '*', month: '*', weekday: '1-5', expression: '0 9 * * 1-5', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, runCount: 10 }),
  },
  {
    id: 'sql',
    name: 'SQL 美化',
    description: '多方言 SQL 格式化',
    keywords: ['sql', 'mysql', 'postgresql', 'format', '美化', '格式化'],
    category: 'data',
    icon: Database,
    ...lazyTool(() => import('./sql/SqlTool.vue')),
    initialState: () => ({ input: 'select id,name from users where enabled=1 order by id desc;', dialect: 'sql', keywordCase: 'upper', tabWidth: 2 }),
    chainInput: (value) => ({ input: value }),
  },
  {
    id: 'yaml',
    name: 'YAML 美化',
    description: 'YAML 校验与格式化',
    keywords: ['yaml', 'yml', 'config', '美化', '格式化'],
    category: 'data',
    icon: FileType2,
    ...lazyTool(() => import('./yaml/YamlTool.vue')),
    initialState: () => ({ input: 'app:\n  name: KAITools\n  enabled: true\n', indent: 2 }),
    chainInput: (value) => ({ input: value }),
  },
  {
    id: 'xml',
    name: 'XML 格式化',
    description: 'XML 校验、格式化与压缩',
    keywords: ['xml', 'format', 'pretty', '格式化', '压缩'],
    category: 'data',
    icon: CodeXml,
    ...lazyTool(() => import('./xml/XmlTool.vue')),
    initialState: () => ({ input: '<root><item id="1">KAITools</item></root>', indent: 2, compact: false }),
    chainInput: (value) => ({ input: value }),
  },
  {
    id: 'text-diff',
    name: '文本比较',
    description: '按行或字符比较文本',
    keywords: ['text', 'diff', 'compare', '文本', '比较', '差异'],
    category: 'text',
    icon: Diff,
    ...lazyTool(() => import('./textDiff/TextDiffTool.vue')),
    initialState: () => ({ left: '第一行\n第二行', right: '第一行\n新的第二行', mode: 'lines', ignoreWhitespace: false }),
  },
  {
    id: 'text-stats',
    name: '文本统计',
    description: '字符、单词、行数与字节统计',
    keywords: ['text', 'stats', 'count', '文本', '统计', '字数'],
    category: 'text',
    icon: ChartNoAxesColumn,
    ...lazyTool(() => import('./textStats/TextStatsTool.vue')),
    initialState: () => ({ input: '' }),
    chainInput: (value) => ({ input: value }),
  },
  {
    id: 'regex',
    name: '正则工作台',
    description: '匹配、捕获与替换预览',
    keywords: ['regex', 'regexp', '正则', '匹配', '捕获', '替换'],
    category: 'developer',
    icon: Regex,
    ...lazyTool(() => import('./regex/RegexTool.vue')),
    initialState: () => ({ input: 'order-2026-0817\norder-2025-1201\ninvalid', pattern: 'order-(\\d{4})-(\\d{4})', flags: 'g', replacement: '$1/$2', mode: 'matches' }),
    chainInput: (value) => ({ input: value }),
  },
  {
    id: 'notes',
    name: '笔记',
    description: 'Markdown 笔记与本地同步',
    keywords: ['notes', 'markdown', 'md', '笔记', '备忘录', '文档'],
    category: 'text',
    icon: BookOpenText,
    ...lazyTool(() => import('./notes/NotesTool.vue')),
    singleton: true,
    initialState: () => ({}),
  },
  {
    id: 'hosts',
    name: 'Hosts',
    description: '直接编辑系统 Hosts 文件',
    keywords: ['hosts', 'dns', '域名', '映射'],
    category: 'system',
    icon: Network,
    ...lazyTool(() => import('./hosts/HostsTool.vue')),
    singleton: true,
    desktopOnly: true,
    initialState: () => ({ selectedGroupId: 'default', search: '', previewOpen: false }),
  },
  {
    id: 'calculator',
    name: '超级计算器',
    description: '科学、程序员、金融与工程计算',
    keywords: ['calculator', 'math', 'finance', 'matrix', '计算器', '金融', '矩阵', '进制'],
    category: 'developer',
    icon: Calculator,
    ...lazyTool(() => import('./calculator/CalculatorTool.vue')),
    initialState: () => ({ section: 'scientific', expression: '', expressionResult: '' }),
    chainInput: (value) => ({ section: 'scientific', expression: value }),
  },
  {
    id: 'clipboard-history',
    name: '剪切板历史',
    description: '管理 Windows 纯文本剪切板记录',
    keywords: ['clipboard', 'history', '剪切板', '历史', '复制'],
    category: 'system',
    icon: Clipboard,
    ...lazyTool(() => import('./clipboardHistory/ClipboardHistoryTool.vue')),
    singleton: true,
    desktopOnly: true,
    initialState: () => ({}),
  },
  {
    id: 'md5',
    name: '哈希摘要',
    description: 'MD5 与 SHA 系列文本摘要',
    keywords: ['md5', 'sha', 'sha1', 'sha256', 'sha384', 'sha512', 'hash', '哈希', '摘要'],
    category: 'encoding',
    icon: Hash,
    ...lazyTool(() => import('./md5/Md5Tool.vue')),
    initialState: () => ({ input: '', output: '', algorithm: 'md5', uppercase: false, split: 50 }),
    chainInput: (value) => ({ input: value }),
  },
  {
    id: 'naming',
    name: '命名转换',
    description: '批量转换代码命名风格',
    keywords: ['camelcase', 'pascalcase', 'snake_case', 'kebab-case', 'naming', '命名', '变量', '字段'],
    category: 'developer',
    icon: CaseSensitive,
    ...lazyTool(() => import('./naming/NamingTool.vue')),
    initialState: () => ({ input: '', target: 'camel', output: '', split: 50 }),
    chainInput: (value) => ({ input: value }),
  },
  {
    id: 'identifiers',
    name: 'UUID / ULID',
    description: '生成并解析时间有序标识符',
    keywords: ['uuid', 'ulid', 'uuidv7', 'identifier', '标识符', '时间解析'],
    category: 'developer',
    icon: Fingerprint,
    ...lazyTool(() => import('./identifiers/IdentifiersTool.vue')),
    initialState: () => ({ kind: 'uuid-v7', count: 1, output: '', inspectInput: '', split: 50 }),
    chainInput: (value) => ({ inspectInput: value }),
  },
]

export const workspaceTools: ToolDefinition[] = workspaceToolDefinitions.map(localizeTool)

export const tools: ToolDefinition[] = [homeTool, ...workspaceTools]

export const toolsById = Object.fromEntries(tools.map((tool) => [tool.id, tool])) as Record<ToolId, ToolDefinition>
