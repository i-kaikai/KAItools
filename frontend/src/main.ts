import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { setActiveLocale } from './i18n'
import './styles/index.css'

function syncViewportHeight(): void {
  const height = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-viewport-height', `${Math.round(height)}px`)
}

syncViewportHeight()
setActiveLocale('zh-CN')
window.addEventListener('resize', syncViewportHeight)
window.visualViewport?.addEventListener('resize', syncViewportHeight)

createApp(App).use(createPinia()).mount('#app')
