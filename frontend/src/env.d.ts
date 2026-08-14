/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ICP_NUMBER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  pywebview?: {
    api: Record<string, (...args: unknown[]) => Promise<unknown>>
  }
}
