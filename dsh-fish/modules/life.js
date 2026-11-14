/**
 * life.js —— 普通聊天轮的「最近」背景（2026-11-14，M3.1）
 *
 * 只做一件事：把**真的发生过**的近期经历压成 1–3 行，交给 say.js 挂进
 * system prompt 的 fish:life 段。不是任务清单，不要求她提，也不替她编。
 *
 * 三条边界：
 *   1. 只读事件流里已有的记录；没有就返回空串，整段不出现。
 *   2. `browsed:` 只代表「翻到过标题」，不算看过；这里只用 `watched:` /
 *      `looked:`（recentBili 已经是这个口径）。安静浏览不会进来。
 *   3. 不额外调用模型，不做总结；标题原样保留。
 */

import { recentBili } from './proactive.js'
import { interestOf } from './interest.js'

const DAY = 86_400_000
const MAX_LINES = 3

function tsOf(e) {
  const raw = e?.ts ?? e?.time ?? e?.at
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0
  const d = Date.parse(String(raw ?? ''))
  return Number.isFinite(d) ? d : 0
}

function recentMeta(events, prefix, since) {
  let n = 0
  for (const e of events ?? []) {
    if (e?.type !== 'meta') continue
    if (!String(e.text ?? '').startsWith(prefix)) continue
    const ts = tsOf(e)
    if (ts && ts >= since) n += 1
  }
  return n
}

/**
 * 生成一段简短的「最近」背景；没有内容就返回空串。
 * @param {object[]} events
 * @param {{now?:number, days?:number}} [o]
 * @returns {string}
 */
export function lifeContext(events = [], { now = Date.now(), days = 3 } = {}) {
  const since = now - Math.max(1, Number(days) || 3) * DAY
  const lines = []

  // 她真实看过/读过的 B 站条目：recentBili 已排除 browsed，且 watched 优先。
  for (const item of recentBili(events, { now, days, limit: 2 })) {
    const text = String(item?.text ?? '').trim()
    if (text) lines.push(text)
  }

  // 画图 / 头像：只报事实，不描述内容（事件里没有画面描述）。
  const draws = recentMeta(events, 'draw:', since)
  const avatars = recentMeta(events, 'avatar:', since)
  if (avatars > 0 && draws > 0) lines.push(`最近画过 ${draws} 张图，也把一张设成了头像。`)
  else if (avatars > 0) lines.push('最近把一张自己画的图设成了头像。')
  else if (draws > 0) lines.push(`最近画过 ${draws} 张图。`)

  // 反复出现的事（interest）：只给一个标签，不替她总结。
  const interest = interestOf(events, now)
  const label = String(interest?.[0]?.text ?? '').trim()
  if (label) lines.push(`最近你常想到：${label}。`)

  const unique = [...new Set(lines)].slice(0, MAX_LINES)
  if (!unique.length) return ''
  return [
    '## 最近',
    '（这些是你自己最近做过的事，不是任务；想提就提，不想提也不用提。细节记不清就说记不清，别补。）',
    ...unique.map((l) => `- ${l}`),
  ].join('\n')
}
