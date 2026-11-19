/** The drift decision, isolated from the <video> element so it can be tested as
 *  arithmetic rather than as a browser. */

/** Below this, do nothing — chasing sub-frame differences only causes stutter. */
export const SOFT_BAND = 0.15
/** Above this, gliding would take too long to converge; jump instead. */
export const HARD_BAND = 1.0
export const SLOW_RATE = 0.97
export const FAST_RATE = 1.03

export type LocalPlayer = { currentTime: number; paused: boolean; rate: number }
export type RoomTarget = { position: number; playing: boolean }

export type Correction = {
  seekTo?: number
  rate?: number
  transport?: 'play' | 'pause'
}

export function decide(local: LocalPlayer, target: RoomTarget): Correction {
  const c: Correction = {}

  if (target.playing === local.paused) c.transport = target.playing ? 'play' : 'pause'

  const drift = local.currentTime - target.position

  if (!target.playing) {
    // A stopped video cannot converge on its own, so any real gap is a seek.
    if (Math.abs(drift) > SOFT_BAND) c.seekTo = target.position
    // Drop any nudge still in effect, so resuming does not start off-speed.
    if (local.rate !== 1) c.rate = 1
    return c
  }

  if (Math.abs(drift) > HARD_BAND) {
    c.seekTo = target.position
    c.rate = 1
    return c
  }

  const wanted = Math.abs(drift) > SOFT_BAND ? (drift > 0 ? SLOW_RATE : FAST_RATE) : 1
  if (wanted !== local.rate) c.rate = wanted
  return c
}
