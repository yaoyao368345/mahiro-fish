import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lettersFromEvents, createOutbox, OUTBOX_LIMITS } from '../telegram-bridge/outbox.mjs'

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mahiro-outbox-'))
}

function writeEvents(file, events) {
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

test('lettersFromEvents pairs letter meta with utterance', () => {
  const events = [
    { type: 'utterance', id: 'u1', ts: '2026-11-14T10:00:00.000Z', text: '今天想跟你说一声。' },
    { type: 'meta', text: 'letter:2026-11-14:u1' },
    { type: 'meta', text: 'letter:2026-11-14:missing' },
    { type: 'meta', text: 'use:her_leave ok' },
  ]
  const letters = lettersFromEvents(events)
  assert.equal(letters.length, 1)
  assert.equal(letters[0].id, 'u1')
  assert.equal(letters[0].text, '今天想跟你说一声。')
  assert.ok(letters[0].ts > 0)
})

test('outbox scan + pump is idempotent', async () => {
  const dir = tmpdir()
  const events = path.join(dir, 'events.jsonl')
  const state = path.join(dir, 'outbox.json')
  writeEvents(events, [
    { type: 'utterance', id: 'u1', ts: new Date().toISOString(), text: '留一句。' },
    { type: 'meta', text: 'letter:2026-11-14:u1' },
  ])
  const sent = []
  const box = createOutbox({
    statePath: state,
    eventsPath: events,
    send: async (text) => { sent.push(text) },
  })
  assert.equal(box.scan(), 1)
  assert.equal(box.scan(), 0, 'second scan must not enqueue the same letter')
  const r1 = await box.pump()
  assert.deepEqual(r1, { sent: 1, failed: 0, pending: 0 })
  const r2 = await box.pump()
  assert.deepEqual(r2, { sent: 0, failed: 0, pending: 0 })
  assert.deepEqual(sent, ['留一句。'])
  assert.ok(box.state().sent.includes('u1'))
})

test('old letters expire instead of being sent', () => {
  const dir = tmpdir()
  const events = path.join(dir, 'events.jsonl')
  const old = new Date(Date.now() - OUTBOX_LIMITS.MAX_AGE_MS - 60_000).toISOString()
  writeEvents(events, [
    { type: 'utterance', id: 'u1', ts: old, text: '很久以前。' },
    { type: 'meta', text: 'letter:2026-11-01:u1' },
  ])
  const box = createOutbox({ statePath: path.join(dir, 'outbox.json'), eventsPath: events, send: async () => {} })
  assert.equal(box.scan(), 0)
  assert.equal(box.state().failed[0].reason, 'too-old')
})

test('failed send backs off and keeps the text', async () => {
  const dir = tmpdir()
  const events = path.join(dir, 'events.jsonl')
  let now = Date.now()
  writeEvents(events, [
    { type: 'utterance', id: 'u1', ts: new Date(now).toISOString(), text: '发送会失败。' },
    { type: 'meta', text: 'letter:2026-11-14:u1' },
  ])
  const box = createOutbox({
    statePath: path.join(dir, 'outbox.json'),
    eventsPath: events,
    send: async () => { throw new Error('network down') },
    now: () => now,
  })
  box.scan()
  const r = await box.pump()
  assert.equal(r.failed, 0)
  assert.equal(box.state().pending[0].attempts, 1)
  assert.ok(box.state().pending[0].nextAt > now)
  // 退避期间不重发
  now += 1000
  assert.equal((await box.pump()).failed, 0)
  assert.equal(box.state().pending[0].attempts, 1)
})

test('queue overflow moves oldest into failed, not silently dropped', () => {
  const dir = tmpdir()
  const events = path.join(dir, 'events.jsonl')
  const list = []
  for (let i = 0; i < OUTBOX_LIMITS.MAX_PENDING + 3; i++) {
    list.push({ type: 'utterance', id: `u${i}`, ts: new Date().toISOString(), text: `第 ${i} 条` })
    list.push({ type: 'meta', text: `letter:2026-11-14:u${i}` })
  }
  writeEvents(events, list)
  const box = createOutbox({ statePath: path.join(dir, 'outbox.json'), eventsPath: events, send: async () => {} })
  box.scan()
  assert.equal(box.state().pending.length, OUTBOX_LIMITS.MAX_PENDING)
  assert.equal(box.state().failed.filter((x) => x.reason === 'queue-full').length, 3)
})
