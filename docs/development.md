# 开发与补丁

## 原则

1. **固定版本。** 不追最新；升级必须同时更新补丁和校验和。
2. **不把第三方完整目录放进仓库。** 部署时按固定版本安装。
3. **补丁必须能从原始版本重新应用。** 先在干净 0.9.9 上 `--dry-run`。
4. **事件流只追加。** 不改 `events.jsonl`，不伪造 `watched` / `growth`。
5. **公开文件白名单。** 不使用 `git add -A` 整理线上目录。

## 目录

```text
dsh-fish/
├── patches/
│   ├── dsh-fish-0.9.9-m2.4-m2.12.patch   # 累积补丁
│   ├── CHECKSUMS.sha256                  # 补丁后 21 个文件的哈希
│   ├── apply.sh                          # 原始应用脚本
│   └── restore.sh                        # 恢复 0.9.9 原始 lib
└── modules/                              # 新增模块源码（参考）
    ├── draw.js
    ├── selfavatar.js
    ├── mediaindex.js
    ├── mediarecall.js
    ├── sub.js
    └── voice.js
```

补丁本身已经包含新增文件；`modules/` 是方便阅读和 review 的副本。

## 应用补丁

```bash
sudo bash scripts/apply-patches.sh
sudo chown -R fish:fish /home/fish/.dsh/profiles/web/node_modules/@ssamurias/dsh-fish
sudo systemctl restart dsh-web
```

脚本行为：

- 版本不是 0.9.9 → 拒绝；
- 校验和已全匹配 → 跳过；
- 已部分应用 → 拒绝，要求先 `restore.sh`；
- 干净目标 → 备份 → dry-run → apply → 校验。

## 修改补丁的流程

1. 准备一个干净的 dsh-fish 0.9.9：

```bash
mkdir -p /tmp/patchwork
cd /tmp/patchwork
npm pack @ssamurias/dsh-fish@0.9.9
tar -xzf ssamurias-dsh-fish-0.9.9.tgz
cp -a package orig
cp -a package work
```

2. 在 `work/` 里改代码。

3. 生成新补丁：

```bash
diff -ruN --label a/lib/foo.js --label b/lib/foo.js \
  orig/lib/foo.js work/lib/foo.js
```

或者对整棵树：

```bash
cd /tmp/patchwork
diff -ruN orig work > /tmp/new.patch
# 检查路径前缀，确保是 a/lib/... b/lib/...
```

4. 在干净 0.9.9 上验证：

```bash
cd /tmp/patchwork/package
patch -p1 --dry-run < /tmp/new.patch
```

5. 更新 `CHECKSUMS.sha256`：

```bash
cd /home/fish/.dsh/profiles/web/node_modules/@ssamurias/dsh-fish
sha256sum lib/bili.js lib/draw.js ... > CHECKSUMS.sha256
```

6. 更新 `dsh-fish/patches/` 里的补丁与校验和，提交。

7. 在隔离环境跑 `scripts/install.sh` 与 `scripts/verify.sh`。

## 兼容性

补丁只适用于：

- dsh-fish **0.9.9**
- DSH **0.2.1-rc.3**
- Node **24.22.3**

如果上游升级：

- 不要强行 `patch`；
- 先看上游 `lib/` 是否改了补丁涉及的 21 个文件；
- 重新基于新版本生成补丁；
- 更新 `package.json` 里的固定版本、`README`、`CHECKSUMS`；
- 在干净环境完整回归。

## 人格导入与默认规则

现行实例通过 `scripts/import-persona.mjs` 导入人格。导入后
`model.persona.imported === true`，`lib/selfdoc.js` 里 `bansMuted` 为真，
`lib/persona.js:366` 的两条默认提示词禁令（关系数值化、撒娇式表达）**不进入
system prompt**；它们只对没有导入人格的默认实例生效。

所以本项目不修改上游 `lib/rules.js`：改它对现行实例没有作用，只会增加补丁面。
如果以后部署一个“从默认起点养起”的实例，再重新评估这两条规则。

## 测试

```bash
node --test tests/*.test.mjs
bash scripts/scan-secrets.sh
bash -n scripts/*.sh
```

测试不需要真实凭据。新增行为优先写纯函数测试：

- outbox / imageoutbox 的解析、去重、退避；
- voicepolicy 的时段、额度、间隔、长度；
- 静态检查：人格关键内容、模板占位符、补丁结构。

## Shell 风格

- `set -euo pipefail`
- 变量加引号
- 覆盖前 `backup_path`
- 失败信息说清楚“下一步做什么”
- 不把密钥写进命令行参数（会进 shell history / ps）

## 日志

- 桥：`~/.telegram-bridge/bridge.log`，5MB 轮转。
- 插件：`~/.dsh-fish/logs/dsh-fish.log`，2MB 轮转。
- DSH Web：`~/.dsh-web/web.log`。
- systemd：`journalctl -u dsh-web -u dsh-telegram`。

日志里不应出现 Token、Cookie、API Key。新增日志时只记录长度、provider、
耗时、错误类别。

## 提交前检查

```bash
bash scripts/scan-secrets.sh
git status
git diff --cached
```

确认暂存区只有白名单文件。`.gitignore` 不能阻止已经 `git add` 的文件，
所以必须看 `git diff --cached`。
