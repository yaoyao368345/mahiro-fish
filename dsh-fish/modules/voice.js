/**
 * voice.js —— 工具 `her_voice`：她自己决定这一轮用声音说（M2.12.4）
 *
 * 为什么不是解析正文里的“我要发语音”：
 *   - 那种标记会漏进用户看到/听到的正文；
 *   - 关键词匹配不是她的决定。
 *
 * 这里只做一件事：她在当轮调用工具时，在内存里记一个「这一轮想用声音」的请求；
 * /say 在回合结束时取走并回给桥。请求不进事件流、不进记忆、不改 herReply。
 * 进程重启会丢失未消费的请求——那就按文字发，属于可接受的退让。
 */

import { defineTool } from './tool.js'
import { toJsonSchema } from './toolschema.js'
import { rootDir } from './store.js'
import { guardWrite } from './tenant.js'
import { logLine } from './log.js'

const REQUEST_TTL_MS = 10 * 60 * 1000
const requests = new Map()

/** 记下「这一轮想用声音」。同一会话重复调用只保留一次。 */
export function markVoiceRequest(sessionId, at = Date.now()) {
  const key = String(sessionId || '').trim()
  if (!key) return false
  requests.set(key, at)
  for (const [k, v] of requests) {
    if (at - v > REQUEST_TTL_MS) requests.delete(k)
  }
  return true
}

/** 取走请求；只有发生在本轮开始之后的才算。 */
export function takeVoiceRequest(sessionId, { since = 0 } = {}) {
  const key = String(sessionId || '').trim()
  if (!key) return false
  const at = requests.get(key)
  if (!at) return false
  requests.delete(key)
  return at >= since
}

function tenancyOf(root, tenancy) {
  if (tenancy && typeof tenancy === 'object') {
    return { root, herDir: String(tenancy.herDir ?? ''), tenant: tenancy.tenant ?? { ok: true } }
  }
  return { root, herDir: '', tenant: { ok: true } }
}

export function registerVoice(ctx, deps = {}) {
  const root = deps.root ?? rootDir()

  return ctx.tools.register(
    defineTool({
      name: 'her_voice',
      description:
        '在 Telegram 私聊里，你想让他听见你的声音时用这个，而不是写在回复里。' +
        '调用之后，你这一轮写下的话会由屋子转成声音发给他；你照常把要说的话写在回复正文里，' +
        '不要写“我要发语音了”这种技术说明。' +
        '它只是一个选择：开心、害羞、惊讶、想分享一件小事、说晚安的时候可以用；' +
        '普通闲聊、长解释、链接和步骤用文字更合适，不调它也完全可以。' +
        '一天最多三次，夜里屋子不会替你出声；额度满了会按文字发。',
      parameters: toJsonSchema({}),
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            text: { type: 'string' },
          },
          required: ['ok', 'text'],
        },
        render: (_args, out) => [{ type: 'text', text: out.text }],
      },
      async execute(_args, exec) {
        const who = guardWrite(tenancyOf(root, deps.tenant), exec, 'her_voice')
        if (!who.ok) return { ok: false, text: who.note }
        if (!markVoiceRequest(who.sessionId)) {
          return { ok: false, text: '这次没记上；话照常写，屋子会按文字发。' }
        }
        logLine('info', ['her_voice：这一轮她选了语音', `session=${who.sessionId}`], root)
        return { ok: true, text: '（记下了：这一轮会用声音说。话照常写在回复里就行。）' }
      },
    }),
  )
}
