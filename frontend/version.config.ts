import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import type { Plugin } from 'vite'

import { parseReleaseNotes, type ReleaseNote } from './src/releaseNotesParser.ts'

const versionPath = fileURLToPath(new URL('../VERSION', import.meta.url))
const releaseNotesPath = fileURLToPath(new URL('../RELEASE_NOTES.md', import.meta.url))

export interface AppMetadataPayload {
  version: string
  releaseNotes: ReleaseNote[]
}

export function readAppMetadata(): AppMetadataPayload {
  const version = readFileSync(versionPath, 'utf8').trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`VERSION must use semantic versioning (x.y.z), received: ${version}`)
  }
  return {
    version,
    releaseNotes: parseReleaseNotes(readFileSync(releaseNotesPath, 'utf8')),
  }
}

function serializedAppMetadata(): string {
  return `${JSON.stringify(readAppMetadata())}\n`
}

export function appMetadataPlugin(): Plugin {
  return {
    name: 'kaitools-app-metadata',
    configureServer(server) {
      server.middlewares.use('/app-metadata.json', (_request, response) => {
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(serializedAppMetadata())
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'app-metadata.json',
        source: serializedAppMetadata(),
      })
    },
  }
}
