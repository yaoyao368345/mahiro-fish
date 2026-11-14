# Telegram 私聊桥

## 设计边界

桥只做三件事：

1. 把主人的文字/语音私聊递进 dsh-fish 的会话。
2. 把她这一轮的回复发回 Telegram（文字 / 语音）。
3. 把她用 `her_leave` 留下的信、`her_draw` 画的图送到主人私聊。

它**不**建第二个 DSH 会话、不建第二个人格、不直接改 DSH 会话存储。
投递统一走 dsh-fish 自己的 `POST /dsh-fish/say`。

## 创建 Bot

1. 在 Telegram 搜索 [@BotFather](https://t.me/BotFather)。
2. 发送 `/newbot`，按提示设置名字和用户名。
3. 复制形如 `123456789:AA...` 的 Token。
4. 给 [@userinfobot](https://t.me/userinfobot) 发任意消息，复制你的数字 ID。
5. 给新 Bot 发一条 `/start`，否则 Bot 不能主动给你发消息。

## 配置

`/home/fish/.telegram-bridge.env`，权限 600：

```dotenv
TELEGRAM_BOT_TOKEN=123456789:AA...
OWNER_TELEGRAM_ID=100000000
```

可选：

```dotenv
TELEGRAM_API_BASE=https://api.telegram.org
DSH_BASE_URL=http://127.0.0.1:3080
DSH_LOG=/home/fish/.dsh-web/web.log
DSH_SESSIONS=/home/fish/.dsh/sessions
POLL_TIMEOUT=30
SAY_TIMEOUT_MS=240000
```

桥每 15 秒重读这个文件；Token 变化会自动重连。

## 鉴权

- 只有 `chat.id === OWNER_TELEGRAM_ID` 的私聊会被处理。
- 群聊、频道、其他人的私聊都会被忽略。
- 没有配置主人时，桥会把第一条私聊的 chat_id 回给对方，方便配置。
- 桥不提供任何“远程命令执行”入口。

## 常用命令

| 消息 | 回复 |
| --- | --- |
| `/start` `/help` | 这里是大肥鱼。直接说话就行。 |
| `/id` | 当前 chat_id |
| `/ping` | pong |
| 其他 `/` 开头 | 忽略 |

管理语音偏好（自然语言）：

- “以后可以多用语音” / “恢复你自己决定就好” → `auto`
- “先不要主动发语音了” / “最近少发点语音吧” → `request_only`
- “关闭语音” → `off`
- “这条用文字回答” → 只影响这一轮

## 主动留话 outbox

`outbox.mjs` 扫描 `~/.dsh-fish/events.jsonl`：

- 只认 `meta letter:<日期>:<utterance-id>`。
- 以 utterance id 为幂等键，重启后不会重复发。
- 失败退避：5s、10s、20s、40s、80s、160s，最多 6 次。
- 超过 24 小时、超过 20 条待发、或失败到上限：转入 `failed`，保留正文。
- 状态在 `~/.telegram-bridge/outbox.json`（0600）。

它不生成文字、不判断该不该说；是否留话由 dsh-fish 的 proactive 决定。

## 图片 outbox

`imageoutbox.mjs` 扫描 `meta draw:<日期>:<绝对路径>`：

- 只接受 `~/.dsh/plugins/subscriptions/images/` 内的绝对路径。
- 路径穿越、目录外文件、符号链接逃逸都会被拒绝。
- 失败退避最多 5 次；状态在 `image-outbox.json`（0600）。
- 真正发送用 Telegram `sendPhoto`。

## 语音

入站：

1. Telegram `voice` → `getFile` → 临时 OGG。
2. ffmpeg 转 16k mono WAV。
3. 本地 sherpa-onnx + SenseVoice 识别。
4. 转写文本前加“（语音转写，可能有误）”，再走 `/say`。
5. 默认只回文字；明确要求语音时才合成。

出站：

- 明确要求语音（“用语音说…”）→ 这一轮合成。
- 她调用 `her_voice` 且策略允许 → 这一轮合成。
- 合成失败/额度满/夜间/太长 → 回退文字。

详见 [voice.md](voice.md)。

## 故障排查

```bash
systemctl status dsh-telegram
journalctl -u dsh-telegram -n 100 --no-pager
tail -100 /home/fish/.telegram-bridge/bridge.log
```

| 现象 | 检查 |
| --- | --- |
| 完全没反应 | Token、`OWNER_TELEGRAM_ID`、是否给 Bot 发过 `/start` |
| 回“这条没送到她那” | DSH Web 是否在跑、`DSH_BASE_URL` 是否正确 |
| 回复很慢或空 | `SAY_TIMEOUT_MS`、`web.log`、她是否在弹卡等人回答 |
| 语音没转写 | ffmpeg、ASR 路径、`ASR_*` 注释 |
| 语音没发出 | `TTS_PROVIDER`、API Key、免费额度、`bridge.log` |
| 主动留话没到 | `outbox.json` 是否 `failed`、事件流里是否有 `letter:` |

## 手动测试

```bash
# 发一条文字
sudo -u fish env HOME=/home/fish \
  /opt/nodejs/v24.22.3/bin/node /home/fish/telegram-bridge/bridge.mjs \
  --test-send '这是一条测试'

# 测试 TTS
sudo -u fish env HOME=/home/fish \
  /opt/nodejs/v24.22.3/bin/node /home/fish/telegram-bridge/bridge.mjs \
  --test-tts '这是一条技术测试语音。'

# 测试 sendPhoto
sudo -u fish env HOME=/home/fish \
  /opt/nodejs/v24.22.3/bin/node /home/fish/telegram-bridge/bridge.mjs \
  --test-photo /home/fish/.dsh/plugins/subscriptions/images/xxx.png
```

## 安全

- Token 只放在 0600 的本地文件里，不提交 Git。
- 桥不监听端口，只做出站长轮询。
- systemd 使用 `NoNewPrivileges`、`PrivateTmp`、`ProtectSystem=strict`。
- 日志不打印 Token；换取 DSH cookie 时只记录长度。
