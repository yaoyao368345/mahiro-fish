#!/usr/bin/env node
/**
 * dsh-fish ⇄ Telegram 私聊桥
 *
 * 设计要点（第三阶段 3.7）：
 *   - 只做一件事：把主人的 Telegram 文字私聊递进 dsh-fish 的书房会话，再把她这一轮
 *     说的话送回 Telegram。不建第二个 DSH 会话、不建第二个人格。
 *   - 投递只走 dsh-fish 自己的 HTTP 入口 POST /dsh-fish/say（插件负责场次、轮数、
 *     记忆、守卫），本程序不直接碰 DSH 的会话存储。
 *   - /say 是同步的：它最多等 75 秒（插件内部常量 REPLY_WAIT_MS）。她若在回合里弹卡
 *     等人回答（ask_owner / ask_pronoun），这一轮会超过 75 秒，/say 会带着空回复先回来。
 *     所以这里加了一条兜底：回复为空时，直接读她那一条会话的事件日志，等这一轮
 *     turn/end 之后取出她的正文。人格、记忆、卡片机制一概不动。
 *   - 不引入任何框架：只用 Node 24 内置 fetch / http / fs。
 *   - 不调用 shell、不 import child_process。
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import http from 'node:http'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createOutbox } from './outbox.mjs'
import { createImageOutbox } from './imageoutbox.mjs'
import { checkAutoVoice, parseVoicePreference, hkClock } from './voicepolicy.mjs'

const HOME = process.env.HOME || '/var/lib/fish'
const ENV_FILE = process.env.BRIDGE_ENV || path.join(HOME, '.telegram-bridge.env')
const STATE_DIR = process.env.BRIDGE_STATE_DIR || path.join(HOME, '.telegram-bridge')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const TTS_PENDING = path.join(STATE_DIR, 'tts-pending.json')
const VOICE_PREFS_FILE = path.join(STATE_DIR, 'voice-prefs.json')
const VOICE_USAGE_FILE = path.join(STATE_DIR, 'voice-usage.json')
const LOG_FILE = path.join(STATE_DIR, 'bridge.log')
const LOG_MAX = 5 * 1024 * 1024

const DEFAULTS = {
  TELEGRAM_API_BASE: 'https://api.telegram.org',
  DSH_BASE_URL: 'http://127.0.0.1:3080',
  DSH_LOG: path.join(HOME, '.dsh-web', 'web.log'),
  DSH_SESSIONS: path.join(HOME, '.dsh', 'sessions'),
  POLL_TIMEOUT: '30',
  SAY_TIMEOUT_MS: '240000',
  // 本地 ASR（M2.11）：只在收到语音时启动，不常驻。
  ASR_BIN: path.join(HOME, '.local', 'sherpa-onnx', 'sherpa-onnx-v1.13.8-linux-x64-shared-no-tts', 'bin', 'sherpa-onnx-offline'),
  ASR_LIB: path.join(HOME, '.local', 'sherpa-onnx', 'sherpa-onnx-v1.13.8-linux-x64-shared-no-tts', 'lib'),
  ASR_MODEL: path.join(HOME, '.local', 'sherpa-onnx', 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17', 'model.int8.onnx'),
  ASR_TOKENS: path.join(HOME, '.local', 'sherpa-onnx', 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17', 'tokens.txt'),
  FFMPEG_BIN: '/usr/bin/ffmpeg',
  VOICE_MAX_SEC: '60',
  VOICE_MAX_BYTES: String(5 * 1024 * 1024),
  // TTS（M2.12）：Kokoro 中文女声；独立于 ASR 的 shared-no-tts 组件。
  TTS_BIN: path.join(HOME, '.local', 'sherpa-onnx', 'sherpa-onnx-v1.13.8-linux-x64-shared', 'bin', 'sherpa-onnx-offline-tts'),
  TTS_LIB: path.join(HOME, '.local', 'sherpa-onnx', 'sherpa-onnx-v1.13.8-linux-x64-shared', 'lib'),
  TTS_DIR: path.join(HOME, '.local', 'sherpa-onnx', 'kokoro-int8-multi-lang-v1_1'),
  TTS_SID: '47',
  TTS_MAX_CHARS: '420',
  // M2.12.1：off = 只回文字；local = Kokoro；openrouter = 免费云端 TTS。
  TTS_PROVIDER: 'off',
  OPENROUTER_TTS_MODEL: 'heygen/heygen-voice-1-turbo:free',
  OPENROUTER_TTS_VOICE: 'noelle',
  OPENROUTER_TTS_TIMEOUT_MS: '45000',
  // Breeze Blue（M2.12.3）：真寻自定义音色。key 单独放 0600 文件。
  BREEZE_ENV_FILE: path.join(HOME, '.breezeblue.env'),
  BREEZE_BASE_URL: 'https://api.breeze.blue',
  BREEZE_TTS_MODEL: 'breeze-tts-2',
  // Bring your own voice. A cloned personal voice ID is a credential:
  // keep it in .telegram-bridge.env (0600) and never commit it.
  BREEZE_TTS_VOICE: '',
  BREEZE_TTS_INSTRUCTIONS: '用自然、清楚、稍微轻快的年轻女性语气说普通话，句尾自然上扬，语气跟着当时的语境走。',
  BREEZE_TTS_SPEED: '1.03',
  BREEZE_TTS_GUIDANCE: '2.0',
  BREEZE_TTS_TIMEOUT_MS: '60000',
}

// ---------------------------------------------------------------- 日志（自轮转）

function rotateLog() {
  try {
    const st = fs.statSync(LOG_FILE)
    if (st.size > LOG_MAX) fs.renameSync(LOG_FILE, LOG_FILE + '.1')
  } catch { /* 不存在就算了 */ }
}

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}`
  try {
    rotateLog()
    fs.appendFileSync(LOG_FILE, line + '\n', { mode: 0o600 })
  } catch { /* 日志写不了也不能让桥停 */ }
  // stdout 进 journald；没有 TTY 时也不报错
  try { process.stdout.write(line + '\n') } catch { /* ignore */ }
}

// ---------------------------------------------------------------- 配置

function parseEnv(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[k] = v
  }
  return out
}

function readConfig() {
  let raw = ''
  try { raw = fs.readFileSync(ENV_FILE, 'utf8') } catch { /* 还没建 */ }
  const cfg = { ...DEFAULTS, ...parseEnv(raw) }
  // Breeze Blue 的 key 单独存放，避免和 Telegram/OpenRouter 混在一个文件里。
  if (!String(cfg.BREEZE_API_KEY || '').trim()) {
    try {
      const b = parseEnv(fs.readFileSync(cfg.BREEZE_ENV_FILE, 'utf8'))
      if (b.BREEZE_API_KEY) cfg.BREEZE_API_KEY = b.BREEZE_API_KEY
    } catch { /* 没有这个文件就只是没配置 */ }
  }
  cfg.TELEGRAM_BOT_TOKEN = String(cfg.TELEGRAM_BOT_TOKEN || '').trim()
  cfg.OWNER_TELEGRAM_ID = String(cfg.OWNER_TELEGRAM_ID || '').trim()
  return cfg
}

// ---------------------------------------------------------------- 状态

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return {
      lastUpdateId: Number(s.lastUpdateId) || 0,
      seenUpdates: Array.isArray(s.seenUpdates) ? s.seenUpdates.slice(-400) : [],
      seenMessages: Array.isArray(s.seenMessages) ? s.seenMessages.slice(-400) : [],
      cookie: typeof s.cookie === 'string' ? s.cookie : '',
    }
  } catch {
    return { lastUpdateId: 0, seenUpdates: [], seenMessages: [], cookie: '' }
  }
}

let state = loadState()

function saveState() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
    const tmp = STATE_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
    fs.renameSync(tmp, STATE_FILE)
  } catch (err) {
    log('state save failed:', err?.message ?? err)
  }
}

// ---------------------------------------------------------------- DSH 认证

let cookieCache = state.cookie || ''
let cookieMintedAt = 0

function dshLogToken(logPath) {
  let text = ''
  try { text = fs.readFileSync(logPath, 'utf8') } catch { return '' }
  // 启动行：dsh web: http://127.0.0.1:3080/?token=XXXX
  const all = [...text.matchAll(/[?&]token=([A-Za-z0-9_-]+)/g)]
  return all.length ? all[all.length - 1][1] : ''
}

async function mintCookie(cfg) {
  const token = dshLogToken(cfg.DSH_LOG)
  if (!token) throw new Error(`读不到 DSH 启动 Token（${cfg.DSH_LOG}）。DSH 是不是没在跑？`)
  const url = cfg.DSH_BASE_URL.replace(/\/+$/, '') + '/?token=' + encodeURIComponent(token)
  const res = await fetch(url, { redirect: 'manual' })
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean)
  if (!raw.length) throw new Error(`换取会话失败：HTTP ${res.status}，没有 Set-Cookie`)
  const pair = String(raw[0]).split(';', 1)[0]
  if (!pair || !pair.includes('=')) throw new Error('换取会话失败：Cookie 形状不对')
  cookieCache = pair
  cookieMintedAt = Date.now()
  state.cookie = pair
  saveState()
  log('DSH 会话已换取（cookie 名称不含敏感值，长度', pair.length, '）')
  return pair
}

async function dshFetch(cfg, pathname, init = {}) {
  const base = cfg.DSH_BASE_URL.replace(/\/+$/, '')
  const doCall = async () => {
    const headers = {
      'content-type': 'application/json',
      origin: base,
      ...(init.headers || {}),
    }
    if (cookieCache) headers.cookie = cookieCache
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), Number(cfg.SAY_TIMEOUT_MS) || 240000)
    try {
      const res = await fetch(base + pathname, { ...init, headers, signal: ac.signal })
      return res
    } finally {
      clearTimeout(timer)
    }
  }
  let res = await doCall()
  if ((res.status === 401 || res.status === 403) && Date.now() - cookieMintedAt > 5000) {
    cookieCache = ''
    await mintCookie(cfg)
    res = await doCall()
  }
  return res
}

// ---------------------------------------------------------------- 会话日志兜底

function sessionLogPath(sessionsDir, sessionId) {
  try {
    for (const ws of fs.readdirSync(sessionsDir)) {
      const p = path.join(sessionsDir, ws, 'session-' + sessionId.replace(/^session-/, ''), 'session.v4.jsonl.zstd')
      if (fs.existsSync(p)) return p
    }
  } catch { /* ignore */ }
  const fallback = path.join(sessionsDir, '--var-lib-fish-.dsh-fish-home--', 'session-' + sessionId.replace(/^session-/, ''), 'session.v4.jsonl.zstd')
  return fs.existsSync(fallback) ? fallback : ''
}

function readEvents(file) {
  const buf = fs.readFileSync(file)
  let text
  try { text = zlib.zstdDecompressSync(buf).toString('utf8') } catch { return null }
  const out = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try { out.push(JSON.parse(line)) } catch { /* 写一半的行，下一拍再看 */ }
  }
  return out
}

function textOfAssistant(e) {
  const content = e?.data?.message?.content
  if (!Array.isArray(content)) return ''
  return content.filter((p) => p?.type === 'text').map((p) => String(p.text ?? '')).join('\n').trim()
}

/**
 * /say 在 75 秒处先回来、且 herReply 为空时，等她这一轮真正结束再取正文。
 * 只读她的会话文件，不写、不改、不触发任何东西。
 */
async function waitSessionReply(cfg, sessionIds, sinceMs, maxMs = 330000) {
  const files = []
  for (const sid of sessionIds.filter(Boolean)) {
    const f = sessionLogPath(cfg.DSH_SESSIONS, sid)
    if (f && !files.includes(f)) files.push(f)
  }
  if (!files.length) return { text: '', why: '找不到会话日志' }
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    for (const file of files) {
      const r = scanSessionFile(file, sinceMs)
      if (r.text) return r
      if (r.ended) return r
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return { text: '', why: '等超时了' }
}

function scanSessionFile(file, sinceMs) {
  const events = readEvents(file)
  if (!events) return { text: '', ended: false }
  const texts = []
  let ended = false
  for (const e of events) {
    const t = Number(e?.time) || 0
    if (t < sinceMs) continue
    if (e.type === 'assistant/message') {
      const txt = textOfAssistant(e)
      if (txt && !texts.includes(txt)) texts.push(txt)
    }
    if (e.type === 'turn/end' && t >= sinceMs) ended = true
  }
  return {
    text: texts.join('\n\n'),
    ended,
    why: ended && !texts.length ? '这一轮结束了，她没有说话' : '',
  }
}

// ---------------------------------------------------------------- Telegram

function apiBase(cfg) {
  return String(cfg.TELEGRAM_API_BASE || DEFAULTS.TELEGRAM_API_BASE).replace(/\/+$/, '')
}

async function tg(cfg, method, payload, { timeoutMs = 45000 } = {}) {
  const url = `${apiBase(cfg)}/bot${cfg.TELEGRAM_BOT_TOKEN}/${method}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
      signal: ac.signal,
    })
    let body = null
    try { body = await res.json() } catch { body = null }
    if (!res.ok || !body?.ok) {
      const desc = body?.description || `HTTP ${res.status}`
      const err = new Error(desc)
      err.status = res.status
      err.retryAfter = Number(body?.parameters?.retry_after) || 0
      throw err
    }
    return body.result
  } finally {
    clearTimeout(timer)
  }
}

function splitText(text, max = 4000) {
  const s = String(text ?? '')
  if (s.length <= max) return [s]
  const out = []
  let rest = s
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max)
    if (cut < max * 0.5) cut = max
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest.trim()) out.push(rest)
  return out
}

async function sendText(cfg, chatId, text) {
  const chunks = splitText(text)
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    try {
      await tg(cfg, 'sendMessage', {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      })
    } catch (err) {
      log('sendMessage failed:', err?.message ?? err)
      if (err?.retryAfter) await sleep(err.retryAfter * 1000)
    }
  }
}

/**
 * 出站队列用的严格发送：任何一段失败都抛，交给 outbox 退避重试。
 * 普通回复仍走 sendText（失败只记日志，不改变原来的聊天体验）。
 */
async function sendTextStrict(cfg, chatId, text) {
  const chunks = splitText(text)
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    await tg(cfg, 'sendMessage', {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    })
  }
}

/**
 * 图片出站：只给 owner 发真实图片文件。调用方（imageoutbox）已经验证过
 * 路径在受信任的生成目录里；这里再验文件存在、大小和魔数。
 */
async function sendPhotoStrict(cfg, chatId, filePath) {
  const fsp = fs.promises
  const st = await fsp.stat(filePath)
  if (!st.isFile()) throw new Error('不是文件')
  if (st.size < 12) throw new Error('文件太小')
  if (st.size > 10 * 1024 * 1024) throw new Error('图片超过 Telegram 10MB 上限')
  const buf = await fsp.readFile(filePath)
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  const gif = buf.slice(0, 3).toString('latin1') === 'GIF'
  const webp = buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP'
  if (!png && !jpg && !gif && !webp) throw new Error('不是可发送的图片格式')
  const mime = png ? 'image/png' : jpg ? 'image/jpeg' : gif ? 'image/gif' : 'image/webp'
  const fd = new FormData()
  fd.append('chat_id', String(chatId))
  fd.append('photo', new Blob([buf], { type: mime }), path.basename(filePath))
  const url = `${apiBase(cfg)}/bot${cfg.TELEGRAM_BOT_TOKEN}/sendPhoto`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 60000)
  try {
    const res = await fetch(url, { method: 'POST', body: fd, signal: ac.signal })
    let body = null
    try { body = await res.json() } catch { body = null }
    if (!res.ok || !body?.ok) {
      const desc = body?.description || `HTTP ${res.status}`
      const err = new Error(desc)
      err.status = res.status
      err.retryAfter = Number(body?.parameters?.retry_after) || 0
      throw err
    }
    return body.result
  } finally {
    clearTimeout(timer)
  }
}


/** 送去 Telegram 的语音必须是 OGG/Opus；只接受这次 TTS 写到受控临时目录的文件。 */
async function sendVoiceStrict(cfg, chatId, filePath) {
  const st = await fsp.stat(filePath)
  if (!st.isFile()) throw new Error('不是文件')
  if (st.size < 200) throw new Error('语音文件太小')
  if (st.size > 10 * 1024 * 1024) throw new Error('语音超过 Telegram 10MB 上限')
  const buf = await fsp.readFile(filePath)
  if (buf.slice(0, 4).toString('latin1') !== 'OggS') throw new Error('不是 OGG/Opus 语音')
  const fd = new FormData()
  fd.append('chat_id', String(chatId))
  fd.append('voice', new Blob([buf], { type: 'audio/ogg' }), path.basename(filePath))
  const url = `${apiBase(cfg)}/bot${cfg.TELEGRAM_BOT_TOKEN}/sendVoice`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 60000)
  try {
    const res = await fetch(url, { method: 'POST', body: fd, signal: ac.signal })
    let body = null
    try { body = await res.json() } catch { body = null }
    if (!res.ok || !body?.ok) {
      const desc = body?.description || `HTTP ${res.status}`
      const err = new Error(desc)
      err.status = res.status
      err.retryAfter = Number(body?.parameters?.retry_after) || 0
      throw err
    }
    return body.result
  } finally { clearTimeout(timer) }
}

/** 清理 Markdown/路径，只保留能读出来的字；不改原意。 */
function cleanForSpeech(text) {
  let s = String(text ?? '')
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  s = s.replace(/https?:\/\/\S+/g, ' ')
  s = s.replace(/`{1,3}/g, '')
  s = s.replace(/[*_#>~]/g, '')
  // 如果某个名字的发音需要纠正，在本地副本里按需加一行替换；
  // 公开模板不包含任何真实主人的名字。
  s = s.replace(/\s+/g, ' ')
  return s.trim()
}

/** Kokoro 中文固定声线；返回临时 OGG/Opus 路径。 */
async function synthesizeKokoro(cfg, text) {
  const clean = cleanForSpeech(text)
  if (!clean) return { ok: false, why: '没有可读的字' }
  if (clean.length > (Number(cfg.TTS_MAX_CHARS) || 420)) {
    return { ok: false, why: '回复太长，先不合成语音' }
  }
  const dir = path.join(STATE_DIR, 'tts')
  const id = randomUUID().slice(0, 8)
  const wav = path.join(dir, `tts-${Date.now()}-${id}.wav`)
  const ogg = path.join(dir, `tts-${Date.now()}-${id}.ogg`)
  const t0 = Date.now()
  try {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
    const K = cfg.TTS_DIR
    const tts = await runProcess(cfg.TTS_BIN, [
      `--kokoro-model=${path.join(K, 'model.int8.onnx')}`,
      `--kokoro-voices=${path.join(K, 'voices.bin')}`,
      `--kokoro-tokens=${path.join(K, 'tokens.txt')}`,
      `--kokoro-data-dir=${path.join(K, 'espeak-ng-data')}`,
      `--kokoro-lexicon=${path.join(K, 'lexicon-us-en.txt')},${path.join(K, 'lexicon-zh.txt')}`,
      `--sid=${Number(cfg.TTS_SID) || 47}`,
      '--num-threads=2',
      `--output-filename=${wav}`,
      clean,
    ], {
      timeoutMs: 120000,
      env: { ...process.env, LD_LIBRARY_PATH: cfg.TTS_LIB + (process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : '') },
    })
    if (tts.code !== 0) return { ok: false, why: `TTS 退出码 ${tts.code}` }
    const ws = await fsp.stat(wav).catch(() => null)
    if (!ws || ws.size < 1000) return { ok: false, why: 'TTS 没有产出 WAV' }
    const ff = await runProcess(cfg.FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
      '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-f', 'ogg', ogg,
    ], { timeoutMs: 60000 })
    if (ff.code !== 0) return { ok: false, why: `Opus 编码失败（${String(ff.stderr).slice(0, 100)}）` }
    const os = await fsp.stat(ogg).catch(() => null)
    if (!os || os.size < 200) return { ok: false, why: 'OGG/Opus 是空的' }
    return { ok: true, path: ogg, ms: Date.now() - t0, bytes: os.size }
  } catch (err) {
    return { ok: false, why: String(err?.message ?? err).slice(0, 120), ms: Date.now() - t0 }
  } finally {
    await fsp.rm(wav, { force: true }).catch(() => {})
  }
}

/**
 * OpenRouter 免费 TTS（HeyGen / Fish）。只接受 PCM 或 MP3；统一转成 OGG/Opus。
 * 免费额度不足、超时、非 200 都按失败处理，由调用方退回文字；绝不切收费模型。
 */
async function synthesizeOpenRouter(cfg, text) {
  const clean = cleanForSpeech(text)
  if (!clean) return { ok: false, why: '没有可读的字' }
  if (clean.length > (Number(cfg.TTS_MAX_CHARS) || 420)) {
    return { ok: false, why: '回复太长，先不合成语音' }
  }
  const key = String(cfg.OPENROUTER_API_KEY || '').trim()
  if (!key) return { ok: false, why: '没有配置 OPENROUTER_API_KEY' }
  const model = String(cfg.OPENROUTER_TTS_MODEL || '').trim()
  if (!model) return { ok: false, why: '没有配置 TTS 模型' }
  const voice = String(cfg.OPENROUTER_TTS_VOICE || '').trim()
  const dir = path.join(STATE_DIR, 'tts')
  const id = randomUUID().slice(0, 8)
  const raw = path.join(dir, `tts-${Date.now()}-${id}.raw`)
  const ogg = path.join(dir, `tts-${Date.now()}-${id}.ogg`)
  const t0 = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), Number(cfg.OPENROUTER_TTS_TIMEOUT_MS) || 45000)
  try {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
    const body = { model, input: clean, response_format: 'pcm' }
    if (voice) body.voice = voice
    const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'HTTP-Referer': String(cfg.DSH_BASE_URL || 'http://127.0.0.1:3080'),
        'X-Title': 'dsh-fish',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    const ct = String(res.headers.get('content-type') || '')
    const buf = Buffer.from(await res.arrayBuffer())
    if (!res.ok || ct.includes('json')) {
      let msg = `HTTP ${res.status}`
      try { msg += `：${JSON.parse(buf.toString('utf8'))?.error?.message ?? ''}` } catch { /* 非 JSON */ }
      return { ok: false, why: msg.slice(0, 160), ms: Date.now() - t0 }
    }
    if (buf.length < 1000) return { ok: false, why: '云端返回的音频太小', ms: Date.now() - t0 }
    const rate = Number((ct.match(/rate=(\d+)/) ?? [])[1] || 24000)
    const ch = Number((ct.match(/channels=(\d+)/) ?? [])[1] || 1)
    // PCM 原始流；MP3 就让 ffmpeg 自己识别
    const isPcm = ct.includes('pcm') || (!ct.includes('mpeg') && !ct.includes('mp3') && !ct.includes('ogg') && !ct.includes('wav'))
    if (ct.includes('mpeg') || ct.includes('mp3')) {
      await fsp.writeFile(raw + '.mp3', buf, { mode: 0o600 })
    } else {
      await fsp.writeFile(raw, buf, { mode: 0o600 })
    }
    const input = ct.includes('mpeg') || ct.includes('mp3') ? raw + '.mp3' : raw
    const args = ['-hide_banner', '-loglevel', 'error', '-y']
    if (isPcm) args.push('-f', 's16le', '-ar', String(rate), '-ac', String(ch))
    args.push('-i', input, '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-f', 'ogg', ogg)
    const ff = await runProcess(cfg.FFMPEG_BIN, args, { timeoutMs: 60000 })
    if (ff.code !== 0) return { ok: false, why: `Opus 编码失败（${String(ff.stderr).slice(0, 100)}）` }
    const os = await fsp.stat(ogg).catch(() => null)
    if (!os || os.size < 200) return { ok: false, why: 'OGG/Opus 是空的' }
    return { ok: true, path: ogg, ms: Date.now() - t0, bytes: os.size }
  } catch (err) {
    const why = err?.name === 'AbortError' ? '云端 TTS 超时' : String(err?.message ?? err)
    return { ok: false, why: why.slice(0, 140), ms: Date.now() - t0 }
  } finally {
    clearTimeout(timer)
    await fsp.rm(raw, { force: true }).catch(() => {})
    await fsp.rm(raw + '.mp3', { force: true }).catch(() => {})
  }
}

/**
 * Breeze Blue 自定义音色。同步模式；只接受 audio/*，JSON/202 都算失败并回退文字。
 * 失败不会自动切 Noelle，也不会充值或开通付费项。
 */
async function synthesizeBreeze(cfg, text) {
  const clean = cleanForSpeech(text)
  if (!clean) return { ok: false, why: '没有可读的字' }
  if (clean.length > (Number(cfg.TTS_MAX_CHARS) || 420)) {
    return { ok: false, why: '回复太长，先不合成语音' }
  }
  const key = String(cfg.BREEZE_API_KEY || '').trim()
  if (!key) return { ok: false, why: '没有配置 BREEZE_API_KEY' }
  const voice = String(cfg.BREEZE_TTS_VOICE || '').trim()
  if (!voice) return { ok: false, why: '没有配置 Breeze 音色' }
  const base = String(cfg.BREEZE_BASE_URL || 'https://api.breeze.blue').replace(/\/+$/, '')
  const dir = path.join(STATE_DIR, 'tts')
  const id = randomUUID().slice(0, 8)
  const mp3 = path.join(dir, `tts-${Date.now()}-${id}.mp3`)
  const ogg = path.join(dir, `tts-${Date.now()}-${id}.ogg`)
  const t0 = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), Number(cfg.BREEZE_TTS_TIMEOUT_MS) || 60000)
  try {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
    const body = {
      text: clean,
      model_id: String(cfg.BREEZE_TTS_MODEL || 'breeze-tts-2'),
      instructions: String(cfg.BREEZE_TTS_INSTRUCTIONS || '').trim() || undefined,
      voice_settings: {
        speed: Number(cfg.BREEZE_TTS_SPEED) || 1,
        guidance_scale: Number(cfg.BREEZE_TTS_GUIDANCE) || 1,
      },
    }
    const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3&delivery=sync`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    const ct = String(res.headers.get('content-type') || '')
    const buf = Buffer.from(await res.arrayBuffer())
    if (!res.ok || !ct.includes('audio')) {
      let msg = `HTTP ${res.status}`
      try {
        const j = JSON.parse(buf.toString('utf8'))
        msg += `：${j?.detail?.message ?? j?.detail?.[0]?.msg ?? j?.message ?? ''}`
      } catch { /* 非 JSON */ }
      return { ok: false, why: msg.slice(0, 180), ms: Date.now() - t0 }
    }
    if (buf.length < 5000) return { ok: false, why: 'Breeze 返回的音频太小', ms: Date.now() - t0 }
    await fsp.writeFile(mp3, buf, { mode: 0o600 })
    const ff = await runProcess(cfg.FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', mp3,
      '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-f', 'ogg', ogg,
    ], { timeoutMs: 60000 })
    if (ff.code !== 0) return { ok: false, why: `Opus 编码失败（${String(ff.stderr).slice(0, 100)}）` }
    const os = await fsp.stat(ogg).catch(() => null)
    if (!os || os.size < 200) return { ok: false, why: 'OGG/Opus 是空的' }
    return { ok: true, path: ogg, ms: Date.now() - t0, bytes: os.size }
  } catch (err) {
    const why = err?.name === 'AbortError' ? 'Breeze TTS 超时' : String(err?.message ?? err)
    return { ok: false, why: why.slice(0, 140), ms: Date.now() - t0 }
  } finally {
    clearTimeout(timer)
    await fsp.rm(mp3, { force: true }).catch(() => {})
  }
}

/** 按 TTS_PROVIDER 选引擎；off 直接失败，绝不偷偷用本地 Kokoro 兜底。 */
async function synthesizeSpeech(cfg, text) {
  const provider = String(cfg.TTS_PROVIDER || 'off').trim().toLowerCase()
  if (provider === 'breeze' || provider === 'breezeblue') return synthesizeBreeze(cfg, text)
  if (provider === 'openrouter') return synthesizeOpenRouter(cfg, text)
  if (provider === 'local') return synthesizeKokoro(cfg, text)
  return { ok: false, why: `语音输出已关闭（TTS_PROVIDER=${provider}）` }
}

/** 语音回复的最小持久化：桥在 TTS 中途重启时，下一次启动还能补发/回退。 */
function savePendingTts(item) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
    fs.writeFileSync(TTS_PENDING, JSON.stringify(item), { mode: 0o600 })
  } catch { /* 不影响本次回复 */ }
}
function readPendingTts() {
  try { return JSON.parse(fs.readFileSync(TTS_PENDING, 'utf8')) } catch { return null }
}
function clearPendingTts() {
  try { fs.rmSync(TTS_PENDING, { force: true }) } catch { /* ignore */ }
}

/**
 * 把真寻已经写出的回复合成为语音。最多重试一次；失败由调用方退回文字。
 * 不生成新的回复文本，不改变原意。
 */
async function sendVoiceReply(cfg, chatId, text, { logPrefix = 'tts ' } = {}) {
  savePendingTts({ chatId, text, at: new Date().toISOString() })
  try {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const r = await synthesizeSpeech(cfg, text)
    if (!r.ok) {
      log(`${logPrefix}合成失败（${attempt}/2）：`, r.why)
      if (attempt === 1) continue
      return false
    }
    try {
      await sendVoiceStrict(cfg, chatId, r.path)
      log(`${logPrefix}sendVoice ok`, `ms=${r.ms}`, `bytes=${r.bytes}`)
      return true
    } catch (err) {
      log(`${logPrefix}sendVoice 失败（${attempt}/2）：`, err?.message ?? err)
    } finally {
      await fsp.rm(r.path, { force: true }).catch(() => {})
    }
  }
  return false
  } finally {
    clearPendingTts()
  }
}

function startTyping(cfg, chatId) {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try { await tg(cfg, 'sendChatAction', { chat_id: chatId, action: 'typing' }) } catch { /* 忽略 */ }
    if (!stopped) timer = setTimeout(tick, 4000)
  }
  let timer = setTimeout(tick, 500)
  return () => { stopped = true; clearTimeout(timer) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

/** 跑一个子进程并收 stdout/stderr；ASR/FFmpeg 都不抛到主流程。 */
function runProcess(bin, args, { timeoutMs = 120000, env = process.env } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    const p = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { p.kill('SIGKILL') } catch { /* ignore */ }
      resolve({ code: -1, stdout, stderr: `${stderr}\n(timeout ${timeoutMs}ms)` })
    }, timeoutMs)
    p.stdout.on('data', (c) => { if (stdout.length < 200000) stdout += String(c) })
    p.stderr.on('data', (c) => { if (stderr.length < 20000) stderr += String(c) })
    p.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code: -2, stdout, stderr: String(err?.message ?? err) })
    })
    p.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code: code ?? -3, stdout, stderr })
    })
  })
}

/** 读 SenseVoice 输出里的最后一个 JSON 对象。 */
function parseAsrJson(stdout) {
  const lines = String(stdout ?? '').trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try {
      const j = JSON.parse(line)
      if (typeof j?.text === 'string') return j
    } catch { /* 继续找 */ }
  }
  return null
}

/** Telegram voice → 16k mono WAV → SenseVoice；只在这次调用期间存在。 */
async function transcribeVoice(cfg, buf, { duration = 0 } = {}) {
  const dir = path.join(STATE_DIR, 'voice')
  const id = randomUUID().slice(0, 8)
  const input = path.join(dir, `voice-${Date.now()}-${id}.ogg`)
  const wav = path.join(dir, `voice-${Date.now()}-${id}.wav`)
  const t0 = Date.now()
  try {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
    await fsp.writeFile(input, buf, { mode: 0o600 })
    const ff = await runProcess(cfg.FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
      '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le', wav,
    ], { timeoutMs: 60000 })
    if (ff.code !== 0) return { ok: false, why: `FFmpeg 转码失败（${String(ff.stderr).slice(0, 120)}）`, ms: Date.now() - t0 }
    const wavStat = await fsp.stat(wav).catch(() => null)
    if (!wavStat || wavStat.size < 100) return { ok: false, why: '转码后的音频是空的', ms: Date.now() - t0 }
    const asr = await runProcess(cfg.ASR_BIN, [
      `--tokens=${cfg.ASR_TOKENS}`,
      `--sense-voice-model=${cfg.ASR_MODEL}`,
      '--sense-voice-language=auto',
      '--num-threads=2',
      wav,
    ], {
      timeoutMs: 120000,
      env: { ...process.env, LD_LIBRARY_PATH: cfg.ASR_LIB + (process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : '') },
    })
    if (asr.code !== 0) return { ok: false, why: `ASR 退出码 ${asr.code}（${String(asr.stderr).slice(0, 120)}）`, ms: Date.now() - t0 }
    const j = parseAsrJson(asr.stdout)
    const text = String(j?.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return { ok: false, why: 'ASR 没有给出文字', ms: Date.now() - t0 }
    return { ok: true, text, lang: String(j?.lang ?? ''), ms: Date.now() - t0, duration: Number(duration) || 0, bytes: buf.length }
  } catch (err) {
    return { ok: false, why: String(err?.message ?? err).slice(0, 120), ms: Date.now() - t0 }
  } finally {
    await fsp.rm(input, { force: true }).catch(() => {})
    await fsp.rm(wav, { force: true }).catch(() => {})
  }
}

async function downloadTelegramFile(cfg, fileId) {
  const f = await tg(cfg, 'getFile', { file_id: fileId })
  const filePath = String(f?.file_path ?? '')
  if (!filePath) throw new Error('Telegram 没有返回 file_path')
  const url = `${apiBase(cfg)}/file/bot${cfg.TELEGRAM_BOT_TOKEN}/${filePath}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 60000)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`下载语音失败 HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  } finally { clearTimeout(timer) }
}


/**
 * Telegram voice：只处理 owner 私聊；下载 → FFmpeg 16k mono → SenseVoice。
 * 转写失败就明确说没听清，不猜测内容；成功后走和文字一样的 /dsh-fish/say。
 */
async function handleVoice(cfg, msg, chatId) {
  const v = msg.voice || {}
  const t0 = Date.now()
  const duration = Number(v.duration) || 0
  const declaredSize = Number(v.file_size) || 0
  const maxSec = Number(cfg.VOICE_MAX_SEC) || 60
  const maxBytes = Number(cfg.VOICE_MAX_BYTES) || 5 * 1024 * 1024
  if (!v.file_id) {
    await sendText(cfg, chatId, '（这条语音没有文件，听不了。）')
    return
  }
  if (duration > maxSec) {
    await sendText(cfg, chatId, `（语音太长了，我只听 ${maxSec} 秒以内的。）`)
    return
  }
  if (declaredSize > maxBytes) {
    await sendText(cfg, chatId, '（语音文件太大了，我这边听不了。）')
    return
  }

  const stopTyping = startTyping(cfg, chatId)
  let buf
  try {
    buf = await downloadTelegramFile(cfg, v.file_id)
  } catch (err) {
    stopTyping()
    log('voice 下载失败：', err?.message ?? err)
    await sendText(cfg, chatId, '（这条语音没下载下来，能再说一遍吗？）')
    return
  }
  if (!buf || buf.length < 200) {
    stopTyping()
    await sendText(cfg, chatId, '（这条语音是空的，听不了。）')
    return
  }
  if (buf.length > maxBytes) {
    stopTyping()
    await sendText(cfg, chatId, '（语音文件太大了，我这边听不了。）')
    return
  }

  const r = await transcribeVoice(cfg, buf, { duration })
  stopTyping()
  if (!r.ok) {
    log('voice ASR 失败：', r.why, 'ms=', r.ms)
    await sendText(cfg, chatId, '（这条语音没听清，能再说一遍吗？）')
    return
  }
  log('voice ASR ok:', `lang=${r.lang}`, `duration=${duration}s`, `bytes=${buf.length}`, `asrMs=${r.ms}`)
  const text = `（语音转写，可能有误）${r.text}`
  await deliverToHer(cfg, chatId, text, {
    title: msg.chat?.first_name || msg.chat?.username || 'Telegram',
    logPrefix: 'voice ',
    voiceReply: false, // M2.12.1：语音入站默认只回文字；只有明确要求语音才合成。
  })
  log('voice 总耗时', Date.now() - t0, 'ms（含下载/转写/回复）')
}

// ---------------------------------------------------------------- 一轮对话

async function handleMessage(cfg, msg) {
  const chat = msg.chat || {}
  const chatId = String(chat.id ?? '')
  const msgKey = `${chatId}:${msg.message_id}`
  if (state.seenMessages.includes(msgKey)) return
  state.seenMessages.push(msgKey)
  state.seenMessages = state.seenMessages.slice(-400)
  saveState()

  if (chat.type !== 'private') return

  const owner = cfg.OWNER_TELEGRAM_ID
  if (!owner) {
    log('收到私聊，但 OWNER_TELEGRAM_ID 还没配置，已忽略。chat_id=' + chatId)
    await sendText(cfg, chatId, `还没配置主人。你的 Telegram ID 是 ${chatId}，把它填进服务端配置后我就开始工作。`)
    return
  }
  if (chatId !== owner) {
    log('非主人私聊，已忽略。chat_id=' + chatId)
    return
  }

  if (msg.voice) {
    await handleVoice(cfg, msg, chatId)
    return
  }

  const text = String(msg.text ?? '').trim()
  if (!text) return

  if (text === '/start' || text === '/help' || text.startsWith('/start@')) {
    await sendText(cfg, chatId, '这里是大肥鱼。直接说话就行。')
    return
  }
  if (text === '/id') {
    await sendText(cfg, chatId, `chat_id: ${chatId}`)
    return
  }
  if (text === '/ping') {
    await sendText(cfg, chatId, 'pong')
    return
  }
  if (text.startsWith('/')) return

  // M2.12.4：owner 的偏好指令先落盘，再照常把这句话递给她。
  // 只有真实用户私聊能走到这里；模型没有改额度的入口。
  const pref = parseVoicePreference(text)
  let forceText = false
  if (pref?.temp === 'text') forceText = true
  if (pref?.mode) {
    const before = loadVoicePrefs().mode
    saveVoicePrefs(pref.mode)
    log(`语音偏好：${before} -> ${pref.mode}`)
  }
  const wantsVoice = !forceText && !pref?.mode && /用语音|语音(回答|回复|说|跟)|发.{0,3}语音/.test(text)
  await deliverToHer(cfg, chatId, text, {
    title: chat.first_name || chat.username || 'Telegram',
    voiceReply: wantsVoice && ttsProviderEnabled(cfg),
    explicitVoice: wantsVoice,
    forceText,
    voiceChoice: !wantsVoice && loadVoicePrefs().mode === 'auto',
  })
}

/**
 * 一条真实的她该看见的消息：/say 投递、等她的正文、失败兜底。
 * 普通文字和语音转写共用这一段，避免两条路各写一份。
 */
// ---------------------------------------------------------------- 自主语音（M2.12.4）

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function loadVoicePrefs() {
  const j = readJsonFile(VOICE_PREFS_FILE)
  const mode = ['auto', 'request_only', 'off'].includes(j?.mode) ? j.mode : 'auto'
  return { mode, updatedAt: j?.updatedAt ?? null }
}

function saveVoicePrefs(mode) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
    fs.writeFileSync(VOICE_PREFS_FILE, JSON.stringify({ mode, updatedAt: new Date().toISOString() }), { mode: 0o600 })
  } catch (err) { log('保存语音偏好失败：', err?.message ?? err) }
}

/** 自主语音计数；跨自然日自动归零，落盘后重启也记得。 */
function loadVoiceUsage() {
  const today = hkClock().day
  const j = readJsonFile(VOICE_USAGE_FILE)
  if (!j || j.day !== today) return { day: today, count: 0, lastAt: 0, history: [] }
  return {
    day: today,
    count: Number(j.count) || 0,
    lastAt: Number(j.lastAt) || 0,
    history: Array.isArray(j.history) ? j.history : [],
  }
}

function saveVoiceUsage(u) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
    fs.writeFileSync(VOICE_USAGE_FILE, JSON.stringify({ ...u, history: u.history.slice(-50) }), { mode: 0o600 })
  } catch (err) { log('保存语音计数失败：', err?.message ?? err) }
}

function recordVoiceUse({ kind, chars, ok }) {
  const u = loadVoiceUsage()
  // 只有真正发出去的自主语音才占额度；失败只留一条历史。
  if (kind === 'auto' && ok) { u.count += 1; u.lastAt = Date.now() }
  u.history.push({ at: new Date().toISOString(), kind, chars, ok })
  saveVoiceUsage(u)
}

/** 自主语音的上限：模式、时段、每日 3 条、间隔 30 分钟、单条 150 字。 */
function autonomousVoiceGate(text) {
  const prefs = loadVoicePrefs()
  const u = loadVoiceUsage()
  return checkAutoVoice({
    mode: prefs.mode,
    count: u.count,
    lastAt: u.lastAt,
    now: Date.now(),
    chars: cleanForSpeech(text).length,
  })
}

/** 只有启用了 TTS provider，才允许把这一轮变成语音。 */
function ttsProviderEnabled(cfg) {
  const p = String(cfg.TTS_PROVIDER ?? 'off').trim().toLowerCase()
  return p === 'breeze' || p === 'breezeblue' || p === 'openrouter' || p === 'local'
}

async function deliverToHer(cfg, chatId, text, { title = 'Telegram', logPrefix = '', voiceReply = false, explicitVoice = false, forceText = false, voiceChoice = false } = {}) {
  const t0 = Date.now()
  const stopTyping = startTyping(cfg, chatId)
  try {
    // 先问一句她住哪条会话：万一这一轮聊满换房，兜底还能找到旧房的事件。
    let houseId = ''
    try {
      const wr = await dshFetch(cfg, '/dsh-fish/whoami', { method: 'GET' })
      if (wr.ok) houseId = String((await wr.json())?.sessionId ?? '')
    } catch { /* 拿不到不影响投递 */ }

    const res = await dshFetch(cfg, '/dsh-fish/say', {
      method: 'POST',
      body: JSON.stringify({
        text,
        channel: `telegram:${chatId}`,
        scene: 'private',
        room: 'house',
        title,
        ...(voiceReply ? { voice: true } : {}),
        // 自主模式：只在 auto 且不是明确要求时，把「可以自己选」放进当轮提示。
        ...(voiceChoice ? { voiceChoice: true } : {}),
      }),
    })
    let out = ''
    let note = ''
    let sessionId = ''
    let voiceRequested = false
    if (res.ok) {
      const r = await res.json()
      out = String(r?.herReply ?? '').trim()
      note = String(r?.note ?? '').trim()
      sessionId = String(r?.sessionId ?? '').trim()
      voiceRequested = r?.voiceRequested === true
      log(`${logPrefix}say ok=`, r?.ok, 'waitedMs=', r?.waitedMs, 'said=', Array.isArray(r?.said) ? r.said.length : 0, 'session=', sessionId)
    } else {
      note = `投递失败：HTTP ${res.status}`
      log(`${logPrefix}say http`, res.status, (await res.text().catch(() => '')).slice(0, 200))
    }

    // /say 75 秒上限到了、她还在弹卡等人回答：等她这一轮真正结束再取正文。
    if (!out && (sessionId || houseId)) {
      log(`${logPrefix}herReply 为空，改读会话事件等这一轮结束…`)
      const w = await waitSessionReply(cfg, [sessionId, houseId], t0)
      if (w.text) out = w.text
      else log(`${logPrefix}会话兜底也没拿到正文：`, w.why)
    }

    if (out) {
      // 发送方式：明确要求 > 她自己标记 > 文字。
      // 自主语音还要过模式、时段、每日 3 条、30 分钟间隔、150 字。
      let voiceKind = ''
      if (ttsProviderEnabled(cfg) && !forceText) {
        const prefs = loadVoicePrefs()
        if (explicitVoice) {
          if (prefs.mode === 'off') log(`${logPrefix}voice_mode=off，明确要求的语音也不发`)
          else voiceKind = 'explicit'
        } else if (voiceRequested) {
          const gate = autonomousVoiceGate(out)
          if (gate.ok) voiceKind = 'auto'
          else log(`${logPrefix}自主语音跳过：`, gate.why)
        }
      }
      if (voiceKind) {
        const chars = cleanForSpeech(out).length
        const voiced = await sendVoiceReply(cfg, chatId, out, { logPrefix: `${logPrefix}tts ` })
        recordVoiceUse({ kind: voiceKind, chars, ok: voiced })
        if (voiced) {
          log(`${logPrefix}语音回复已发出`, `kind=${voiceKind}`, `chars=${chars}`)
          return
        }
        log(`${logPrefix}TTS 失败，退回文字`, `kind=${voiceKind}`)
      }
      await sendText(cfg, chatId, out)
    } else if (note) await sendText(cfg, chatId, note)
    else await sendText(cfg, chatId, '（她这次没说话。）')
    log(`${logPrefix}回合完成，耗时`, Date.now() - t0, 'ms')
  } catch (err) {
    log(`${logPrefix}回合失败：`, err?.name === 'AbortError' ? '请求超时' : (err?.message ?? err))
    await sendText(cfg, chatId, '（这条没送到她那，等会儿再试。）')
  } finally {
    stopTyping()
  }
}

// ---------------------------------------------------------------- 主循环

let activeToken = ''
let botName = ''
let warnedNoTokenAt = 0
let warnedNoOwnerAt = 0
let backoff = 1000

async function pollOnce(cfg) {
  const offset = state.lastUpdateId ? state.lastUpdateId + 1 : undefined
  const updates = await tg(cfg, 'getUpdates', {
    ...(offset ? { offset } : {}),
    timeout: Number(cfg.POLL_TIMEOUT) || 30,
    allowed_updates: ['message'],
  }, { timeoutMs: (Number(cfg.POLL_TIMEOUT) || 30) * 1000 + 15000 })
  if (!Array.isArray(updates)) return []
  const fresh = []
  for (const u of updates) {
    const id = Number(u?.update_id) || 0
    if (!id || id <= state.lastUpdateId) continue
    if (state.seenUpdates.includes(id)) continue
    state.seenUpdates.push(id)
    state.lastUpdateId = id
    state.seenUpdates = state.seenUpdates.slice(-400)
    saveState()
    fresh.push(u)
  }
  return fresh
}

/** 桥在合成中途重启时，继续上一次未完成的语音回复；失败退回文字。 */
async function resumePendingTts() {
  const p = readPendingTts()
  if (!p || !p.chatId || !p.text) return
  clearPendingTts()
  const cfg = readConfig()
  if (!cfg.TELEGRAM_BOT_TOKEN || !cfg.OWNER_TELEGRAM_ID) return
  const age = Date.now() - (Date.parse(String(p.at ?? '')) || 0)
  if (age > 60 * 60_000) {
    await sendText(cfg, String(p.chatId), String(p.text))
    log('tts 恢复：pending 太久，退回文字')
    return
  }
  const ok = await sendVoiceReply(cfg, String(p.chatId), String(p.text), { logPrefix: 'tts-resume ' })
  if (!ok) await sendText(cfg, String(p.chatId), String(p.text))
  log('tts 恢复完成', ok ? 'voice' : 'text')
}

async function main() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  log('桥启动 · node', process.version, '· 状态目录', STATE_DIR)

  // ---- 主动留话出口 ----
  // her_leave 写的是「留给他的一句话」；这里只负责把它送到 owner 私聊。
  // 不生成、不判断、不叫醒；只认 letter meta + 对应 utterance，幂等队列见 outbox.mjs。
  const outbox = createOutbox({
    statePath: path.join(STATE_DIR, 'outbox.json'),
    eventsPath: path.join(HOME, '.dsh-fish', 'events.jsonl'),
    log,
    send: async (text) => {
      const cfg = readConfig()
      if (!cfg.TELEGRAM_BOT_TOKEN) throw new Error('没有 Bot Token')
      if (!cfg.OWNER_TELEGRAM_ID) throw new Error('没有 OWNER_TELEGRAM_ID')
      await sendTextStrict(cfg, cfg.OWNER_TELEGRAM_ID, text)
    },
  })
  // ---- her_draw 图片出口 ----
  // 只认 her_draw 写的 draw:<日期>:<受信任目录路径>；不生成图片、不碰聊天文字。
  const imageOutbox = createImageOutbox({
    statePath: path.join(STATE_DIR, 'image-outbox.json'),
    eventsPath: path.join(HOME, '.dsh-fish', 'events.jsonl'),
    trustedDir: path.join(HOME, '.dsh', 'plugins', 'subscriptions', 'images'),
    log,
    send: async (filePath) => {
      const cfg = readConfig()
      if (!cfg.TELEGRAM_BOT_TOKEN) throw new Error('没有 Bot Token')
      if (!cfg.OWNER_TELEGRAM_ID) throw new Error('没有 OWNER_TELEGRAM_ID')
      await sendPhotoStrict(cfg, cfg.OWNER_TELEGRAM_ID, filePath)
    },
  })
  const outboxTick = async () => {
    try {
      outbox.scan()
      await outbox.pump()
      imageOutbox.scan()
      await imageOutbox.pump()
    } catch (err) {
      log('outbox tick failed:', err?.message ?? err)
    }
  }
  void outboxTick()
  const outboxTimer = setInterval(outboxTick, 3000)
  outboxTimer.unref?.()
  log('主动留话出口已就绪：只看 her_leave 的 letter 事件，队列', path.join(STATE_DIR, 'outbox.json'))
  log('生图出口已就绪：只看 her_draw 的 draw 事件，队列', path.join(STATE_DIR, 'image-outbox.json'))

  let queue = Promise.resolve()
  const enqueue = (fn) => { queue = queue.then(fn, fn).catch((e) => log('队列异常：', e?.message ?? e)) }

  const shutdown = (sig) => {
    log('收到', sig, '，退出。')
    saveState()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  while (true) {
    const cfg = readConfig()
    const token = cfg.TELEGRAM_BOT_TOKEN
    if (!token) {
      if (Date.now() - warnedNoTokenAt > 600000) {
        warnedNoTokenAt = Date.now()
        log(`等待 Bot Token：请把 Token 写进 ${ENV_FILE}（0600），会自动生效，不用重启。`)
      }
      await sleep(15000)
      continue
    }
    if (!cfg.OWNER_TELEGRAM_ID && Date.now() - warnedNoOwnerAt > 600000) {
      warnedNoOwnerAt = Date.now()
      log('OWNER_TELEGRAM_ID 还没配置：只回应第一条私聊里的提示，不会把消息递给大肥鱼。')
    }
    if (token !== activeToken) {
      activeToken = token
      try {
        const me = await tg({ ...cfg, TELEGRAM_BOT_TOKEN: token }, 'getMe', {})
        botName = String(me?.username ?? '')
        log('Bot 已连接：@' + botName)
      } catch (err) {
        log('Bot Token 校验失败：', err?.message ?? err)
        await sleep(10000)
        continue
      }
      // 顺手探一下 DSH：认证失败或 DSH 没起来，这里就会先报出来，不用等第一条消息。
      try {
        const wr = await dshFetch(cfg, '/dsh-fish/whoami', { method: 'GET' })
        if (wr.ok) {
          const w = await wr.json()
          log('DSH 就绪：session=' + w.sessionId + ' writable=' + w.writable)
        } else {
          log('DSH 探活失败：HTTP', wr.status)
        }
      } catch (err) {
        log('DSH 探活失败：', err?.message ?? err)
      }
      void resumePendingTts().catch((err) => log('tts 恢复失败：', err?.message ?? err))
    }

    try {
      const updates = await pollOnce({ ...cfg, TELEGRAM_BOT_TOKEN: token })
      backoff = 1000
      for (const u of updates) {
        if (u?.message) enqueue(() => handleMessage({ ...cfg, TELEGRAM_BOT_TOKEN: token }, u.message))
      }
    } catch (err) {
      const status = Number(err?.status) || 0
      if (status === 409) {
        log('另一个进程也在轮询这个 Bot（409），10 秒后重试。')
        await sleep(10000)
      } else if (status === 401) {
        log('Bot Token 被 Telegram 拒绝（401），等待配置更新。')
        activeToken = ''
        await sleep(15000)
      } else if (status === 429) {
        const wait = (Number(err?.retryAfter) || 5) * 1000
        log('限流（429），等', wait, 'ms')
        await sleep(wait)
      } else {
        log('轮询失败：', err?.name === 'AbortError' ? '超时' : (err?.message ?? err), '· ', backoff, 'ms 后重试')
        await sleep(backoff)
        backoff = Math.min(backoff * 2, 30000)
      }
    }
  }
}

// 技术测试入口：只发一条/一张/一段语音，不启动轮询、不写她的记忆。
if (process.argv.includes('--test-tts')) {
  const i = process.argv.indexOf('--test-tts')
  const text = String(process.argv[i + 1] ?? '').trim() || '这是一条技术测试语音。'
  const cfg = readConfig()
  if (!cfg.TELEGRAM_BOT_TOKEN || !cfg.OWNER_TELEGRAM_ID) {
    log('test-tts 失败：缺 Bot Token 或 OWNER_TELEGRAM_ID')
    process.exit(2)
  }
  ;(async () => {
    const r = await synthesizeSpeech(cfg, text)
    if (!r.ok) { log('test-tts 合成失败：', r.why); process.exit(1) }
    try {
      await sendVoiceStrict(cfg, cfg.OWNER_TELEGRAM_ID, r.path)
      log('test-tts ok', `ms=${r.ms}`, `bytes=${r.bytes}`)
    } finally { await fsp.rm(r.path, { force: true }).catch(() => {}) }
  })().then(() => process.exit(0)).catch((err) => { log('test-tts failed:', err?.message ?? err); process.exit(1) })
} else if (process.argv.includes('--test-photo')) {
  const i = process.argv.indexOf('--test-photo')
  const file = String(process.argv[i + 1] ?? '').trim()
  const trusted = path.resolve(path.join(HOME, '.dsh', 'plugins', 'subscriptions', 'images'))
  const p = path.resolve(file)
  const cfg = readConfig()
  if (!cfg.TELEGRAM_BOT_TOKEN || !cfg.OWNER_TELEGRAM_ID) {
    log('test-photo 失败：缺 Bot Token 或 OWNER_TELEGRAM_ID')
    process.exit(2)
  }
  if (!p.startsWith(trusted + path.sep)) {
    log('test-photo 失败：文件不在受信任生成目录')
    process.exit(2)
  }
  sendPhotoStrict(cfg, cfg.OWNER_TELEGRAM_ID, p)
    .then(() => { log('test-photo ok'); process.exit(0) })
    .catch((err) => { log('test-photo failed:', err?.message ?? err); process.exit(1) })
} else if (process.argv.includes('--test-send')) {
  const i = process.argv.indexOf('--test-send')
  const text = String(process.argv[i + 1] ?? '').trim() || '[技术测试] M2.4 出站链路'
  const cfg = readConfig()
  if (!cfg.TELEGRAM_BOT_TOKEN || !cfg.OWNER_TELEGRAM_ID) {
    log('test-send 失败：缺 Bot Token 或 OWNER_TELEGRAM_ID')
    process.exit(2)
  }
  sendTextStrict(cfg, cfg.OWNER_TELEGRAM_ID, text)
    .then(() => { log('test-send ok'); process.exit(0) })
    .catch((err) => { log('test-send failed:', err?.message ?? err); process.exit(1) })
} else {
  main().catch((err) => {
    log('致命错误：', err?.stack || err?.message || String(err))
    process.exit(1)
  })
}
