/**
 * mediaindex.js —— 她真正看过的视频画面索引（M2.6）
 *
 * 只做三件事：
 *   1. 把成功的 bili_watch 画面落成文字索引（bvid/标题/日期/时间点/路径/sha/ watched 事件）。
 *   2. 给 her_media 提供只读检索；只返回索引里的文件，不碰别处。
 *   3. 和 media.js 的 30 天/100MB 清理联动：图没了就只留文字，不留下可读的失效路径。
 *
 * 不写 events.jsonl、不生成 watched/growth、不重新抽帧；重新抽帧仍由 bili_watch 按原额度决定。
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve, sep, basename } from 'node:path'
import { readEvents, readJson, writeAtomic } from './store.js'
import { MEDIA_TTL_MS, MEDIA_MAX_BYTES, sweepMedia } from './media.js'

export const MEDIA_INDEX_VERSION = 1
export const MEDIA_INDEX_NAME = 'index.json'

export function mediaRoot(root) {
  return join(root, 'media')
}

export function mediaIndexPath(root) {
  return join(mediaRoot(root), MEDIA_INDEX_NAME)
}

function emptyIndex() {
  return { version: MEDIA_INDEX_VERSION, records: [] }
}

function normalizeIndex(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.records)) return emptyIndex()
  return {
    version: MEDIA_INDEX_VERSION,
    records: raw.records
      .filter((r) => r && typeof r === 'object' && r.watchedEventId && r.bvid)
      .map((r) => ({
        watchedEventId: String(r.watchedEventId ?? ''),
        bvid: String(r.bvid ?? ''),
        title: String(r.title ?? '').slice(0, 200),
        up: String(r.up ?? '').slice(0, 80),
        duration: Number(r.duration) || 0,
        view: Number(r.view) || 0,
        watchedAt: String(r.watchedAt ?? ''),
        date: String(r.date ?? ''),
        times: Array.isArray(r.times) ? r.times.map(Number).filter((x) => Number.isFinite(x) && x >= 0).slice(0, 16) : [],
        path: String(r.path ?? ''),
        sha256: String(r.sha256 ?? ''),
        bytes: Number(r.bytes) || 0,
        status: r.status === 'expired' || r.status === 'missing' ? r.status : 'cached',
        expiredAt: String(r.expiredAt ?? ''),
      })),
  }
}

export async function loadMediaIndex(root) {
  return normalizeIndex(await readJson(mediaIndexPath(root), null))
}

export async function saveMediaIndex(root, index) {
  const clean = normalizeIndex(index)
  await writeAtomic(mediaIndexPath(root), JSON.stringify(clean, null, 2), 0o600)
  return clean
}

function relPath(root, abs) {
  const base = resolve(mediaRoot(root))
  const p = resolve(String(abs ?? ''))
  if (!p.startsWith(base + sep)) return ''
  return join('media', p.slice(base.length + 1))
}

function absPath(root, rel) {
  if (!rel) return ''
  const p = resolve(root, String(rel))
  const base = resolve(mediaRoot(root))
  return p.startsWith(base + sep) ? p : ''
}

async function sha256Of(file) {
  const buf = await fs.readFile(file)
  return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length }
}

/** 一条记录对应的真实可读文件；sha 不符也算不可读。 */
export async function verifyRecord(root, rec) {
  if (!rec?.path) return { status: rec?.status === 'expired' ? 'expired' : 'missing', path: '' }
  const abs = absPath(root, rec.path)
  if (!abs) return { status: 'missing', path: '' }
  try {
    const st = await fs.stat(abs)
    if (!st.isFile()) return { status: 'missing', path: '' }
    if (rec.sha256) {
      const got = await sha256Of(abs)
      if (got.sha256 !== rec.sha256) return { status: 'missing', path: '' }
    }
    return { status: 'cached', path: abs, bytes: st.size }
  } catch {
    return { status: 'missing', path: '' }
  }
}

/**
 * 记一条成功抽帧。由 watch.js 在 watched: 事件落盘后调用。
 * 失败不抛——索引写不进去不能影响她这次看画面。
 */
export async function recordWatch(root, rec = {}) {
  try {
    const id = String(rec.watchedEventId ?? '').trim()
    const bvid = String(rec.bvid ?? '').trim()
    if (!id || !bvid) return null
    const index = await loadMediaIndex(root)
    const current = index.records.find((r) => r.watchedEventId === id)
    const rel = relPath(root, rec.path)
    let sha256 = String(rec.sha256 ?? '')
    let bytes = Number(rec.bytes) || 0
    if (rel) {
      const abs = absPath(root, rel)
      try {
        const got = await sha256Of(abs)
        sha256 = got.sha256
        bytes = got.bytes
      } catch { /* 文件不在了就只留文字 */ }
    }
    const item = {
      watchedEventId: id,
      bvid,
      title: String(rec.title ?? '').slice(0, 200),
      up: String(rec.up ?? '').slice(0, 80),
      duration: Number(rec.duration) || 0,
      view: Number(rec.view) || 0,
      watchedAt: String(rec.watchedAt ?? new Date().toISOString()),
      date: String(rec.date ?? '').slice(0, 10),
      times: Array.isArray(rec.times) ? rec.times.map(Number).filter((x) => Number.isFinite(x) && x >= 0).slice(0, 16) : [],
      path: rel && sha256 ? rel : '',
      sha256,
      bytes,
      status: rel && sha256 ? 'cached' : 'missing',
      expiredAt: '',
    }
    if (current) Object.assign(current, item)
    else index.records.push(item)
    await saveMediaIndex(root, index)
    return item
  } catch {
    return null
  }
}

/** 精确参数命中：同 bvid、同 at 时间点、图还在。用于 bili_watch 的缓存复用。 */
export async function findCachedWatch(root, { bvid = '', at = null } = {}) {
  const b = String(bvid ?? '').trim()
  const asked = (Array.isArray(at) ? at : at === null || at === undefined || at === '' ? [] : [at])
    .map(Number)
    .filter((x) => Number.isFinite(x) && x >= 0)
    .map((x) => Math.round(x * 10) / 10)
    .sort((a, b2) => a - b2)
  if (!b || !asked.length) return { ok: false }
  const index = await loadMediaIndex(root)
  const hits = index.records.filter((r) => r.bvid === b && r.status === 'cached')
  for (const rec of hits) {
    const times = rec.times.map((x) => Math.round(x * 10) / 10).sort((a, b2) => a - b2)
    if (times.length !== asked.length || times.some((x, i) => x !== asked[i])) continue
    const v = await verifyRecord(root, rec)
    if (v.status === 'cached') return { ok: true, path: v.path, record: rec }
  }
  return { ok: false }
}

/** `use:bili_watch ok ...（取的是：20 秒、60 秒、230 秒）...` → [20,60,230] */
function timesFromUse(text) {
  const m = String(text ?? '').match(/取的是：([^）]+)/)
  if (!m) return []
  return m[1].split('、')
    .map((s) => Number.parseFloat(String(s).replace(/[^\d.]/g, '')))
    .filter((x) => Number.isFinite(x) && x >= 0)
    .slice(0, 16)
}

async function chooseSheet(root, bvid, atMs) {
  const dir = mediaRoot(root)
  let names = []
  try { names = await fs.readdir(dir) } catch { return '' }
  const candidates = []
  for (const name of names) {
    if (!name.startsWith(`sheet-${bvid}-`) || !name.endsWith('.png')) continue
    const p = join(dir, name)
    try {
      const st = await fs.stat(p)
      candidates.push({ name, path: p, mtimeMs: st.mtimeMs })
    } catch { /* ignore */ }
  }
  if (!candidates.length) return ''
  candidates.sort((a, b) => Math.abs(a.mtimeMs - atMs) - Math.abs(b.mtimeMs - atMs))
  return candidates[0].path
}

/**
 * 从事件流补旧记录（M2.3 已看过的 BV 没有索引）。
 * 只读事件流；旧记录没有精确 times 时从同期 use:bili_watch 回执里取。
 */
export async function backfillMediaIndex(root, { events = null } = {}) {
  const evs = events ?? (await readEvents(root).then((r) => r.events).catch(() => []))
  const index = await loadMediaIndex(root)
  const known = new Set(index.records.map((r) => r.watchedEventId))
  const uses = evs.filter((e) => e?.type === 'meta' && String(e.text ?? '').startsWith('use:bili_watch '))
  let added = 0
  for (const e of evs) {
    if (e?.type !== 'meta') continue
    const text = String(e.text ?? '')
    const m = text.match(/^watched:(\d{4}-\d{2}-\d{2})\s+(BV[0-9A-Za-z]+)\s+(\{.*\})$/)
    if (!m) continue
    if (known.has(String(e.id ?? ''))) continue
    const date = m[1]
    const bvid = m[2]
    let info = {}
    try { info = JSON.parse(m[3]) } catch { info = {} }
    const at = Date.parse(String(e.ts ?? '')) || 0
    const nearUse = uses
      .map((u) => ({ u, d: Math.abs((Date.parse(String(u.ts ?? '')) || 0) - at) }))
      .filter((x) => x.d <= 15_000)
      .sort((a, b) => a.d - b.d)[0]?.u
    const times = nearUse ? timesFromUse(nearUse.text) : []
    const sheet = await chooseSheet(root, bvid, at)
    let rel = ''
    let sha256 = ''
    let bytes = 0
    if (sheet) {
      rel = relPath(root, sheet)
      try {
        const got = await sha256Of(sheet)
        sha256 = got.sha256
        bytes = got.bytes
      } catch { /* ignore */ }
    }
    index.records.push({
      watchedEventId: String(e.id ?? ''),
      bvid,
      title: String(info.title ?? '').slice(0, 200),
      up: String(info.up ?? '').slice(0, 80),
      duration: Number(info.duration) || 0,
      view: Number(info.view) || 0,
      watchedAt: String(e.ts ?? ''),
      date,
      times,
      path: rel && sha256 ? rel : '',
      sha256,
      bytes,
      status: rel && sha256 ? 'cached' : 'missing',
      expiredAt: '',
    })
    known.add(String(e.id ?? ''))
    added += 1
  }
  if (added) await saveMediaIndex(root, index)
  return { added, total: index.records.length }
}

/** 读索引 + 补旧记录。她的工具和索引维护都从这里进。 */
export async function ensureMediaIndex(root, { events = null } = {}) {
  const b = await backfillMediaIndex(root, { events })
  return { index: await loadMediaIndex(root), added: b.added }
}

/** 30 天/100MB 清理，并把被删/丢失的文件从“可读取”降级为文字记录。 */
export async function maintainMediaIndex(root, { now = Date.now(), ttlMs = MEDIA_TTL_MS, maxBytes = MEDIA_MAX_BYTES } = {}) {
  const swept = await sweepMedia(root, { now, ttlMs, maxBytes })
  const index = await loadMediaIndex(root)
  const gone = new Set(swept.removedNames)
  let changed = false
  for (const r of index.records) {
    const name = r.path ? basename(r.path) : ''
    const abs = absPath(root, r.path)
    let missing = false
    if (r.path && (gone.has(name) || !abs)) missing = true
    if (r.path && abs) {
      try { await fs.stat(abs) } catch { missing = true }
    }
    if (missing) {
      r.status = 'expired'
      r.path = ''
      r.expiredAt = r.expiredAt || new Date(now).toISOString()
      changed = true
    }
  }
  if (changed) await saveMediaIndex(root, index)
  return { ...swept, indexRecords: index.records.length, changed }
}

/** 检索：bvid 精确，或标题/UP/BV/日期包含查询词；默认最近 5 条。 */
export function searchMediaIndex(index, { query = '', bvid = '', limit = 5 } = {}) {
  const q = String(query ?? '').trim().toLowerCase()
  const b = String(bvid ?? '').trim()
  const tokens = q.split(/\s+/).filter(Boolean)
  let rows = (index?.records ?? []).filter((r) => {
    if (b && r.bvid !== b) return false
    if (!tokens.length) return true
    const hay = `${r.title} ${r.bvid} ${r.up} ${r.date}`.toLowerCase()
    return tokens.every((t) => hay.includes(t))
  })
  rows = rows.slice().sort((a, b2) => String(b2.watchedAt).localeCompare(String(a.watchedAt)))
  const cap = Math.max(1, Math.min(10, Number(limit) || 5))
  return rows.slice(0, cap)
}
