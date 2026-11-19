import { describe, test, expect } from 'vitest'
import { effectivePosition } from '../shared/clock.js'
import type { Playback } from '../shared/protocol.js'

const pb = (o: Partial<Playback> = {}): Playback => ({
  playing: false, position: 0, anchorAt: 1_000_000, seq: 1, ...o,
})

describe('effectivePosition', () => {
  test('a paused room stays at its anchored position however much time passes', () => {
    expect(effectivePosition(pb({ playing: false, position: 42 }), 1_999_999)).toBe(42)
  })

  test('a playing room advances by the wall time since its anchor', () => {
    const p = pb({ playing: true, position: 10, anchorAt: 1_000_000 })
    expect(effectivePosition(p, 1_003_500)).toBeCloseTo(13.5, 6)
  })

  test('never returns a negative position when the clock runs backwards', () => {
    const p = pb({ playing: true, position: 1, anchorAt: 1_000_000 })
    expect(effectivePosition(p, 990_000)).toBe(0)
  })

  test('clamps to duration so a finished video does not project past its end', () => {
    const p = pb({ playing: true, position: 100, anchorAt: 1_000_000 })
    expect(effectivePosition(p, 1_060_000, 120)).toBe(120)
  })

  test('ignores duration when it is unknown', () => {
    const p = pb({ playing: true, position: 100, anchorAt: 1_000_000 })
    expect(effectivePosition(p, 1_060_000, null)).toBe(160)
  })
})
