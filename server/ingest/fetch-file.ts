import { createWriteStream } from 'node:fs'
import { symlink, unlink, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Source } from './drive-url.js'
import { parseConfirmForm } from './drive-confirm.js'
import { filenameFromDisposition } from './filename.js'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export type Progress = (bytes: number, totalBytes?: number) => void
export type Fetched = { title: string | null; bytes: number }

export class IngestError extends Error {}

export async function fetchToFile(
  source: Source,
  dest: string,
  onProgress: Progress,
): Promise<Fetched> {
  switch (source.kind) {
    case 'file':
      return linkLocal(source.path, dest)
    case 'url':
      return download(source.url, dest, onProgress, {})
    case 'drive':
      return downloadFromDrive(source.fileId, dest, onProgress)
  }
}

async function linkLocal(path: string, dest: string): Promise<Fetched> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new IngestError(`No such file on this machine: ${path}`)

  // Symlink rather than copy — a local file is already on this disk once.
  await unlink(dest).catch(() => {})
  await symlink(path, dest)
  return { title: filenameFromDisposition(null) ?? path.split('/').pop() ?? null, bytes: info.size }
}

async function downloadFromDrive(
  fileId: string,
  dest: string,
  onProgress: Progress,
): Promise<Fetched> {
  const first = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`
  const res = await fetch(first, { headers: { 'user-agent': UA } })

  if (!res.ok) {
    throw new IngestError(`Drive refused the download (HTTP ${res.status}).`)
  }

  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('text/html')) {
    return streamToFile(res, dest, onProgress)
  }

  // Google answered with a page instead of bytes: either the virus-scan interstitial
  // (which we can get past) or a permission wall (which we cannot).
  const html = await res.text()
  const form = parseConfirmForm(html)
  if (!form) {
    throw new IngestError(
      'Drive returned a web page instead of the file. The usual cause is that the file ' +
        'is not shared with "Anyone with the link". Check sharing and try again.',
    )
  }

  const url = new URL(form.action)
  for (const [k, v] of Object.entries(form.params)) url.searchParams.set(k, v)

  const cookies = res.headers.getSetCookie?.() ?? []
  const jar = cookies.map((c) => c.split(';')[0]).join('; ')

  return download(url.toString(), dest, onProgress, jar ? { cookie: jar } : {})
}

async function download(
  url: string,
  dest: string,
  onProgress: Progress,
  headers: Record<string, string>,
): Promise<Fetched> {
  const res = await fetch(url, { headers: { 'user-agent': UA, ...headers } })
  if (!res.ok) throw new IngestError(`Download failed (HTTP ${res.status}).`)

  const type = res.headers.get('content-type') ?? ''
  if (type.includes('text/html')) {
    throw new IngestError('That link served a web page, not a video file.')
  }
  return streamToFile(res, dest, onProgress)
}

async function streamToFile(res: Response, dest: string, onProgress: Progress): Promise<Fetched> {
  if (!res.body) throw new IngestError('Server sent an empty response.')

  const totalHeader = res.headers.get('content-length')
  const totalBytes = totalHeader ? Number(totalHeader) : undefined

  let bytes = 0
  let lastReport = 0
  const counted = async function* () {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength
      // Reporting every chunk would flood the room; once a second is plenty.
      const now = Date.now()
      if (now - lastReport > 1000) {
        lastReport = now
        onProgress(bytes, totalBytes)
      }
      yield chunk
    }
  }

  await unlink(dest).catch(() => {})
  await pipeline(Readable.from(counted()), createWriteStream(dest))
  onProgress(bytes, totalBytes)

  return { title: filenameFromDisposition(res.headers.get('content-disposition')), bytes }
}
