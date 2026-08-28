import { afterEach, describe, expect, it } from 'vitest'

import { syncAppViewportHeight } from '@/viewport'

const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')

function setWindowProperty(name: 'innerHeight' | 'visualViewport', value: unknown): void {
  Object.defineProperty(window, name, { configurable: true, value })
}

function restoreWindowProperty(name: 'innerHeight' | 'visualViewport', descriptor: PropertyDescriptor | undefined): void {
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
    document.documentElement.style.removeProperty('--app-viewport-height')
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
})
