import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApp, mediaPath } from '../server/http.js'
import { RoomRegistry } from '../server/room/registry.js'
import type { MediaInfo } from '../shared/protocol.js'

const run = promisify(execFile)

let server: Server
let base: string
let mediaDir: string
let rooms: RoomRegistry
let ingestCalls: string[]

/** stands in for the network: records the source and reports the video ready */
const fakeIngest = async (source: string, _dest: string, onMedia: (m: MediaInfo) => void) => {
  ingestCalls.push(source)
  onMedia({ status: 'ready', title: 'Fixture', duration: 2 })
}

beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), 'watchalong-'))
  rooms = new RoomRegistry()
  ingestCalls = []

  const app = createApp({ rooms, mediaDir, clientDir: mediaDir, startIngest: fakeIngest })
  server = createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await rm(mediaDir, { recursive: true, force: true })
})

const post = (path: string, body: unknown) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/rooms', () => {
  test('creating a room hands back an id and kicks off the ingest', async () => {
    const res = await post('/api/rooms', { source: 'https://example.com/movie.mp4' })
    expect(res.status).toBe(201)

    const { roomId } = (await res.json()) as { roomId: string }
    expect(rooms.get(roomId)).toBeDefined()
    expect(ingestCalls).toContain('https://example.com/movie.mp4')
  })

  test('refuses to create a room with nothing to play', async () => {
    const res = await post('/api/rooms', { source: '   ' })
    expect(res.status).toBe(400)
  })

  test('the room is reachable for chat before the video has finished arriving', async () => {
    const slow = async (_s: string, _d: string, _cb: (m: MediaInfo) => void) => {}
    const app = createApp({ rooms, mediaDir, clientDir: mediaDir, startIngest: slow })
    const s = createServer(app)
    await new Promise<void>((r) => s.listen(0, r))
    const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`

    const { roomId } = (await (
      await fetch(b + '/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'x' }),
      })
    ).json()) as { roomId: string }

    const info = await (await fetch(b + `/api/rooms/${roomId}`)).json()
    expect(info.media.status).toBe('ingesting')
    await new Promise<void>((r) => s.close(() => r()))
  })
})

describe('GET /api/rooms/:id', () => {
  test('reports the media status of a live room', async () => {
    const { roomId } = (await (await post('/api/rooms', { source: 'x' })).json()) as { roomId: string }
    const info = await (await fetch(`${base}/api/rooms/${roomId}`)).json()
    expect(info.media).toMatchObject({ status: 'ready', title: 'Fixture' })
  })

  test('404s for a room that does not exist', async () => {
    expect((await fetch(`${base}/api/rooms/nosuchroom`)).status).toBe(404)
  })
})

describe('GET /media/:id', () => {
  let roomId: string

  beforeAll(async () => {
    roomId = (await (await post('/api/rooms', { source: 'x' })).json() as { roomId: string }).roomId
    // a real, tiny mp4 — Range behaviour is the point of these tests
    await run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaPath(mediaDir, roomId),
    ])
  })

  test('serves the whole file when no range is asked for', async () => {
    const res = await fetch(`${base}/media/${roomId}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('video/mp4')
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0)
  })

  test('advertises range support, without which the video cannot be seeked', async () => {
    const res = await fetch(`${base}/media/${roomId}`)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
  })

  test('serves a partial range so seeking does not re-download the film', async () => {
    const res = await fetch(`${base}/media/${roomId}`, { headers: { Range: 'bytes=100-199' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toMatch(/^bytes 100-199\//)
    expect((await res.arrayBuffer()).byteLength).toBe(100)
  })

  test('rejects a room id shaped like a path traversal', async () => {
    expect((await fetch(`${base}/media/..%2F..%2Fetc%2Fpasswd`)).status).toBe(400)
  })

  test('404s when the room exists but the file is not there yet', async () => {
    const { roomId: fresh } = (await (await post('/api/rooms', { source: 'x' })).json()) as {
      roomId: string
    }
    expect((await fetch(`${base}/media/${fresh}`)).status).toBe(404)
  })
})
