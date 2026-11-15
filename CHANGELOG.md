# 变更记录

## 未发布 — 2026-11-15

- 人格系统改为三种初始化模式：`blank`、`original-fish`（推荐默认）、`mahiro`（旧模板）。
  - 新增 `persona/original-fish.md`：原创大肥鱼，没有原作背景和预设性格。
  - 保留 `persona/mahiro-handover.md` 与旧实例的恢复能力。
  - `scripts/import-persona.mjs` 支持 `--mode`，不再要求人格文件必须包含“绪山真寻”。
- 备份/恢复校验改用 `scripts/persona-seed.mjs` 识别实际 seed 和 `import-mark`；
  `verify-private.sh` / `restore-private.sh` 新增 `--expect-persona`，默认 `auto`。
- 私有备份补上 Telegram 的 `avatar-outbox.json` 与 `tts-pending.json`。
- README、部署文档、安全说明改为通用“大肥鱼养成系统”，旧真寻保留为可选模板。
- 新增 `tests/persona.test.mjs`，覆盖空白、原创、旧真寻和期望不匹配。

## 2026-11-14

- B 站看画面额度（`video.perDay`）只约束她自己：定时醒着刷站、自己挑的
  那几条计数。主人发来的视频不占额度，也不受上限阻挡。
  - `watched:` 事件里 `"self": true` 表示她自己发起；老记录没有这个字段，
    一律按主人点名的处理。
  - `watchedToday()` 只数带 `self` 标记的当天记录。
- 人格微调（`persona/mahiro-handover.md`）：补上“有点好色”这一面；说话方式允许
  自然地撒娇、卖萌和嘴硬着要关心，仍不写成刻板动漫角色。同步 README、
  persona 说明和静态测试。重新导入后旧状态归档。
- 评论关着时不再告诉她“在那条下面说”：`lib/selfdoc.js` 按 `speak` 开关
  选用对应文案；评论能力本身仍关闭。
- 设置页标签“上网时间段（未成年人模式）”改为“上网时间段”。
- TTS 指令去掉“不要过度卖萌”，保留自然、贴合语气的描述。
- `avoid.keywords` 移除“鬼畜”，`avoid.minDuration` 改为 0：
  短视频重新进入自主浏览的候选池。
- 默认提示词禁令（`lib/rules.js`）不改：导入人格时 `bansMuted` 为真，
  它们本来就不进 system prompt；原因记在 `docs/development.md`。
- 聊天自然度 M3.1：
  - system prompt 按真实段名和工具表摘掉无关的宿主 Agent / 开发环境说明
    （bash、workflow、subagent、present、Web GUI、checkout 等），
    不再只靠带下划线的工具名匹配；`harness:identity` 的 "AI agent" 也去掉。
  - 普通聊天新增 `fish:life` 段：只从真实的 `watched:` / `looked:` / 画图 /
    头像事件里取 1–3 行近期经历；`browsed:` 不算看过；没有就不出现。
  - 每轮“先把话回给他”改为“想怎么接就怎么接”，不再每轮催 `growth_commit`。
  - 人格里补一句许可：感兴趣可以多说，有想法可以带出来；不改成 KPI。
- 她可以自己换头像：`her_avatar` 挑一张画过的图（不给路径就用最近那张），
  或 `her_draw(..., asAvatar: true)` 画的同时换。插件写 `avatar:` 事件，
  桥转 640×640 JPG 后调 `setMyProfilePhoto`，并把同一张写成网页状态卡头像。
  头像每天最多 2 次，失败退避重试。
- 头像额度从每天 1 次调到 2 次；`dsh-telegram` 增加
  `ReadWritePaths=~/.dsh-fish`，网页状态卡头像可以真正写入。

## 0.1.0 — 2026-11-14

首次公开整理。

- 发布初始绪山真寻人格（`persona/mahiro-handover.md`），与首次导入的
  `seed` 逐字一致。
- 整理 Telegram 私聊桥：文字、主动留话 outbox、图片 outbox、语音策略。
- 整理 dsh-fish 0.9.9 补丁（M2.4–M2.12.4）：
  - B 站真实经历进入主动材料
  - 媒体索引 `her_media`、30 天/100MB 维护、抽帧缓存
  - `bili_sub` 字幕
  - `her_draw` 生图
  - `her_voice` 自主语音
- 固定依赖版本：Node 24.22.3、DSH 0.2.1-rc.3、dsh-fish 0.9.9、
  dsh-plugin-subscriptions 0.9.13、pnpm 11.28.5。
- 新增可重复执行的安装、补丁、验证、更新、恢复脚本。
- 新增无凭据的基础测试与凭据扫描。
- 明确公开仓库不包含运行数据；真实数据使用独立私有备份。
- 新增手动私有记忆备份：
  - `scripts/backup-private.sh`：白名单快照 + manifest + SHA256 + 私有仓库推送。
  - `scripts/restore-private.sh`：隔离恢复与显式确认的线上恢复。
  - `scripts/verify-private.sh`：私有属性、SHA256、seed、会话和凭据检查。
  - `state.json` 的 DSH cookie 脱敏；B 站 Cookie、OAuth、API Key 不进入备份。
