export interface ReleaseNote {
  version: string
  releaseDate: string | null
  changes: string[]
  upgradeNotes: string[]
  draft: boolean
}

type ReleaseSection = 'changes' | 'upgrade' | null

export function parseReleaseNotes(source: string): ReleaseNote[] {
  const notes: Array<Omit<ReleaseNote, 'draft'>> = []
  let current: Omit<ReleaseNote, 'draft'> | null = null
  let section: ReleaseSection = null

  for (const sourceLine of source.split(/\r?\n/)) {
    const line = sourceLine.trim()
    const versionMatch = line.match(/^## v(\d+\.\d+\.\d+)$/)
    if (versionMatch) {
      current = { version: versionMatch[1]!, releaseDate: null, changes: [], upgradeNotes: [] }
      notes.push(current)
      section = null
      continue
    }
    if (!current) continue

    const dateMatch = line.match(/(\d{4}-\d{2}-\d{2}|TBD)\s*$/)
    if (dateMatch) {
      current.releaseDate = dateMatch[1]!.trim()
      continue
    }
    if (line.startsWith('### ')) {
      section = section === null ? 'changes' : 'upgrade'
      continue
    }

    const itemMatch = line.match(/^\-\s+(.+)$/)
    if (!itemMatch || !section) continue
    const item = itemMatch[1]!.trim()
    if (section === 'changes') current.changes.push(item)
    if (section === 'upgrade') current.upgradeNotes.push(item)
  }

  return notes.map((note) => ({
    ...note,
    draft: note.releaseDate === null
      || note.releaseDate === 'TBD'
      || [...note.changes, ...note.upgradeNotes].some((item) => item === 'TBD'),
  }))
}
