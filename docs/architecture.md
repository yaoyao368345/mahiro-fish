# 架构

## 组件

```text
┌────────────────────┐        getUpdates / sendMessage        ┌──────────────┐
│ Telegram 私聊       │ ◄────────────────────────────────────► │ bridge.mjs   │
└────────────────────┘                                        └──────┬───────┘
                                                                     │ POST /dsh-fish/say
                                                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ DSH Web (127.0.0.1:3080, dsh-web.service)                                │
│                                                                          │
│  @ssamurias/dsh-fish 0.9.9 + patches                                    │
│   ├─ seed / events.jsonl（唯一可信经历）                                 │
│   ├─ persona / memory / diary / dream / interest / proactive            │
│   ├─ bili_look / bili_watch / bili_sub / her_media                      │
│   ├─ her_draw ──► dsh-plugin-subscriptions ──► ChatGPT 图片              │
│   ├─ her_voice ──► /say 返回 voiceRequested                              │
│   └─ her_leave ──► events 里的 letter meta                               │
│                                                                          │
│  DeepSeek provider（DEEPSEEK_API_KEY）                                   │
└──────────────────────────────────────────────────────────────────────────┘
                                                                     │
                     bridge 扫描事件流：letter / draw / voice          │
                                                                     ▼
                                              Telegram 文字 / sendPhoto / sendVoice
```

## 一次普通对话

1. 主人在 Telegram 私聊里发文字。
2. `bridge.mjs` 长轮询拿到 update，校验 `chat.id === OWNER_TELEGRAM_ID`。
3. 桥从 `~/.dsh-web/web.log` 取本地 token，换取 DSH 的浏览器 cookie。
4. 桥调用 `POST /dsh-fish/say`，带上 `channel=telegram:<chatId>`、
   `scene=private`、`room=house`。
5. dsh-fish 负责场次、轮数、记忆、守卫和人格提示，调用 DeepSeek。
6. `/say` 返回 `herReply`、`sessionId`、`note`、`voiceRequested`。
7. 桥发送文字；如果这一轮明确要求语音，或她调用了 `her_voice` 且通过策略，
   桥合成 OGG/Opus 并 `sendVoice`。
8. 如果 `/say` 超时但会话还在生成，桥直接读会话事件日志，等 `turn/end`
   后取正文（兜底路径，不另建人格）。

## 主动留话

1. dsh-fish 的 proactive 回合里，她调用 `her_leave`。
2. 插件写一条 `utterance` 和一条 `meta letter:<日期>:<utterance-id>`。
3. 桥的 `outbox.mjs` 扫描事件流，以 utterance id 为幂等键入队。
4. 发送成功写入 `sent`；失败按 5s/10s/20s… 退避，最多 6 次；
   超过 24 小时或队列上限则转入 `failed`，保留正文，不静默丢。

## 主动画图

1. 她调用 `her_draw`（每天最多 2 张）。
2. 插件复用 subscriptions 的 `image_generate`（provider=gpt）。
3. 生成图保存在 `~/.dsh/plugins/subscriptions/images/`。
4. 插件写 `meta draw:<日期>:<绝对路径>`。
5. 桥的 `imageoutbox.mjs` 只接受该受信任目录内的绝对路径，
   通过 `sendPhoto` 发给主人；目录外路径直接拒绝。
6. 图片 30 天 / 100MB 清理；事件流不修改。

## 数据文件

| 路径 | 作用 | 是否公开 |
| --- | --- | --- |
| `~/.dsh-fish/events.jsonl` | 唯一可信经历，只追加 | 否 |
| `~/.dsh-fish/config.json` | 行为开关 | 模板公开 |
| `~/.dsh-fish/owner.json` | 主人信息、B 站 Cookie | 否 |
| `~/.dsh-fish/diary/` | 日记 | 否 |
| `~/.dsh-fish/media/index.json` | 媒体索引 | 否 |
| `~/.dsh-fish/home/` | 身份文件、会话工作区 | 否 |
| `~/.telegram-bridge/` | 去重、outbox、语音计数 | 否 |
| `~/.telegram-bridge.env` | Bot Token / 主人 ID / TTS Key | 否 |
| `~/.dsh/plugins/subscriptions/auth.json` | ChatGPT OAuth | 否 |
| `~/.dsh/.credentials.yaml` | DSH 凭据引用 | 否 |

## 服务

| 服务 | 监听 | 职责 |
| --- | --- | --- |
| `dsh-web.service` | `127.0.0.1:3080` | DSH + dsh-fish + DeepSeek |
| `dsh-telegram.service` | 无（出站长轮询） | Telegram 桥 |

两个服务都以 `fish` 用户运行。`dsh-web` 使用 `ProtectSystem=full`，
`dsh-telegram` 使用 `ProtectSystem=strict` 且只允许写
`~/.telegram-bridge`。

## 失败时的降级

- Telegram 不可用：DSH 里的对话与养成仍然工作。
- 没有 B 站登录：公开浏览可用；个性化功能失败时降级为只看文字。
- 没有 ChatGPT Plus：`her_draw` 失败并回退，不影响聊天。
- ASR 未安装：收到语音回一句“没听清”，文字聊天不受影响。
- TTS 失败/额度满/夜间/太长：回退文字，不重复合成。
- 媒体图过期：索引保留文字事实，`path` 清空，不再返回可读路径。

## 补丁清单

`dsh-fish/patches/dsh-fish-0.9.9-m2.4-m2.12.patch` 修改：

| 文件 | 作用 |
| --- | --- |
| `proactive.js` | 真实 B 站 watched/looked 进入主动材料；dream 白名单；her_leave 说明 |
| `drive.js` | 主动“劲儿”接入真实经历 |
| `scheduler.js` | 节奏与主动回合 |
| `persona.js` | `her_media` / `bili_sub` / `her_draw` / `her_voice` 的能力说明 |
| `bili.js` | 字幕轨道、相对 URL、AI/人工来源、CID/分P |
| `watch.js` | 成功抽帧写索引；同 bvid+at 命中缓存 |
| `media.js` | 30 天 / 100MB 清理，保护索引 |
| `index.js` / `restrict.js` / `selfdoc.js` / `settings.js` / `recall.js` | 注册与工具面 |
| `draw.js`（新） | `her_draw`，每天 2 张，写 `draw:` |
| `mediaindex.js`（新） | 媒体索引、维护、缓存 |
| `mediarecall.js`（新） | 只读工具 `her_media` |
| `sub.js`（新） | `bili_sub`，按句给、可翻页 |
| `voice.js`（新） | `her_voice`，只写内存请求 |
| `say.js` / `observe.js` | `voice:true`、`voiceRequested`、当轮提示 |

补丁后的完整校验和见 `dsh-fish/patches/CHECKSUMS.sha256`。
