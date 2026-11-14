#!/usr/bin/env node
/**
 * outbox.mjs —— Telegram 主动消息的轻量出站队列
 *
 * 只做一件事：把真寻用 her_leave 留下的那句话，送到 owner 私聊。
 * 不生成文字、不判断她该不该说、不新增调度器；是否留下这句话由 dsh-fish
 * 的 proactive/her_leave 决定。
 *
 * 幂等：以 letter meta 指向的 utterance id 为键；sent / pending / failed 三张表
 * 都在同一个 JSON 里，桥重启后继续。失败有上限与退避，不无限重发。
 */

import fs from 'node:fs'
import path from 'node:path'

const MAX_ATTEMPTS = 6
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_PENDING = 20
const MAX_SENT = 500
const MAX_FAILED = 50

function readJson(file, fallback) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    return v && typeof v === 'object' ? v : fallback
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function readFishEvents(file) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try { out.push(JSON.parse(line)) } catch { /* 写一半的行，下一拍再看 */ }
  }
  return out
}

/** 从事件流里取 her_leave 留下的信：`meta letter:<dk>:<utterance-id>` + 对应的 utterance。 */
export function lettersFromEvents(events) {
  const utterances = new Map()
  for (const e of events ?? []) {
    if (e?.type !== 'utterance' || !e?.id) continue
    utterances.set(String(e.id), e)
  }
  const out = []
  for (const e of events ?? []) {
    if (e?.type !== 'meta') continue
    const t = String(e?.text ?? '')
    if (!t.startsWith('letter:')) continue
    const id = t.split(':')[2]
    if (!id) continue
    const u = utterances.get(id)
    if (!u) continue
    const text = String(u.text ?? '').trim()
    if (!text) continue
    const ts = Date.parse(String(u.ts ?? '')) || Date.parse(String(e.ts ?? '')) || 0
    out.push({ id, text, ts })
  }
  return out
}

function loadState(file) {
  const s = readJson(file, {})
  return {
    sent: Array.isArray(s.sent) ? s.sent.map(String).slice(-MAX_SENT) : [],
    pending: Array.isArray(s.pending) ? s.pending : [],
    failed: Array.isArray(s.failed) ? s.failed.slice(-MAX_FAILED) : [],
  }
}

/**
 * @param {{statePath:string, eventsPath:string, send:(text:string)=>Promise<void>, log?:Function, now?:Function}} o
 */
export function createOutbox(o) {
  const statePath = o.statePath
  const eventsPath = o.eventsPath
  const send = o.send
  const log = o.log ?? (() => {})
  const now = o.now ?? (() => Date.now())
  let state = loadState(statePath)
  let busy = false

  const save = () => {
    try { writeJson(statePath, state) } catch (err) { log('outbox state save failed:', err?.message ?? err) }
  }

  function scan() {
    const letters = lettersFromEvents(readFishEvents(eventsPath))
    if (!letters.length) return 0
    const known = new Set([
      ...state.sent,
      ...state.failed.map((x) => String(x?.id ?? '')),
      ...state.pending.map((x) => String(x?.id ?? '')),
    ])
    let added = 0
    const t = now()
    for (const l of letters) {
      if (known.has(l.id)) continue
      if (l.ts && t - l.ts > MAX_AGE_MS) {
        state.failed.push({ id: l.id, text: l.text.slice(0, 600), reason: 'too-old', at: new Date(t).toISOString() })
        known.add(l.id)
        log('outbox 跳过旧信：', l.id)
        continue
      }
      state.pending.push({ id: l.id, text: l.text, ts: l.ts, attempts: 0, nextAt: 0 })
      known.add(l.id)
      added += 1
      log('outbox 收到一封留话：', l.id, '，队列', state.pending.length)
    }
    // 队列上限：最旧的转入 failed，保留正文，不静默丢。
    if (state.pending.length > MAX_PENDING) {
      state.pending.sort((a, b) => (a.ts || 0) - (b.ts || 0))
      while (state.pending.length > MAX_PENDING) {
        const drop = state.pending.shift()
        state.failed.push({ id: drop.id, text: String(drop.text ?? '').slice(0, 600), reason: 'queue-full', at: new Date(t).toISOString() })
        log('outbox 队列满了，转入 failed：', drop.id)
      }
    }
    if (added || state.pending.length) save()
    return added
  }

  function backoffMs(attempts) {
    return Math.min(5 * 60_000, 5_000 * Math.pow(2, Math.max(0, attempts - 1)))
  }

  async function pump() {
    if (busy || !state.pending.length) return { sent: 0, failed: 0, pending: state.pending.length }
    busy = true
    let sent = 0
    let failed = 0
    try {
      const t = now()
      const due = state.pending.filter((x) => !x.nextAt || x.nextAt <= t)
      for (const item of due) {
        const id = String(item.id ?? '')
        if (!id) continue
        try {
          await send(String(item.text ?? ''))
          state.sent.push(id)
          state.sent = state.sent.slice(-MAX_SENT)
          state.pending = state.pending.filter((x) => String(x?.id ?? '') !== id)
          sent += 1
          log('outbox 已投递：', id)
        } catch (err) {
          item.attempts = Number(item.attempts || 0) + 1
          const why = String(err?.message ?? err).slice(0, 160)
          if (item.attempts >= MAX_ATTEMPTS) {
            state.failed.push({ id, text: String(item.text ?? '').slice(0, 600), reason: why, at: new Date(t).toISOString() })
            state.pending = state.pending.filter((x) => String(x?.id ?? '') !== id)
            failed += 1
            log('outbox 投递失败到上限，转入 failed：', id, why)
          } else {
            item.nextAt = t + backoffMs(item.attempts)
            log('outbox 投递失败，稍后重试：', id, `第 ${item.attempts}/${MAX_ATTEMPTS} 次`, why)
          }
        }
        save()
      }
    } finally {
      busy = false
    }
    return { sent, failed, pending: state.pending.length }
  }

  return {
    scan,
    pump,
    state: () => JSON.parse(JSON.stringify(state)),
  }
}

export const OUTBOX_LIMITS = Object.freeze({ MAX_ATTEMPTS, MAX_AGE_MS, MAX_PENDING, MAX_SENT, MAX_FAILED })
