# Watchalong — Design

**Date:** 2026-08-23
**Status:** Approved

## Purpose

A private site where a handful of friends watch one mp4 together, in sync, with a chat
panel beside the video. Source of the mp4 is a Google Drive share link.

Scale target: 4–6 concurrent viewers, one room at a time in practice. Everything in this
design is sized for that and no larger.

## Decisions (settled during brainstorming)

| Question | Decision | Rejected |
|---|---|---|
| Video source | Ingest once from Drive to local disk, serve as a static file with HTTP Range | Drive `/preview` iframe (opaque player, sync impossible); on-demand proxy (bandwidth × viewers, Drive rate-limits) |
| Playback control | Anyone in the room can play/pause/seek | Host-only; host-with-handover |
| Access | Unguessable room link + nickname | Room password; site password; real accounts |
| Chat persistence | None — in-memory, dies with the room | Disk-backed backlog |
| Subtitles | Not in v1 | — |
| Presence list | Yes | — |
| Playback events in chat | Yes, as system lines | — |
| Deployment | Local dev only for now | tt-server + Cloudflare Tunnel (follow-up) |
| Stack | Single Node/TS process: Express + `ws` + Vite/vanilla-TS client | Next.js (no first-class WS, unused SSR); self-hosting SyncTube |

## Architecture

One Node process. Express serves the built client and Range-serves the mp4; `ws` carries
all realtime traffic on the same port.

```
shared/protocol.ts   message types — the single source of truth, imported by both sides
server/
  index.ts           boot
  http.ts            static · POST /api/rooms · GET /api/rooms/:id · GET /media/:id
  ws.ts              transport glue: parse → validate → reduce → fan out
  room/clock.ts      (playback, serverNow) → effective position          PURE
  room/state.ts      (state, event) → (state, outbound[])                PURE
  room/registry.ts   roomId → Room, subscribers, idle GC
  ingest/driveUrl.ts share link → fileId                                 PURE
  ingest/fetchFile.ts fileId | http url | local path → mp4 on disk
  ingest/index.ts    job orchestration, status, ffprobe duration
client/
  net.ts             WS connect/reconnect + NTP-lite clock offset
  sync.ts            (localTime, targetTime, playing) → Action           PURE
  player.ts          applies Action to <video>, echo guard
  chat.ts presence.ts ui.ts
```

**Organizing rule:** everything that decides *what should happen* is a pure function taking
time as a parameter; everything that touches the world (sockets, `<video>`, disk, Drive)
is a thin adapter containing no decisions. This is what makes the sync logic testable
without a browser.

## Sync protocol

Server holds one authoritative record per room:

```ts
type Playback = {
  playing:  boolean
  position: number   // seconds into the video
  anchorAt: number   // server-clock ms at which `position` was true
  seq:      number   // monotonic
}
```

Effective time is projected, never ticked:

```
effective(pb, serverNow) = pb.playing ? pb.position + (serverNow - pb.anchorAt)/1000
                                      : pb.position
```

The server runs no timer. This stays correct across event-loop stalls and for clients
joining mid-scene.

**Clients send intent, never state.** The server decides, bumps `seq`, and broadcasts to
everyone including the originator — one code path, no "did I send this" special-casing.

`play` and `pause` do not carry a position: the server uses its own effective position, so
a laggy client cannot yank the room. Only `seek` carries a position.

### Clock offset

Client clocks are wrong by seconds; trusting `Date.now()` would poison every projection.
`net.ts` pings every 10s: client sends `t0`, server echoes `tServer`, client computes
`rtt = t1 - t0`, `offset = tServer + rtt/2 - t1`. Keeps the **lowest-RTT sample** of the
last five (least distorted by queueing) and exposes `serverNow()`.

### Drift correction

A 250ms tick (not `timeupdate` — it fires unevenly) computes
`drift = video.currentTime - effective(...)`:

| drift | action |
|---|---|
| > 1.0s | hard seek |
| 0.15–1.0s | `playbackRate` 0.97 if ahead, 1.03 if behind — glides back invisibly |
| < 0.15s | `playbackRate` 1.0, nothing |

### Echo guard

Applying a remote seek fires the video's own `seeked` event, whose handler would emit a
seek intent, which broadcasts, which seeks everyone — forever. Two defenses, both tested
directly: an `applyingRemote` flag around every remote application, and emitters comparing
against the last position we ourselves commanded.

### Deliberate non-goals

- **A buffering client does not pause the room.** It falls behind and is caught up by drift
  correction. Pausing everyone for the slowest connection is the other defensible choice;
  not doing it.
- **No auto-start.** Browsers block programmatic `play()` with audio before a user gesture,
  so the room opens on a nickname + Join screen that supplies the gesture.

## Ingest

`POST /api/rooms { source }` returns a `roomId` immediately and starts an async job.
Room is usable (chat, presence) while `media.status === 'ingesting'`; the player unlocks on
`ready`.

`source` accepts a Drive share link (all four URL shapes plus a bare file id), any direct
http(s) mp4 URL, or a local filesystem path. The Drive path is the fragile one and is
quarantined in one module: request the file, and if Google answers with the virus-scan
interstitial instead of bytes, parse the confirm form's hidden inputs and re-request with
them. Failure modes surface as a room-visible error string, not a stack trace.

Duration comes from `ffprobe` when present, otherwise stays null and the client uses its
own `video.duration`.

## Testing

- Pure modules (`clock`, `state`, `sync`, `driveUrl`) — unit tests, TDD, no I/O.
- `registry` + `ws` — tests against fake connections implementing the `Conn` interface.
- Drive interstitial parsing — tests against a captured HTML fixture.
- Two-browser sync — Playwright: both clients join, one seeks, assert the other converges.

## Deferred

Subtitles · chat persistence · multiple videos per room · host/handover controls ·
pause-on-buffer · deployment to tt-server behind the Cloudflare Tunnel.
