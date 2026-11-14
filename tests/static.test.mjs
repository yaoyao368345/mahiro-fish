import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('initial persona keeps the required character basis', () => {
  const p = read('persona/mahiro-handover.md')
  for (const needle of [
    '绪山真寻', '緒山まひろ', '别当欧尼酱了',
    '绪山美波里', '游戏', '动画', '漫画', '二次元',
    '懒散', '怕生', '害羞', '嘴硬', '关心', '好色', '撒娇',
    '口语', '口癖', '原作', '新的经历', '改变观点', '新的兴趣',
  ]) {
    assert.ok(p.includes(needle), `persona missing: ${needle}`)
  }
})

test('public env template contains only placeholders', () => {
  const env = read('.env.example')
  assert.ok(env.includes('REPLACE_ME'))
  assert.ok(!/TELEGRAM_BOT_TOKEN=\d{8,10}:[A-Za-z0-9_-]{35}/.test(env))
  assert.ok(!/OWNER_TELEGRAM_ID=(?!100000000\b)\d{6,}/.test(env))
  assert.ok(!/sk-[A-Za-z0-9]{24,}/.test(env))
})

test('patch is pinned to dsh-fish 0.9.9 and adds the expected modules', () => {
  const patch = read('dsh-fish/patches/dsh-fish-0.9.9-m2.4-m2.12.patch')
  assert.ok(patch.includes('--- a/lib/proactive.js'))
  for (const mod of ['draw.js', 'mediaindex.js', 'mediarecall.js', 'sub.js', 'voice.js']) {
    assert.ok(patch.includes(`+++ b/lib/${mod}`), `patch missing ${mod}`)
  }
})

test('watch quota applies only to her own picks, not owner-shared videos', () => {
  const patch = read('dsh-fish/patches/dsh-fish-0.9.9-m2.4-m2.12.patch')
  const start = patch.indexOf('--- a/lib/watch.js')
  const end = patch.indexOf('--- /dev/null')
  assert.ok(start > 0 && end > start, 'watch.js hunk missing')
  const watch = patch.slice(start, end)
  assert.ok(watch.includes("import { inWake } from './wakewin.js'"))
  assert.ok(watch.includes('const selfWatch = inWake()'))
  assert.ok(watch.includes('if (selfWatch && used >= cap)'))
  assert.ok(watch.includes('...(selfWatch ? { self: true } : {})'))
})

test('her_draw can set her own avatar once a day', () => {
  const draw = read('dsh-fish/modules/draw.js')
  assert.ok(draw.includes('AVATAR_PER_DAY'))
  assert.ok(draw.includes('avatarsToday'))
  assert.ok(draw.includes('asAvatar'))
  assert.ok(draw.includes('avatar:${dk}:${abs}'))
  const outbox = read('telegram-bridge/avataroutbox.mjs')
  assert.ok(outbox.includes('avatarsFromEvents'))
  assert.ok(outbox.includes('trustedImagePath'))
})

test('systemd templates do not hardcode a real user or host', () => {
  for (const unit of ['config/systemd/dsh-web.service.template', 'config/systemd/dsh-telegram.service.template']) {
    const s = read(unit)
    assert.ok(s.includes('__FISH_USER__'))
    assert.ok(!/^User=fish$/m.test(s))
  }
})

test('no live credential files are present in the repo', () => {
  for (const rel of [
    '.env', '.telegram-bridge.env', '.breezeblue.env',
    'events.jsonl', 'owner.json', 'auth.json', 'credentials.yaml',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), false, `${rel} must not exist`)
  }
})
