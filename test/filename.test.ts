import { describe, test, expect } from 'vitest'
import { filenameFromDisposition } from '../server/ingest/filename.js'

describe('filenameFromDisposition', () => {
  test('reads the plain quoted filename Drive usually sends', () => {
    expect(filenameFromDisposition('attachment; filename="Movie Night.mp4"')).toBe('Movie Night.mp4')
  })

  test('prefers the UTF-8 form when both are present, since it survives accents', () => {
    const h = `attachment; filename="Amelie.mp4"; filename*=UTF-8''Am%C3%A9lie.mp4`
    expect(filenameFromDisposition(h)).toBe('Amélie.mp4')
  })

  test('handles an unquoted filename', () => {
    expect(filenameFromDisposition('attachment; filename=movie.mp4')).toBe('movie.mp4')
  })

  test('strips any path Google might include, so we cannot be walked out of media/', () => {
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"')).toBe('passwd')
  })

  test('returns null when there is no header to read', () => {
    expect(filenameFromDisposition(null)).toBeNull()
    expect(filenameFromDisposition('attachment')).toBeNull()
  })
})
