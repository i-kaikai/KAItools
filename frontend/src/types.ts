export type ThemeMode = 'system' | 'light' | 'dark'
export type AppLocale = 'zh-CN' | 'en-US'
export type ParticleQuality = 'high' | 'balanced' | 'off'
export type MotionMode = 'system' | 'reduced'
export type SidebarStartup = 'remember' | 'collapsed' | 'expanded'
export type EditorHighlightKind = 'added' | 'removed' | 'match'

export interface EditorHighlight {
  from: number
  to: number
  kind: EditorHighlightKind
}

export type ToolId =
  | 'home'
  | 'file-manager'
  | 'json'
  | 'json-diff'
  | 'json-java'
  | 'api-client'
  | 'jwt'
  | 'mermaid'
  | 'flowchart'
  | 'kanban'
  | 'checklist'
  | 'java'
  | 'timestamp'
  | 'base64-text'
  | 'base64-image'
  | 'base64-file'
  | 'html-pdf'
  | 'word-pdf'
  | 'pdf-word'
  | 'qrcode'
  | 'image-studio'
  | 'image-format'
  | 'video-audio'
  | 'html-pdf'
  | 'word-pdf'
  | 'pdf-word'
  | 'cron'
  | 'sql'
  | 'yaml'
  | 'xml'
  | 'text-diff'
  | 'text-stats'
  | 'regex'
  | 'md5'
  | 'naming'
  | 'identifiers'
  | 'hosts'
  | 'notes'
  | 'clipboard-history'
  | 'calculator'

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
  locale: AppLocale
  theme: ThemeMode
  sidebarCollapsed: boolean
  particleQuality: ParticleQuality
  motionMode: MotionMode
  sidebarStartup: SidebarStartup
  restorePinnedTabsOnLaunch: boolean
  editorFontSize: number
  editorLineWrapping: boolean
  clipboardMonitoringEnabled: boolean
  systemStatusRefreshSeconds: 0 | 1 | 30 | 60 | 300
  /** One-time local migration marker; it prevents later manual refresh choices from being overwritten. */
  systemStatusRefreshMigrationVersion: number
  developerModeEnabled: boolean
  /** Windows desktop global shortcut that restores KAITools to the foreground. */
  activationHotkey: string
  /** Recently used tools in most-recent-first order. Local to this device and never synced. */
  recentToolIds: ToolId[]
}

export interface BackendConnection {
  schemaVersion: number
  /** Local-only override used exclusively by the hidden developer mode. */
  localApiOrigin: string
  /** Never takes effect unless developerModeEnabled is true. */
  useLocalApi: boolean
}

export interface SidebarShortcuts {
  schemaVersion: number
  toolIds: ToolId[]
}

export interface ShortcutSyncState {
  schemaVersion: number
  accountId: string | null
  mode: 'pending' | 'enabled' | 'paused'
  revision: number | null
  pendingToolIds: ToolId[] | null
}

export interface DashboardCard {
  id: string
  toolId: ToolId
  title: string
  description: string
  accentColor: string
  sortOrder: number
  enabled: boolean
}

export type DashboardCarouselMode = 'classic' | 'step'

export interface DashboardCards {
  schemaVersion: number
  cards: DashboardCard[]
  carouselMode: DashboardCarouselMode
  classicRotationSpeed: number
  stepIntervalMs: number
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

export type UpdateStatus = 'up-to-date' | 'update-available' | 'repair-available' | 'newer-local-version'

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  status: UpdateStatus
  available: boolean
  filesToDownload: number
  bytesToDownload: number
  releaseNotes: string[]
  publishedAt: string | null
  lastInstallError: string | null
}

export interface UpdateInstallResult {
  version: string
  restarting: boolean
  filesToDownload: number
  state?: UpdateProgressState
}

export interface UpdateLatestResult {
  currentVersion: string
  latestVersion: string
  available: boolean
  releaseNotes: string[]
  publishedAt: string | null
}

export type UpdateProgressState = 'idle' | 'checking' | 'downloading' | 'ready-to-restart' | 'restarting' | 'failed'

export interface UpdateProgress {
  state: UpdateProgressState
  currentVersion: string
  targetVersion: string | null
  currentFile: string | null
  completedFiles: number
  totalFiles: number
  downloadedBytes: number
  totalBytes: number
  error: string | null
}

export interface ClipboardHistoryItem {
  id: string
  text: string
  createdAt: string
  truncated: boolean
}

export interface ClipboardHistorySnapshot {
  enabled: boolean
  maxEntries: number
  maxBytes: number
  items: ClipboardHistoryItem[]
}

export interface SystemStatusSnapshot {
  capturedAt: string
  runtime: 'desktop' | 'web'
  system: Record<string, string | number | boolean | null>
  application: Record<string, string | number | boolean | null | Record<string, string | number | boolean | null>>
}

export type DocumentConversionEngine = 'microsoft-word' | 'libreoffice'

export interface DocumentConversionCapabilities {
  docxToPdf: {
    engines: DocumentConversionEngine[]
    preferred: DocumentConversionEngine | null
  }
  pdfToDocx: {
    engines: DocumentConversionEngine[]
    preferred: DocumentConversionEngine | null
  }
}

export interface DocumentConversionPayload {
  dataBase64: string
  fileName: string
}

export interface DocumentConversionResult {
  cancelled: boolean
  engine: DocumentConversionEngine
  outputName: string
  outputSize: number
}

export interface BootstrapState {
  settings: AppSettings
  backendConnection: BackendConnection
  sidebarShortcuts: SidebarShortcuts
  shortcutSync: ShortcutSyncState
  dashboardCards: DashboardCards
  workspace: { schemaVersion: number; tabs: ToolTab[] }
  hostsProfiles: HostsProfiles
  runtime: RuntimeInfo
}

export type NoteSyncStatus = 'local' | 'pending' | 'synced' | 'conflict'

export interface Notebook {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface NoteFolder {
  id: string
  notebookId: string
  parentId: string | null
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface NoteDocument {
  id: string
  notebookId: string
  folderId: string | null
  title: string
  content: string
  pinned: boolean
  revision: number
  syncStatus: NoteSyncStatus
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface NotesState {
  schemaVersion: number
  notebooks: Notebook[]
  folders: NoteFolder[]
  notes: NoteDocument[]
}

export interface FileManagerFolder {
  id: string
  parentId: string | null
  name: string
  createdAt: string
  updatedAt: string
}

export interface FileManagerAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  /** Inline local data for a tool snapshot. No attachment is uploaded or synchronized. */
  dataBase64: string
}

export interface FileManagerFile {
  id: string
  folderId: string | null
  title: string
  toolId: Exclude<ToolId, 'home' | 'file-manager' | 'clipboard-history'>
  payloadVersion: number
  state: Record<string, unknown>
  attachments: FileManagerAttachment[]
  createdAt: string
  updatedAt: string
}

export interface FileManagerState {
  schemaVersion: number
  folders: FileManagerFolder[]
  files: FileManagerFile[]
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
