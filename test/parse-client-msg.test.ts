import { describe, test, expect } from 'vitest'
import { parseClientMsg } from '../server/parse-client-msg.js'

describe('parseClientMsg', () => {
  test('accepts a hello', () => {
    expect(parseClientMsg('{"t":"hello","nick":"irene"}')).toEqual({ t: 'hello', nick: 'irene' })
  })

  test('accepts a seek carrying a position', () => {
    expect(parseClientMsg('{"t":"intent","kind":"seek","position":120.5}')).toEqual({
      t: 'intent', kind: 'seek', position: 120.5,
    })
  })

  test('accepts a play with no position, since play carries none', () => {
    expect(parseClientMsg('{"t":"intent","kind":"play"}')).toEqual({ t: 'intent', kind: 'play' })
  })

  test('accepts a chat message', () => {
    expect(parseClientMsg('{"t":"chat","text":"hi"}')).toEqual({ t: 'chat', text: 'hi' })
  })

  test('accepts a ping', () => {
    expect(parseClientMsg('{"t":"ping","t0":123}')).toEqual({ t: 'ping', t0: 123 })
  })

  test('rejects malformed JSON rather than throwing', () => {
    expect(parseClientMsg('{not json')).toBeNull()
  })

  test('rejects a message type we do not serve', () => {
    expect(parseClientMsg('{"t":"shutdown"}')).toBeNull()
  })

  test('rejects a JSON value that is not an object', () => {
    expect(parseClientMsg('"hello"')).toBeNull()
    expect(parseClientMsg('null')).toBeNull()
    expect(parseClientMsg('[1,2]')).toBeNull()
  })

  test('rejects a hello whose nickname is not a string', () => {
    expect(parseClientMsg('{"t":"hello","nick":42}')).toBeNull()
  })

  test('rejects an intent with a kind we do not recognise', () => {
    expect(parseClientMsg('{"t":"intent","kind":"rewind"}')).toBeNull()
  })

  test('rejects a seek to a position that is not a finite number', () => {
    expect(parseClientMsg('{"t":"intent","kind":"seek","position":"120"}')).toBeNull()
    expect(parseClientMsg('{"t":"intent","kind":"seek","position":null}')).toBeNull()
    expect(parseClientMsg('{"t":"seek","kind":"seek","position":1e999}')).toBeNull()
  })

  test('rejects a chat with no text', () => {
    expect(parseClientMsg('{"t":"chat"}')).toBeNull()
  })

  test('rejects an absurdly long frame before parsing it', () => {
    expect(parseClientMsg('{"t":"chat","text":"' + 'x'.repeat(200_000) + '"}')).toBeNull()
  })
})
