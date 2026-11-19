# CLAUDE.md — watchalong

Guidance for Claude Code working in this repository.

## Contents

- [Overview](#overview)
- [Run it](#run-it)
- [Architecture](#architecture)
- [The sync protocol](#the-sync-protocol)
- [Ingest](#ingest)
- [Ports and env vars](#ports-and-env-vars)
- [Testing](#testing)
- [Invariants](#invariants)
- [Deferred](#deferred)

## Overview

Private watch-together site: paste a Google Drive link to an mp4, get a room URL, friends
join with a nickname and watch in sync with a chat panel beside the video.

Sized for 4–6 viewers. Not multi-tenant, no accounts, no persistence.

## Run it

```bash
npm install
npm run dev        # server on :8080 (tsx watch) + vite on :5173 with proxy
npm start          # build client, serve everything from :8080
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

`npm run dev` is the one to use while working — open **:5173**. `npm start` is the
single-process form; open **:8080**.

Sources accepted when creating a room: a Drive share link (any of the four URL shapes, or a
bare file id), any direct http(s) video URL, or an absolute path on this machine. The local
path is what to use for tests — no network, symlinked rather than copied.

## Architecture

One Node process. Express serves the built client and Range-serves the mp4; `ws` carries
realtime traffic on the same port. No database — rooms live in a `Map` and die with the
process.

```
shared/protocol.ts    wire types, imported by BOTH sides
shared/clock.ts       effectivePosition()                        PURE
server/
  index.ts            boot + idle-room sweeper
  http.ts             POST /api/rooms · GET /api/rooms/:id · GET /media/:id · static
  ws.ts               transport glue only — no room rules live here
  parse-client-msg.ts the trust boundary; unrecognised input becomes null
  room/state.ts       reducer (state, event) → (state, outbound[])  PURE
  room/registry.ts    Room fan-out over a `Conn` interface + idle GC
  ingest/drive-url.ts link → fileId, source classification         PURE
  ingest/drive-confirm.ts  virus-scan interstitial → confirm params  PURE
  ingest/filename.ts  Content-Disposition → room title             PURE
  ingest/fetch-file.ts  the network; the only module that does I/O to Drive
  ingest/index.ts     orchestration; never throws, failures become MediaInfo.error
client/
  net.ts              WS + reconnect + NTP-lite clock offset
  clock-offset.ts     OffsetEstimator                              PURE
  sync.ts             decide(local, target) → Correction           PURE
  player.ts           applies corrections to <video>
  room.ts landing.ts dom.ts format.ts styles.css
```

**The organizing rule:** everything that decides *what should happen* is a pure function
with time passed in as a parameter. Everything that touches the world is a thin adapter
containing no decisions. Keep it that way — it is why the sync logic is testable without a
browser.

## The sync protocol

Server holds `Playback { playing, position, anchorAt, seq }` per room and **never runs a
timer**. Effective time is projected: `position + (serverNow - anchorAt)/1000` while
playing. This is why event-loop stalls and late joiners are both non-events.

Clients send **intent**, never state. The server decides and broadcasts to everyone
*including the originator* — one code path.

- `play`/`pause` carry no position; the server uses its own effective position so a laggy
  client cannot yank the room. Only `seek` carries a position.
- Clients estimate their clock offset from the server (ping/pong, keep the lowest-RTT
  sample of the last five). Never use raw `Date.now()` for a projection.
- Drift correction runs on a 250ms tick in three bands: `<0.15s` nothing, `0.15–1.0s`
  nudge `playbackRate` to 0.97/1.03, `>1.0s` hard seek.
- **Intents are emitted only from explicit user actions.** Nothing in the correction path
  may send one. This is what prevents the feedback loop where an applied remote seek fires
  `seeked` → broadcast → everyone seeks → forever. If you add a `video` event listener that
  sends an intent, you have reintroduced that bug.

Measured drift between two Chromium clients on one machine: 60–240ms during playback,
identical frame when paused.

## Ingest

`POST /api/rooms` returns a room id immediately and downloads in the background. The room
is usable for chat while `media.status === 'ingesting'`.

Drive's large-file flow answers the first request with an HTML virus-scan interstitial
rather than bytes; `drive-confirm.ts` extracts the form's hidden params (`confirm`, `uuid`)
and the request is retried with them. A page with no such form means the file is not shared
as *Anyone with the link*, and that is what the error says.

`ingest()` never throws. Every failure becomes `MediaInfo { status: 'error', message }` and
surfaces in the room.

Duration comes from `ffprobe` when available; otherwise null and the client uses
`video.duration`.

## Ports and env vars

| Name | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | http + ws |
| `MEDIA_DIR` | `./media` | where ingested mp4s land (gitignored) |

Vite dev server is `5173` and proxies `/api`, `/media`, `/ws` to `8080`.

Idle rooms are swept after 30 minutes empty, and their media file is deleted with them.

## Testing

`npm test` — 109 tests, all of the pure logic. No mocks: the room fan-out is tested against
a fake `Conn`, the HTTP layer against a real listening server and a real ffmpeg-generated
mp4 (Range behaviour is asserted, since without it seeking silently re-downloads).

Browser-level verification is not in `npm test` — it needs a running server. The scripts
used during development live in the session scratchpad; the checks worth re-running when
touching sync are: two clients converge after play, after seek, and land on the same frame
when paused; a late joiner arrives at the right position; a paused player is left at
`playbackRate` 1.

**Not yet verified against reality:** the Drive confirm-form dance is tested against a
captured-shape fixture, not a live large shared file. The first real Drive ingest is the
proof.

## Invariants

- Never let the correction path emit an intent (see above).
- Never point `<video>` at `/media/:id` before `status === 'ready'` — the browser caches a
  truncated duration from a file still being written.
- Keep `shared/protocol.ts` the only definition of the wire format.
- `parse-client-msg.ts` is the trust boundary; do not add message handling that bypasses it.
- Room ids in paths must match `/^[A-Za-z0-9_-]{6,32}$/` before touching the filesystem.

## Deferred

Subtitles · chat persistence · multiple videos per room · host/handover controls ·
pause-the-room-on-buffer · deployment to tt-server behind the Cloudflare Tunnel.
