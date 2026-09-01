/// <reference types="vite/client" />

declare const __KAITOOLS_VERSION__: string
declare const __KAITOOLS_RELEASE_NOTES__: string

interface ImportMetaEnv {
  readonly VITE_KAITOOLS_API_URL?: string
  readonly VITE_KAITOOLS_ENABLE_SERVICE_CONFIGURATION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  pywebview?: {
    api: Record<string, (...args: unknown[]) => Promise<unknown>>
  }
}
