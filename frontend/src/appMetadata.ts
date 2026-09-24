import { setReleaseNotes, type ReleaseNote } from './releaseNotes'
import { setAppVersion } from './version'

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

export interface AppMetadata {
  version: string
  releaseNotes: ReleaseNote[]
}

let loadedMetadata: AppMetadata | null = null
let loadingMetadata: Promise<AppMetadata> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseReleaseNote(value: unknown, index: number): ReleaseNote {
  if (!isRecord(value)
    || typeof value.version !== 'string'
    || !VERSION_PATTERN.test(value.version)
    || (value.releaseDate !== null && typeof value.releaseDate !== 'string')
    || !Array.isArray(value.changes)
    || !value.changes.every((item): item is string => typeof item === 'string')
    || !Array.isArray(value.upgradeNotes)
    || !value.upgradeNotes.every((item): item is string => typeof item === 'string')
    || typeof value.draft !== 'boolean') {
    throw new Error(`Invalid app metadata release note at index ${index}`)
  }
  return {
    version: value.version,
    releaseDate: value.releaseDate,
    changes: [...value.changes],
    upgradeNotes: [...value.upgradeNotes],
    draft: value.draft,
  }
}

function parseMetadata(value: unknown): AppMetadata {
  if (!isRecord(value) || typeof value.version !== 'string' || !VERSION_PATTERN.test(value.version) || !Array.isArray(value.releaseNotes)) {
    throw new Error('Invalid app metadata')
  }
  const metadata = {
    version: value.version,
    releaseNotes: value.releaseNotes.map(parseReleaseNote),
  }
  setAppVersion(metadata.version)
  setReleaseNotes(metadata.releaseNotes)
  loadedMetadata = metadata
  return metadata
}

export function initializeAppMetadata(value: unknown): AppMetadata {
  return parseMetadata(value)
}

export function loadAppMetadata(): Promise<AppMetadata> {
  if (loadedMetadata) return Promise.resolve(loadedMetadata)
  if (loadingMetadata) return loadingMetadata
  loadingMetadata = fetch(`${import.meta.env.BASE_URL}app-metadata.json`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`App metadata request failed: ${response.status}`)
      return response.json() as Promise<unknown>
    })
    .then(parseMetadata)
    .finally(() => {
      loadingMetadata = null
    })
  return loadingMetadata
}
