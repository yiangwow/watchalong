import {
  MAX_CHAT_LEN,
  MAX_NICK_LEN,
  type IntentKind,
  type MediaInfo,
  type Member,
  type Playback,
  type ServerMsg,
} from '../../shared/protocol.js'
import { effectivePosition } from '../../shared/clock.js'

const LOG_CAP = 200

export type RoomState = {
  id: string
  media: MediaInfo
  playback: Playback
  members: Member[]
  /** recent chat + system lines, replayed to anyone who joins or refreshes */
  log: ServerMsg[]
}

export type RoomEvent =
  | { t: 'join'; id: string; nick: string; now: number; msgId: string }
  | { t: 'leave'; id: string; now: number; msgId: string }
  | { t: 'intent'; id: string; kind: IntentKind; position?: number; now: number; msgId: string }
  | { t: 'chat'; id: string; text: string; now: number; msgId: string }
  | { t: 'media'; media: MediaInfo }

export type Outbound = { to: 'all' | string; msg: ServerMsg }
export type Reduced = { state: RoomState; out: Outbound[] }

export function createRoom(id: string, title: string): RoomState {
  return {
    id,
    media: { status: 'ingesting', title, duration: null },
    playback: { playing: false, position: 0, anchorAt: 0, seq: 0 },
    members: [],
    log: [],
  }
}

/** The whole decision surface of a room. Pure: time and ids arrive as parameters, so
 *  every rule here is testable without a socket, a clock, or a browser. */
export function reduce(state: RoomState, event: RoomEvent): Reduced {
  switch (event.t) {
    case 'join':
      return onJoin(state, event)
    case 'leave':
      return onLeave(state, event)
    case 'intent':
      return onIntent(state, event)
    case 'chat':
      return onChat(state, event)
    case 'media':
      return onMedia(state, event)
  }
}

function onJoin(state: RoomState, e: Extract<RoomEvent, { t: 'join' }>): Reduced {
  const nick = cleanNick(e.nick)
  const members = [...state.members.filter((m) => m.id !== e.id), { id: e.id, nick }]
  const system: ServerMsg = { t: 'system', id: e.msgId, kind: 'join', nick, ts: e.now }
  const next = { ...state, members, log: append(state.log, system) }

  const welcome: ServerMsg = {
    t: 'welcome',
    you: { id: e.id, nick },
    members,
    playback: state.playback,
    serverNow: e.now,
    media: state.media,
    history: state.log,
  }
  return {
    state: next,
    out: [
      { to: e.id, msg: welcome },
      { to: 'all', msg: { t: 'presence', members } },
      { to: 'all', msg: system },
    ],
  }
}

function onLeave(state: RoomState, e: Extract<RoomEvent, { t: 'leave' }>): Reduced {
  const member = state.members.find((m) => m.id === e.id)
  if (!member) return { state, out: [] }

  const members = state.members.filter((m) => m.id !== e.id)
  const system: ServerMsg = { t: 'system', id: e.msgId, kind: 'leave', nick: member.nick, ts: e.now }
  return {
    state: { ...state, members, log: append(state.log, system) },
    out: [
      { to: 'all', msg: { t: 'presence', members } },
      { to: 'all', msg: system },
    ],
  }
}

function onIntent(state: RoomState, e: Extract<RoomEvent, { t: 'intent' }>): Reduced {
  const member = state.members.find((m) => m.id === e.id)
  if (!member) return { state, out: [] }
  // Nothing to control until there are bytes on disk to control.
  if (state.media.status !== 'ready') return { state, out: [] }

  const duration = state.media.duration ?? null
  const here = effectivePosition(state.playback, e.now, duration)
  let playback: Playback

  switch (e.kind) {
    case 'play':
      // Deliberately ignores any client-supplied position: play means "resume from where
      // the room is", not "resume from where my possibly-stale player is".
      playback = { playing: true, position: here, anchorAt: e.now, seq: state.playback.seq + 1 }
      break
    case 'pause':
      playback = { playing: false, position: here, anchorAt: e.now, seq: state.playback.seq + 1 }
      break
    case 'seek': {
      const want = Number.isFinite(e.position) ? (e.position as number) : here
      const position = clamp(want, duration)
      playback = { ...state.playback, position, anchorAt: e.now, seq: state.playback.seq + 1 }
      break
    }
  }

  const system: ServerMsg = {
    t: 'system',
    id: e.msgId,
    kind: e.kind,
    nick: member.nick,
    position: round(playback.position),
    ts: e.now,
  }
  return {
    state: { ...state, playback, log: append(state.log, system) },
    out: [
      { to: 'all', msg: { t: 'state', playback, serverNow: e.now } },
      { to: 'all', msg: system },
    ],
  }
}

function onChat(state: RoomState, e: Extract<RoomEvent, { t: 'chat' }>): Reduced {
  const member = state.members.find((m) => m.id === e.id)
  if (!member) return { state, out: [] }

  const text = e.text.trim().slice(0, MAX_CHAT_LEN)
  if (!text) return { state, out: [] }

  const msg: ServerMsg = { t: 'chat', id: e.msgId, nick: member.nick, text, ts: e.now }
  return { state: { ...state, log: append(state.log, msg) }, out: [{ to: 'all', msg }] }
}

function onMedia(state: RoomState, e: Extract<RoomEvent, { t: 'media' }>): Reduced {
  return {
    state: { ...state, media: e.media },
    out: [{ to: 'all', msg: { t: 'media', media: e.media } }],
  }
}

function append(log: ServerMsg[], msg: ServerMsg): ServerMsg[] {
  const next = [...log, msg]
  return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next
}

function cleanNick(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NICK_LEN) || 'anon'
}

function clamp(v: number, duration: number | null): number {
  const floored = Math.max(0, v)
  return duration != null && duration > 0 ? Math.min(floored, duration) : floored
}

const round = (n: number) => Math.round(n * 1000) / 1000
