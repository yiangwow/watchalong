import { basename } from 'node:path'

/** Pull a human-usable name out of Content-Disposition. Used only for the room title,
 *  but it comes from a remote server, so the path is stripped rather than trusted. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null

  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)?.[1]
  if (utf8) return safe(decodeURIComponent(utf8.trim()))

  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header)?.[1]
  if (quoted) return safe(quoted)

  const bare = /filename\s*=\s*([^;]+)/i.exec(header)?.[1]
  if (bare) return safe(bare.trim())

  return null
}

function safe(name: string): string | null {
  const b = basename(name.replace(/\\/g, '/')).trim()
  return b && b !== '.' && b !== '..' ? b : null
}
