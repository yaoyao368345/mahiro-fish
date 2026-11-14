import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { avatarsFromEvents, createAvatarOutbox } from '../telegram-bridge/avataroutbox.mjs'

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mahiro-avataroutbox-'))
}
function writeEvents(file, events) {
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}
function png(file) {
  fs.writeFileSync(file, Buffer.alloc(2048, 1))
  return file
}

test('avatarsFromEvents only accepts avatar:<date>:<path>', () => {
  const rows = avatarsFromEvents([
    { id: 'ev_1', type: 'meta', ts: '2026-11-14T10:00:00.000Z', text: 'avatar:2026-11-14:/tmp/x/a.png' },
    { type: 'meta', text: 'avatar:not-a-date:/tmp/x/b.png' },
    { type: 'meta', text: 'draw:2026-11-14:/tmp/x/c.png' },
    { type: 'utterance', text: 'avatar:2026-11-14:/tmp/x/d.png' },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'ev_1')
  assert.equal(rows[0].path, '/tmp/x/a.png')
})

test('avatar outbox converts, sends once, and removes the temp jpg', async () => {
  const dir = tmpdir()
  const trusted = path.join(dir, 'images')
  fs.mkdirSync(trusted)
  const img = png(path.join(trusted, 'a.png'))
  const events = path.join(dir, 'events.jsonl')
  writeEvents(events, [{
    id: 'ev_1', type: 'meta', ts: new Date().toISOString(), text: `avatar:2026-11-14:${img}`,
  }])

  const sent = []
  const box = createAvatarOutbox({
    statePath: path.join(dir, 'avatar-outbox.json'),
    eventsPath: events,
    trustedDir: trusted,
    tmpDir: path.join(dir, 'tmp'),
    convert: async (_src, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); png(dest) },
    send: async (jpg, item) => { sent.push({ jpg, path: item.path }) },
  })
  assert.equal(box.scan(), 1)
  assert.equal(box.scan(), 0)
  assert.equal((await box.pump()).sent, 1)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].path, img)
  assert.equal(fs.existsSync(sent[0].jpg), false)
  assert.equal((await box.pump()).sent, 0)
  assert.deepEqual(box.state().sent, ['ev_1'])
})

test('avatar outbox refuses images outside the trusted directory', () => {
  const dir = tmpdir()
  const events = path.join(dir, 'events.jsonl')
  writeEvents(events, [{
    id: 'ev_2', type: 'meta', ts: new Date().toISOString(), text: 'avatar:2026-11-14:/etc/passwd',
  }])
  const box = createAvatarOutbox({
    statePath: path.join(dir, 'avatar-outbox.json'),
    eventsPath: events,
    trustedDir: path.join(dir, 'images'),
    tmpDir: dir,
    convert: async () => { throw new Error('must not convert') },
    send: async () => { throw new Error('must not send') },
  })
  assert.equal(box.scan(), 0)
  assert.equal(box.state().failed[0].reason, 'outside-trusted-dir')
})

test('avatar outbox retries a failed upload and keeps the item pending', async () => {
  const dir = tmpdir()
  const trusted = path.join(dir, 'images')
  fs.mkdirSync(trusted)
  const img = png(path.join(trusted, 'a.png'))
  const events = path.join(dir, 'events.jsonl')
  writeEvents(events, [{
    id: 'ev_3', type: 'meta', ts: new Date().toISOString(), text: `avatar:2026-11-14:${img}`,
  }])

  const box = createAvatarOutbox({
    statePath: path.join(dir, 'avatar-outbox.json'),
    eventsPath: events,
    trustedDir: trusted,
    tmpDir: dir,
    convert: async (_src, dest) => { png(dest) },
    send: async () => { throw new Error('telegram down') },
  })
  box.scan()
  assert.equal((await box.pump()).failed, 0)
  assert.equal(box.state().pending.length, 1)
  assert.equal(box.state().pending[0].attempts, 1)
})
