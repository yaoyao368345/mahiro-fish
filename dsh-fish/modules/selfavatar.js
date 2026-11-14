/**
 * selfavatar.js —— 工具 `her_avatar`：把已经画过的某张图设成自己的头像
 *
 * 为什么不只靠 her_draw 的 asAvatar：
 *   她经常是「画完过一会儿才想起来用它当头像」。那条路要求重新画一张，
 *   既浪费当天的画图额度，也不是她想要的。这个工具只挑已经画过的图。
 *
 * 只接受她自己画册（drawImagesDir）里的文件；不给 path 就用最近画的那张。
 * 真正的上传由桥做（Bot Token 只在桥那边）：这里只写一条
 * `avatar:<日期>:<路径>` 元事件，和 her_draw(asAvatar) 共用同一个出口。
 */

import fs from 'node:fs'
import path from 'node:path'

import { readEvents, appendEvent, rootDir } from './store.js'
import { loadConfig, dateKey } from './settings.js'
import { drawImagesDir, avatarsToday, AVATAR_PER_DAY } from './draw.js'
import { deriveSelf } from './derive.js'
import { defineTool } from './tool.js'
import { guardWrite } from './tenant.js'
import { logLine } from './log.js'
import { toJsonSchema } from './toolschema.js'

/** 事件流里最近一条 `draw:<日期>:<路径>`。 */
export function latestDrawing(events = []) {
  let last = null
  for (const e of events ?? []) {
    if (e?.type !== 'meta') continue
    const m = /^draw:(\d{4}-\d{2}-\d{2}):(.+)$/.exec(String(e?.text ?? ''))
    if (!m) continue
    last = { date: m[1], path: String(m[2]).trim(), ts: Date.parse(String(e?.ts ?? '')) || 0 }
  }
  return last
}

/**
 * 选出这次要用的图。
 * 只认她画册里的文件；给了路径就用它，没给就用最近那张。
 * @returns {Promise<{ok:true,path:string}|{ok:false,why:string}>}
 */
export async function pickAvatarSource(events, rawPath, dir) {
  const base = path.resolve(String(dir ?? ''))
  if (!base) return { ok: false, why: '还没有画册。' }
  const p = String(rawPath ?? '').trim()
  const chosen = p ? path.resolve(p) : (() => {
    const last = latestDrawing(events)
    return last?.path ? path.resolve(last.path) : ''
  })()
  if (!chosen) return { ok: false, why: '我还没画过能当头像的图。' }
  if (!chosen.startsWith(base + path.sep)) return { ok: false, why: '这张不在我的画册里。' }
  try {
    const st = await fs.promises.stat(chosen)
    if (!st.isFile() || st.size < 12) return { ok: false, why: '这张图找不到了。' }
  } catch {
    return { ok: false, why: '这张图找不到了。' }
  }
  return { ok: true, path: chosen }
}

export function registerSelfAvatar(ctx, deps = {}) {
  const root = deps.root ?? rootDir()

  return ctx.tools.register(
    defineTool({
      name: 'her_avatar',
      description:
        '把你自己画过的某张图设成自己的头像。不给 path 就用你最近画的那张。' +
        '一天最多一次；Telegram 和网页那张会一起换，不用他动手。' +
        '只认你自己画册里的图；想用别的东西当头像，先画一张。',
      parameters: toJsonSchema({
        path: {
          type: 'string',
          description: '可选：哪张画。不写就用最近画的那张。',
        },
      }),
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            path: { type: 'string' },
            text: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['ok', 'path', 'text', 'note'],
        },
        render: (_args, out) => [{ type: 'text', text: out.ok ? out.text : `这次没换成：${out.note}` }],
      },
      async execute(args, exec) {
        const who = guardWrite(tenancyOf(root, deps.tenant), exec, 'her_avatar')
        if (!who.ok) return { ok: false, path: '', text: '', note: who.note }

        const { events } = await readEvents(root)
        const dk = dateKey()
        if (avatarsToday(events, dk) >= AVATAR_PER_DAY) {
          return { ok: false, path: '', text: '', note: '今天已经换过一次头像了，明天再换也一样。' }
        }

        const picked = await pickAvatarSource(events, args?.path, drawImagesDir(root))
        if (!picked.ok) return { ok: false, path: '', text: '', note: picked.why }

        const { config } = await loadConfig(root).catch(() => ({ config: {} }))
        const model = deriveSelf(events, { growthDays: config?.growthDays })
        const stored = await appendEvent(
          { type: 'meta', text: `avatar:${dk}:${picked.path}` },
          { day: model.day, stage: model.stage, source: 'system' },
          root,
        ).catch(() => null)
        if (!stored?.id) {
          logLine('warn', ['her_avatar：头像事件没记下', path.basename(picked.path)], root)
          return { ok: false, path: '', text: '', note: '头像没记上，等会儿再试。' }
        }

        logLine('info', ['her_avatar：换头像', path.basename(picked.path)], root)
        return {
          ok: true,
          path: picked.path,
          text: '这张我拿来当头像。',
          note: '',
        }
      },
    }),
  )
}

function tenancyOf(root, tenancy) {
  if (tenancy && typeof tenancy === 'object') {
    return { root, herDir: String(tenancy.herDir ?? ''), tenant: tenancy.tenant ?? { ok: true } }
  }
  return { root, herDir: '', tenant: { ok: true } }
}
