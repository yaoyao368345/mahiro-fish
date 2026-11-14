# 安全与隐私

## 公开仓库的边界

这个仓库公开：

- 代码、补丁、脚本、模板；
- 初始绪山真寻人格；
- 部署文档。

这个仓库不公开：

- DeepSeek / OpenRouter / ElevenLabs / Breeze 等 API Key；
- Telegram Bot Token、`OWNER_TELEGRAM_ID`；
- ChatGPT OAuth `auth.json`；
- B 站 Cookie、账号信息；
- `events.jsonl`、日记、梦、主动留话、成长记录；
- workspace / sessions / 媒体索引；
- 真实图片、视频、语音、试听素材；
- 真实 `.env`；
- 服务器 IP、SSH 私钥、个人配置。

## 白名单整理

不要对 `/var/lib/fish` 执行：

```bash
git add -A          # 禁止
git add /var/lib/fish  # 禁止
```

正确做法是只复制明确列出的文件到仓库：

```text
persona/mahiro-handover.md
telegram-bridge/*.mjs
dsh-fish/patches/*
dsh-fish/modules/*
config/*
scripts/*
docs/*
tests/*
README / LICENSE / .gitignore / .env.example
```

## 提交前扫描

```bash
bash scripts/scan-secrets.sh
git diff --cached
```

扫描覆盖：

- DeepSeek `sk-...`
- OpenRouter `sk-or-v1-...`
- Telegram Bot Token
- GitHub Token
- AWS Access Key
- 私钥头
- Slack Token
- Google API Key
- 真实 `OWNER_TELEGRAM_ID` / Bot Token / OpenRouter Key / 音色 ID
- 真实称呼、姓名、个人关系等标识（可用 `PERSONAL_PATTERNS` 临时扫描）

发现真实密钥时：

1. **不要提交、不要推送。**
2. 立即在对应平台吊销/轮换密钥。
3. 清理工作区与暂存区。
4. 如果已经推送，按下面的泄露流程处理。

## 权限

| 文件 | 权限 | 属主 |
| --- | --- | --- |
| `/etc/mahiro-fish/dsh.env` | 600 | root |
| `~/.telegram-bridge.env` | 600 | fish |
| `~/.breezeblue.env` | 600 | fish |
| `~/.dsh-fish/events.jsonl` | 600 | fish |
| `~/.dsh-fish/owner.json` | 600 | fish |
| `~/.dsh/plugins/subscriptions/auth.json` | 600 | fish |
| `~/.telegram-bridge/*.json` | 600 | fish |
| 代码 / 桥模块 | 644 | fish |

`scripts/verify.sh` 会检查关键文件是否为 600。

## systemd 加固

- `NoNewPrivileges=yes`
- `PrivateTmp=yes`
- `dsh-web`: `ProtectSystem=full`
- `dsh-telegram`: `ProtectSystem=strict`，只允许写 `~/.telegram-bridge`
  和 `~/.dsh-fish`（后者只用于状态卡头像）
- 不监听公网；DSH 只绑 `127.0.0.1`

## 网络暴露

只开放 SSH。不要开放：

- 3080（DSH Web）
- Telegram 桥（它不监听端口）
- 任何数据库/内部端口

需要远程访问 Web 时：

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

或放在 HTTPS 反代 + 强访问控制之后，并设置
`--trusted-host` / `--public-url`。

## 如果密钥泄露

1. 立即吊销：
   - DeepSeek：平台 → API Keys → 删除。
   - Telegram：@BotFather → `/revoke`。
   - OpenRouter / Breeze / OpenAI：对应控制台。
2. 生成新密钥，更新本地 600 文件。
3. 重启服务。
4. 检查日志是否有异常调用。
5. 如果已推送：
   - 不要使用 GitHub push protection 的“绕过”按钮；
   - 用 `git filter-repo` 清理历史；
   - 强制推送前先确认没有其他人的提交；
   - 通知可能受影响的人。

## GitHub push protection

如果 GitHub 阻止推送，说明检测到了密钥：

- **不要**点 bypass；
- 删除/脱敏该文件；
- 重写提交；
- 重新推送。

## 公开人格的边界

`persona/mahiro-handover.md` 是特意公开的初始模板。它不包含：

- 旧实例的称呼、私人关系、聊天；
- 日记、梦、成长事件；
- 真实生活经历。

公开它不等于公开旧实例的记忆。

## 依赖供应链

- Node、DSH、dsh-fish、subscriptions、pnpm 全部固定版本。
- ASR 压缩包固定 URL + SHA256。
- 不在仓库里放第三方完整目录。
- 安装时校验 Node 官方 SHA256、ASR SHA256、补丁 SHA256。
- 定期看上游安全公告；升级时重新生成补丁。

## 报告问题

如果你发现本仓库包含凭据或隐私，请不要在公开 issue 里贴出具体值。
先通过仓库维护者的私下渠道联系，或只描述“哪个文件、哪一类问题”。
