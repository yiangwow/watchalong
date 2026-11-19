import { describe, test, expect } from 'vitest'
import { timecode, clockTime } from '../client/format.js'

describe('timecode', () => {
  test('shows minutes and seconds for a short film', () => {
    expect(timecode(72)).toBe('01:12')
  })

  test('grows an hours field only once there are hours to show', () => {
    expect(timecode(3599)).toBe('59:59')
    expect(timecode(3600)).toBe('1:00:00')
  })

  test('pads so the digits never jitter as the film runs', () => {
    expect(timecode(5)).toBe('00:05')
    expect(timecode(4265)).toBe('1:11:05')
  })

  test('floors rather than rounds, so it never shows a second that has not happened', () => {
    expect(timecode(59.99)).toBe('00:59')
  })

  test('treats a missing or nonsense duration as zero rather than NaN', () => {
    expect(timecode(NaN)).toBe('00:00')
    expect(timecode(-3)).toBe('00:00')
    expect(timecode(Infinity)).toBe('00:00')
  })
})

describe('clockTime', () => {
  test('renders a wall-clock stamp for chat lines', () => {
    expect(clockTime(new Date(2026, 7, 23, 21, 5).getTime())).toBe('21:05')
  })

  test('pads the hour so the chat column stays aligned', () => {
    expect(clockTime(new Date(2026, 7, 23, 9, 5).getTime())).toBe('09:05')
  })
})
