#!/usr/bin/env node
/**
 * import-persona.mjs —— 用 dsh-fish 自带的 applyHandover() 导入初始人格。
 *
 * 默认只允许在“还没有起点”的状态库上导入，避免覆盖正在成长的她。
 * 加 --reset 会先调用 resetAll()：旧状态库整体改名封存，一个字节都不删。
 *
 * 用法：
 *   node scripts/import-persona.mjs [--root ~/.dsh-fish] [--persona persona/mahiro-handover.md]
 *                                   [--pkg /path/to/@ssamurias/dsh-fish] [--reset] [--yes]
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
const personaPath = path.resolve(arg('--persona', path.join(REPO, 'persona/mahiro-handover.md')))
const defaultPkg = path.join(HOME, '.dsh/profiles/web/node_modules/@ssamurias/dsh-fish')
const pkg = path.resolve(arg('--pkg', process.env.DSH_FISH_PKG || defaultPkg))
const reset = has('--reset')
const yes = has('--yes')

if (!pkg) {
  console.error('缺少 --pkg（dsh-fish 安装目录），或设置 DSH_FISH_PKG。')
  process.exit(2)
}
if (!fs.existsSync(path.join(pkg, 'lib/import.js'))) {
  console.error(`不是有效的 dsh-fish 目录：${pkg}`)
  process.exit(2)
}
if (!fs.existsSync(personaPath)) {
  console.error(`找不到人格文件：${personaPath}`)
  process.exit(2)
}

const text = fs.readFileSync(personaPath, 'utf8')
if (!text.includes('绪山真寻')) {
  console.error('人格文件里没有找到“绪山真寻”，拒绝导入。')
  process.exit(2)
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

const { resetAll } = await import(path.join(pkg, 'lib/reset.js'))
const { applyHandover } = await import(path.join(pkg, 'lib/import.js'))
const log = { warn: (...a) => console.warn('[dsh-fish]', ...a) }

if (reset) {
  const r = await resetAll(root, { log: (m) => console.log('[reset]', m) })
  console.log('[reset]', JSON.stringify(r))
  if (!r.ok) {
    console.error('重置失败，未导入。')
    process.exit(1)
  }
}

const imported = await applyHandover(text, root, {
  log,
  source: '绪山真寻 / 别当欧尼酱了！',
})
console.log('[import]', JSON.stringify(imported))
if (!imported.ok) process.exit(imported.alreadyHad ? 3 : 1)

console.log(`\n已导入。状态库：${root}`)
console.log('下一步：启动 dsh-web，然后在设置 → 大肥鱼里看她是否从第一天开始。')
