import { createPinia } from 'pinia'
import { createApp } from 'vue'

import { loadAppMetadata } from './appMetadata'
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

async function bootstrap(): Promise<void> {
  await loadAppMetadata()
  createApp(App).use(createPinia()).mount('#app')
}

void bootstrap().catch((error) => {
  console.error('Failed to load KAITools app metadata', error)
  const root = document.getElementById('app')
  if (root) root.textContent = '\u5e94\u7528\u7248\u672c\u4fe1\u606f\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u5e94\u7528\u3002'
})
