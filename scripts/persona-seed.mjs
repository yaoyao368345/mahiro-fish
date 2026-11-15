#!/usr/bin/env node
/**
 * persona-seed.mjs —— 识别并校验一条事件流实际使用的人格起点。
 *
 * 以前仓库里的校验脚本都写死了“seed 必须包含绪山真寻”。那会让空白人格、
 * 原创人格以及以后任何自定义人格都无法备份和恢复，也会把旧真寻备份绑死在一个
 * 名字上。这里改为读 seed 本身和 import-mark，返回可读的人格类型。
 *
 * 用法：
 *   node scripts/persona-seed.mjs <events.jsonl>
 *   node scripts/persona-seed.mjs <events.jsonl> --expect original-fish
 *   node scripts/persona-seed.mjs <events.jsonl> --json
 *
 * 退出码：
 *   0  有 seed，且（如果指定了 --expect）类型匹配
 *   1  seed 缺失或类型不匹配
 *   2  参数/文件错误
 */

import fs from 'node:fs'
import process from 'node:process'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const expectIdx = args.indexOf('--expect')
const expect = expectIdx >= 0 ? String(args[expectIdx + 1] ?? 'auto') : 'auto'
const asJson = args.includes('--json')

if (!file) {
  console.error('用法：node scripts/persona-seed.mjs <events.jsonl> [--expect auto|blank|original-fish|mahiro|custom] [--json]')
  process.exit(2)
}

let raw
try {
  raw = fs.readFileSync(file, 'utf8')
} catch (err) {
  console.error(`读取事件流失败：${err?.message ?? err}`)
  process.exit(2)
}

const events = []
for (const line of raw.split('\n')) {
  const t = line.trim()
  if (!t) continue
  try {
    events.push(JSON.parse(t))
  } catch {
    // 备份脚本会丢掉写了一半的尾行；遇到坏行时按“事件流损坏”处理。
    console.error('事件流里有无法解析的行，拒绝判断人格。')
    process.exit(1)
  }
}

const seeds = events.filter((e) => e?.type === 'seed')
const markEvent = [...events].reverse().find(
  (e) => e?.type === 'meta' && String(e?.text ?? '').startsWith('import-mark:'),
)
const mark = markEvent ? String(markEvent.text).slice('import-mark:'.length).trim() : ''
const seed = seeds.find((e) => e?.source === 'import') ?? seeds[0] ?? null
const text = String(seed?.text ?? '')
const lowerMark = mark.toLowerCase()
const lowerText = text.toLowerCase()

function classify() {
  if (!seed) return 'missing'
  if (lowerMark.includes('original-fish') || lowerMark.includes('大肥鱼')) return 'original-fish'
  if (lowerMark.includes('mahiro') || mark.includes('绪山真寻') || mark.includes('真寻')) return 'mahiro'
  if (!mark && seed.source === 'system') return 'blank'
  if (lowerText.includes('大肥鱼')) return 'original-fish'
  if (text.includes('绪山真寻') || lowerText.includes('mahiro')) return 'mahiro'
  return seed.source === 'import' ? 'custom' : 'unknown'
}

const kind = classify()
const info = {
  ok: Boolean(seed) && (expect === 'auto' || expect === kind),
  kind,
  expect,
  seeds: seeds.length,
  seedSource: seed?.source ?? '',
  seedChars: text.length,
  importMark: mark,
  events: events.length,
}

if (asJson) {
  console.log(JSON.stringify(info, null, 2))
} else if (!seed) {
  console.error('事件流里没有 seed，无法判断人格。')
} else {
  console.log(`人格类型：${kind}（seed 来源 ${seed.source || '未知'}，${text.length} 字，事件 ${events.length} 条）`)
  if (mark) console.log(`导入标记：${mark}`)
  if (expect !== 'auto' && expect !== kind) {
    console.error(`期望人格是 ${expect}，实际是 ${kind}。`)
  }
}

process.exit(info.ok ? 0 : 1)
