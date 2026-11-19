import express, { type Express } from 'express'
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { nanoid } from 'nanoid'
import type { RoomRegistry } from './room/registry.js'
import { ingest } from './ingest/index.js'

export type HttpDeps = {
  rooms: RoomRegistry
  mediaDir: string
  clientDir: string
  /** injectable so tests do not have to hit the network */
  startIngest?: typeof ingest
}

const ROOM_ID = /^[A-Za-z0-9_-]{6,32}$/

export function createApp({ rooms, mediaDir, clientDir, startIngest = ingest }: HttpDeps): Express {
  const app = express()
  app.use(express.json({ limit: '16kb' }))

  app.post('/api/rooms', (req, res) => {
    const source = typeof req.body?.source === 'string' ? req.body.source : ''
    if (!source.trim()) {
      return res.status(400).json({ error: 'Paste a Google Drive link (or a video URL) first.' })
    }

    const id = nanoid(10)
    const room = rooms.create(id, 'Loading…')
    const dest = mediaPath(mediaDir, id)

    // Return immediately: the room is usable for chat while the bytes are still arriving.
    void startIngest(source, dest, (media) => room.setMedia(media))

    res.status(201).json({ roomId: id })
  })

  app.get('/api/rooms/:id', (req, res) => {
    const room = rooms.get(req.params.id)
    if (!room) return res.status(404).json({ error: 'No such room.' })
    res.json({ roomId: room.id, media: room.state.media, members: room.state.members.length })
  })

  // express's sendFile handles Range for us, which is what makes seeking work at all.
  app.get('/media/:id', (req, res) => {
    const id = req.params.id
    if (!ROOM_ID.test(id)) return res.status(400).end()

    const file = mediaPath(mediaDir, id)
    if (!existsSync(file)) return res.status(404).end()

    res.sendFile(file, { acceptRanges: true, headers: { 'Content-Type': 'video/mp4' } })
  })

  app.use(express.static(clientDir))

  // Room URLs are client-side routes; hand them the app shell.
  app.get('/r/:id', (_req, res) => res.sendFile(join(clientDir, 'index.html')))

  return app
}

export function mediaPath(mediaDir: string, roomId: string): string {
  return resolve(mediaDir, `${roomId}.mp4`)
}

export async function deleteMedia(mediaDir: string, roomId: string): Promise<void> {
  await unlink(mediaPath(mediaDir, roomId)).catch(() => {})
}
