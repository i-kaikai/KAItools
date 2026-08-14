export type ThemeMode = 'system' | 'light' | 'dark'
export type EditorHighlightKind = 'added' | 'removed'

export interface EditorHighlight {
  from: number
  to: number
  kind: EditorHighlightKind
}

export type ToolId =
  | 'home'
  | 'json'
  | 'json-diff'
  | 'json-java'
  | 'java'
  | 'timestamp'
  | 'base64-text'
  | 'base64-image'
  | 'base64-file'
  | 'cron'
  | 'sql'
  | 'yaml'
  | 'xml'
  | 'text-diff'
  | 'text-stats'
  | 'md5'
  | 'hosts'

export interface ApiError {
  code: string
  message: string
  details?: unknown
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError }

export interface AppSettings {
  schemaVersion: number
  theme: ThemeMode
  sidebarCollapsed: boolean
}

export interface ToolTab {
  id: string
  toolId: ToolId
  title: string
  pinned: boolean
  state: Record<string, unknown>
}

export interface HostsEntry {
  id: string
  ip: string
  hostname: string
  comment: string
  enabled: boolean
}

export interface HostsGroup {
  id: string
  name: string
  enabled: boolean
  entries: HostsEntry[]
}

export interface HostsProfiles {
  schemaVersion: number
  groups: HostsGroup[]
}

export interface RuntimeInfo {
  version: string
  webview2: string | null
  dataDirectory: string
}

export interface BootstrapState {
  settings: AppSettings
  workspace: { schemaVersion: number; tabs: ToolTab[] }
  hostsProfiles: HostsProfiles
  runtime: RuntimeInfo
}

export interface HostsBackup {
  id: string
  createdAt: string
  size: number
  sha256: string
}

export interface HostsSnapshot {
  path: string
  sha256: string
  content: string
  encoding: string
  newline: 'CRLF' | 'LF'
  backups: HostsBackup[]
}

export interface HostsPreview {
  currentContent: string
  desiredContent: string
  changed: boolean
  sourceSha256: string
  desiredSha256: string
  backups?: HostsBackup[]
}
