#!/usr/bin/env node
/**
 * import-persona.mjs —— 用 dsh-fish 自带的 applyHandover() 导入初始人格。
 *
 * 默认只允许在“还没有起点”的状态库上导入，避免覆盖正在成长的她。
 * 加 --reset 会先调用 resetAll()：旧状态库整体改名封存，一个字节都不删。
 *
 * 人格模式：
 *   original-fish  原创大肥鱼（默认，persona/original-fish.md）
 *   mahiro         旧绪山真寻模板（persona/mahiro-handover.md）
 *   blank          dsh-fish 原生空白人格；重置后不写 seed，启动时由插件落下
 *   custom         用 --persona 指定的任意交接单
 *
 * 用法：
 *   node scripts/import-persona.mjs [--root ~/.dsh-fish] [--mode original-fish]
 *   node scripts/import-persona.mjs --mode mahiro
 *   node scripts/import-persona.mjs --mode blank --reset --yes
 *   node scripts/import-persona.mjs --persona persona/my-fish.md --mode custom
 *   node scripts/import-persona.mjs [--pkg /path/to/@ssamurias/dsh-fish] [--reset] [--yes]
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const has = (name) => process.argv.includes(name)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const HOME = process.env.HOME || os.homedir()
const root = path.resolve(arg('--root', path.join(HOME, '.dsh-fish')))
const defaultPkg = path.join(HOME, '.dsh/profiles/web/node_modules/@ssamurias/dsh-fish')
const pkg = path.resolve(arg('--pkg', process.env.DSH_FISH_PKG || defaultPkg))
const reset = has('--reset')
const yes = has('--yes')

const BUILTIN = {
  blank: null,
  'original-fish': path.join(REPO, 'persona/original-fish.md'),
  mahiro: path.join(REPO, 'persona/mahiro-handover.md'),
}
const MODE_NAMES = ['blank', 'original-fish', 'mahiro', 'custom']
const requestedPersona = arg('--persona', '')
const explicitMode = arg('--mode', process.env.PERSONA_MODE || '')
let mode = explicitMode
let personaPath = ''

if (!mode) {
  // 兼容旧用法：只给 --persona 时，按文件名识别内置人格，否则视为自定义。
  if (requestedPersona) {
    const abs = path.resolve(requestedPersona)
    const found = Object.entries(BUILTIN).find(([, p]) => p && path.resolve(p) === abs)
    mode = found ? found[0] : 'custom'
    personaPath = abs
  } else {
    mode = 'original-fish'
  }
}
if (!MODE_NAMES.includes(mode)) {
  console.error(`未知人格模式：${mode}（可选：${MODE_NAMES.join(' / ')}）`)
  process.exit(2)
}

if (mode === 'blank') {
  if (requestedPersona) {
    console.error('--mode blank 不能和 --persona 一起用。')
    process.exit(2)
  }
  personaPath = ''
} else if (requestedPersona) {
  personaPath = path.resolve(requestedPersona)
} else {
  personaPath = BUILTIN[mode]
}

if (!pkg) {
  console.error('缺少 --pkg（dsh-fish 安装目录），或设置 DSH_FISH_PKG。')
  process.exit(2)
}
if (!fs.existsSync(path.join(pkg, 'lib/import.js'))) {
  console.error(`不是有效的 dsh-fish 目录：${pkg}`)
  process.exit(2)
}
if (mode !== 'blank' && !fs.existsSync(personaPath)) {
  console.error(`找不到人格文件：${personaPath}`)
  process.exit(2)
}

const { resetAll } = await import(path.join(pkg, 'lib/reset.js'))
const { applyHandover, parseHandover } = await import(path.join(pkg, 'lib/import.js'))
const log = { warn: (...a) => console.warn('[dsh-fish]', ...a) }

let text = ''
if (mode !== 'blank') {
  text = fs.readFileSync(personaPath, 'utf8')
  const parsed = parseHandover(text)
  if (!parsed.ok) {
    console.error(`人格文件不能导入：${parsed.why}`)
    process.exit(2)
  }
  // 内置模板额外核对一下，避免误把旧人格当成新人格导入。
  if (mode === 'original-fish' && !text.includes('大肥鱼')) {
    console.error('original-fish 模板里没有找到“大肥鱼”，拒绝导入。')
    process.exit(2)
  }
  if (mode === 'mahiro' && !text.includes('绪山真寻')) {
    console.error('mahiro 模板里没有找到“绪山真寻”，拒绝导入。')
    process.exit(2)
  }
}

const eventsPath = path.join(root, 'events.jsonl')
const hasState = fs.existsSync(eventsPath) && fs.statSync(eventsPath).size > 0

if (hasState && !reset) {
  console.error(`目标状态库已经有事件流：${eventsPath}`)
  console.error('不会覆盖一个已经在成长的实例。确实要重开一局，请加 --reset（旧档会整体封存，不删除）。')
  process.exit(3)
}
if (hasState && reset && !yes) {
  console.error('--reset 会封存旧状态库。确认请再加 --yes，并先停止 dsh-web。')
  process.exit(3)
}

if (reset) {
  const r = await resetAll(root, { log: (m) => console.log('[reset]', m) })
  console.log('[reset]', JSON.stringify(r))
  if (!r.ok) {
    console.error('重置失败，未导入。')
    process.exit(1)
  }
}

if (mode === 'blank') {
  if (!hasState) {
    console.log(`\n状态库是空的：${root}`)
  }
  console.log('已选择 blank（dsh-fish 原生空白人格）。')
  console.log('启动 dsh-web 后，插件会自动写入“你不是助手。你刚开始存在。”作为第一个事实。')
  console.log('本脚本没有预先写入任何 seed，也没有创建第二套记忆引擎。')
  process.exit(0)
}

const source = mode === 'original-fish'
  ? 'original-fish'
  : mode === 'mahiro'
    ? 'mahiro'
    : `custom:${path.basename(personaPath, path.extname(personaPath))}`.slice(0, 120)

const imported = await applyHandover(text, root, {
  log,
  source,
})
console.log('[import]', JSON.stringify(imported))
if (!imported.ok) process.exit(imported.alreadyHad ? 3 : 1)

console.log(`\n已导入 ${mode}。状态库：${root}`)
console.log('下一步：启动 dsh-web，然后在设置 → 大肥鱼里看她是否从第一天开始。')
