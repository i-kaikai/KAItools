export type RuntimeTarget = 'desktop' | 'web'

export function resolveRuntimeTarget(mode: string): RuntimeTarget {
  return mode === 'web' ? 'web' : 'desktop'
}

export const runtimeTarget = resolveRuntimeTarget(import.meta.env.MODE)
export const isWebRuntime = runtimeTarget === 'web'
