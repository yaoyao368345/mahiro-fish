# 生图：ChatGPT Plus 与 her_draw

生图是可选功能。没有 ChatGPT Plus 时不要开启；聊天与其它功能不受影响。

## 前置条件

1. 已安装 `dsh-plugin-subscriptions@0.9.13`（安装脚本已装）。
2. 有 ChatGPT Plus/Pro 订阅。
3. 在 DSH Web 完成 OAuth 登录。
4. 在订阅设置里启用图片生成。

## OAuth 登录

1. 打开 DSH Web（SSH 隧道后 `http://127.0.0.1:3080/`）。
2. 设置 → Subscriptions → ChatGPT (Codex) → 登录。
3. 浏览器打开官方 OAuth 页面，确认授权。
4. 令牌保存在 `~/.dsh/plugins/subscriptions/auth.json`（0600）。
5. 在“Provider tools”里打开图片生成。

**不要**把 `auth.json` 复制到仓库、issue、聊天记录或公开备份。

## 工具链

```text
她调用 her_draw(prompt)
      │
      ▼
dsh-fish draw.js
      │  每天最多 2 张；prompt 最多 800 字
      ▼
dsh-plugin-subscriptions 的 image_generate(provider=gpt)
      │
      ▼
ChatGPT 图片接口
      │
      ▼
保存到 ~/.dsh/plugins/subscriptions/images/
      │
      ▼
写 meta draw:<日期>:<绝对路径>
      │
      ▼
telegram-bridge/imageoutbox.mjs
      │  只接受受信任目录内的绝对路径
      ▼
Telegram sendPhoto
```

## 自选头像

`her_avatar(path?)` 可以把已经画过的图设成自己的头像；不给 `path` 就用最近画的那张。
`her_draw(prompt, asAvatar: true)` 则是在画的同时顺手换掉。

1. 插件写 `meta avatar:<日期>:<绝对路径>`；头像每天最多 1 次。
   只接受她自己画册（生成目录）里的文件。
2. 桥的 `avataroutbox.mjs` 只接受生成目录里的图片，用 ffmpeg 转成
   640×640 JPG。
3. 调 Telegram Bot API `setMyProfilePhoto`。静态头像只收 JPG，
   而且每次都必须重新上传，不能复用 `file_id`。
4. 成功后把同一张写成 `<数据目录>/avatar.jpg`，DSH Web 状态卡同步换。

上传失败按 5s/10s/20s… 退避，最多 5 次；`avatar:` 事件仍留在事件流里。
头像额度与画图额度分开：画可以照画，只是当天不能再改头像。

## 额度与清理

- 每天最多 2 张（按本地日期）。
- 图片保留 30 天 / 100MB，先删最旧。
- 清理只动生成目录里的图片，不删 `events.jsonl`。
- 图片被清理后，`draw:` 事件仍在；桥不会重发不存在的文件。

## 安全边界

`imageoutbox.mjs` 只接受 `~/.dsh/plugins/subscriptions/images/` 内的
规范化绝对路径：

- `../` 穿越拒绝；
- 目录外路径拒绝；
- 指向目录外的符号链接拒绝；
- 失败写入 `image-outbox.json` 的 `failed`，不无限重发。

这避免了“事件流被写进一个任意路径，桥就把任意文件发出去”的风险。

## 没有 Plus 时

- `her_draw` 会失败，并在日志里留下原因。
- 她应当承认“这次没画出来”，而不是编造一张图。
- 聊天、B 站、语音、记忆都不受影响。

## 公开仓库里没有什么

- 没有 `auth.json`；
- 没有生成的图片；
- 没有 `image-outbox.json`；
- 没有真实 prompt 历史或图片索引。

仓库只有 `draw.js`、`imageoutbox.mjs` 和配置模板。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| `her_draw` 不可用 | 订阅插件是否安装、是否启用图片工具 |
| 401/403 | OAuth 是否过期；重新登录 |
| 额度错误 | ChatGPT 账号额度；换账号或稍后再试 |
| 图生成了但没发 | `image-outbox.json` 是否 `outside-trusted-dir`；文件是否存在 |
| 重复发送 | 不应发生；以图片路径为幂等键 |
| 磁盘满 | 检查 `~/.dsh/plugins/subscriptions/images/` 和媒体目录 |

## 许可与内容

生成图片由第三方服务产生，受其条款约束。不要把生成图片当作官方素材，
也不要在公开仓库里附带角色插画或动画截图。角色原型权利归原作者与制作方。
