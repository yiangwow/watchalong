import { describe, test, expect } from 'vitest'
import { createRoom, reduce } from '../server/room/state.js'
import type { RoomState, RoomEvent } from '../server/room/state.js'
import type { ServerMsg } from '../shared/protocol.js'

const T0 = 1_700_000_000_000

function ready(duration: number | null = 600): RoomState {
  const s = createRoom('room1', 'Movie Night')
  return { ...s, media: { ...s.media, status: 'ready', duration } }
}

/** join a member, returning the room only — most tests do not care about the welcome */
function join(state: RoomState, id: string, nick: string, now = T0): RoomState {
  return reduce(state, { t: 'join', id, nick, now, msgId: 'm-' + id }).state
}

const broadcasts = (out: { to: string; msg: ServerMsg }[], t: string) =>
  out.filter((o) => o.msg.t === t)

describe('membership', () => {
  test('join adds the member and tells everyone who is now present', () => {
    const { state, out } = reduce(ready(), {
      t: 'join', id: 'a', nick: 'irene', now: T0, msgId: 'm1',
    } satisfies RoomEvent)

    expect(state.members).toEqual([{ id: 'a', nick: 'irene' }])
    const presence = broadcasts(out, 'presence')
    expect(presence).toHaveLength(1)
    expect(presence[0]!.to).toBe('all')
  })

  test('the joiner alone receives a welcome carrying current playback', () => {
    const base = { ...ready(), playback: { playing: true, position: 30, anchorAt: T0, seq: 7 } }
    const { out } = reduce(base, { t: 'join', id: 'a', nick: 'irene', now: T0, msgId: 'm1' })

    const welcome = out.find((o) => o.msg.t === 'welcome')
    expect(welcome?.to).toBe('a')
    expect(welcome?.msg).toMatchObject({ t: 'welcome', playback: { position: 30, seq: 7 } })
  })

  test('a blank nickname becomes anon rather than an empty label', () => {
    const { state } = reduce(ready(), { t: 'join', id: 'a', nick: '   ', now: T0, msgId: 'm1' })
    expect(state.members[0]!.nick).toBe('anon')
  })

  test('leaving removes the member and announces it', () => {
    const s = join(ready(), 'a', 'irene')
    const { state, out } = reduce(s, { t: 'leave', id: 'a', now: T0, msgId: 'm2' })

    expect(state.members).toEqual([])
    expect(broadcasts(out, 'system')[0]!.msg).toMatchObject({ kind: 'leave', nick: 'irene' })
  })

  test('leaving a room you were never in changes nothing and says nothing', () => {
    const s = ready()
    const { state, out } = reduce(s, { t: 'leave', id: 'ghost', now: T0, msgId: 'm2' })
    expect(state).toBe(s)
    expect(out).toEqual([])
  })
})

describe('playback intents', () => {
  test('play starts the clock from where the room was paused', () => {
    const s = { ...join(ready(), 'a', 'irene'), playback: { playing: false, position: 42, anchorAt: T0 - 9999, seq: 1 } }
    const { state } = reduce(s, { t: 'intent', id: 'a', kind: 'play', now: T0, msgId: 'm3' })

    expect(state.playback).toMatchObject({ playing: true, position: 42, anchorAt: T0, seq: 2 })
  })

  test('play ignores any position the client claims, so a laggy peer cannot yank the room', () => {
    const s = { ...join(ready(), 'a', 'irene'), playback: { playing: false, position: 42, anchorAt: T0, seq: 1 } }
    const { state } = reduce(s, { t: 'intent', id: 'a', kind: 'play', position: 999, now: T0, msgId: 'm3' })

    expect(state.playback.position).toBe(42)
  })

  test('pause freezes at the position the room had actually reached', () => {
    const s = { ...join(ready(), 'a', 'irene'), playback: { playing: true, position: 10, anchorAt: T0, seq: 1 } }
    const { state } = reduce(s, { t: 'intent', id: 'a', kind: 'pause', now: T0 + 5000, msgId: 'm3' })

    expect(state.playback).toMatchObject({ playing: false, position: 15, seq: 2 })
  })

  test('seek moves the room without changing whether it is playing', () => {
    const s = { ...join(ready(), 'a', 'irene'), playback: { playing: true, position: 10, anchorAt: T0, seq: 1 } }
    const { state } = reduce(s, { t: 'intent', id: 'a', kind: 'seek', position: 300, now: T0 + 5000, msgId: 'm3' })

    expect(state.playback).toMatchObject({ playing: true, position: 300, anchorAt: T0 + 5000, seq: 2 })
  })

  test('seek past the end lands on the end rather than nowhere', () => {
    const s = join(ready(600), 'a', 'irene')
    const { state } = reduce(s, { t: 'intent', id: 'a', kind: 'seek', position: 99_999, now: T0, msgId: 'm3' })
    expect(state.playback.position).toBe(600)
  })

  test('a playback change is broadcast to everyone, including whoever caused it', () => {
    const s = join(ready(), 'a', 'irene')
    const { out } = reduce(s, { t: 'intent', id: 'a', kind: 'play', now: T0, msgId: 'm3' })

    expect(broadcasts(out, 'state')[0]!.to).toBe('all')
  })

  test('a playback change narrates itself in chat', () => {
    const s = { ...join(ready(), 'a', 'irene'), playback: { playing: true, position: 10, anchorAt: T0, seq: 1 } }
    const { out } = reduce(s, { t: 'intent', id: 'a', kind: 'pause', now: T0 + 2000, msgId: 'm3' })

    expect(broadcasts(out, 'system')[0]!.msg).toMatchObject({
      kind: 'pause', nick: 'irene', position: 12,
    })
  })

  test('intents are refused while the video is still being ingested', () => {
    const s = join(createRoom('room1', 'Movie Night'), 'a', 'irene')
    const { state, out } = reduce(s, { t: 'intent', id: 'a', kind: 'play', now: T0, msgId: 'm3' })

    expect(state.playback.playing).toBe(false)
    expect(out).toEqual([])
  })

  test('intents from someone who never joined are ignored', () => {
    const s = ready()
    const { state, out } = reduce(s, { t: 'intent', id: 'ghost', kind: 'play', now: T0, msgId: 'm3' })
    expect(state).toBe(s)
    expect(out).toEqual([])
  })
})

describe('chat', () => {
  test('a message is broadcast with the sender resolved to their nickname', () => {
    const s = join(ready(), 'a', 'irene')
    const { out } = reduce(s, { t: 'chat', id: 'a', text: 'this bit is great', now: T0, msgId: 'c1' })

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      to: 'all',
      msg: { t: 'chat', nick: 'irene', text: 'this bit is great', id: 'c1' },
    })
  })

  test('whitespace-only messages are dropped instead of broadcast as blanks', () => {
    const s = join(ready(), 'a', 'irene')
    const { out } = reduce(s, { t: 'chat', id: 'a', text: '   \n ', now: T0, msgId: 'c1' })
    expect(out).toEqual([])
  })

  test('an overlong message is truncated rather than rejected', () => {
    const s = join(ready(), 'a', 'irene')
    const { out } = reduce(s, { t: 'chat', id: 'a', text: 'x'.repeat(5000), now: T0, msgId: 'c1' })

    const msg = out[0]!.msg as Extract<ServerMsg, { t: 'chat' }>
    expect(msg.text).toHaveLength(1000)
  })
})

describe('backlog', () => {
  test('a client joining late is welcomed with what it missed', () => {
    let s = join(ready(), 'a', 'irene')
    s = reduce(s, { t: 'chat', id: 'a', text: 'starting now', now: T0, msgId: 'c1' }).state

    const { out } = reduce(s, { t: 'join', id: 'b', nick: 'friend', now: T0, msgId: 'm9' })
    const welcome = out.find((o) => o.msg.t === 'welcome')!.msg as Extract<ServerMsg, { t: 'welcome' }>

    expect(welcome.history.some((m) => m.t === 'chat' && m.text === 'starting now')).toBe(true)
  })

  test('the backlog is capped so a long night cannot grow without bound', () => {
    let s = join(ready(), 'a', 'irene')
    for (let i = 0; i < 500; i++) {
      s = reduce(s, { t: 'chat', id: 'a', text: `m${i}`, now: T0, msgId: `c${i}` }).state
    }
    expect(s.log.length).toBeLessThanOrEqual(200)
  })
})

describe('media', () => {
  test('ingest completing tells the room the video is ready', () => {
    const s = join(createRoom('room1', 'Movie Night'), 'a', 'irene')
    const { state, out } = reduce(s, {
      t: 'media', media: { status: 'ready', title: 'Movie Night', duration: 600 },
    })

    expect(state.media.status).toBe('ready')
    expect(broadcasts(out, 'media')[0]!.to).toBe('all')
  })
})
