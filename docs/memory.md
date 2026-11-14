# 记忆与长期媒体

## 一句话

`~/.dsh-fish/events.jsonl` 是唯一可信经历，只能追加，不能删除。
公开仓库**不包含**它。

## 事件流

dsh-fish 把每一次真实发生的事写进 `events.jsonl`：

- `seed`：她是谁（导入的初始人格）
- `utterance`：她说过的话
- `heard` / `looked` / `watched`：她听见/看到的东西
- `revise`：她改口
- `narration`：她自己的回想
- `dream`：梦
- `refusal`：拒绝
- `meta`：系统记账（导入标记、letter、draw、工具回执等）

派生状态（天数、阶段、立场、疤、日记索引）都从事件流读出来，不另存一份
“可编辑的真相”。这保证了：

- 重启不会丢记忆；
- 备份/恢复不会把别人的经历混进来；
- 她不能悄悄改掉过去，只能追加 `revise`。

## 文件地图

| 文件 | 内容 |
| --- | --- |
| `events.jsonl` | 唯一可信经历 |
| `config.json` | 行为开关（时间窗、配额、工具白名单） |
| `owner.json` | 主人信息、B 站 Cookie（0600） |
| `diary/YYYY-MM-DD.md` | 日记，一天一个文件 |
| `out/YYYY-MM-DD.md` | 每日报告 |
| `media/index.json` | 看过的画面索引 |
| `media/sheet-*.png` | 拼图，30 天 / 100MB |
| `home/她的身份.md` | 插件每轮重写的身份文档 |
| `talk-recent.json` | 最近几轮摘要 |
| `inbox.md` | 她留给你的话的纯文本副本 |
| `logs/dsh-fish.log` | 插件日志，2MB 轮转 |
| `instance.json` | 当前实例心跳 |

## 媒体索引

`mediaindex.js` 只做三件事：

1. 把成功的 `bili_watch` 落成文字索引。
2. 给 `her_media` 提供只读检索。
3. 和 `media.js` 的清理联动：图没了就只留文字。

记录包含 `watchedEventId`、`bvid`、标题、UP、日期、时间点、相对路径、
SHA256、字节数、状态。

### 为什么图片会过期

2C4G 的磁盘有限。默认策略：

- 保留 30 天；
- 总量不超过 100MB；
- 先删最旧的图；
- `index.json` 不删。

图过期后：

- `status = expired`
- `path = ''`
- 仍然知道“她在某天看过某条视频的哪几秒”
- `her_media` 不再返回可读路径
- 想重新看，仍然用 `bili_watch`，受原额度限制

### 缓存命中

`findCachedWatch` 只命中：

- 同 `bvid`
- 同时间点集合（四舍五入到 0.1 秒）
- 图还在
- SHA256 与索引一致

不满足就重新抽帧，不会拿错图。

## 日记、梦、主动留话

- 日记：`growth_commit type=diary`，一天可多篇；是否给主人看由设置页开关。
- 梦：`her_dream`，只能用 `refs` 指回真实发生的事，一天最多一条，不算成长。
- 主动留话：`her_leave` → `meta letter:*` → Telegram outbox。
- 主动材料：最近的话、听见的东西、真实的 B 站经历；`browsed:` 不算。

这些都属于运行数据，不进入公开仓库。

## 备份

### 私有备份（GitHub Private 仓库）

运行状态备份到独立的私有仓库，不使用文件加密：

```bash
cd /opt/mahiro-fish
sudo bash scripts/backup-private.sh
sudo bash scripts/verify-private.sh
```

备份包含事件流、日记/梦、DSH 会话、媒体索引、Telegram 去重状态和
非敏感配置；不包含 Bot Token、API Key、ChatGPT OAuth、B 站 Cookie、
真实 `.env` 或图片/音频/视频本体。

详细说明见 [private-backup.md](private-backup.md)。

### 恢复

先隔离演练：

```bash
sudo bash scripts/restore-private.sh --target /tmp/mahiro-restore
```

确认后覆盖线上（会先备份当前状态）：

```bash
sudo bash scripts/restore-private.sh --apply --yes
```

恢复后先看：

```bash
sudo bash scripts/verify.sh
```

### 公开仓库能做什么

- 重新装出同样的代码环境；
- 从初始人格开始新的一局；
- 恢复配置结构。

### 公开仓库不能做什么

- 恢复旧实例的聊天、称呼、关系；
- 恢复日记、梦、主动留话；
- 恢复 B 站 Cookie、Telegram 会话、ChatGPT OAuth；
- 恢复真实图片、语音、视频。

这是有意的边界：公开仓库是“起点”，不是“某一个人的记忆”。

## 不要做的事

- 不要手动编辑 `events.jsonl`。
- 不要删除 `events.jsonl` 来“重置”；用插件自带的重置（会封存旧档）。
- 不要把 `.dsh-fish` 直接 `git add`。
- 不要把 `owner.json`、`auth.json`、`.telegram-bridge.env` 贴到 issue 里。
- 不要在公开仓库里放真实日记或梦的截图。
