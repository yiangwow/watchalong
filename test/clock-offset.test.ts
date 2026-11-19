import { describe, test, expect } from 'vitest'
import { OffsetEstimator } from '../client/clock-offset.js'

describe('OffsetEstimator', () => {
  test('assumes no offset until it has heard from the server', () => {
    expect(new OffsetEstimator().offset).toBe(0)
  })

  test('a perfectly symmetric round trip reveals the raw clock difference', () => {
    const e = new OffsetEstimator()
    // client sent at 1000, server said 6100, reply seen at 1200 → rtt 200, server is +5000
    e.sample(1000, 6100, 1200)
    expect(e.offset).toBe(5000)
  })

  test('prefers the least-delayed sample, because a slow round trip lies most', () => {
    const e = new OffsetEstimator()
    e.sample(1000, 6500, 2000) // rtt 1000 — badly queued, implies offset 5000... but noisy
    e.sample(3000, 8010, 3020) // rtt 20 — clean
    expect(e.offset).toBe(5000)
    expect(e.rtt).toBe(20)
  })

  test('forgets stale samples so the estimate can follow a drifting clock', () => {
    const e = new OffsetEstimator(2)
    e.sample(1000, 6010, 1020) // clean, offset 5000
    e.sample(2000, 9500, 3000) // rtt 1000
    e.sample(4000, 11500, 5000) // rtt 1000 — evicts the first
    expect(e.offset).not.toBe(5000)
  })

  test('converts a local instant into server time', () => {
    const e = new OffsetEstimator()
    e.sample(1000, 6100, 1200)
    expect(e.toServer(2000)).toBe(7000)
  })
})
