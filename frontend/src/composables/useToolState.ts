import { reactive, toRaw, watch } from 'vue'

export function useToolState<T extends Record<string, unknown>>(
  initial: Record<string, unknown>,
  defaults: T,
  emit: (value: T) => void,
): T {
  const state = reactive({ ...structuredClone(toRaw(defaults)), ...structuredClone(toRaw(initial)) }) as T
  watch(
    state,
    () => emit(structuredClone(toRaw(state))),
    { deep: true },
  )
  return state
}
