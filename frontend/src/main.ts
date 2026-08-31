import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { setActiveLocale } from './i18n'
import './styles/index.css'
import { syncAppViewportHeight } from './viewport'

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}

syncAppViewportHeight()
setActiveLocale('zh-CN')
window.addEventListener('resize', syncAppViewportHeight)
window.addEventListener('pageshow', syncAppViewportHeight)
window.visualViewport?.addEventListener('resize', syncAppViewportHeight)

createApp(App).use(createPinia()).mount('#app')
