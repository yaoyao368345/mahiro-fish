# 部署

本文以 Debian 13、x86_64、2C4G 为基准。`fish` 用户、`/home/fish` 为默认值，
可以通过环境变量覆盖。

## 0. 先想清楚三件事

1. **公开仓库只恢复代码和初始人格。** 旧实例的聊天、日记、梦、称呼、B 站
   Cookie 都不在里面。真实数据要单独做私有备份。
2. **DSH Web 只监听 127.0.0.1。** 不要直接把 3080 暴露到公网。
3. **可选功能默认关闭。** 没有 Telegram、B 站、ChatGPT Plus、TTS 也能跑核心。

## 1. 系统准备

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git ffmpeg patch tar xz-utils bzip2
```

确认时区和时间同步：

```bash
timedatectl set-timezone Asia/Shanghai   # 或你所在的时区
timedatectl status
```

dsh-fish 的自主语音额度按 `Asia/Hong_Kong` 自然日计算，这与服务器时区无关；
但日志、日记日期使用本地时区，建议设置正确。

## 2. 安装 Node.js（固定 24.22.3）

```bash
V=24.22.3
curl -fLO https://nodejs.org/dist/v$V/node-v$V-linux-x64.tar.xz
curl -fLO https://nodejs.org/dist/v$V/SHASUMS256.txt
grep " node-v$V-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum -c -
sudo mkdir -p /opt/nodejs
sudo tar -xJf node-v$V-linux-x64.tar.xz -C /opt/nodejs
sudo mv /opt/nodejs/node-v$V-linux-x64 /opt/nodejs/v$V
echo 'export PATH=/opt/nodejs/v24.22.3/bin:$PATH' | sudo tee /etc/profile.d/nodejs.sh
```

验证：

```bash
/opt/nodejs/v24.22.3/bin/node -v   # v24.22.3
```

## 3. 安装 DSH 与 pnpm

```bash
export PATH=/opt/nodejs/v24.22.3/bin:$PATH
sudo npm install -g @deepseek-ai/dsh@0.2.1-rc.3 pnpm@11.28.5
dsh --version    # 0.2.1-rc.3
pnpm --version   # 11.28.5
```

## 4. 创建用户与 profile

```bash
sudo useradd --create-home --home-dir /home/fish --shell /bin/bash fish
sudo install -d -m 700 -o fish -g fish /home/fish

sudo -u fish env HOME=/home/fish PATH=/opt/nodejs/v24.22.3/bin:$PATH \
  dsh --profile web --help
```

第一条 `dsh --profile web --help` 会从内置模板创建
`/home/fish/.dsh/profiles/web`，不会启动服务。

安装固定版本插件：

```bash
sudo -u fish env HOME=/home/fish PATH=/opt/nodejs/v24.22.3/bin:$PATH \
  dsh plugin --profile web add @ssamurias/dsh-fish@0.9.9

sudo -u fish env HOME=/home/fish PATH=/opt/nodejs/v24.22.3/bin:$PATH \
  dsh plugin --profile web add dsh-plugin-subscriptions@0.9.13
```

确认 profile 的 `package.json`：

```json
{
  "dependencies": {
    "@ssamurias/dsh-fish": "0.9.9",
    "dsh-plugin-subscriptions": "0.9.13"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@ssamurias/dsh-fish",
        "dsh-plugin-subscriptions"
      ]
    }
  }
}
```

`dependencies` 与 `bundles` 两边都要有；缺一边会在下次 pnpm 清理时出问题。

## 5. 配置 DeepSeek

```bash
sudo install -d -m 750 /etc/mahiro-fish
sudo install -m 600 /dev/null /etc/mahiro-fish/dsh.env
sudo nano /etc/mahiro-fish/dsh.env
```

内容：

```dotenv
DEEPSEEK_API_KEY=sk-你的Key
DSH_TELEMETRY_MODE=DISABLED
DSH_TELEMETRY_DISABLED=1
```

把 `config/cordis.patch.yml` 复制到 profile：

```bash
sudo install -m 600 -o fish -g fish \
  config/cordis.patch.yml \
  /home/fish/.dsh/profiles/web/cordis.patch.yml
```

它把 DeepSeek 设为默认 provider，默认模型 `deepseek-flash`。

## 6. 打补丁

```bash
sudo bash scripts/apply-patches.sh
sudo chown -R fish:fish /home/fish/.dsh/profiles/web/node_modules/@ssamurias/dsh-fish
```

脚本会：

1. 检查 dsh-fish 版本必须是 0.9.9；
2. 如果校验和已经全部匹配，直接跳过（可重复执行）；
3. 备份现有 `lib/`；
4. `patch -p1 --dry-run` 后正式应用；
5. 用 `CHECKSUMS.sha256` 校验 21 个文件。

## 7. 安装 Telegram 桥

```bash
sudo install -d -m 700 -o fish -g fish /home/fish/telegram-bridge
sudo install -m 644 -o fish -g fish \
  telegram-bridge/{bridge.mjs,outbox.mjs,imageoutbox.mjs,voicepolicy.mjs} \
  /home/fish/telegram-bridge/
sudo install -d -m 700 -o fish -g fish /home/fish/.telegram-bridge
```

配置：

```bash
sudo -u fish install -m 600 config/telegram-bridge.env.example /home/fish/.telegram-bridge.env
sudo -u fish nano /home/fish/.telegram-bridge.env
```

至少填：

```dotenv
TELEGRAM_BOT_TOKEN=123456789:AA...
OWNER_TELEGRAM_ID=100000000
```

## 8. systemd

```bash
sudo sed -e 's|__FISH_USER__|fish|g' \
         -e 's|__FISH_HOME__|/home/fish|g' \
         -e 's|__NODE_BIN__|/opt/nodejs/v24.22.3/bin|g' \
         -e 's|__DSH_BIN__|/opt/nodejs/v24.22.3/bin/dsh|g' \
         -e 's|__DSH_ENV__|/etc/mahiro-fish/dsh.env|g' \
         config/systemd/dsh-web.service.template \
  | sudo tee /etc/systemd/system/dsh-web.service

sudo sed -e 's|__FISH_USER__|fish|g' \
         -e 's|__FISH_HOME__|/home/fish|g' \
         -e 's|__NODE_BIN__|/opt/nodejs/v24.22.3/bin|g' \
         config/systemd/dsh-telegram.service.template \
  | sudo tee /etc/systemd/system/dsh-telegram.service

sudo install -d -m 700 -o fish -g fish /home/fish/.dsh-web
sudo -u fish touch /home/fish/.dsh-web/web.log
sudo chmod 600 /home/fish/.dsh-web/web.log
sudo systemctl daemon-reload
sudo systemctl enable --now dsh-web.service
```

确认 Web 起来后，再启动 Telegram：

```bash
sudo systemctl enable --now dsh-telegram.service
```

## 9. 导入初始人格

全新状态库：

```bash
sudo systemctl stop dsh-web
sudo node scripts/import-persona.mjs \
  --pkg /home/fish/.dsh/profiles/web/node_modules/@ssamurias/dsh-fish \
  --root /home/fish/.dsh-fish \
  --persona persona/mahiro-handover.md
sudo chown -R fish:fish /home/fish/.dsh-fish
sudo systemctl start dsh-web
```

也可以完全走原生设置页：DSH Web → 设置 → 大肥鱼 → 接一只别人养过的大肥鱼，
粘贴 `persona/mahiro-handover.md`。

已经有 `seed` 的实例会被拒绝。要重开一局必须加 `--reset --yes`；
它会先把旧状态整体改名到 `/home/fish/dsh-fish-backups/reset-<时间>/`。
**执行前先停 dsh-web。**

## 10. 验证

```bash
sudo bash scripts/verify.sh
```

应看到：

- Node / DSH / dsh-fish 版本正确
- 补丁校验和全部匹配
- 5 个新增模块存在
- 两个 systemd 服务 active
- `127.0.0.1:3080` 可访问
- 事件流里有绪山真寻的 seed
- 敏感文件权限 600
- 语法、测试、凭据扫描通过

再手动测试 Telegram：

1. 给 Bot 发 `/start`，应回“这里是大肥鱼。直接说话就行。”
2. 发 `/id`，应返回你的 chat_id。
3. 发 `/ping`，应回 `pong`。
4. 发一句正常的话，应收到真寻的回复。

## 11. 更新

```bash
cd /opt/mahiro-fish
sudo bash scripts/update.sh
```

如果上游 dsh-fish 不是 0.9.9，补丁会拒绝。不要硬打；先按
`docs/development.md` 的方式更新补丁。

## 12. 恢复

```bash
sudo bash scripts/restore.sh --list
sudo bash scripts/restore.sh --from <时间戳>
sudo bash scripts/restore.sh --code      # 只撤销补丁
```

`--from` 只恢复备份目录里存在的文件，并且只允许
`/home/fish/*`、`/etc/mahiro-fish/*`、`/etc/systemd/system/dsh-*.service`。

## 常见问题

### `dsh: pnpm was not found`

`pnpm` 不在 PATH。确认 `/opt/nodejs/v24.22.3/bin/pnpm` 存在，并在
systemd 和 sudo 命令里带上完整 PATH。

### 设置页没有“大肥鱼”

- 检查 profile 的 `dependencies` 和 `bundles` 是否都有
  `@ssamurias/dsh-fish`。
- 检查 `cordis.patch.yml` 里的 name 是否是带 scope 的全名。
- 看 `~/.dsh-web/web.log` 和 `~/.dsh-fish/logs/dsh-fish.log`。

### Telegram 没反应

```bash
systemctl status dsh-telegram
journalctl -u dsh-telegram -n 100 --no-pager
cat /home/fish/.telegram-bridge/bridge.log
```

常见原因：Token 错、`OWNER_TELEGRAM_ID` 不是数字、给 Bot 发消息的不是主人、
DSH Web 没起来。

### 语音听不清

确认 ffmpeg 存在、ASR 路径正确、`.telegram-bridge.env` 里的 `ASR_*` 已取消注释。
看 `bridge.log` 里的 `voice ASR` 行。

### 图片没发出来

确认 `her_draw` 成功、`~/.dsh/plugins/subscriptions/images/` 里有图、
`image-outbox.json` 里没有把路径记成 `outside-trusted-dir`。

### 端口安全

只开放 SSH。Web 用 SSH 隧道或 HTTPS 反代 + 访问控制。
不要开放 3080 到公网。
