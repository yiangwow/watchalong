import type { Playback } from './protocol.js'

/** Project a playback anchor onto a point in time.
 *
 *  The server never ticks a timer — it stores "position P was true at instant A" and
 *  derives everything else. That keeps the room correct across event-loop stalls and
 *  makes a client joining mid-scene identical to one that was here all along. */
export function effectivePosition(
  pb: Playback,
  serverNow: number,
  duration?: number | null,
): number {
  const raw = pb.playing ? pb.position + (serverNow - pb.anchorAt) / 1000 : pb.position
  const floored = Math.max(0, raw)
  return duration != null && duration > 0 ? Math.min(floored, duration) : floored
}
