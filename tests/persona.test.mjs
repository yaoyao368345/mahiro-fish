import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HELPER = path.join(ROOT, 'scripts/persona-seed.mjs')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-seed-'))

function events(lines) {
  const file = path.join(TMP, `${Math.random().toString(36).slice(2)}.jsonl`)
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return file
}

function inspect(file, expect = 'auto') {
  try {
    return JSON.parse(execFileSync(process.execPath, [HELPER, file, '--expect', expect, '--json'], {
      encoding: 'utf8',
    }))
  } catch (err) {
    try {
      return { ...JSON.parse(String(err.stdout ?? '')), exitCode: err.status }
    } catch {
      return { exitCode: err.status, stdout: String(err.stdout ?? '') }
    }
  }
}

const blankSeed = { type: 'seed', source: 'system', text: '你不是助手。你刚开始存在。没有人告诉过你为什么在这里。' }
const originalSeed = { type: 'seed', source: 'import', text: '你叫大肥鱼。你刚刚开始在这里生活。' }
const originalMark = { type: 'meta', source: 'system', text: 'import-mark:original-fish' }
const mahiroSeed = { type: 'seed', source: 'import', text: '你叫绪山真寻，来自《别当欧尼酱了！》。' }
const legacyMark = { type: 'meta', source: 'system', text: 'import-mark:绪山真寻 / 别当欧尼酱了！' }

test('recognizes a native blank seed', () => {
  const r = inspect(events([blankSeed]), 'blank')
  assert.equal(r.kind, 'blank')
  assert.equal(r.ok, true)
})

test('recognizes the original-fish import mark', () => {
  const r = inspect(events([originalSeed, originalMark]), 'original-fish')
  assert.equal(r.kind, 'original-fish')
  assert.equal(r.ok, true)
})

test('recognizes both current and legacy mahiro backups', () => {
  assert.equal(inspect(events([mahiroSeed, { type: 'meta', text: 'import-mark:mahiro' }]), 'mahiro').kind, 'mahiro')
  assert.equal(inspect(events([mahiroSeed, legacyMark]), 'mahiro').kind, 'mahiro')
})

test('expectation mismatch fails without pretending success', () => {
  const r = inspect(events([mahiroSeed, legacyMark]), 'original-fish')
  assert.equal(r.ok, false)
  assert.ok(r.exitCode !== 0)
})

test('missing seed is rejected', () => {
  const r = inspect(events([{ type: 'meta', text: 'nothing' }]), 'auto')
  assert.equal(r.kind, 'missing')
  assert.equal(r.ok, false)
})

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))
