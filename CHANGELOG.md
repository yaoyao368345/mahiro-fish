# 变更记录

## 未发布 — 2026-11-14

- B 站看画面额度（`video.perDay`）只约束她自己：定时醒着刷站、自己挑的
  那几条计数。主人发来的视频不占额度，也不受上限阻挡。
  - `watched:` 事件里 `"self": true` 表示她自己发起；老记录没有这个字段，
    一律按主人点名的处理。
  - `watchedToday()` 只数带 `self` 标记的当天记录。

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
