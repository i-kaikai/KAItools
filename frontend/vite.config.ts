import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { appMetadataPlugin } from './version.config.ts'

export default defineConfig({
  base: './',
  plugins: [vue(), appMetadataPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../build/web',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome120',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
