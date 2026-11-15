#!/usr/bin/env bash
# 校验 GitHub Private 备份：可见性、manifest、SHA256、seed、会话与敏感内容。
#
#   sudo bash scripts/verify-private.sh
#   sudo bash scripts/verify-private.sh --commit <sha>
set -euo pipefail

if [ -z "${FISH_HOME:-}" ] && [ -d /var/lib/fish ] && [ ! -d /home/fish ]; then
  export FISH_HOME=/var/lib/fish
fi
source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/lib-private.sh"
export PATH="${NODE_BIN}:$PATH"

PRIVATE_DIR="${PRIVATE_REPO_DIR:-/root/mahiro-fish-private-backup}"
COMMIT="origin/${PRIVATE_BRANCH:-main}"
MANIFEST=""
EXPECT_PERSONA="${PERSONA_EXPECT:-auto}"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo-dir) PRIVATE_DIR="${2:?缺少目录}"; shift 2 ;;
    --commit) COMMIT="${2:?缺少提交}"; shift 2 ;;
    --manifest) MANIFEST="${2:?缺少 manifest}"; shift 2 ;;
    --expect-persona) EXPECT_PERSONA="${2:?缺少人格类型}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

need_cmd git
need_cmd gh
need_cmd python3
need_cmd zstd
need_cmd tar
gh auth status >/dev/null 2>&1 || die "GitHub CLI 未登录"

assert_private_repo
ensure_private_repo_dir "$PRIVATE_DIR"
git -C "$PRIVATE_DIR" fetch origin "${PRIVATE_BRANCH:-main}" >/dev/null 2>&1 || true
SHA="$(git -C "$PRIVATE_DIR" rev-parse "$COMMIT")" || die "找不到提交：$COMMIT"
log "校验提交：$SHA"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$PRIVATE_DIR" archive "$SHA" | tar -x -C "$TMP" || die "导出提交失败"

if [ -n "$MANIFEST" ]; then
  MF="$TMP/${MANIFEST#/}"
else
  MF="$(find "$TMP/manifests" -maxdepth 1 -type f -name '*.json' | sort | tail -1)"
fi
[ -f "$MF" ] || die "找不到 manifest"
verify_manifest "$TMP" "$MF"
validate_snapshot_tree "$TMP/state"
assert_no_forbidden_names "$TMP/state"
if ! scan_private_tree "$TMP/state"; then
  die "备份里发现潜在凭据"
fi
ok "manifest / SHA256 / 内容完整性通过"

# seed 与事件流
EV="$(find "$TMP/state" -path '*/.dsh-fish/events.jsonl' -print -quit)"
[ -n "$EV" ] || die "备份里没有 events.jsonl"
"${NODE_BIN}/node" "${REPO_DIR}/scripts/persona-seed.mjs" "$EV" --expect "$EXPECT_PERSONA" \
  || die "备份里的 seed 不符合期望人格（${EXPECT_PERSONA}）"
python3 - "$EV" <<'PY'
import json, sys
n = 0; days = set()
for line in open(sys.argv[1], encoding='utf-8'):
    line = line.strip()
    if not line: continue
    e = json.loads(line); n += 1
    days.add(e.get('day'))
print(f"  事件数 {n}；天数 {len(days)}")
PY

# home.json 当前会话与 session 文件
HOME_JSON="$(find "$TMP/state" -path '*/.dsh-fish/home.json' -print -quit)"
[ -n "$HOME_JSON" ] || die "备份里没有 home.json"
SESSION_ID="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("sessionId",""))' "$HOME_JSON")"
[ -n "$SESSION_ID" ] || die "home.json 没有 sessionId"
if ! find "$TMP/state" -path "*/sessions/*/${SESSION_ID}/session.v4.jsonl.zstd" -print -quit | grep -q .; then
  die "home.json 指向的会话文件不在备份里：$SESSION_ID"
fi
ok "当前会话文件存在：$SESSION_ID"

# workspace.json 引用的会话是否齐全
WS="$(find "$TMP/state" -path '*/.dsh/storages/workspace.json' -print -quit)"
if [ -n "$WS" ]; then
  python3 - "$TMP/state" "$WS" <<'PY'
import json, os, sys
root, ws = sys.argv[1], sys.argv[2]
d = json.load(open(ws))
ids = []
for t in (d.get('tables') or {}).get('workspaces', {}).values():
    ids.extend(t.get('sessionIds') or [])
# 用实际路径检查
allpaths = []
for dirpath, _, names in os.walk(root):
    for n in names:
        if n == 'session.v4.jsonl.zstd':
            allpaths.append(dirpath)
for i in ids:
    if not any(os.path.basename(p) == i for p in allpaths):
        raise SystemExit(f'workspace.json 引用的会话缺失：{i}')
print(f"  workspace 会话齐全：{len(ids)} 个")
PY
else
  warn "没有 workspace.json，跳过 workspace 会话检查"
fi

# Telegram state 不应含 cookie
ST="$(find "$TMP/state" -path '*/.telegram-bridge/state.json' -print -quit)"
if [ -n "$ST" ]; then
  python3 - "$ST" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
if d.get('cookie'):
    raise SystemExit('state.json 仍然包含 cookie')
print('  Telegram state.json 已脱敏（无 cookie）')
PY
fi

# 公开仓库不能有任何私人备份路径
assert_public_repo_clean

COUNT="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["summary"]["file_count"])' "$MF")"
BYTES="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["summary"]["total_bytes"])' "$MF")"
ok "私有备份校验通过"
printf '  提交 SHA  %s\n  文件数    %s\n  总大小    %s 字节\n' "$SHA" "$COUNT" "$BYTES"
