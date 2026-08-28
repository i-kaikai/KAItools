import { getActiveLocale, translateForLocale } from '@/i18n'
import type { AppLocale, DashboardCard, DashboardCards } from '@/types'

const SYSTEM_CARD_DEFINITIONS = [
  { id: 'system-json', toolId: 'json', descriptionKey: 'dashboard.json', accentColor: '#35d0a7' },
  { id: 'system-java', toolId: 'java', descriptionKey: 'dashboard.java', accentColor: '#ff7d5d' },
  { id: 'system-timestamp', toolId: 'timestamp', descriptionKey: 'dashboard.timestamp', accentColor: '#6ea0ff' },
  { id: 'system-base64-text', toolId: 'base64-text', descriptionKey: 'dashboard.base64-text', accentColor: '#dcad49' },
  { id: 'system-cron', toolId: 'cron', descriptionKey: 'dashboard.cron', accentColor: '#6eb9ff' },
  { id: 'system-notes', toolId: 'notes', descriptionKey: 'dashboard.notes', accentColor: '#a58df0' },
]

function systemCard(definition: typeof SYSTEM_CARD_DEFINITIONS[number], locale: AppLocale, sortOrder: number): DashboardCard {
  return {
    id: definition.id,
    toolId: definition.toolId as DashboardCard['toolId'],
    title: translateForLocale(locale, `tool.${definition.toolId}.name`),
    description: translateForLocale(locale, definition.descriptionKey),
    accentColor: definition.accentColor,
    sortOrder,
    enabled: true,
  }
}

export function defaultDashboardCards(locale: AppLocale = getActiveLocale()): DashboardCards {
  return {
    schemaVersion: 1,
    cards: SYSTEM_CARD_DEFINITIONS.map((definition, sortOrder) => systemCard(definition, locale, sortOrder)),
    carouselMode: 'step',
    classicRotationSpeed: 16,
    stepIntervalMs: 1600,
  }
}

export function localizeSystemDashboardCards(cards: DashboardCards, toLocale: AppLocale): DashboardCards {
  return {
    ...cards,
    cards: cards.cards.map((card) => {
      const definition = SYSTEM_CARD_DEFINITIONS.find((item) => item.id === card.id)
      if (!definition) return card
      const matchesSystemDefault = (['zh-CN', 'en-US'] as AppLocale[]).some((locale) => {
        const defaultCard = systemCard(definition, locale, card.sortOrder)
        return card.title === defaultCard.title && card.description === defaultCard.description
      })
      if (!matchesSystemDefault) return card
      return { ...card, title: translateForLocale(toLocale, `tool.${definition.toolId}.name`), description: translateForLocale(toLocale, definition.descriptionKey) }
    }),
  }
}
