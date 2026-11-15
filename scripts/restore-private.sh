#!/usr/bin/env bash
# 从 GitHub Private 备份恢复真寻状态。
#
# 默认只恢复到临时隔离目录，不动线上：
#   sudo bash scripts/restore-private.sh
#   sudo bash scripts/restore-private.sh --target /tmp/mahiro-restore
#
# 真正覆盖线上必须显式确认；脚本会先把当前状态备份到
# /var/lib/fish/.mahiro-fish-backups/pre-restore-<时间>/：
#   sudo bash scripts/restore-private.sh --apply --yes
#
# 可指定历史提交：
#   sudo bash scripts/restore-private.sh --commit <sha>
#
# 可指定期望人格（auto / blank / original-fish / mahiro / custom）：
#   sudo bash scripts/restore-private.sh --expect-persona mahiro
set -euo pipefail

if [ -z "${FISH_HOME:-}" ] && [ -d /var/lib/fish ] && [ ! -d /home/fish ]; then
  export FISH_HOME=/var/lib/fish
fi
source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/lib-private.sh"
export PATH="${NODE_BIN}:$PATH"

PRIVATE_DIR="${PRIVATE_REPO_DIR:-/root/mahiro-fish-private-backup}"
COMMIT="origin/${PRIVATE_BRANCH:-main}"
TARGET=""
APPLY=0
YES=0
MANIFEST=""
EXPECT_PERSONA="${PERSONA_EXPECT:-auto}"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo-dir) PRIVATE_DIR="${2:?缺少目录}"; shift 2 ;;
    --commit) COMMIT="${2:?缺少提交}"; shift 2 ;;
    --target) TARGET="${2:?缺少目录}"; shift 2 ;;
    --manifest) MANIFEST="${2:?缺少 manifest}"; shift 2 ;;
    --expect-persona) EXPECT_PERSONA="${2:?缺少人格类型}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --yes) YES=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

need_root
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
log "恢复来源提交：$SHA"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$PRIVATE_DIR" archive "$SHA" | tar -x -C "$TMP" || die "导出提交失败"

if [ -n "$MANIFEST" ]; then
  MF="$TMP/${MANIFEST#/}"
else
  MF="$(find "$TMP/manifests" -maxdepth 1 -type f -name '*.json' | sort | tail -1)"
fi
[ -f "$MF" ] || die "找不到 manifest"
log "使用 manifest：${MF#${TMP}/}"
verify_manifest "$TMP" "$MF"
validate_snapshot_tree "$TMP/state"
assert_no_forbidden_names "$TMP/state"
if ! scan_private_tree "$TMP/state"; then
  die "备份里发现潜在凭据，拒绝恢复。"
fi
ok "备份内容校验通过"

find_seed() {
  local root="$1" ev
  ev="$(find "$root" -path '*/.dsh-fish/events.jsonl' -print -quit)"
  [ -n "$ev" ] || die "备份里没有 events.jsonl"
  "${NODE_BIN}/node" "${REPO_DIR}/scripts/persona-seed.mjs" "$ev" --expect "$EXPECT_PERSONA" \
    || die "事件流里的 seed 不符合期望人格（${EXPECT_PERSONA}）"
  python3 - "$ev" <<'PY'
import json, sys
p = sys.argv[1]
n = 0
for line in open(p, encoding='utf-8'):
    line = line.strip()
    if not line: continue
    json.loads(line); n += 1
print(f'  事件数 {n}')
PY
}

if [ "$APPLY" = 0 ]; then
  DEST="${TARGET:-$(mktemp -d /tmp/mahiro-restore-XXXXXX)}"
  mkdir -p "$DEST"
  cp -a "$TMP/state/." "$DEST/"
  find_seed "$DEST"
  ok "已恢复到隔离目录：$DEST"
  echo "  这是只读演练；没有修改线上状态。"
  echo "  检查完成后可以删除：rm -rf $DEST"
  exit 0
fi

[ "$YES" = 1 ] || die "覆盖线上必须显式加 --yes。已停止，未修改任何线上文件。"

STAMP="$(date +%Y%m%d-%H%M%S)"
PRE="${BACKUP_ROOT}/pre-restore-${STAMP}"
log "先备份当前状态到 ${PRE}"
mkdir -p "$PRE"

# 备份当前会被覆盖的文件（只备份 manifest 里出现的路径）
python3 - "$TMP" "$PRE" "$MF" <<'PY'
import json, os, shutil, sys
repo, pre, mf = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(mf))
for f in m['files']:
    rel = f['path']
    if not rel.startswith('state/'): continue
    dst = '/' + rel[len('state/'):]
    if os.path.exists(dst):
        out = os.path.join(pre, rel[len('state/'):])
        os.makedirs(os.path.dirname(out), exist_ok=True)
        if os.path.isdir(dst):
            shutil.copytree(dst, out, dirs_exist_ok=True)
        else:
            shutil.copy2(dst, out)
print(f"pre-restore files: {len(m['files'])}")
PY

log "停止服务"
systemctl stop dsh-telegram.service dsh-web.service 2>/dev/null || true

# 恢复：manifest 的 state/var/lib/fish/... → /var/lib/fish/...
python3 - "$TMP" "$MF" "$FISH_USER" <<'PY'
import json, os, shutil, sys
repo, mf, user = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(mf))
for f in m['files']:
    rel = f['path']
    if not rel.startswith('state/'): raise SystemExit(f'非法路径：{rel}')
    dst = '/' + rel[len('state/'):]
    src = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    os.chmod(dst, int(f.get('mode', '0o600'), 8))
print(f"restored files: {len(m['files'])}")
PY

# 旧 PID/锁会让重启误判；这些文件不在备份里，清掉即可重新生成。
rm -f "${FISH_ROOT}/instance.json"
find "$DSH_HOME/sessions" -name 'session.lock' -delete 2>/dev/null || true
chown -R "$FISH_USER:$FISH_USER" "$FISH_HOME/.dsh-fish" "$FISH_HOME/.telegram-bridge" "$DSH_HOME/storages" "$DSH_HOME/sessions" 2>/dev/null || true
chown -R "$FISH_USER:$FISH_USER" "$PROFILE_DIR" 2>/dev/null || true

systemctl daemon-reload 2>/dev/null || true
systemctl start dsh-web.service 2>/dev/null || true
if ! grep -qE '^TELEGRAM_BOT_TOKEN=.+REPLACE_ME' "$BRIDGE_ENV_FILE" 2>/dev/null; then
  systemctl start dsh-telegram.service 2>/dev/null || true
fi

find_seed "$FISH_HOME"
ok "线上恢复完成"
echo "  恢复前状态：$PRE"
echo "  B 站 Cookie / ChatGPT OAuth / .env 不在备份内，如缺失请重新登录或填写。"
