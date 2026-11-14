import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkAutoVoice,
  parseVoicePreference,
  hkClock,
  VOICE_AUTO_MAX,
  VOICE_AUTO_MAX_CHARS,
} from '../telegram-bridge/voicepolicy.mjs'

// 2026-11-14T03:00:00Z = 11:00 Asia/Hong_Kong
const DAY = Date.parse('2026-11-14T03:00:00.000Z')
// 2026-11-14T15:00:00Z = 23:00 Asia/Hong_Kong
const NIGHT = Date.parse('2026-11-14T15:00:00.000Z')

test('hkClock uses Hong Kong natural day', () => {
  assert.deepEqual(hkClock(DAY), { day: '2026-11-14', hour: 11 })
  assert.deepEqual(hkClock(Date.parse('2026-11-14T16:30:00.000Z')), { day: '2026-11-15', hour: 0 })
})

test('auto voice allows daytime within quotas', () => {
  assert.deepEqual(checkAutoVoice({ mode: 'auto', count: 0, lastAt: 0, now: DAY, chars: 10 }), { ok: true })
})

test('auto voice respects mode, night, count, gap, length', () => {
  assert.equal(checkAutoVoice({ mode: 'request_only', count: 0, lastAt: 0, now: DAY, chars: 10 }).ok, false)
  assert.equal(checkAutoVoice({ mode: 'off', count: 0, lastAt: 0, now: DAY, chars: 10 }).ok, false)
  assert.equal(checkAutoVoice({ mode: 'auto', count: 0, lastAt: 0, now: NIGHT, chars: 10 }).ok, false)
  assert.equal(checkAutoVoice({ mode: 'auto', count: VOICE_AUTO_MAX, lastAt: 0, now: DAY, chars: 10 }).ok, false)
  assert.equal(checkAutoVoice({ mode: 'auto', count: 0, lastAt: DAY - 10 * 60_000, now: DAY, chars: 10 }).ok, false)
  assert.equal(checkAutoVoice({ mode: 'auto', count: 0, lastAt: 0, now: DAY, chars: VOICE_AUTO_MAX_CHARS + 1 }).ok, false)
})

test('owner voice preference phrases', () => {
  assert.deepEqual(parseVoicePreference('以后可以多用语音'), { mode: 'auto' })
  assert.deepEqual(parseVoicePreference('先不要主动发语音了'), { mode: 'request_only' })
  assert.deepEqual(parseVoicePreference('关闭语音'), { mode: 'off' })
  assert.deepEqual(parseVoicePreference('这条用文字回答'), { temp: 'text' })
  assert.equal(parseVoicePreference('今天吃什么'), null)
  assert.equal(parseVoicePreference(''), null)
})
