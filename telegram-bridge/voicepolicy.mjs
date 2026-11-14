/**
 * voicepolicy.mjs —— 自主语音的纯策略（M2.12.4）
 *
 * 只管判断，不读写文件、不发请求。桥负责计数与发送；
 * 这样夜间、每日上限、30 分钟间隔、150 字这些边界可以单独测。
 */

export const VOICE_AUTO_MAX = 3
export const VOICE_AUTO_GAP_MS = 30 * 60 * 1000
export const VOICE_AUTO_MAX_CHARS = 150
export const VOICE_TZ = 'Asia/Hong_Kong'

/** 香港时区的自然日与小时；额度按这个重置。 */
export function hkClock(ts = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VOICE_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(new Date(ts))
  const get = (t) => parts.find((x) => x.type === t)?.value ?? ''
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

/**
 * 自主语音能不能发。
 * @param {{mode:string, count:number, lastAt:number, now?:number, chars:number}} p
 */
export function checkAutoVoice({ mode, count, lastAt, now = Date.now(), chars }) {
  if (mode !== 'auto') return { ok: false, why: `voice_mode=${mode}` }
  const { hour } = hkClock(now)
  if (hour < 9 || hour >= 23) return { ok: false, why: `夜间 ${hour} 点` }
  if (count >= VOICE_AUTO_MAX) return { ok: false, why: `今日自主语音 ${count}/${VOICE_AUTO_MAX}` }
  if (lastAt && now - lastAt < VOICE_AUTO_GAP_MS) return { ok: false, why: '距上条不足 30 分钟' }
  if (chars > VOICE_AUTO_MAX_CHARS) return { ok: false, why: `文本 ${chars} 字，超过 ${VOICE_AUTO_MAX_CHARS}` }
  return { ok: true }
}

/** owner 的偏好指令；只有真实私聊文本会传进来。 */
export function parseVoicePreference(text) {
  const t = String(text ?? '').replace(/\s+/g, '')
  if (!t) return null
  if (/这条.{0,4}(用|要|发)?文字|这次.{0,4}文字|用文字(回答|回复)/.test(t)) return { temp: 'text' }
  if (/关闭语音|关掉语音|语音关掉|不要语音|别用语音/.test(t)) return { mode: 'off' }
  if (/先不要主动发语音|不要主动发语音|别主动发语音|少发点语音|少发语音|少用语音|先别发语音/.test(t)) return { mode: 'request_only' }
  if (/恢复你自己决定|你自己决定就好|正常发语音|可以多用语音|多主动发语音|多用语音|多些语音/.test(t)) return { mode: 'auto' }
  return null
}
