import type { Playback } from '../shared/protocol.js'
import { effectivePosition } from '../shared/clock.js'
import { decide } from './sync.js'
import type { Net } from './net.js'

const TICK_MS = 250

/** Keeps one <video> aligned with the room.
 *
 *  Intents are emitted ONLY from explicit user actions (the transport bar calls
 *  requestPlay/requestPause/requestSeek). Nothing in the correction path can emit,
 *  which is what stops the classic feedback loop where an applied remote seek fires
 *  `seeked`, which broadcasts, which seeks everyone, forever. */
export class SyncedPlayer {
  private target: Playback = { playing: false, position: 0, anchorAt: 0, seq: 0 }
  private duration: number | null = null
  private timer: number | null = null
  private applyingRemote = false
  private wantsPlay = false
  /** raised when the browser refuses to start audio without a gesture */
  onBlocked: (() => void) | null = null

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly net: Net,
  ) {}

  setDuration(seconds: number | null): void {
    this.duration = seconds
  }

  setTarget(playback: Playback): void {
    this.target = playback
    this.correct()
  }

  /** Where the room is right now, in film seconds. */
  roomPosition(): number {
    return effectivePosition(this.target, this.net.serverNow(), this.duration)
  }

  get playing(): boolean {
    return this.target.playing
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = window.setInterval(() => this.correct(), TICK_MS)
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  // --- user intents -------------------------------------------------------

  requestPlay(): void {
    this.wantsPlay = true
    this.net.send({ t: 'intent', kind: 'play' })
  }

  requestPause(): void {
    this.net.send({ t: 'intent', kind: 'pause' })
  }

  requestSeek(position: number): void {
    this.net.send({ t: 'intent', kind: 'seek', position })
  }

  // --- correction ---------------------------------------------------------

  private correct(): void {
    const video = this.video
    if (!video.duration || Number.isNaN(video.duration)) return

    const c = decide(
      { currentTime: video.currentTime, paused: video.paused, rate: video.playbackRate },
      { position: this.roomPosition(), playing: this.target.playing },
    )

    this.applyingRemote = true
    try {
      if (c.seekTo !== undefined) video.currentTime = c.seekTo
      if (c.rate !== undefined) video.playbackRate = c.rate
      if (c.transport === 'pause') video.pause()
      if (c.transport === 'play') {
        video.play().catch(() => {
          // Autoplay policy: we have no gesture yet. Tell the UI to ask for one.
          if (!this.wantsPlay) this.onBlocked?.()
        })
      }
    } finally {
      this.applyingRemote = false
    }
  }

  get isApplyingRemote(): boolean {
    return this.applyingRemote
  }
}
