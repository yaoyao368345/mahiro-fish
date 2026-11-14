# v0.1.0

首个公开版本：把 Debian 上的真寻养成环境整理成可复现的开源部署。

## 包含什么

- 初始绪山真寻人格 `persona/mahiro-handover.md`，与首次导入的 seed 逐字一致。
- DSH 0.2.1-rc.3 + dsh-fish 0.9.9 固定版本部署。
- dsh-fish 0.9.9 累积补丁（M2.4–M2.12.4）：
  - B 站真实经历进入主动材料
  - 媒体索引 `her_media`、30 天/100MB 维护、抽帧缓存
  - `bili_sub` 字幕
  - `her_draw` 生图
  - `her_voice` 自主语音
- Telegram 私聊桥：文字、主动留话 outbox、图片 outbox、语音收发。
- 本地 SenseVoice ASR、OpenRouter/本地/Breeze TTS 可选配置。
- 可重复执行的安装、补丁、验证、更新、恢复脚本。
- 手动私有记忆备份脚本：
  - `scripts/backup-private.sh`
  - `scripts/restore-private.sh`
  - `scripts/verify-private.sh`

## 部署

```bash
sudo git clone https://github.com/yaoyao368345/mahiro-fish.git /opt/mahiro-fish
cd /opt/mahiro-fish
sudo bash scripts/install.sh
sudo nano /etc/mahiro-fish/dsh.env
sudo -u fish nano /home/fish/.telegram-bridge.env
sudo bash scripts/verify.sh
sudo systemctl restart dsh-web dsh-telegram
```

可选功能默认关闭：B 站登录、ChatGPT Plus 生图、ASR、TTS。
没有这些，核心文字养成和 Telegram 私聊仍可运行。

## 私有记忆备份

运行数据不在公开仓库。使用独立的 GitHub Private 仓库：

```bash
sudo bash scripts/backup-private.sh
sudo bash scripts/verify-private.sh
sudo bash scripts/restore-private.sh --target /tmp/restore
```

备份包含事件流、日记/梦、DSH 会话、媒体索引、Telegram 去重状态和
非敏感配置；不包含 Bot Token、API Key、ChatGPT OAuth、B 站 Cookie、
SSH 私钥、真实 `.env` 或图片/音频/视频本体。

## 验证

- 18 个无凭据基础测试通过。
- 补丁可从干净 dsh-fish 0.9.9 重新应用，19 个文件 SHA256 匹配。
- 安装脚本在隔离目录首次安装与重复执行均通过。
- 凭据扫描通过。

## 已知限制

- 只提供 linux-x64 的固定 ASR 依赖；ARM 需要自行编译。
- 2C4G 上本地 Kokoro TTS 较慢，建议云端或只回文字。
- B 站接口可能变化，失败时降级为只看文字。
- ChatGPT 生图依赖订阅插件与账号额度。
- 补丁只适用于 dsh-fish 0.9.9；升级前必须更新补丁。
- 私有备份不包含媒体图片本体；恢复后可能需要重新获取。
- 恢复后需要重新填写 API Key、重新登录 B 站与 ChatGPT。

## 许可与声明

代码以 MIT 发布。角色原型来自《别当欧尼酱了！》；本项目是非官方粉丝实现，
不包含动画截图、配音、角色插画或原作长篇台词。
第三方组件与许可证见 `THIRD-PARTY-NOTICES.md`。
