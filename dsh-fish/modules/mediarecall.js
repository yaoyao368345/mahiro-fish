/**
 * mediarecall.js —— 只读工具 her_media：翻她真正看过的视频画面（M2.6）
 *
 * 不自动读图、不把旧图塞进每一轮上下文；只返回索引里的文字与可读路径。
 * 真要看图时，她自己用 read_image；图过期就只保留“曾经看过”的文字。
 */

import { rootDir } from './store.js'
import { defineTool } from './tool.js'
import { slashed } from './posix.js'
import {
  ensureMediaIndex,
  maintainMediaIndex,
  searchMediaIndex,
  verifyRecord,
} from './mediaindex.js'

function fmtTimes(times) {
  const list = (Array.isArray(times) ? times : []).map((x) => Math.round(Number(x) * 10) / 10)
  return list.length ? list.map((x) => `${x} 秒`).join('、') : ''
}

export function registerMediaRecall(ctx, deps = {}) {
  const root = deps.root ?? rootDir()
  return ctx.tools.register(
    defineTool({
      name: 'her_media',
      description:
        '翻你自己真正看过的视频画面记录。只读，不会自动把图片加载进这一轮。' +
        '找到后如果拼图还在，它会把文件路径给你，你用 read_image 打开；' +
        '如果图已经不在了，它只告诉你曾经看过哪条、哪些时刻。' +
        '想重新取画面，仍然用 bili_watch，受原来的额度和设置约束。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '可选：标题、UP、BV 号、日期里记得的词。' },
          bvid: { type: 'string', description: '可选：只想找某一条 BV。' },
          limit: { type: 'number', description: '最多返回几条，1–10，默认 5。' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            found: { type: 'number' },
            text: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  bvid: { type: 'string' },
                  title: { type: 'string' },
                  date: { type: 'string' },
                  times: { type: 'array', items: { type: 'number' } },
                  status: { type: 'string' },
                  path: { type: 'string' },
                  sha256: { type: 'string' },
                  watchedEventId: { type: 'string' },
                },
                required: ['bvid', 'title', 'date', 'times', 'status', 'path', 'watchedEventId'],
              },
            },
          },
          required: ['ok', 'found', 'text', 'items'],
        },
        render: (_args, out) => [{ type: 'text', text: out.text }],
      },
      async execute(args = {}) {
        // 先按 30 天/100MB 维护，再补旧记录、检索；不会写事件流。
        await maintainMediaIndex(root).catch(() => null)
        const { index } = await ensureMediaIndex(root)
        const rows = searchMediaIndex(index, {
          query: args?.query,
          bvid: args?.bvid,
          limit: args?.limit,
        })
        const items = []
        const lines = []
        for (const r of rows) {
          const v = await verifyRecord(root, r)
          const path = v.status === 'cached' ? slashed(v.path) : ''
          items.push({
            bvid: r.bvid,
            title: r.title,
            date: r.date,
            times: r.times,
            status: v.status,
            path,
            sha256: r.sha256,
            watchedEventId: r.watchedEventId,
          })
          const title = r.title || r.bvid
          lines.push(`- ${r.date || '日期不明'}，《${title}》（${r.bvid}）${r.up ? ` · UP：${r.up}` : ''}`)
          const times = fmtTimes(r.times)
          if (times) lines.push(`  看过：${times}`)
          if (path) {
            lines.push(`  拼图还在：${path}`)
            lines.push('  用 read_image 打开它；不看也可以。')
          } else {
            lines.push('  原图已经不在缓存里了，只记得你看过这些画面。想重新取，用 bili_watch。')
          }
          lines.push(`  这条看过事实的账：${r.watchedEventId}`)
        }
        return {
          ok: true,
          found: items.length,
          text: items.length
            ? [`找到 ${items.length} 条你看过画面的记录：`, ...lines].join('\n')
            : '没有找到你看过画面的记录。只翻到标题、没真正看过画面的，不算。',
          items,
        }
      },
    }),
  )
}
