export type RuntimeTarget = 'desktop' | 'web'

export function resolveRuntimeTarget(mode: string): RuntimeTarget {
  return mode === 'web' ? 'web' : 'desktop'
}

export function normalizeIcpNumber(value: string | undefined): string {
  return value?.trim() ?? ''
}

export const runtimeTarget = resolveRuntimeTarget(import.meta.env.MODE)
export const isWebRuntime = runtimeTarget === 'web'
export const icpNumber = normalizeIcpNumber(import.meta.env.VITE_ICP_NUMBER)
