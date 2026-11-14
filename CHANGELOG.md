# 变更记录

## 未发布 — 2026-11-14

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
- 她可以自己换头像：`her_avatar` 挑一张画过的图（不给路径就用最近那张），
  或 `her_draw(..., asAvatar: true)` 画的同时换。插件写 `avatar:` 事件，
  桥转 640×640 JPG 后调 `setMyProfilePhoto`，并把同一张写成网页状态卡头像。
  头像每天最多 1 次，失败退避重试。

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
