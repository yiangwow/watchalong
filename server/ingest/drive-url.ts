/** Turning whatever the user pasted into something fetchable.
 *  Pure string work — the network lives next door in fetch-file.ts. */

const FILE_ID = /^[A-Za-z0-9_-]{25,}$/
const DRIVE_HOSTS = new Set(['drive.google.com', 'drive.usercontent.google.com', 'docs.google.com'])

export function parseDriveFileId(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (FILE_ID.test(s)) return s

  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (!DRIVE_HOSTS.has(url.hostname)) return null

  // .../file/d/<id>/view  — the link the Share button produces
  const inPath = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{25,})/)
  if (inPath?.[1]) return inPath[1]

  // ?id=<id> — open?id=, uc?export=download&id=, usercontent download?id=
  const inQuery = url.searchParams.get('id')
  if (inQuery && FILE_ID.test(inQuery)) return inQuery

  // Folders, docs, and anything else have no single file behind them.
  return null
}

export type Source =
  | { kind: 'drive'; fileId: string }
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string }

export function classifySource(raw: string): Source | null {
  const s = raw.trim()
  if (!s) return null

  const fileId = parseDriveFileId(s)
  if (fileId) return { kind: 'drive', fileId }

  if (/^https?:\/\//i.test(s)) return { kind: 'url', url: s }

  return { kind: 'file', path: s }
}
