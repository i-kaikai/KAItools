/// <reference types="vite/client" />

interface ImportMetaEnv {
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  pywebview?: {
    api: Record<string, (...args: unknown[]) => Promise<unknown>>
  }
}
