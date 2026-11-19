import type { ClientMsg } from '../shared/protocol.js'

/** The trust boundary: everything past this point may assume well-formed messages.
 *  Anything unrecognised becomes null and is dropped rather than throwing. */

const MAX_FRAME = 64 * 1024
const KINDS = new Set(['play', 'pause', 'seek'])

export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_FRAME) return null

  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null

  const m = v as Record<string, unknown>
  switch (m.t) {
    case 'hello':
      return typeof m.nick === 'string' ? { t: 'hello', nick: m.nick } : null

    case 'intent': {
      if (typeof m.kind !== 'string' || !KINDS.has(m.kind)) return null
      const kind = m.kind as 'play' | 'pause' | 'seek'
      if (m.position === undefined) return { t: 'intent', kind }
      if (typeof m.position !== 'number' || !Number.isFinite(m.position)) return null
      return { t: 'intent', kind, position: m.position }
    }

    case 'chat':
      return typeof m.text === 'string' ? { t: 'chat', text: m.text } : null

    case 'ping':
      return typeof m.t0 === 'number' && Number.isFinite(m.t0) ? { t: 'ping', t0: m.t0 } : null

    default:
      return null
  }
}
