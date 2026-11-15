# dsh-fish 0.9.9 补丁

适用版本：dsh-fish **0.9.9**（DSH 0.2.1-rc.3）。
不要用于升级后的 dsh-fish。

## 内容

`dsh-fish-0.9.9-m2.4-m2.12.patch` 是累积补丁，包含 M2.4–M2.12.4 与 M3.4 的全部改动：

- **M2.4 主动生活增强**
  - `proactive.js`：真实 B 站 `watched` / `looked` 进入主动材料与“劲儿”
  - `drive.js` / `scheduler.js` / `persona.js`：主动回合与说明
  - `her_leave` 作为发送工具时的身份说明
- **M2.6–M2.9 媒体与字幕**
  - `mediaindex.js`（新）：媒体索引、30 天/100MB 维护、缓存命中
  - `mediarecall.js`（新）：只读工具 `her_media`
  - `watch.js`：成功后写索引；同 bvid + 同时间点命中缓存
  - `media.js`：清理时保护 `index.json`
  - `bili.js`：字幕轨协议相对 URL、AI/人工/未知来源、CID/分P
  - `sub.js`（新）：从 1.0.0 移植的 `bili_sub`，按句给、可翻页
- **M2.10 生图**
  - `draw.js`（新）：`her_draw`，复用 `image_generate`，每天 2 张
- **M3.4 自主记忆语义**
  - `capture.js` / `persona.js`：`growth_commit` 明确为“她自己的记忆”，不需要询问批准，也不强制每次记录。
  - `ask.js` / `persona.js`：收窄 `ask_owner` 到真正需要外部授权、资源或配合的事；记忆、兴趣、看法、日记和观看感受不走审批。
- **M2.12 语音**
  - `voice.js`（新）：`her_voice`，只写内存请求
  - `say.js` / `observe.js`：`voice:true`、`voiceRequested`、当轮提示
  - `persona.js`：Telegram 语音回复能力说明
  - `restrict.js`：工具面加入 `her_voice`

补丁后的 25 个文件校验和见 `CHECKSUMS.sha256`。

## 应用

推荐从仓库根目录：

```bash
sudo bash scripts/apply-patches.sh
sudo systemctl restart dsh-web
```

也可以直接：

```bash
cd dsh-fish/patches
sudo ./apply.sh
sudo systemctl restart dsh-web
```

`apply.sh` 先 dry-run，再打补丁，最后用 `CHECKSUMS.sha256` 校验。
`scripts/apply-patches.sh` 额外做了版本检查、备份和幂等处理。

## 校验

```bash
cd /home/fish/.dsh/profiles/web/node_modules/@ssamurias/dsh-fish
sha256sum -c /opt/mahiro-fish/dsh-fish/patches/CHECKSUMS.sha256
```

## 回滚

```bash
sudo bash scripts/restore.sh --code
sudo systemctl restart dsh-web
```

或：

```bash
cd dsh-fish/patches
sudo ./restore.sh
sudo systemctl restart dsh-web
```

`restore.sh` 会先把当前 `lib/` 备份成 `lib.before-restore.<时间>`，
再恢复 0.9.9 原始 `lib/`，并移除新增模块。
**不要在升级后的 dsh-fish 上运行它。**

原始 `lib/` 的来源：

- 本地开发时，如果存在 `orig/package/lib`，直接用它；
- 否则从 npm 下载固定的 `@ssamurias/dsh-fish@0.9.9` tarball，
  校验 SHA256 后解出 `lib/`。

tarball SHA256：

```text
71835c673557d14e992577d1c4f255816b4cc0bce74fe874f47c17b11c0e487d
```

仓库不附带第三方完整依赖目录。部署时仍应通过 npm 安装固定版本：

```bash
dsh plugin --profile web add @ssamurias/dsh-fish@0.9.9
```

## 数据文件

- 媒体索引：`~/.dsh-fish/media/index.json`（0600）
- 图片：`~/.dsh-fish/media/sheet-*.png`，30 天 / 100MB
- 图片过期后：索引保留标题、日期、时间点、SHA256、watched 事件 ID；
  `path` 清空，`status` 变 `expired`，不再作为可读取对象返回
- 不修改 `events.jsonl`；不生成 watched/growth
