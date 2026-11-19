import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'node:http'
import { nanoid } from 'nanoid'
import type { ServerMsg } from '../shared/protocol.js'
import type { Conn, RoomRegistry } from './room/registry.js'
import { parseClientMsg } from './parse-client-msg.js'

/** Thin adapter: parse, look up, hand to the reducer, fan out. No room rules live here. */
export function attachWebSockets(server: Server, rooms: RoomRegistry): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws') return socket.destroy()

    const roomId = url.searchParams.get('room') ?? ''
    const room = rooms.get(roomId)
    if (!room) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      return socket.destroy()
    }

    wss.handleUpgrade(req, socket, head, (ws) => wire(ws, roomId, rooms))
  })

  return wss
}

function wire(ws: WebSocket, roomId: string, rooms: RoomRegistry): void {
  const conn: Conn = {
    id: nanoid(12),
    send: (msg: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
    },
    close: () => ws.close(),
  }

  const room = rooms.get(roomId)
  if (!room) return ws.close()
  room.attach(conn)

  let joined = false

  ws.on('message', (data) => {
    const msg = parseClientMsg(data.toString())
    if (!msg) return

    // A room can be swept while a socket lingers; re-resolve rather than trust the closure.
    const live = rooms.get(roomId)
    if (!live) return ws.close()

    const now = Date.now()
    switch (msg.t) {
      case 'ping':
        return conn.send({ t: 'pong', t0: msg.t0, tServer: now })

      case 'hello':
        if (joined) return
        joined = true
        return live.dispatch({ t: 'join', id: conn.id, nick: msg.nick, now, msgId: nanoid(10) })

      case 'intent':
        return live.dispatch({
          t: 'intent', id: conn.id, kind: msg.kind, position: msg.position, now, msgId: nanoid(10),
        })

      case 'chat':
        return live.dispatch({ t: 'chat', id: conn.id, text: msg.text, now, msgId: nanoid(10) })
    }
  })

  ws.on('close', () => {
    rooms.get(roomId)?.detach(conn.id, Date.now(), nanoid(10))
  })

  ws.on('error', () => ws.close())
}
