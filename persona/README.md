# 初始人格模板

本项目支持三种人格起点，它们都走 dsh-fish 自己的 `seed` 事件，不创建第二套记忆引擎。

| 模式 | 文件 | 说明 |
| --- | --- | --- |
| `original-fish` | `original-fish.md` | **推荐默认。** 原创大肥鱼：没有原作背景，没有预先规定的性格、喜好和习惯 |
| `blank` | 无 | dsh-fish 原生空白人格；重置后不写 seed，首次启动由插件落下“你刚开始存在” |
| `mahiro` | `mahiro-handover.md` | 旧绪山真寻模板，保留为可选模板和旧实例恢复入口 |

## original-fish

`original-fish.md` 是一份很短的交接单。它只说明：

- 她叫大肥鱼；
- 她刚来这里，性格、兴趣和生活方式还没固定；
- 她可以好奇、犹豫、拒绝、主动尝试，也可以改变想法；
- 她不需要为了人设卖萌、懒散或勤奋；
- 真实经历可以进入记忆，但不强制每次经历都变成成长事件。

它不包含绪山真寻或原作背景，不预设妹妹/家人关系，不强制每天主动找主人，
不强制喜欢游戏、动画或 B 站，也不含好感度、服从度等数值系统。

## mahiro（可选）

`mahiro-handover.md` 是 2026-11-14 旧实例首次导入时使用的交接单，与当时的
`seed` 逐字一致。它保留了绪山真寻的名字、原作背景、妹妹关系、基础兴趣和性格。
它现在只是可选模板；新安装默认不使用它。

## 怎么用

### 方法 A：dsh-fish 设置页（推荐）

1. 打开 DSH Web → 设置 → 大肥鱼。
2. 找到“接一只别人养过的大肥鱼 / 导入交接单”。
3. 粘贴选中模板的全文。
4. 确认。插件会写入一条 `seed`（source=import）和一条 `import-mark`。

不要在已经有 `seed` 的实例上导入——插件会拒绝，这是设计：事件流只能追加。

### 方法 B：命令行（全新实例）

```bash
# 先停掉 DSH Web，避免状态库被占用
sudo systemctl stop dsh-web

# 推荐：原创大肥鱼
sudo -u fish node scripts/import-persona.mjs --mode original-fish

# 或者：原生空白人格
sudo -u fish node scripts/import-persona.mjs --mode blank

# 或者：旧真寻模板
sudo -u fish node scripts/import-persona.mjs --mode mahiro

sudo systemctl start dsh-web
```

脚本直接调用 dsh-fish 自带的 `applyHandover()`；如果目标状态库已经存在，它会拒绝，
除非显式加 `--reset --yes`（会先把旧状态整体改名封存，绝不删除）。

## 备份与恢复怎么认人格

`scripts/persona-seed.mjs` 读取 `events.jsonl` 里的实际 `seed` 和 `import-mark`，
识别 `blank` / `original-fish` / `mahiro` / `custom`。备份验证和恢复验证默认
`--expect-persona auto`，也可以显式要求某种人格：

```bash
sudo bash scripts/verify-private.sh --expect-persona original-fish
sudo bash scripts/restore-private.sh --expect-persona mahiro --target /tmp/old-mahiro
```

旧真寻备份里的 `import-mark` 是早期的“绪山真寻 / 别当欧尼酱了！”，
识别器仍然认它，所以旧档不会因为新版本改了人格名称而失效。

## 不会公开的东西

本仓库只包含初始模板。实例运行后产生的以下内容都不在公开仓库里：

- `events.jsonl` 与其中的对话、称呼、关系
- 日记、梦、主动留话、成长记录
- Telegram 私聊、B 站浏览记录、媒体索引
- 任何真实图片、语音、视频

真实记忆放在独立的 GitHub Private 备份仓库，见
[docs/private-backup.md](../docs/private-backup.md)。
