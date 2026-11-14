# 变更记录

## 1.0.0 — 2026-11-14

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
