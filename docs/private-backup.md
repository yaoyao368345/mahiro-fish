# 私有记忆备份

公开仓库只保存代码和初始人格。真寻运行后的记忆、日记、梦、会话、媒体索引
和投递状态，保存在一个**独立的 GitHub Private 仓库**：

<https://github.com/yaoyao368345/mahiro-fish-private-backup>

不使用 age 或其他文件加密，也不配置 GitHub Actions、不定时任务。
备份与恢复都是手动命令。

> 私有仓库里包含真实聊天、称呼、日记、梦和部分生活状态。
> 它能被 GitHub 账号看到，**不要**改成 public，也不要把内容复制到公开 issue。

## 备份什么

| 内容 | 路径（原始绝对路径） |
| --- | --- |
| 事件流（唯一可信经历） | `~/.dsh-fish/events.jsonl` |
| 长期记忆/成长/配置 | `~/.dsh-fish/config.json`、`talk-recent.json`、`home.json`、`inbox.md` |
| 便条/预约/出门/请神/纪念品状态 | `notes.json`、`session-notes.json`、`outings.json`、`possessions.json`、`keepsakes.json`、`keepsakes/` |
| 日记与每日报告 | `~/.dsh-fish/diary/`、`~/.dsh-fish/out/` |
| 当前身份文档 | `~/.dsh-fish/home/她的身份.md` |
| B 站媒体记忆索引 | `~/.dsh-fish/media/index.json` |
| Telegram 投递去重 | `~/.telegram-bridge/state.json`、`outbox.json`、`image-outbox.json` |
| 语音偏好与额度 | `~/.telegram-bridge/voice-prefs.json`、`voice-usage.json` |
| 当前 DSH 会话 | `~/.dsh/sessions/--var-lib-fish-.dsh-fish-home--/**/session.v4.jsonl.zstd` |
| DSH 工作区状态 | `~/.dsh/storages/workspace.json` |
| 非敏感 DSH 配置 | `~/.dsh/cordis.patch.yml`、profile 的 `cordis*.yml`、`package.json`、`pnpm-lock.yaml` |
| systemd 单元 | `/etc/systemd/system/dsh-web.service`、`dsh-telegram.service` |

## 不备份什么

- Telegram Bot Token、`OWNER_TELEGRAM_ID`
- DeepSeek / OpenRouter / Breeze / ElevenLabs API Key
- ChatGPT OAuth `auth.json`
- B 站 Cookie 与 `owner.json`
- GitHub 登录凭据、SSH 私钥
- 真实 `.env` / `.telegram-bridge.env` / `.breezeblue.env`
- `node_modules`、ASR 模型、缓存
- 图片、音频、视频本体（媒体索引会保留）
- 日志、`instance.json`、运行中的锁文件

### 特殊的脱敏

`~/.telegram-bridge/state.json` 同时包含必要的 Telegram 去重状态和
DSH 浏览器 cookie。备份脚本只删除 `cookie` 字段，保留
`lastUpdateId`、`seenUpdates`、`seenMessages`。恢复后桥会从
`~/.dsh-web/web.log` 重新换取 cookie。

`owner.json` 同时包含 B 站 Cookie 和账号信息，无法只保留“必要记忆”
而不带凭据，因此整体排除。恢复后需要在设置页重新扫码登录 B 站。

## 一致性

- `events.jsonl` 由脚本按完整 JSON 行读取；如果最后一行正在写入、没有换行，
  会被安全丢弃。事件流是只追加的，丢弃未完成的尾行不会破坏已有历史。
- 其他 JSON 在快照后逐个解析；JSONL 每行解析；`.zstd` 会话做完整性测试。
- 任何解析失败都会中止，不会提交或推送。
- 这不是跨文件的数据库事务，但能保证事件流本身没有半行、状态文件没有半截。

## 备份命令

```bash
cd /opt/mahiro-fish
sudo bash scripts/backup-private.sh
```

首次运行会克隆私有仓库；之后每次生成新的 `manifests/<时间>.json` 和一次新提交。
输出会给出提交 SHA、文件数和总字节数。失败时脚本以非零退出，不会打印“成功”。

可选：

```bash
# 指定私有仓库本地目录
sudo bash scripts/backup-private.sh --repo-dir /root/mahiro-fish-private-backup
```

## 私有仓库结构

```text
mahiro-fish-private-backup/
├── README.md
├── .mahiro-fish-private-backup    # 仓库归属标记，防止推错项目
├── manifests/
│   └── 20261114-164959.json
└── state/
    └── var/lib/fish/...           # 原始绝对路径（去掉开头 /）
```

`manifest.json` 包含：

- `backup_id`、`created_at`、`tool_version`
- `summary.file_count`、`summary.total_bytes`
- `files[]`：`path`、`sha256`、`bytes`、`mode`
- `excluded[]`：排除项与原因
- `sanitized[]`：脱敏项
- `notes[]`：一致性/恢复限制

## 校验

```bash
cd /opt/mahiro-fish
sudo bash scripts/verify-private.sh
```

它会：

1. 通过 GitHub API 确认 `private=true`、`visibility=private`。
2. 确认 Git remote 指向私有仓库。
3. 解出最新提交，按 manifest 校验每个文件的 SHA256 与大小。
4. 校验所有 JSON/JSONL/zstd 可解析。
5. 校验 seed 是绪山真寻、事件流可解析。
6. 校验 `home.json` 的当前会话文件存在、`workspace.json` 引用的会话齐全。
7. 确认 `state.json` 不再包含 cookie。
8. 确认没有 `owner.json`、`auth.json`、`.env` 等禁止文件。
9. 确认公开仓库没有 `state/`、`manifests/` 或私人数据。

## 恢复

### 先隔离演练（推荐）

```bash
cd /opt/mahiro-fish
sudo bash scripts/restore-private.sh --target /tmp/mahiro-restore-test
```

它会把备份解到 `/tmp/mahiro-restore-test`，保持 `var/lib/fish/...` 结构，
校验 manifest、SHA256、seed、会话，不会碰线上。

也可以指定历史提交：

```bash
sudo bash scripts/restore-private.sh --commit <sha> --target /tmp/restore
```

### 覆盖线上

**必须**显式加两个参数：

```bash
sudo bash scripts/restore-private.sh --apply --yes
```

执行前脚本会：

1. 再次确认私有仓库和 SHA。
2. 把当前会被覆盖的文件备份到
   `~/.mahiro-fish-backups/pre-restore-<时间>/`。
3. 停止 `dsh-web` / `dsh-telegram`。
4. 按 manifest 还原文件，修正属主和权限。
5. 删除旧 `instance.json` 和 `session.lock`，避免旧 PID 误判。
6. 启动服务，并再次校验 seed。

恢复后需要重新填写/登录：

- `/etc/mahiro-fish/dsh.env` 的 DeepSeek Key
- `~/.telegram-bridge.env` 的 Bot Token 与主人 ID
- ChatGPT OAuth（订阅插件设置页）
- B 站 Cookie（dsh-fish 设置页扫码）

## 已验证的结果

2026-11-14 首次真实备份：

- 备份 ID：`20261114-164959`
- 提交：`297b6119220fa61f9d404c5472c82483bbc3fe01`
- 27 个文件，637,724 字节
- 重新 clone 后 manifest/SHA256 全部通过
- 事件流 101 行，seed 为绪山真寻
- 当前会话与 5 个 workspace 会话齐全
- 未发现 API Key、Bot Token、OAuth、B 站 Cookie
- 公开仓库没有私人备份内容

## 限制

- 媒体图片本体不备份；`media/index.json` 会保留，但恢复后图片可能显示为
  “原图已不在”，需要重新用 `bili_watch` 获取。
- DSH 会话是 zstd 压缩文件；跨 DSH 大版本恢复可能需要重新建立会话。
- 备份包含真实聊天与主人信息，仓库必须保持 private。
- 没有自动定时备份；需要手动运行。
- 没有 GitHub Actions；推送由本地脚本完成。
