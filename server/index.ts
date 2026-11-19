import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp, deleteMedia } from './http.js'
import { RoomRegistry } from './room/registry.js'
import { attachWebSockets } from './ws.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const PORT = Number(process.env.PORT ?? 8080)
const MEDIA_DIR = resolve(process.env.MEDIA_DIR ?? join(root, 'media'))
const CLIENT_DIR = resolve(root, 'dist/client')
/** how long an empty room survives, so a refresh or a bathroom break does not kill it */
const ROOM_IDLE_MS = 30 * 60 * 1000

mkdirSync(MEDIA_DIR, { recursive: true })

const rooms = new RoomRegistry()
const app = createApp({ rooms, mediaDir: MEDIA_DIR, clientDir: CLIENT_DIR })
const server = createServer(app)
attachWebSockets(server, rooms)

setInterval(() => {
  for (const id of rooms.sweep(Date.now(), ROOM_IDLE_MS)) {
    void deleteMedia(MEDIA_DIR, id)
    console.log(`[rooms] swept idle room ${id}`)
  }
}, 60_000).unref()

server.listen(PORT, () => {
  console.log(`watchalong listening on http://localhost:${PORT}`)
  console.log(`  media: ${MEDIA_DIR}`)
})
