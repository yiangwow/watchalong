/** Wire contract. Imported by BOTH client and server — the one thing that keeps
 *  them from silently disagreeing about a message shape mid-movie. */

export type Playback = {
  playing: boolean
  /** seconds into the video */
  position: number
  /** server-clock ms at which `position` was true */
  anchorAt: number
  /** monotonic, bumped on every change */
  seq: number
}

export type Member = { id: string; nick: string }

export type MediaStatus = 'ingesting' | 'ready' | 'error'

export type MediaInfo = {
  status: MediaStatus
  title: string
  /** bytes fetched so far, for the ingesting spinner */
  bytes?: number
  /** total bytes, when Google bothers to tell us */
  totalBytes?: number
  /** seconds, from ffprobe; null when unavailable */
  duration?: number | null
  message?: string
}

export type IntentKind = 'play' | 'pause' | 'seek'

export type ClientMsg =
  | { t: 'hello'; nick: string }
  | { t: 'intent'; kind: IntentKind; position?: number }
  | { t: 'chat'; text: string }
  | { t: 'ping'; t0: number }

export type SystemKind = 'join' | 'leave' | 'play' | 'pause' | 'seek'

export type ServerMsg =
  | {
      t: 'welcome'
      you: Member
      members: Member[]
      playback: Playback
      serverNow: number
      media: MediaInfo
      history: ServerMsg[]
    }
  | { t: 'state'; playback: Playback; serverNow: number }
  | { t: 'chat'; id: string; nick: string; text: string; ts: number }
  | { t: 'system'; id: string; kind: SystemKind; nick: string; position?: number; ts: number }
  | { t: 'presence'; members: Member[] }
  | { t: 'media'; media: MediaInfo }
  | { t: 'pong'; t0: number; tServer: number }
  | { t: 'error'; message: string }

export const MAX_CHAT_LEN = 1000
export const MAX_NICK_LEN = 24
