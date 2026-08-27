import type { DashboardCard, DashboardCards } from '@/types'

const SYSTEM_CARDS: DashboardCard[] = [
  { id: 'system-json', toolId: 'json', title: 'JSON', description: '格式化、压缩与关系图', accentColor: '#35d0a7', sortOrder: 0, enabled: true },
  { id: 'system-java', toolId: 'java', title: 'Java 转义', description: '字符串转义与反转义', accentColor: '#ff7d5d', sortOrder: 1, enabled: true },
  { id: 'system-timestamp', toolId: 'timestamp', title: '日期转换', description: '多格式日期与时间戳转换', accentColor: '#6ea0ff', sortOrder: 2, enabled: true },
  { id: 'system-base64-text', toolId: 'base64-text', title: 'Base64 文本', description: 'UTF-8 文本编码与解码', accentColor: '#dcad49', sortOrder: 3, enabled: true },
  { id: 'system-cron', toolId: 'cron', title: 'Crontab', description: '生成并校验 Cron 表达式', accentColor: '#6eb9ff', sortOrder: 4, enabled: true },
  { id: 'system-notes', toolId: 'notes', title: '笔记', description: 'Markdown 本地笔记', accentColor: '#a58df0', sortOrder: 5, enabled: true },
]

export function defaultDashboardCards(): DashboardCards {
  return {
    schemaVersion: 1,
    cards: SYSTEM_CARDS.map((card) => ({ ...card })),
    carouselMode: 'step',
    classicRotationSpeed: 16,
    stepIntervalMs: 1600,
  }
}
