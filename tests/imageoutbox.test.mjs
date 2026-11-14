import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { trustedImagePath, drawsFromEvents, createImageOutbox } from '../telegram-bridge/imageoutbox.mjs'

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mahiro-imageoutbox-'))
}
function writeEvents(file, events) {
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

test('trustedImagePath rejects traversal and outside paths', () => {
  const base = '/tmp/mahiro-images'
  assert.equal(trustedImagePath(base, '/tmp/mahiro-images/a.png'), '/tmp/mahiro-images/a.png')
  assert.equal(trustedImagePath(base, '/tmp/mahiro-images/sub/a.png'), '/tmp/mahiro-images/sub/a.png')
  assert.equal(trustedImagePath(base, '/tmp/mahiro-images/../secret.png'), '')
  assert.equal(trustedImagePath(base, '/etc/passwd'), '')
  assert.equal(trustedImagePath('', '/etc/passwd'), '')
})

test('drawsFromEvents only accepts draw:<date>:<path>', () => {
  const rows = drawsFromEvents([
    { type: 'meta', ts: '2026-11-14T10:00:00.000Z', text: 'draw:2026-11-14:/tmp/x/a.png' },
    { type: 'meta', text: 'draw:not-a-date:/tmp/x/b.png' },
    { type: 'utterance', text: 'draw:2026-11-14:/tmp/x/c.png' },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].date, '2026-11-14')
  assert.equal(rows[0].path, '/tmp/x/a.png')
})

test('image outbox sends trusted images once', async () => {
  const dir = tmpdir()
  const trusted = path.join(dir, 'images')
  fs.mkdirSync(trusted)
  const img = path.join(trusted, 'a.png')
  fs.writeFileSync(img, 'not-a-real-png-but-a-file')
  const events = path.join(dir, 'events.jsonl')
  writeEvents(events, [{ type: 'meta', ts: new Date().toISOString(), text: `draw:2026-11-14:${img}` }])

  const sent = []
  const box = createImageOutbox({
    statePath: path.join(dir, 'image-outbox.json'),
    eventsPath: events,
    trustedDir: trusted,
    send: async (p) => { sent.push(p) },
  })
  assert.equal(box.scan(), 1)
  assert.equal(box.scan(), 0)
  assert.equal((await box.pump()).sent, 1)
  assert.deepEqual(sent, [img])
  assert.equal((await box.pump()).sent, 0)
})

test('image outbox refuses images outside the trusted directory', () => {
  const dir = tmpdir()
  const events = path.join(dir, 'events.jsonl')
  writeEvents(events, [{ type: 'meta', ts: new Date().toISOString(), text: 'draw:2026-11-14:/etc/passwd' }])
  const box = createImageOutbox({
    statePath: path.join(dir, 'image-outbox.json'),
    eventsPath: events,
    trustedDir: path.join(dir, 'images'),
    send: async () => { throw new Error('must not be called') },
  })
  assert.equal(box.scan(), 0)
  assert.equal(box.state().failed[0].reason, 'outside-trusted-dir')
})
