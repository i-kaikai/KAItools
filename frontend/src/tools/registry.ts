import {
  Braces,
  Clock3,
  Code2,
  Hash,
  House,
  Network,
} from '@lucide/vue'
import { defineAsyncComponent, type Component } from 'vue'

import type { ToolId } from '@/types'

export interface ToolDefinition {
  id: ToolId
  name: string
  description: string
  keywords: string[]
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
    icon: Braces,
    component: defineAsyncComponent(() => import('./json/JsonTool.vue')),
    initialState: () => ({ input: '{\n  "name": "DevToolkit",\n  "ready": true,\n  "count": 5\n}', indent: 2, outputMode: 'code' }),
  },
  {
    id: 'java',
    name: 'Java 转义',
    description: '字符串转义与反转义',
    keywords: ['java', 'escape', 'unicode', '转义'],
    icon: Code2,
    component: defineAsyncComponent(() => import('./java/JavaTool.vue')),
    initialState: () => ({ input: '', mode: 'escape', unicode: false }),
  },
  {
    id: 'timestamp',
    name: '日期转换',
    description: '多格式日期与时间戳转换',
    keywords: ['date', 'datetime', 'timestamp', 'utc', '时区', '日期', '时间戳'],
    icon: Clock3,
    component: defineAsyncComponent(() => import('./timestamp/TimestampTool.vue')),
    initialState: () => ({ mode: 'timestamp', timestamp: '', unit: 'auto', zone: Intl.DateTimeFormat().resolvedOptions().timeZone, dateTime: '' }),
  },
  {
    id: 'hosts',
    name: 'Hosts',
    description: '直接编辑系统 Hosts 文件',
    keywords: ['hosts', 'dns', '域名', '映射'],
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
    icon: Hash,
    component: defineAsyncComponent(() => import('./md5/Md5Tool.vue')),
    initialState: () => ({ input: '', uppercase: false }),
  },
]

export const tools: ToolDefinition[] = [homeTool, ...workspaceTools]

export const toolsById = Object.fromEntries(tools.map((tool) => [tool.id, tool])) as Record<ToolId, ToolDefinition>
