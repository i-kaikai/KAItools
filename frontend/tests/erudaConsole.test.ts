import { describe, expect, it, vi } from 'vitest'

import { createErudaConsoleController } from '@/utils/erudaConsole'

type ErudaModule = typeof import('eruda')

function createMockModule() {
  const eruda = {
    init: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
  }
  return {
    eruda,
    module: { default: eruda as unknown as ErudaModule['default'] },
  }
}

describe('Eruda console controller', () => {
  it('loads on demand, reuses one instance, and can reopen after destroy', async () => {
    const { eruda, module } = createMockModule()
    const loadEruda = vi.fn(async () => module)
    const controller = createErudaConsoleController(loadEruda)

    await controller.open()
    await controller.open()

    expect(loadEruda).toHaveBeenCalledTimes(1)
    expect(eruda.init).toHaveBeenCalledTimes(1)
    expect(eruda.init).toHaveBeenCalledWith({ useShadowDom: true })
    expect(eruda.show).toHaveBeenCalledTimes(2)

    await controller.hide()
    expect(eruda.hide).toHaveBeenCalledTimes(1)

    await controller.destroy()
    await controller.destroy()
    expect(eruda.destroy).toHaveBeenCalledTimes(1)

    await controller.open()
    expect(eruda.init).toHaveBeenCalledTimes(2)
    expect(eruda.show).toHaveBeenCalledTimes(3)
  })

  it('clears a failed import so opening can be retried', async () => {
    const { eruda, module } = createMockModule()
    let failImport = true
    const loadEruda = vi.fn(async () => {
      if (failImport) throw new Error('Import failed')
      return module
    })
    const controller = createErudaConsoleController(loadEruda)

    await expect(controller.open()).rejects.toThrow('Import failed')
    failImport = false
    await controller.open()

    expect(loadEruda).toHaveBeenCalledTimes(2)
    expect(eruda.init).toHaveBeenCalledTimes(1)
    expect(eruda.show).toHaveBeenCalledTimes(1)
  })

  it('does not initialize after destroy cancels a pending import', async () => {
    const { eruda, module } = createMockModule()
    let resolveImport: (value: ErudaModule) => void = () => undefined
    const loadEruda = vi.fn(() => new Promise<ErudaModule>((resolve) => { resolveImport = resolve }))
    const controller = createErudaConsoleController(loadEruda)

    const opening = controller.open()
    await controller.destroy()
    resolveImport(module)
    await opening

    expect(eruda.init).not.toHaveBeenCalled()
    expect(eruda.show).not.toHaveBeenCalled()
  })
})
