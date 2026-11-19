import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfirmForm } from '../server/ingest/drive-confirm.js'

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')

describe('parseConfirmForm', () => {
  test('turns the virus-scan interstitial into the request that actually downloads', () => {
    const form = parseConfirmForm(fixture('drive-confirm.html'))

    expect(form).not.toBeNull()
    expect(form!.action).toBe('https://drive.usercontent.google.com/download')
    expect(form!.params).toMatchObject({
      id: '1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv',
      export: 'download',
      confirm: 't',
      uuid: '7f9c1e22-0b4a-4f31-9d55-2c3a1b0e8d77',
    })
  })

  test('drops the submit button, which is not a parameter', () => {
    const form = parseConfirmForm(fixture('drive-confirm.html'))
    expect(Object.keys(form!.params)).toEqual(['id', 'export', 'confirm', 'uuid'])
  })

  test('builds a URL ready to fetch', () => {
    const form = parseConfirmForm(fixture('drive-confirm.html'))!
    const url = new URL(form.action)
    for (const [k, v] of Object.entries(form.params)) url.searchParams.set(k, v)
    expect(url.toString()).toContain('confirm=t')
    expect(url.toString()).toContain('uuid=7f9c1e22')
  })

  test('finds nothing on the page Drive shows when a file is not shared', () => {
    expect(parseConfirmForm(fixture('drive-denied.html'))).toBeNull()
  })

  test('tolerates single-quoted attributes and reordered ones', () => {
    const html = `<form id='download-form' method='get' action='https://x/dl'>
      <input value='ID1' name='id' type='hidden'></form>`
    expect(parseConfirmForm(html)).toEqual({ action: 'https://x/dl', params: { id: 'ID1' } })
  })

  test('decodes HTML entities in attribute values', () => {
    const html = `<form id="download-form" action="https://x/dl?a=1&amp;b=2">
      <input type="hidden" name="uuid" value="a&amp;b"></form>`
    const form = parseConfirmForm(html)!
    expect(form.action).toBe('https://x/dl?a=1&b=2')
    expect(form.params.uuid).toBe('a&b')
  })
})
