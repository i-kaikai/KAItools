import { parseReleaseNotes, type ReleaseNote } from './releaseNotesParser'

export type { ReleaseNote }
export { parseReleaseNotes }

export let releaseNotes: ReleaseNote[] = []

export function setReleaseNotes(value: ReleaseNote[]): void {
  releaseNotes = value
}
