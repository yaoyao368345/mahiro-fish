#!/usr/bin/env node
/**
 * avataroutbox.mjs —— 把她挑中的那张画换成自己的头像
 *
 * 只认 her_draw 写的 `avatar:<日期>:<绝对路径>`；路径必须在她自己的生成目录里。
 * 这里只排一次队、调一次桥给的 convert / send，不生成图片、不碰聊天文字。
 *
 * 为什么不在 dsh-fish 里直接调 Telegram：Bot Token 只在桥这边（0600 env），
 * 插件不该碰它。事件流是唯一可信的交接面，和 letter / draw / voice 一样。
 *
 * 静态头像只收 JPG；convert 由桥用 ffmpeg 转一张 640×640 的临时图，上传完即删。
 */

import fs from 'node:fs'
import path from 'node:path'
import { trustedImagePath } from './imageoutbox.mjs'

const MAX_ATTEMPTS = 5
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_PENDING = 3
const MAX_SENT = 100
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

/** 从事件流里取她挑中的头像：`avatar:<YYYY-MM-DD>:<path>`。 */
export function avatarsFromEvents(events) {
  const out = []
  for (const e of events ?? []) {
    if (e?.type !== 'meta') continue
    const m = /^avatar:(\d{4}-\d{2}-\d{2}):(.+)$/.exec(String(e?.text ?? ''))
    if (!m) continue
    const p = String(m[2]).trim()
    if (!p) continue
    out.push({
      id: String(e.id ?? ''),
      path: p,
      date: m[1],
      ts: Date.parse(String(e.ts ?? '')) || 0,
    })
  }
  return out
}

/**
 * @param {object} o
 * @param {string} o.statePath
 * @param {string} o.eventsPath
 * @param {string} o.trustedDir 只接受这个目录下的图片
 * @param {string} o.tmpDir 转出来的 JPG 临时放这儿
 * @param {(src:string,dest:string)=>Promise<void>} o.convert 转成 640×640 JPG
 * @param {(jpg:string,item:object)=>Promise<void>} o.send 上传并落网页头像
 * @param {(line:string,...rest:any[])=>void} [o.log]
 * @param {()=>number} [o.now]
 */
export function createAvatarOutbox(o) {
  const statePath = o.statePath
  const eventsPath = o.eventsPath
  const trustedDir = path.resolve(String(o.trustedDir ?? ''))
  const tmpDir = path.resolve(String(o.tmpDir ?? path.dirname(statePath)))
  const convert = o.convert
  const send = o.send
  const log = o.log ?? (() => {})
  const now = o.now ?? (() => Date.now())
  let state = loadState(statePath)
  let busy = false
  const save = () => {
    try { writeJson(statePath, state) } catch (err) { log('avatar outbox state save failed:', err?.message ?? err) }
  }

  function scan() {
    const rows = avatarsFromEvents(readFishEvents(eventsPath))
    if (!rows.length) return 0
    const known = new Set([
      ...state.sent,
      ...state.failed.map((x) => String(x?.id ?? '')),
      ...state.pending.map((x) => String(x?.id ?? '')),
    ])
    let added = 0
    const t = now()
    for (const r of rows) {
      const id = r.id || `path:${r.path}:${r.ts}`
      if (known.has(id)) continue
      const p = trustedImagePath(trustedDir, r.path)
      if (!p) {
        state.failed.push({ id, path: String(r.path), reason: 'outside-trusted-dir', at: new Date(t).toISOString() })
        known.add(id)
        log('avatar outbox 拒绝目录外图片：', String(r.path))
        continue
      }
      if (r.ts && t - r.ts > MAX_AGE_MS) {
        state.failed.push({ id, path: p, reason: 'too-old', at: new Date(t).toISOString() })
        known.add(id)
        log('avatar outbox 跳过旧头像：', path.basename(p))
        continue
      }
      state.pending.push({ id, path: p, ts: r.ts, attempts: 0, nextAt: 0 })
      known.add(id)
      added += 1
      log('avatar outbox 收到一张：', path.basename(p))
    }
    if (state.pending.length > MAX_PENDING) {
      state.pending.sort((a, b) => (a.ts || 0) - (b.ts || 0))
      while (state.pending.length > MAX_PENDING) {
        const drop = state.pending.shift()
        state.failed.push({ id: drop.id, path: drop.path, reason: 'queue-full', at: new Date(t).toISOString() })
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
        const src = String(item.path ?? '')
        const dest = path.join(tmpDir, `avatar-${process.pid}-${t}-${Math.random().toString(16).slice(2, 8)}.jpg`)
        try {
          if (!src) throw new Error('没有图片路径')
          await convert(src, dest)
          const st = fs.statSync(dest)
          if (!st.isFile() || st.size < 1000) throw new Error('转出来的 JPG 是空的')
          await send(dest, item)
          state.sent.push(id)
          state.sent = state.sent.slice(-MAX_SENT)
          state.pending = state.pending.filter((x) => String(x?.id ?? '') !== id)
          sent += 1
          log('avatar outbox 已更换：', path.basename(src))
        } catch (err) {
          item.attempts = Number(item.attempts || 0) + 1
          const why = String(err?.message ?? err).slice(0, 160)
          if (item.attempts >= MAX_ATTEMPTS) {
            state.failed.push({ id, path: src, reason: why, at: new Date(t).toISOString() })
            state.pending = state.pending.filter((x) => String(x?.id ?? '') !== id)
            failed += 1
            log('avatar outbox 失败到上限：', path.basename(src), why)
          } else {
            item.nextAt = t + backoffMs(item.attempts)
            log('avatar outbox 失败，稍后重试：', path.basename(src), `第 ${item.attempts}/${MAX_ATTEMPTS} 次`, why)
          }
        } finally {
          try { fs.unlinkSync(dest) } catch { /* 没生成就算了 */ }
        }
        save()
      }
    } finally { busy = false }
    return { sent, failed, pending: state.pending.length }
  }

  return { scan, pump, state: () => JSON.parse(JSON.stringify(state)) }
}
