import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { MediaInfo } from '../../shared/protocol.js'
import { classifySource } from './drive-url.js'
import { fetchToFile, IngestError } from './fetch-file.js'

const run = promisify(execFile)

export type OnMedia = (media: MediaInfo) => void

/** Fetch the video into `dest`, reporting status as it goes. Never throws: every failure
 *  becomes an `error` MediaInfo, because a broken link should show up in the room rather
 *  than as an unhandled rejection in a log nobody is reading. */
export async function ingest(rawSource: string, dest: string, onMedia: OnMedia): Promise<void> {
  const source = classifySource(rawSource)
  if (!source) {
    onMedia({ status: 'error', title: 'Untitled', message: 'No video source was given.' })
    return
  }

  const fallbackTitle =
    source.kind === 'file' ? (source.path.split('/').pop() ?? 'Video') : 'Video'
  onMedia({ status: 'ingesting', title: fallbackTitle, bytes: 0, duration: null })

  try {
    const { title, bytes } = await fetchToFile(source, dest, (b, total) =>
      onMedia({ status: 'ingesting', title: fallbackTitle, bytes: b, totalBytes: total, duration: null }),
    )
    const duration = await probeDuration(dest)
    onMedia({ status: 'ready', title: title ?? fallbackTitle, bytes, duration })
  } catch (err) {
    const message =
      err instanceof IngestError ? err.message : `Could not fetch the video: ${String(err)}`
    onMedia({ status: 'error', title: fallbackTitle, message })
  }
}

/** Duration is a nicety: it lets the server clamp seeks. When ffprobe is missing the
 *  client falls back to the value the <video> element reports. */
async function probeDuration(path: string): Promise<number | null> {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path,
    ])
    const seconds = Number.parseFloat(stdout.trim())
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  } catch {
    return null
  }
}
