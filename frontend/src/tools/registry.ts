import {
  Binary,
  Braces,
  CalendarClock,
  ChartNoAxesColumn,
  Clock3,
  Code2,
  CodeXml,
  Database,
  Diff,
  FileJson,
  FileType2,
  FileUp,
  GitCompareArrows,
  Hash,
  House,
  Image,
  Network,
} from '@lucide/vue'
import { defineAsyncComponent, type Component } from 'vue'

import type { ToolId } from '@/types'

export type ToolCategoryId = 'data' | 'encoding' | 'developer' | 'text' | 'system'

export interface ToolCategory {
  id: ToolCategoryId
  name: string
  description: string
}

export const toolCategories: ToolCategory[] = [
  { id: 'data', name: '数据格式', description: '结构化数据、配置与查询语句' },
  { id: 'encoding', name: '编码转换', description: '文本、图片、文件与摘要处理' },
  { id: 'developer', name: '开发辅助', description: '代码、时间、任务与系统配置' },
  { id: 'text', name: '文本处理', description: '差异分析与内容统计' },
  { id: 'system', name: '系统工具', description: '本机环境与网络配置' },
]

export interface ToolDefinition {
  id: ToolId
  name: string
  description: string
  keywords: string[]
  category: ToolCategoryId
  icon: Component
  component: Component
  singleton?: boolean
  initialState: () => Record<string, unknown>
}

export const homeTool: ToolDefinition = {
  id: 'home',
  name: '首页',
  description: '开发工具工作台',
  keywords: ['home', '首页', '工作台'],
  category: 'developer',
  icon: House,
  component: defineAsyncComponent(() => import('./home/HomeTool.vue')),
  singleton: true,
  initialState: () => ({}),
}

export const workspaceTools: ToolDefinition[] = [
  {
    id: 'json',
    name: 'JSON',
    description: '格式化、压缩与树视图',
    keywords: ['json', '格式化', '校验', 'tree'],
    category: 'data',
    icon: Braces,
    component: defineAsyncComponent(() => import('./json/JsonTool.vue')),
    initialState: () => ({ input: '{\n  "name": "DevToolkit",\n  "ready": true,\n  "count": 5\n}', indent: 2, outputMode: 'code' }),
  },
  {
    id: 'json-diff',
    name: 'JSON 对比',
    description: '语义化比较 JSON 差异',
    keywords: ['json', 'diff', 'compare', '对比', '差异'],
    category: 'data',
    icon: GitCompareArrows,
    component: defineAsyncComponent(() => import('./jsonDiff/JsonDiffTool.vue')),
    initialState: () => ({ left: '{\n  "name": "DevToolkit",\n  "version": 1\n}', right: '{\n  "name": "DevToolkit",\n  "version": 2\n}', ignoreOrder: true }),
  },
  {
    id: 'json-java',
    name: 'JSON / JavaBean',
    description: 'JSON 与 JavaBean 互转',
    keywords: ['json', 'java', 'javabean', 'pojo', '互转'],
    category: 'data',
    icon: FileJson,
    component: defineAsyncComponent(() => import('./jsonJava/JsonJavaTool.vue')),
    initialState: () => ({ input: '{\n  "id": 1,\n  "name": "demo",\n  "enabled": true\n}', mode: 'json-to-java', className: 'RootBean', lombok: false }),
  },
  {
    id: 'java',
    name: 'Java 转义',
    description: '字符串转义与反转义',
    keywords: ['java', 'escape', 'unicode', '转义'],
    category: 'developer',
    icon: Code2,
    component: defineAsyncComponent(() => import('./java/JavaTool.vue')),
    initialState: () => ({ input: '', mode: 'escape', unicode: false }),
  },
  {
    id: 'timestamp',
    name: '日期转换',
    description: '多格式日期与时间戳转换',
    keywords: ['date', 'datetime', 'timestamp', 'utc', '时区', '日期', '时间戳'],
    category: 'developer',
    icon: Clock3,
    component: defineAsyncComponent(() => import('./timestamp/TimestampTool.vue')),
    initialState: () => ({ mode: 'timestamp', timestamp: '', unit: 'auto', zone: Intl.DateTimeFormat().resolvedOptions().timeZone, dateTime: '' }),
  },
  {
    id: 'base64-text',
    name: 'Base64 文本',
    description: 'UTF-8 文本编码与解码',
    keywords: ['base64', 'text', 'utf8', '编码', '解码', '文本'],
    category: 'encoding',
    icon: Binary,
    component: defineAsyncComponent(() => import('./base64Text/Base64TextTool.vue')),
    initialState: () => ({ input: '', mode: 'encode', urlSafe: false }),
  },
  {
    id: 'base64-image',
    name: 'Base64 图片',
    description: '图片与 Data URL 互转',
    keywords: ['base64', 'image', 'dataurl', '图片', '编码', '解码'],
    category: 'encoding',
    icon: Image,
    component: defineAsyncComponent(() => import('./base64Image/Base64ImageTool.vue')),
    initialState: () => ({ dataUrl: '', fileName: '' }),
  },
  {
    id: 'base64-file',
    name: 'Base64 文件',
    description: '任意文件与 Base64 互转',
    keywords: ['base64', 'file', 'blob', '文件', '转换'],
    category: 'encoding',
    icon: FileUp,
    component: defineAsyncComponent(() => import('./base64File/Base64FileTool.vue')),
    initialState: () => ({ base64: '', fileName: 'decoded.bin', mimeType: 'application/octet-stream' }),
  },
  {
    id: 'cron',
    name: 'Crontab 生成器',
    description: '生成并校验 Cron 表达式',
    keywords: ['cron', 'crontab', 'schedule', '定时', '表达式'],
    category: 'developer',
    icon: CalendarClock,
    component: defineAsyncComponent(() => import('./cron/CronTool.vue')),
    initialState: () => ({ minute: '0', hour: '9', day: '*', month: '*', weekday: '1-5' }),
  },
  {
    id: 'sql',
    name: 'SQL 美化',
    description: '多方言 SQL 格式化',
    keywords: ['sql', 'mysql', 'postgresql', 'format', '美化', '格式化'],
    category: 'data',
    icon: Database,
    component: defineAsyncComponent(() => import('./sql/SqlTool.vue')),
    initialState: () => ({ input: 'select id,name from users where enabled=1 order by id desc;', dialect: 'sql', keywordCase: 'upper', tabWidth: 2 }),
  },
  {
    id: 'yaml',
    name: 'YAML 美化',
    description: 'YAML 校验与格式化',
    keywords: ['yaml', 'yml', 'config', '美化', '格式化'],
    category: 'data',
    icon: FileType2,
    component: defineAsyncComponent(() => import('./yaml/YamlTool.vue')),
    initialState: () => ({ input: 'app:\n  name: DevToolkit\n  enabled: true\n', indent: 2 }),
  },
  {
    id: 'xml',
    name: 'XML 格式化',
    description: 'XML 校验、格式化与压缩',
    keywords: ['xml', 'format', 'pretty', '格式化', '压缩'],
    category: 'data',
    icon: CodeXml,
    component: defineAsyncComponent(() => import('./xml/XmlTool.vue')),
    initialState: () => ({ input: '<root><item id="1">DevToolkit</item></root>', indent: 2, compact: false }),
  },
  {
    id: 'text-diff',
    name: '文本比较',
    description: '按行或字符比较文本',
    keywords: ['text', 'diff', 'compare', '文本', '比较', '差异'],
    category: 'text',
    icon: Diff,
    component: defineAsyncComponent(() => import('./textDiff/TextDiffTool.vue')),
    initialState: () => ({ left: '第一行\n第二行', right: '第一行\n新的第二行', mode: 'lines', ignoreWhitespace: false }),
  },
  {
    id: 'text-stats',
    name: '文本统计',
    description: '字符、单词、行数与字节统计',
    keywords: ['text', 'stats', 'count', '文本', '统计', '字数'],
    category: 'text',
    icon: ChartNoAxesColumn,
    component: defineAsyncComponent(() => import('./textStats/TextStatsTool.vue')),
    initialState: () => ({ input: '' }),
  },
  {
    id: 'hosts',
    name: 'Hosts',
    description: '直接编辑系统 Hosts 文件',
    keywords: ['hosts', 'dns', '域名', '映射'],
    category: 'system',
    icon: Network,
    component: defineAsyncComponent(() => import('./hosts/HostsTool.vue')),
    singleton: true,
    initialState: () => ({ selectedGroupId: 'default', search: '', previewOpen: false }),
  },
  {
    id: 'md5',
    name: 'MD5 摘要',
    description: 'UTF-8 文本摘要',
    keywords: ['md5', 'hash', '摘要'],
    category: 'encoding',
    icon: Hash,
    component: defineAsyncComponent(() => import('./md5/Md5Tool.vue')),
    initialState: () => ({ input: '', uppercase: false }),
  },
]

export const tools: ToolDefinition[] = [homeTool, ...workspaceTools]

export const toolsById = Object.fromEntries(tools.map((tool) => [tool.id, tool])) as Record<ToolId, ToolDefinition>
