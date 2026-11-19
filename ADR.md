# Architectural Decision Records — watchalong

## ADR-001 — Ingest the file rather than stream from Google Drive

**Date:** 2026-08-23
**Status:** Accepted

### Context

The product requirement is "paste a Google Drive link and watch it together". Drive is
hostile to `<video>`: the share link is an HTML page, `uc?export=download` redirects and
serves a virus-scan interstitial for large files, and the endpoints do not reliably provide
the CORS and HTTP Range headers that a `<video>` element needs in order to seek.

Three options were considered:

1. **Drive `/preview` iframe.** Trivial, but the player is opaque — no JS API, no
   `currentTime`, no programmatic play/pause/seek.
2. **On-demand proxy.** Server re-streams Drive bytes with proper Range/CORS. No wait, no
   disk, but costs our bandwidth multiplied by viewers and Drive rate-limits aggressively.
3. **Ingest once to local disk**, serve as a static file.

### Decision

Ingest once to local disk (option 3).

### Consequences

- Full programmatic control of the timeline, which is a hard prerequisite for synced
  playback. Option 1 would have made the core feature impossible — chat plus a manual
  "3, 2, 1, play" countdown is a different, lesser product.
- Seeking is fast and free after the first fetch, and costs no Drive quota during viewing.
- A room is not watchable until ingest finishes. Mitigated by making the room joinable and
  chattable immediately, with progress shown.
- Disk is consumed per room. Mitigated by deleting the media file when the room is swept.
- The Drive interstitial parser is a dependency on undocumented HTML that Google can change
  at any time. Contained to one module, covered by a fixture test, and backed by two
  fallback source types (direct URL, local path) so the app is never wholly blocked by it.

---

## ADR-002 — Server-authoritative anchor, clients send intent

**Date:** 2026-08-23
**Status:** Accepted

### Context

With anyone-can-control playback, every client is both a producer and a consumer of
playback changes. The naive design — each client broadcasts its own `currentTime` — has two
failure modes: clients disagree about "now" because their wall clocks differ by seconds, and
applying a remote change fires the local `play`/`pause`/`seeked` events, which rebroadcast,
which is an infinite loop.

### Decision

The server stores `{ playing, position, anchorAt, seq }` and runs no timer; effective
position is projected arithmetically on demand. Clients send *intent* (`play`, `pause`,
`seek`), never state, and the server broadcasts the resulting state to everyone including
the originator. Clients estimate their offset from the server clock with an NTP-lite
ping/pong and correct drift in three bands (ignore / `playbackRate` nudge / hard seek).

### Consequences

- Late joiners need no special handling — they project the same anchor as everyone else.
- Correctness survives event-loop stalls, because nothing is being counted in real time.
- `play`/`pause` deliberately ignore any client-supplied position, so a lagging client
  cannot drag the room backwards.
- The echo loop is prevented structurally: intents originate only from explicit user
  actions, never from the correction path. This is an invariant, not a convention — adding
  a `video` event listener that sends an intent reintroduces the bug.
- Small correction stutters are traded for smooth convergence via `playbackRate`, which
  costs a slight, deliberate pitch shift for a few seconds after a drift event.

---

## ADR-003 — Custom transport controls instead of the browser's

**Date:** 2026-08-23
**Status:** Accepted

### Context

Native `<video controls>` is free, accessible, and keyboard-ready. Building a control bar is
work and a source of bugs.

### Decision

Build a custom transport bar.

### Consequences

- The decisive reason is that native controls expose a **playback-speed menu**, and playback
  rate is precisely the mechanism the drift corrector uses to converge. A viewer selecting
  1.5× and the sync engine nudging to 0.97 are fighting over one knob, with no way for
  either to know about the other.
- Cost: play/pause, scrub, skip, volume, fullscreen, and their keyboard and ARIA handling
  are ours to maintain. Focus styles, `role="slider"` and arrow-key seeking are implemented;
  this is a smaller accessibility surface than the native element provides and should be
  revisited if the audience widens.
- The bar can show the *room's* position rather than this client's, which is the more
  truthful thing to display.
