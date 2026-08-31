export function syncAppViewportHeight(): number {
  const height = Math.round(window.innerHeight)

  if (height > 0) {
    document.documentElement.style.setProperty('--app-viewport-height', `${height}px`)
  }

  if (window.scrollX !== 0 || window.scrollY !== 0) {
    window.scrollTo(0, 0)
  }

  return height
}
