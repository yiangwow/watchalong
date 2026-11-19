import { describe, test, expect } from 'vitest'
import { Room, RoomRegistry } from '../server/room/registry.js'
import { createRoom } from '../server/room/state.js'
import type { Conn } from '../server/room/registry.js'
import type { ServerMsg } from '../shared/protocol.js'

const T0 = 1_700_000_000_000

class FakeConn implements Conn {
  received: ServerMsg[] = []
  closed = false
  constructor(readonly id: string) {}
  send(msg: ServerMsg) { this.received.push(msg) }
  close() { this.closed = true }
}

function readyRoom() {
  const s = createRoom('r1', 'Movie')
  return new Room({ ...s, media: { ...s.media, status: 'ready', duration: 600 } })
}

const kinds = (c: FakeConn) => c.received.map((m) => m.t)

describe('Room fan-out', () => {
  test('a broadcast reaches every attached connection', () => {
    const room = readyRoom()
    const a = new FakeConn('a'), b = new FakeConn('b')
    room.attach(a); room.attach(b)

    room.dispatch({ t: 'join', id: 'a', nick: 'irene', now: T0, msgId: 'm1' })

    expect(kinds(b)).toContain('presence')
  })

  test('a welcome goes only to the client it belongs to', () => {
    const room = readyRoom()
    const a = new FakeConn('a'), b = new FakeConn('b')
    room.attach(a); room.attach(b)

    room.dispatch({ t: 'join', id: 'a', nick: 'irene', now: T0, msgId: 'm1' })

    expect(kinds(a)).toContain('welcome')
    expect(kinds(b)).not.toContain('welcome')
  })

  test('the person who caused a playback change is told about it too', () => {
    const room = readyRoom()
    const a = new FakeConn('a')
    room.attach(a)
    room.dispatch({ t: 'join', id: 'a', nick: 'irene', now: T0, msgId: 'm1' })
    a.received.length = 0

    room.dispatch({ t: 'intent', id: 'a', kind: 'play', now: T0, msgId: 'm2' })

    expect(kinds(a)).toContain('state')
  })

  test('a detached connection stops receiving', () => {
    const room = readyRoom()
    const a = new FakeConn('a'), b = new FakeConn('b')
    room.attach(a); room.attach(b)
    room.dispatch({ t: 'join', id: 'a', nick: 'irene', now: T0, msgId: 'm1' })

    room.detach('b', T0, 'm2')
    b.received.length = 0
    room.dispatch({ t: 'chat', id: 'a', text: 'hello', now: T0, msgId: 'c1' })

    expect(b.received).toEqual([])
  })

  test('detaching someone who had joined announces that they left', () => {
    const room = readyRoom()
    const a = new FakeConn('a'), b = new FakeConn('b')
    room.attach(a); room.attach(b)
    room.dispatch({ t: 'join', id: 'b', nick: 'friend', now: T0, msgId: 'm1' })
    a.received.length = 0

    room.detach('b', T0, 'm2')

    const leave = a.received.find((m) => m.t === 'system' && m.kind === 'leave')
    expect(leave).toMatchObject({ nick: 'friend' })
  })

  test('an ingest update is pushed to the room without anyone asking', () => {
    const room = readyRoom()
    const a = new FakeConn('a')
    room.attach(a)
    room.dispatch({ t: 'join', id: 'a', nick: 'irene', now: T0, msgId: 'm1' })
    a.received.length = 0

    room.setMedia({ status: 'ready', title: 'Movie', duration: 600 })

    expect(kinds(a)).toContain('media')
  })
})

describe('RoomRegistry', () => {
  test('hands back the room it created', () => {
    const reg = new RoomRegistry()
    const room = reg.create('r1', 'Movie')
    expect(reg.get('r1')).toBe(room)
  })

  test('returns nothing for a room id that was never created', () => {
    expect(new RoomRegistry().get('nope')).toBeUndefined()
  })

  test('sweeps away a room that has sat empty past the idle window', () => {
    const reg = new RoomRegistry()
    reg.create('r1', 'Movie', T0)

    expect(reg.sweep(T0 + 60_000, 30_000)).toEqual(['r1'])
    expect(reg.get('r1')).toBeUndefined()
  })

  test('keeps a room that still has someone in it, however long it has run', () => {
    const reg = new RoomRegistry()
    const room = reg.create('r1', 'Movie', T0)
    room.attach(new FakeConn('a'))
    room.dispatch({ t: 'join', id: 'a', nick: 'irene', now: T0, msgId: 'm1' })

    expect(reg.sweep(T0 + 10 * 60_000, 30_000)).toEqual([])
    expect(reg.get('r1')).toBeDefined()
  })

  test('gives a just-emptied room time to survive a refresh', () => {
    const reg = new RoomRegistry()
    const room = reg.create('r1', 'Movie', T0)
    const a = new FakeConn('a')
    room.attach(a)
    room.dispatch({ t: 'join', id: 'a', nick: 'irene', now: T0, msgId: 'm1' })
    room.detach('a', T0 + 1000, 'm2')

    expect(reg.sweep(T0 + 5000, 30_000)).toEqual([])
    expect(reg.sweep(T0 + 60_000, 30_000)).toEqual(['r1'])
  })
})
