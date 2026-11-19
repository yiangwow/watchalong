import { describe, test, expect } from 'vitest'
import { parseDriveFileId, classifySource } from '../server/ingest/drive-url.js'

const ID = '1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv'

describe('parseDriveFileId', () => {
  test('reads the id out of the link Drive actually gives you when you hit Share', () => {
    expect(parseDriveFileId(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(ID)
  })

  test('handles the /file/d/ link without a trailing view segment', () => {
    expect(parseDriveFileId(`https://drive.google.com/file/d/${ID}`)).toBe(ID)
  })

  test('handles the older open?id= form', () => {
    expect(parseDriveFileId(`https://drive.google.com/open?id=${ID}`)).toBe(ID)
  })

  test('handles the uc?export=download form', () => {
    expect(parseDriveFileId(`https://drive.google.com/uc?id=${ID}&export=download`)).toBe(ID)
  })

  test('handles the usercontent host that Drive redirects large files to', () => {
    expect(
      parseDriveFileId(`https://drive.usercontent.google.com/download?id=${ID}&export=download`),
    ).toBe(ID)
  })

  test('accepts a bare file id, since that is what people paste half the time', () => {
    expect(parseDriveFileId(ID)).toBe(ID)
  })

  test('ignores surrounding whitespace from a sloppy paste', () => {
    expect(parseDriveFileId(`  https://drive.google.com/file/d/${ID}/view \n`)).toBe(ID)
  })

  test('refuses a Drive folder link, which has no single file to fetch', () => {
    expect(parseDriveFileId(`https://drive.google.com/drive/folders/${ID}`)).toBeNull()
  })

  test('is not fooled by an unrelated URL', () => {
    expect(parseDriveFileId('https://example.com/movie.mp4')).toBeNull()
  })

  test('does not mistake a filename for a file id', () => {
    expect(parseDriveFileId('movie.mp4')).toBeNull()
  })
})

describe('classifySource', () => {
  test('a Drive link is fetched through the Drive path', () => {
    expect(classifySource(`https://drive.google.com/file/d/${ID}/view`)).toEqual({
      kind: 'drive', fileId: ID,
    })
  })

  test('any other http url is fetched directly', () => {
    expect(classifySource('https://example.com/movie.mp4')).toEqual({
      kind: 'url', url: 'https://example.com/movie.mp4',
    })
  })

  test('anything else is treated as a path on this machine', () => {
    expect(classifySource('/home/unix/movies/movie.mp4')).toEqual({
      kind: 'file', path: '/home/unix/movies/movie.mp4',
    })
  })

  test('an empty source is not a valid anything', () => {
    expect(classifySource('   ')).toBeNull()
  })
})
