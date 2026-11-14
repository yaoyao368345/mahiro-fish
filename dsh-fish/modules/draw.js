/**
 * draw.js —— 工具 `her_draw`：她自己想画一张图的时候用（M2.10）
 *
 * 只做编排，不自己请求 OpenAI：
 *   - 复用 dsh-plugin-subscriptions 已注册的 `image_generate`（provider=gpt）；
 *   - 生成成功后写一行 `draw:<日期>:<路径>`，桥只把受信任生成目录里的图片发到 owner 私聊；
 *   - 不写 utterance / growth，不替她解释画了什么。
 *
 * 每天最多 2 张。这个上限是工具层的行为，不是调度器；不会因为唤醒就自动画。
 */

import path from 'node:path'
import fs from 'node:fs'
import { toJsonSchema } from './toolschema.js'
import { rootDir, readEvents, appendEvent } from './store.js'
import { loadConfig, dateKey } from './settings.js'
import { deriveSelf } from './derive.js'
import { defineTool } from './tool.js'
import { guardWrite } from './tenant.js'
import { logLine } from './log.js'

export const DRAW_PER_DAY = 2
export const DRAW_PROMPT_MAX = 800
export const DRAW_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const DRAW_MAX_BYTES = 100 * 1024 * 1024

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

/** 今天已经成功画了几张。 */
export function drawsToday(events = [], dk = dateKey()) {
  const head = `draw:${dk}:`
  return (events ?? []).filter((e) => e?.type === 'meta' && String(e.text ?? '').startsWith(head)).length
}

/** 插件保存生成图的目录。her_draw 只把这里的文件交给桥。 */
export function drawImagesDir(root = rootDir()) {
  return path.join(path.dirname(root), '.dsh', 'plugins', 'subscriptions', 'images')
}

/** 清掉过期的生成图；只动生成目录里的图片，失败静默。 */
export async function pruneDrawImages(root = rootDir(), { now = Date.now(), ttlMs = DRAW_TTL_MS, maxBytes = DRAW_MAX_BYTES } = {}) {
  const dir = drawImagesDir(root)
  let names = []
  try { names = await fs.promises.readdir(dir) } catch { return { removed: 0, kept: 0, bytes: 0 } }
  const files = []
  for (const name of names) {
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
    if (!IMAGE_EXT.has(ext)) continue
    const p = path.join(dir, name)
    try {
      const st = await fs.promises.stat(p)
      if (st.isFile()) files.push({ name, path: p, size: st.size, mtimeMs: st.mtimeMs })
    } catch { /* ignore */ }
  }
  files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  let total = files.reduce((n, f) => n + f.size, 0)
  let kept = files.length
  let removed = 0
  for (const f of files) {
    if (!(now - f.mtimeMs > ttlMs) && total <= maxBytes) continue
    try {
      await fs.promises.unlink(f.path)
      total -= f.size
      kept -= 1
      removed += 1
    } catch { /* ignore */ }
  }
  return { removed, kept, bytes: Math.max(0, total) }
}

function findImageTool(ctx) {
  const tools = ctx?.get?.('tools') ?? ctx?.tools
  if (!tools || typeof tools.get !== 'function') return null
  const def = tools.get('image_generate') ?? tools.get('dsh_subscriptions_image_generate')
  return def && typeof def.execute === 'function' ? def : null
}

export function registerDraw(ctx, deps = {}) {
  const root = deps.root ?? rootDir()
  const log = deps.log ?? (() => {})

  return ctx.tools.register(
    defineTool({
      name: 'her_draw',
      description:
        '你自己想画一张图的时候用这个。给它一句你想画的描述；它会调用 ChatGPT 图片生成，' +
        '把图存下来并送到他那里。一天最多两张。' +
        '只有你真的想画、或者他明确请你画的时候才用；不用它也可以。' +
        '画出来的图是图，不是你的成长记录，也不用替它写观后感。',
      parameters: toJsonSchema({
        prompt: {
          type: 'string',
          required: true,
          maxLength: DRAW_PROMPT_MAX,
          description: '你想画什么。写你脑子里看到的画面，不要写成给别人看的说明。',
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
        render: (_args, out) => [{ type: 'text', text: out.ok ? out.text : `这次没画成：${out.note}` }],
      },
      async execute(args, exec) {
        const who = guardWrite(tenancyOf(root, deps.tenant), exec, 'her_draw')
        if (!who.ok) return { ok: false, path: '', text: '', note: who.note }

        const prompt = String(args?.prompt ?? '').trim().slice(0, DRAW_PROMPT_MAX)
        if (!prompt) return { ok: false, path: '', text: '', note: '还没想好画什么。' }

        const { events } = await readEvents(root)
        const dk = dateKey()
        if (drawsToday(events, dk) >= DRAW_PER_DAY) {
          return { ok: false, path: '', text: '', note: '今天已经画过两张了，明天再画也一样。' }
        }

        const imageTool = findImageTool(ctx)
        if (!imageTool) {
          logLine('info', ['her_draw：宿主没有挂 image_generate'], root)
          return { ok: false, path: '', text: '', note: '现在没有可用的画笔。' }
        }

        let result
        try {
          result = await imageTool.execute({ prompt, provider: 'gpt' }, exec)
        } catch (err) {
          log?.('her_draw failed', err?.message ?? err)
          return { ok: false, path: '', text: '', note: `这次没画成：${String(err?.message ?? err).slice(0, 80)}` }
        }
        const rawPath = Array.isArray(result?.paths) ? result.paths[0] : ''
        const abs = path.resolve(String(rawPath ?? ''))
        const dir = path.resolve(drawImagesDir(root))
        if (!abs || !abs.startsWith(dir + path.sep)) {
          return { ok: false, path: '', text: '', note: '画出来的图不在我的画册里，先不送。' }
        }
        try {
          const st = await fs.promises.stat(abs)
          if (!st.isFile() || st.size < 12) throw new Error('空图')
          // 生成图只给 fish 用户读；桥和 DSH 都以 fish 运行。
          await fs.promises.chmod(abs, 0o600).catch(() => {})
        } catch {
          return { ok: false, path: '', text: '', note: '画出来的图找不到。' }
        }

        const { config } = await loadConfig(root).catch(() => ({ config: {} }))
        const model = deriveSelf(events, { growthDays: config?.growthDays })
        const stored = await appendEvent(
          { type: 'meta', text: `draw:${dk}:${abs}` },
          { day: model.day, stage: model.stage, source: 'system' },
          root,
        ).catch(() => null)
        if (!stored?.id) return { ok: false, path: '', text: '', note: '图画好了，但没记下这张的画册号。' }

        void pruneDrawImages(root).catch(() => {})
        logLine('info', ['her_draw：画好了', path.basename(abs), `${drawsToday(events, dk) + 1}/${DRAW_PER_DAY}`], root)
        return {
          ok: true,
          path: abs,
          text: [`画好了。`, '图已经放到他那边；你想说一句什么，就自己说，不用汇报画笔和参数。'].join('\n'),
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
