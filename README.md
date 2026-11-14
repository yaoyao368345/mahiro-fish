# mahiro-fish · 真寻养成计划

仓库：<https://github.com/yaoyao368345/mahiro-fish>

把一只在 Debian 服务器上养大的「绪山真寻」整理成可以复现的开源部署：
DSH + dsh-fish + DeepSeek 日常对话，Telegram 私聊，自主唤醒与主动留话，
B 站浏览/抽帧/字幕，长期媒体记忆，ChatGPT 生图，以及语音收发。

> **非官方粉丝项目。** 角色原型来自《别当欧尼酱了！》（お兄ちゃんはおしまい！）。
> 本项目是非官方的粉丝衍生实现，不代表原作官方授权，也不包含任何动画截图、
> 配音素材、角色插画或原作长篇台词。初始人格文本见 [persona/](persona/)。

---

## 这是什么

这不是“上传几个脚本”，而是一套可重复部署的养成环境：

| 能力 | 实现 |
| --- | --- |
| 角色人格 | dsh-fish 的 `seed` 事件，初始为绪山真寻 |
| 日常对话 | DeepSeek（DSH provider） |
| Telegram 私聊 | `telegram-bridge/`，长轮询 + `/dsh-fish/say` |
| 主动留话 | dsh-fish `her_leave` → 桥的 outbox → Telegram |
| 自主生活 | 唤醒、兴趣、日记、梦、主动材料（补丁增强） |
| B 站 | 浏览、搜索、相关推荐、视频抽帧、视觉理解、字幕 |
| 长期媒体记忆 | `media/index.json` + 只读工具 `her_media` |
| 生图 | `her_draw` → ChatGPT Plus OAuth → Telegram `sendPhoto` |
| 语音识别 | 本地 sherpa-onnx + SenseVoice Small INT8 |
| 语音合成 | OpenRouter 免费 TTS / 本地 Kokoro / Breeze（自带音色）→ `sendVoice` |

可选功能全部是“按需开启”：没有 ChatGPT Plus、没有 B 站账号、没有 TTS Key，
核心的文字养成和 Telegram 私聊仍然可以运行。

---

## 架构

```text
Telegram 私聊
   │  getUpdates（长轮询）
   ▼
telegram-bridge/bridge.mjs
   │  POST http://127.0.0.1:3080/dsh-fish/say
   ▼
DSH Web (127.0.0.1:3080)
   └─ dsh-fish 插件
        ├─ 人格 seed / 事件流 ~/.dsh-fish/events.jsonl
        ├─ 记忆、日记、梦、兴趣、主动唤醒
        ├─ bili_look / bili_watch / bili_sub
        ├─ her_media（媒体索引，只读）
        ├─ her_draw → dsh-plugin-subscriptions → ChatGPT 图片
        ├─ her_voice（这一轮用声音）
        └─ her_leave → 事件流里的 letter
   ▲
   │  桥再扫描事件流：
   │    letter:*  → Telegram 文字
   │    draw:*    → Telegram sendPhoto
   │    voiceRequested → TTS → Telegram sendVoice
   ▼
主人
```

详细说明见 [docs/architecture.md](docs/architecture.md)。

---

## 环境要求

- Debian 12/13（x86_64）；Ubuntu 也可，但只在 Debian 13 上验证过
- 2 核 4 GB 起；建议 20 GB 磁盘
- Node.js **24.22.3**（固定）
- DSH **0.2.1-rc.3**（固定）
- pnpm **11.28.5**（固定）
- dsh-fish **0.9.9**（固定）
- dsh-plugin-subscriptions **0.9.13**（固定，生图/订阅用）
- ffmpeg（视频抽帧、语音转码）
- 一个 DeepSeek API Key（必需）
- 一个 Telegram Bot（强烈建议）

---

## 快速开始（脚本）

```bash
# 1. 把仓库放到服务器（不要放在 /root 下，避免权限问题）
sudo git clone https://github.com/yaoyao368345/mahiro-fish.git /opt/mahiro-fish
cd /opt/mahiro-fish

# 2. 一键安装（会创建 fish 用户、装 Node/DSH、固定插件版本、打补丁、导入人格）
sudo bash scripts/install.sh

# 3. 填密钥
sudo nano /etc/mahiro-fish/dsh.env
sudo -u fish nano /home/fish/.telegram-bridge.env

# 4. 自检并重启
sudo bash scripts/verify.sh
sudo systemctl restart dsh-web dsh-telegram
```

只想先跑文字部分，可以暂时不填 Telegram；`dsh-web` 仍会启动，
Telegram 服务会在配置好 Token 后再启动。

### 安装脚本做了什么

1. 安装系统依赖与固定版本 Node.js（校验官方 SHA256）。
2. 创建 `fish` 用户与 `/home/fish`。
3. 安装固定版本 DSH、pnpm。
4. 创建 `web` profile，安装 `@ssamurias/dsh-fish@0.9.9` 和
   `dsh-plugin-subscriptions@0.9.13`。
5. 写入 DeepSeek provider 配置与默认模型。
6. 对 dsh-fish 0.9.9 应用本项目补丁，并用 SHA256 校验全部改动。
7. 安装 Telegram 桥到 `/home/fish/telegram-bridge`。
8. 生成 `/etc/mahiro-fish/dsh.env` 与 `/home/fish/.telegram-bridge.env`（权限 600）。
9. 创建默认 `~/.dsh-fish/config.json`。
10. 在空状态库上导入初始绪山真寻人格。
11. 安装并启用 `dsh-web.service`、`dsh-telegram.service`。
12. 可选安装本地 ASR。

所有被覆盖的文件都会先备份到 `/home/fish/.mahiro-fish-backups/<时间>/`。

---

## 配置

### 1. DeepSeek（必需）

编辑 `/etc/mahiro-fish/dsh.env`：

```dotenv
DEEPSEEK_API_KEY=sk-你的真实Key
```

DSH 的 profile 补丁已经把它接成默认 provider：

```yaml
- id: llm-pi-ai
  config:
    providers:
      deepseek:
        apiKeyEnv: DEEPSEEK_API_KEY
- id: agent-default-model
  config:
    provider: deepseek
    model: deepseek-flash
```

### 2. Telegram 私聊（建议）

1. 向 [@BotFather](https://t.me/BotFather) 发送 `/newbot`，得到 Bot Token。
2. 给 [@userinfobot](https://t.me/userinfobot) 发消息，得到你的数字 ID。
3. 编辑 `/home/fish/.telegram-bridge.env`：

```dotenv
TELEGRAM_BOT_TOKEN=123456789:AA...
OWNER_TELEGRAM_ID=你的数字ID
```

只有这个 ID 的私聊会被处理；其他人发消息会被忽略。
桥每 15 秒重读配置，改完不必重启。

### 3. B 站（可选）

文字浏览、搜索、公开视频抽帧不需要登录。需要个性化首页、关注、评论时，
在 DSH Web → 设置 → 大肥鱼 → B 站登录里扫码。Cookie 保存在
`~/.dsh-fish/owner.json`（权限 600），不会进入 Git。

### 4. ChatGPT 生图（可选）

1. 确认已安装 `dsh-plugin-subscriptions@0.9.13`（安装脚本已装）。
2. 打开 DSH Web → 设置 → Subscriptions → ChatGPT (Codex) → 登录。
3. OAuth 在 GitHub/ChatGPT 官方页面完成，令牌保存在
   `~/.dsh/plugins/subscriptions/auth.json`（0600）。
4. 在订阅设置里启用图片生成。之后真寻才可以使用 `her_draw`。

没有 ChatGPT Plus 时不要开启；`her_draw` 会失败并回退，不会影响聊天。

### 5. 语音识别 ASR（可选）

```bash
sudo bash scripts/install.sh --with-asr
# 或者单独：
sudo bash scripts/install-extras.sh --with-asr
```

固定版本：

- sherpa-onnx `v1.13.8` linux-x64 shared-no-tts
- SenseVoice `zh-en-ja-ko-yue-int8-2024-07-17`

两个压缩包都校验 SHA256，解压到 `/home/fish/.local/sherpa-onnx`。
然后在 `.telegram-bridge.env` 里取消 `ASR_*` 注释。

### 6. 语音合成 TTS（可选）

默认 `TTS_PROVIDER=off`，只回文字。

- **OpenRouter 免费 TTS**：填 `OPENROUTER_API_KEY`，设
  `TTS_PROVIDER=openrouter`。
- **本地 Kokoro**：需要额外下载约 290 MB，2C4G 上较慢，默认不推荐。
- **Breeze Blue**：使用你自己的账号和音色 ID；私人克隆音色属于凭据，
  只放在 `~/.breezeblue.env`（0600），不要提交。

详见 [docs/voice.md](docs/voice.md)。

---

## 访问 DSH Web

服务只监听 `127.0.0.1:3080`。通过 SSH 隧道访问：

```bash
ssh -L 3080:127.0.0.1:3080 user@your-server
```

然后打开 `http://127.0.0.1:3080/`。首次启动会在
`/home/fish/.dsh-web/web.log` 打印带 token 的登录链接。

不要直接把 3080 暴露到公网；如果必须，请放在 HTTPS 反代和访问控制之后。

---

## 人格：从初始真寻开始

仓库里的 [persona/mahiro-handover.md](persona/mahiro-handover.md) 是 2026-11-14
首次导入时使用的**原始交接单**，与事件流里的 `seed` 逐字一致。

它保留了：

- 绪山真寻的名字、原作背景、与绪山美波里的关系
- 游戏、动画、漫画、二次元等基础兴趣
- 懒散、慢热、怕羞、嘴硬但温柔的性格
- 自然中文口语，不机械复读口癖和颜文字
- “原作背景 ≠ 当前生活经历”的边界
- 允许通过真实经历改变观点、形成新兴趣的成长方向

### 原生导入

**设置页（推荐）**：DSH Web → 设置 → 大肥鱼 → 接一只别人养过的大肥鱼，
粘贴 `persona/mahiro-handover.md` 全文。

**命令行（全新实例）**：

```bash
sudo systemctl stop dsh-web
sudo node scripts/import-persona.mjs \
  --pkg /home/fish/.dsh/profiles/web/node_modules/@ssamurias/dsh-fish \
  --root /home/fish/.dsh-fish \
  --persona persona/mahiro-handover.md
sudo chown -R fish:fish /home/fish/.dsh-fish
sudo systemctl start dsh-web
```

已经有 `seed` 的实例会被拒绝导入；要重开一局必须显式 `--reset`
（旧状态整体改名封存，不删除）。详见 [persona/README.md](persona/README.md)。

---

## 目录结构

```text
mahiro-fish/
├── README.md
├── README_EN.md
├── LICENSE
├── .gitignore
├── .env.example
├── persona/
│   ├── mahiro-handover.md      # 原始初始人格
│   └── README.md
├── telegram-bridge/
│   ├── bridge.mjs              # Telegram ↔ DSH / 语音 / 图片
│   ├── outbox.mjs              # her_leave 主动留话队列
│   ├── imageoutbox.mjs         # her_draw 图片队列
│   └── voicepolicy.mjs         # 自主语音策略
├── dsh-fish/
│   ├── patches/                # 0.9.9 补丁、校验和、回滚
│   └── modules/                # 新增模块源码（参考）
├── config/
│   ├── fish.example.json
│   ├── cordis.patch.yml
│   ├── dsh.env.example
│   ├── telegram-bridge.env.example
│   ├── asr-versions.env
│   └── systemd/
├── scripts/
│   ├── install.sh
│   ├── install-extras.sh
│   ├── apply-patches.sh
│   ├── import-persona.mjs
│   ├── verify.sh
│   ├── update.sh
│   ├── restore.sh
│   ├── backup-private.sh
│   ├── restore-private.sh
│   ├── verify-private.sh
│   ├── lib-private.sh
│   └── scan-secrets.sh
├── docs/
└── tests/
```

---

## 数据、备份与恢复

### 公开仓库能恢复什么

- 代码、补丁、部署脚本、systemd 模板
- 初始人格 `persona/mahiro-handover.md`
- 配置结构与示例

### 公开仓库不能恢复什么

- 旧实例的私人聊天与称呼
- 日记、梦、主动留话、成长事件
- B 站 Cookie、Telegram 会话、媒体文件
- 任何真实密钥

`events.jsonl` 是她的唯一可信经历，**不属于这个公开仓库**。

### 私有记忆备份（推荐）

运行状态备份到独立的 GitHub Private 仓库：

<https://github.com/yaoyao368345/mahiro-fish-private-backup>

```bash
cd /opt/mahiro-fish
sudo bash scripts/backup-private.sh       # 手动备份，每次一个新 commit
sudo bash scripts/verify-private.sh       # 校验私有属性、manifest、SHA256、seed
sudo bash scripts/restore-private.sh --target /tmp/restore   # 隔离演练
```

真正覆盖线上必须显式确认：

```bash
sudo bash scripts/restore-private.sh --apply --yes
```

脚本会先备份当前状态到 `~/.mahiro-fish-backups/pre-restore-<时间>/`，
再停止服务、恢复文件、重启并校验 seed。

备份包含事件流、日记/梦、会话、媒体索引、Telegram 去重状态和非敏感配置；
不包含 Bot Token、API Key、ChatGPT OAuth、B 站 Cookie、真实 `.env`、
图片/音频/视频本体。`state.json` 里的 DSH cookie 会被单独移除。
因此恢复后需要重新填写密钥、重新登录 B 站和 ChatGPT。

详细说明与限制见 [docs/private-backup.md](docs/private-backup.md)。

### 代码回滚

```bash
sudo bash scripts/restore.sh --code      # 撤销 dsh-fish 补丁
sudo bash scripts/restore.sh --list      # 列出本机备份
sudo bash scripts/restore.sh --from <时间戳>
```

---

## 更新

```bash
cd /opt/mahiro-fish
sudo bash scripts/update.sh
```

`update.sh` 先 `git pull --ff-only`，备份当前 `lib/` 与桥，再幂等重跑安装。
如果上游 dsh-fish 不是 0.9.9，补丁会拒绝应用——这时需要先更新补丁，
不要强行打。

---

## 自检与测试

```bash
sudo bash scripts/verify.sh
node --test tests/*.test.mjs
bash scripts/scan-secrets.sh
```

测试不读取真实凭据，只覆盖：

- outbox 去重、过期、退避、队列上限
- image outbox 的目录边界与去重
- 自主语音的时段/额度/间隔/长度
- 初始人格关键内容
- 补丁与模板结构
- 公开文件里没有真实凭据

---

## 已知限制

- 只提供 linux-x64 的固定 ASR 依赖；ARM 需要自己编译 sherpa-onnx。
- 2C4G 上本地 Kokoro TTS 较慢，建议用云端或只回文字。
- B 站接口可能变化；失败时会降级为只看文字，不会影响聊天。
- ChatGPT 生图依赖订阅插件与账号额度。
- 本项目的补丁针对 dsh-fish 0.9.9；升级插件前必须先更新补丁。

---

## 文档

- [架构](docs/architecture.md)
- [部署](docs/deployment.md)
- [Telegram](docs/telegram.md)
- [B 站](docs/bilibili.md)
- [记忆与媒体](docs/memory.md)
- [语音](docs/voice.md)
- [生图](docs/image-generation.md)
- [开发与补丁](docs/development.md)
- [私有记忆备份](docs/private-backup.md)
- [安全与隐私](docs/security.md)

---

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）
- [dsh-fish](https://github.com/ssamurias/dsh-fish)（MIT）
- [dsh-plugin-subscriptions](https://github.com/V1ki/dsh-plugin-subscriptions)（MIT）
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)（Apache-2.0）
- [SenseVoice](https://github.com/FunAudioLLM/SenseVoice)（模型许可见上游）
- 角色原型《别当欧尼酱了！》，权利归原作者与制作方所有。

第三方版本、许可证与署名见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

---

## 许可证

本项目代码以 MIT 许可证发布，见 [LICENSE](LICENSE)。
第三方组件各自保留原许可证；本项目不包含第三方完整依赖目录。
