import { describe, test, expect } from 'vitest'
import { decide, SOFT_BAND, HARD_BAND, SLOW_RATE, FAST_RATE } from '../client/sync.js'

const local = (currentTime: number, paused = false, rate = 1) => ({ currentTime, paused, rate })
const target = (position: number, playing = true) => ({ position, playing })

describe('drift correction while playing', () => {
  test('leaves an aligned player completely alone', () => {
    expect(decide(local(100.02), target(100))).toEqual({})
  })

  test('slows a player that has run ahead, instead of yanking it back', () => {
    const c = decide(local(100.5), target(100))
    expect(c).toEqual({ rate: SLOW_RATE })
  })

  test('speeds up a player that has fallen behind', () => {
    const c = decide(local(99.5), target(100))
    expect(c).toEqual({ rate: FAST_RATE })
  })

  test('hard-seeks once drift is too large to glide away', () => {
    const c = decide(local(140), target(100))
    expect(c).toEqual({ seekTo: 100, rate: 1 })
  })

  test('restores normal speed once the nudge has done its job', () => {
    const c = decide(local(100.02, false, FAST_RATE), target(100))
    expect(c).toEqual({ rate: 1 })
  })

  test('does not re-issue a nudge that is already in effect', () => {
    const c = decide(local(100.5, false, SLOW_RATE), target(100))
    expect(c).toEqual({})
  })

  test('the soft band ends exactly where the hard band begins', () => {
    expect(SOFT_BAND).toBeLessThan(HARD_BAND)
    expect(decide(local(100 + HARD_BAND + 0.01), target(100)).seekTo).toBe(100)
    expect(decide(local(100 + SOFT_BAND + 0.01), target(100)).rate).toBe(SLOW_RATE)
  })
})

describe('transport', () => {
  test('starts a locally paused player when the room is playing', () => {
    expect(decide(local(100, true), target(100)).transport).toBe('play')
  })

  test('pauses a locally playing player when the room has paused', () => {
    expect(decide(local(100), target(100, false)).transport).toBe('pause')
  })

  test('says nothing about transport when it already matches', () => {
    expect(decide(local(100), target(100)).transport).toBeUndefined()
    expect(decide(local(100, true), target(100, false)).transport).toBeUndefined()
  })
})

describe('drift correction while paused', () => {
  test('corrects a paused player by seeking, since rate cannot help a stopped video', () => {
    const c = decide(local(100.5, true), target(100, false))
    expect(c).toEqual({ seekTo: 100 })
  })

  test('restores normal speed when the room pauses mid-nudge', () => {
    // otherwise a player left at 0.97 resumes slightly slow until the next tick
    expect(decide(local(100, true, FAST_RATE), target(100, false))).toEqual({ rate: 1 })
  })

  test('tolerates sub-frame differences on a paused player', () => {
    expect(decide(local(100.02, true), target(100, false))).toEqual({})
  })
})
