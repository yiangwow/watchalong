import type { ClientMsg, ServerMsg } from '../shared/protocol.js'
import { OffsetEstimator } from './clock-offset.js'

type Handler = (msg: ServerMsg) => void

/** The socket, plus the clock agreement that makes the server's positions meaningful
 *  on this machine. Reconnects on its own — a dropped wifi should not end movie night. */
export class Net {
  private ws: WebSocket | null = null
  private readonly clock = new OffsetEstimator()
  private handlers = new Set<Handler>()
  private pingTimer: number | null = null
  private retry = 0
  private closedByUs = false
  private nick = ''

  constructor(private readonly roomId: string) {}

  onMessage(fn: Handler): void {
    this.handlers.add(fn)
  }

  /** Server time as best this client can estimate it. */
  serverNow(): number {
    return this.clock.toServer(Date.now())
  }

  get latency(): number {
    return Math.round(this.clock.rtt)
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(nick: string): void {
    this.nick = nick
    this.open()
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(this.roomId)}`)
    this.ws = ws

    ws.addEventListener('open', () => {
      this.retry = 0
      this.send({ t: 'hello', nick: this.nick })
      this.ping()
      this.pingTimer = window.setInterval(() => this.ping(), 10_000)
    })

    ws.addEventListener('message', (ev) => {
      let msg: ServerMsg
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      if (msg.t === 'pong') {
        this.clock.sample(msg.t0, msg.tServer, Date.now())
        return
      }
      for (const h of this.handlers) h(msg)
    })

    ws.addEventListener('close', () => {
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
      this.pingTimer = null
      if (this.closedByUs) return
      // Back off, but never so far that a brief blip feels like being kicked out.
      const wait = Math.min(1000 * 2 ** this.retry++, 10_000)
      window.setTimeout(() => this.open(), wait)
    })
  }

  private ping(): void {
    this.send({ t: 'ping', t0: Date.now() })
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  close(): void {
    this.closedByUs = true
    this.ws?.close()
  }
}
