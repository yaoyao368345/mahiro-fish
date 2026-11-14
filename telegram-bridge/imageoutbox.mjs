#!/usr/bin/env node
/**
 * imageoutbox.mjs —— 把真寻画好的图送到 Telegram 私聊
 *
 * 只认 her_draw 写的 `draw:<日期>:<绝对路径>` 元事件；只接受受信任生成目录里的图片。
 * 没有生成逻辑，不改变聊天文字路径。失败的图片有上限退避，不无限重发。
 */

import fs from 'node:fs'
import path from 'node:path'

const MAX_ATTEMPTS = 5
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_PENDING = 10
const MAX_SENT = 300
const MAX_FAILED = 30

function readJson(file, fallback) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    return v && typeof v === 'object' ? v : fallback
  } catch { return fallback }
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
    try { out.push(JSON.parse(line)) } catch { /* 半行，下一次 */ }
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

/** 只接受生成目录里的绝对路径；返回规范化路径或空串。 */
export function trustedImagePath(trustedDir, raw) {
  const base = path.resolve(String(trustedDir ?? ''))
  const p = path.resolve(String(raw ?? ''))
  if (!base || !p.startsWith(base + path.sep)) return ''
  return p
}

/** 从事件流里取 her_draw 的图：`draw:<YYYY-MM-DD>:<path>`。 */
export function drawsFromEvents(events) {
  const out = []
  for (const e of events ?? []) {
    if (e?.type !== 'meta') continue
    const m = /^draw:(\d{4}-\d{2}-\d{2}):(.+)$/.exec(String(e?.text ?? ''))
    if (!m) continue
    const p = String(m[2]).trim()
    if (!p) continue
    out.push({ path: p, date: m[1], ts: Date.parse(String(e.ts ?? '')) || 0 })
  }
  return out
}

export function createImageOutbox(o) {
  const statePath = o.statePath
  const eventsPath = o.eventsPath
  const trustedDir = path.resolve(String(o.trustedDir ?? ''))
  const send = o.send
  const log = o.log ?? (() => {})
  const now = o.now ?? (() => Date.now())
  let state = loadState(statePath)
  let busy = false
  const save = () => {
    try { writeJson(statePath, state) } catch (err) { log('image outbox state save failed:', err?.message ?? err) }
  }

  function scan() {
    const drawings = drawsFromEvents(readFishEvents(eventsPath))
    if (!drawings.length) return 0
    const known = new Set([
      ...state.sent,
      ...state.failed.map((x) => String(x?.path ?? '')),
      ...state.pending.map((x) => String(x?.path ?? '')),
    ])
    let added = 0
    const t = now()
    for (const d of drawings) {
      const p = trustedImagePath(trustedDir, d.path)
      if (!p) {
        const raw = String(d.path)
        if (!known.has(raw)) {
          state.failed.push({ path: raw, reason: 'outside-trusted-dir', at: new Date(t).toISOString() })
          known.add(raw)
          log('image outbox 拒绝目录外图片：', raw)
        }
        continue
      }
      if (known.has(p)) continue
      if (d.ts && t - d.ts > MAX_AGE_MS) {
        state.failed.push({ path: p, reason: 'too-old', at: new Date(t).toISOString() })
        known.add(p)
        log('image outbox 跳过旧图：', path.basename(p))
        continue
      }
      state.pending.push({ path: p, ts: d.ts, attempts: 0, nextAt: 0 })
      known.add(p)
      added += 1
      log('image outbox 收到一张图：', path.basename(p))
    }
    if (state.pending.length > MAX_PENDING) {
      state.pending.sort((a, b) => (a.ts || 0) - (b.ts || 0))
      while (state.pending.length > MAX_PENDING) {
        const drop = state.pending.shift()
        state.failed.push({ path: drop.path, reason: 'queue-full', at: new Date(t).toISOString() })
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
        const p = String(item.path ?? '')
        if (!p) continue
        try {
          await send(p)
          state.sent.push(p)
          state.sent = state.sent.slice(-MAX_SENT)
          state.pending = state.pending.filter((x) => String(x?.path ?? '') !== p)
          sent += 1
          log('image outbox 已投递：', path.basename(p))
        } catch (err) {
          item.attempts = Number(item.attempts || 0) + 1
          const why = String(err?.message ?? err).slice(0, 160)
          if (item.attempts >= MAX_ATTEMPTS) {
            state.failed.push({ path: p, reason: why, at: new Date(t).toISOString() })
            state.pending = state.pending.filter((x) => String(x?.path ?? '') !== p)
            failed += 1
            log('image outbox 失败到上限：', path.basename(p), why)
          } else {
            item.nextAt = t + backoffMs(item.attempts)
            log('image outbox 发送失败，稍后重试：', path.basename(p), `第 ${item.attempts}/${MAX_ATTEMPTS} 次`, why)
          }
        }
        save()
      }
    } finally { busy = false }
    return { sent, failed, pending: state.pending.length }
  }

  return { scan, pump, state: () => JSON.parse(JSON.stringify(state)) }
}
