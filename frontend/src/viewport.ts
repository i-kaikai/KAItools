export function syncAppViewportHeight(): number {
  const height = Math.round(window.innerHeight)

  if (height > 0) {
    document.documentElement.style.setProperty('--app-viewport-height', `${height}px`)
  }

  return height
}
