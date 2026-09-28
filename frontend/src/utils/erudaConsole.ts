import { readonly, ref } from 'vue'

type ErudaModule = typeof import('eruda')
type ErudaLoader = () => Promise<ErudaModule>

export function createErudaConsoleController(loadEruda: ErudaLoader = () => import('eruda')) {
  let erudaModule: Promise<ErudaModule> | undefined
  let initialized = false
  let generation = 0

  async function open(): Promise<boolean> {
    const requestGeneration = generation
    if (!erudaModule) {
      erudaModule = loadEruda().catch((error: unknown) => {
        erudaModule = undefined
        throw error
      })
    }
    const { default: eruda } = await erudaModule
    if (requestGeneration !== generation) return false
    if (!initialized) {
      eruda.init({ useShadowDom: true })
      initialized = true
    }
    eruda.show()
    return true
  }

  async function hide(): Promise<void> {
    if (!erudaModule || !initialized) return
    const { default: eruda } = await erudaModule
    if (initialized) eruda.hide()
  }

  async function destroy(): Promise<void> {
    generation += 1
    if (!erudaModule || !initialized) return
    const { default: eruda } = await erudaModule
    if (!initialized) return
    try {
      eruda.destroy()
    } finally {
      initialized = false
    }
  }

  return { open, hide, destroy }
}

const erudaConsole = createErudaConsoleController()
const activeState = ref(false)
const visibleState = ref(false)

export const erudaConsoleActive = readonly(activeState)
export const erudaConsoleVisible = readonly(visibleState)

export async function openErudaConsole(): Promise<boolean> {
  const opened = await erudaConsole.open()
  if (opened) {
    activeState.value = true
    visibleState.value = true
  }
  return opened
}

export async function hideErudaConsole(): Promise<void> {
  await erudaConsole.hide()
  if (activeState.value) visibleState.value = false
}

export async function toggleErudaConsole(): Promise<void> {
  if (visibleState.value) {
    await hideErudaConsole()
  } else {
    await openErudaConsole()
  }
}

export async function destroyErudaConsole(): Promise<void> {
  try {
    await erudaConsole.destroy()
  } finally {
    activeState.value = false
    visibleState.value = false
  }
}
