import { afterEach, describe, expect, it, vi } from 'vitest'

import { syncAppViewportHeight } from '@/viewport'

const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
const originalScrollX = Object.getOwnPropertyDescriptor(window, 'scrollX')
const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')

function setWindowProperty(name: 'innerHeight' | 'visualViewport' | 'scrollX' | 'scrollY', value: unknown): void {
  Object.defineProperty(window, name, { configurable: true, value })
}

function restoreWindowProperty(name: 'innerHeight' | 'visualViewport' | 'scrollX' | 'scrollY', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor)
    return
  }
  Reflect.deleteProperty(window, name)
}

describe('application viewport height', () => {
  afterEach(() => {
    restoreWindowProperty('innerHeight', originalInnerHeight)
    restoreWindowProperty('visualViewport', originalVisualViewport)
    restoreWindowProperty('scrollX', originalScrollX)
    restoreWindowProperty('scrollY', originalScrollY)
    document.documentElement.style.removeProperty('--app-viewport-height')
    vi.restoreAllMocks()
  })

  it('uses the layout viewport when the visual viewport is offset or shorter', () => {
    setWindowProperty('innerHeight', 1280)
    setWindowProperty('visualViewport', { height: 1260, offsetTop: 20, scale: 1 })

    expect(syncAppViewportHeight()).toBe(1280)
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('1280px')
  })

  it('keeps the CSS fallback while the browser reports no usable layout height', () => {
    setWindowProperty('innerHeight', 0)
    document.documentElement.style.setProperty('--app-viewport-height', '100vh')

    expect(syncAppViewportHeight()).toBe(0)
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('100vh')
  })

  it('resets a restored root scroll position while synchronizing the viewport', () => {
    setWindowProperty('innerHeight', 800)
    setWindowProperty('scrollX', 0)
    setWindowProperty('scrollY', 24)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    expect(syncAppViewportHeight()).toBe(800)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })
})
