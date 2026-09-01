import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const versionPath = fileURLToPath(new URL('../VERSION', import.meta.url))
const releaseNotesPath = fileURLToPath(new URL('../RELEASE_NOTES.md', import.meta.url))
const appVersion = readFileSync(versionPath, 'utf8').trim()
const releaseNotesSource = readFileSync(releaseNotesPath, 'utf8')

if (!/^\d+\.\d+\.\d+$/.test(appVersion)) {
  throw new Error(`VERSION must use semantic versioning (x.y.z), received: ${appVersion}`)
}

export const appVersionDefine = {
  __KAITOOLS_VERSION__: JSON.stringify(appVersion),
  __KAITOOLS_RELEASE_NOTES__: JSON.stringify(releaseNotesSource),
}
