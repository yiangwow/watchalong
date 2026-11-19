import type { MediaInfo, ServerMsg } from '../../shared/protocol.js'
import { createRoom, reduce, type RoomEvent, type RoomState } from './state.js'

/** The only thing a room needs to know about a client. Keeping it this small is what
 *  lets the whole fan-out layer be tested without a WebSocket. */
export interface Conn {
  readonly id: string
  send(msg: ServerMsg): void
  close(): void
}

export class Room {
  private conns = new Map<string, Conn>()
  /** when the room last had nobody in it; null while occupied */
  emptySince: number | null = null

  constructor(public state: RoomState) {}

  get id(): string {
    return this.state.id
  }

  attach(conn: Conn): void {
    this.conns.set(conn.id, conn)
  }

  detach(connId: string, now: number, msgId: string): void {
    this.conns.delete(connId)
    this.dispatch({ t: 'leave', id: connId, now, msgId })
    if (this.state.members.length === 0) this.emptySince = now
  }

  dispatch(event: RoomEvent): void {
    const { state, out } = reduce(this.state, event)
    this.state = state
    if (state.members.length > 0) this.emptySince = null

    for (const { to, msg } of out) {
      if (to === 'all') {
        for (const conn of this.conns.values()) conn.send(msg)
      } else {
        this.conns.get(to)?.send(msg)
      }
    }
  }

  setMedia(media: MediaInfo): void {
    this.dispatch({ t: 'media', media })
  }

  closeAll(): void {
    for (const conn of this.conns.values()) conn.close()
    this.conns.clear()
  }
}

export class RoomRegistry {
  private rooms = new Map<string, Room>()

  create(id: string, title: string, now = Date.now()): Room {
    const room = new Room(createRoom(id, title))
    room.emptySince = now
    this.rooms.set(id, room)
    return room
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id)
  }

  /** Drop rooms nobody has been in for `idleMs`. Returns the ids removed so the caller
   *  can delete their media files. */
  sweep(now: number, idleMs: number): string[] {
    const removed: string[] = []
    for (const [id, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince >= idleMs) {
        room.closeAll()
        this.rooms.delete(id)
        removed.push(id)
      }
    }
    return removed
  }
}
