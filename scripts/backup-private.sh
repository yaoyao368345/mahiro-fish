#!/usr/bin/env bash
# 手动创建真寻运行状态的私有备份，并推送到 GitHub Private 仓库。
#
#   sudo bash scripts/backup-private.sh
#   sudo bash scripts/backup-private.sh --repo-dir /root/mahiro-fish-private-backup
#
# 不会停止线上服务；events.jsonl 只取完整行，其他 JSON 会做解析校验。
# 任何校验失败都不会提交或推送。
set -euo pipefail

if [ -z "${FISH_HOME:-}" ] && [ -d /var/lib/fish ] && [ ! -d /home/fish ]; then
  export FISH_HOME=/var/lib/fish
fi
source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/lib-private.sh"
export PATH="${NODE_BIN}:$PATH"

PRIVATE_DIR="${PRIVATE_REPO_DIR:-/root/mahiro-fish-private-backup}"
MAX_FILE_BYTES="${MAX_FILE_BYTES:-8388608}"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo-dir) PRIVATE_DIR="${2:?缺少目录}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

need_root
need_cmd git
need_cmd gh
need_cmd python3
need_cmd zstd
need_cmd sha256sum
gh auth status >/dev/null 2>&1 || die "GitHub CLI 未登录"

STAMP="${MAHIRO_BACKUP_STAMP:-$(date +%Y%m%d-%H%M%S)}"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TOOL_VERSION="$(python3 - "${REPO_DIR}/package.json" <<'PY' 2>/dev/null || echo '0.1.0'
import json, sys
print(json.load(open(sys.argv[1]))['version'])
PY
)"

log "私有备份开始：${STAMP}"
print_paths

# ---------------------------------------------------------------- 仓库安全
assert_private_repo
ensure_private_repo_dir "$PRIVATE_DIR"
assert_repo_is_ours_or_empty "$PRIVATE_DIR"
assert_private_remote "$PRIVATE_DIR"

# ---------------------------------------------------------------- 快照
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SNAP="$TMP/state"
mkdir -p "$SNAP"
EXCLUDED="$TMP/excluded.txt"
SANITIZED="$TMP/sanitized.txt"
: >"$EXCLUDED"
: >"$SANITIZED"

exclude() { printf '%s\t%s\n' "$1" "$2" >>"$EXCLUDED"; }

copy_file() {
  local src="$1" dst reason
  if [ ! -e "$src" ]; then exclude "$src" "missing"; return 0; fi
  if [ -L "$src" ]; then exclude "$src" "symlink"; return 0; fi
  if [ ! -f "$src" ]; then exclude "$src" "not-regular-file"; return 0; fi
  local size
  size="$(stat -c%s "$src")"
  if [ "$size" -gt "$MAX_FILE_BYTES" ]; then
    exclude "$src" "too-large:${size}"; return 0
  fi
  dst="$SNAP$src"
  mkdir -p "$(dirname "$dst")"
  cp --preserve=mode --no-preserve=ownership "$src" "$dst"
}

copy_jsonl_consistent() {
  local src="$1" dst
  if [ ! -f "$src" ]; then exclude "$src" "missing"; return 0; fi
  dst="$SNAP$src"
  mkdir -p "$(dirname "$dst")"
  python3 - "$src" "$dst" <<'PY'
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
ends_nl = data.endswith(b'\n')
parts = data.split(b'\n')
if ends_nl:
    parts = parts[:-1]
out = []
for i, line in enumerate(parts):
    if not line.strip():
        continue
    try:
        json.loads(line)
    except Exception:
        if i == len(parts) - 1 and not ends_nl:
            break  # 写入一半的最后一行：安全丢弃
        raise SystemExit(f'events.jsonl 中间存在损坏行：第 {i+1} 行')
    out.append(line)
with open(dst, 'wb') as f:
    f.write(b'\n'.join(out) + (b'\n' if out else b''))
os.chmod(dst, 0o600)
if len(out) != len(parts):
    print(f'  ! events.jsonl 丢弃了未写完的最后一行（保留 {len(out)} 行）')
PY
}

copy_state_sanitized() {
  local src="$1" dst
  if [ ! -f "$src" ]; then exclude "$src" "missing"; return 0; fi
  dst="$SNAP$src"
  mkdir -p "$(dirname "$dst")"
  python3 - "$src" "$dst" <<'PY'
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src))
removed = []
for k in ('cookie',):
    if k in d:
        d.pop(k)
        removed.append(k)
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
    f.write('\n')
os.chmod(dst, 0o600)
print('removed ' + (','.join(removed) if removed else 'none'))
PY
  printf '%s\t%s\n' "$src" "removed cookie (DSH browser session)" >>"$SANITIZED"
}

copy_dir_files() {
  local src="$1" pattern="${2:-*}" maxdepth="${3:-2}" f
  if [ ! -d "$src" ]; then exclude "$src" "missing-dir"; return 0; fi
  while IFS= read -r -d '' f; do copy_file "$f"; done < <(
    find "$src" -maxdepth "$maxdepth" -type f -name "$pattern" -print0
  )
}

# 1. 事件流：完整行快照
copy_jsonl_consistent "$FISH_ROOT/events.jsonl"

# 2. 长期记忆 / 成长 / 状态
copy_file "$FISH_ROOT/config.json"
copy_file "$FISH_ROOT/talk-recent.json"
copy_file "$FISH_ROOT/home.json"
copy_file "$FISH_ROOT/inbox.md"
copy_file "$FISH_ROOT/notes.json"
copy_file "$FISH_ROOT/session-notes.json"
copy_file "$FISH_ROOT/keepsakes.json"
copy_file "$FISH_ROOT/outings.json"
copy_file "$FISH_ROOT/possessions.json"
copy_dir_files "$FISH_ROOT/diary" '*.md' 1
copy_dir_files "$FISH_ROOT/out" '*.md' 1
copy_dir_files "$FISH_ROOT/home" '*' 1
copy_dir_files "$FISH_ROOT/keepsakes" '*' 6

# 3. B 站媒体记忆索引（不含图片本体）
copy_file "$FISH_ROOT/media/index.json"

# 4. Telegram 投递去重与语音偏好
copy_state_sanitized "$FISH_HOME/.telegram-bridge/state.json"
copy_file "$FISH_HOME/.telegram-bridge/outbox.json"
copy_file "$FISH_HOME/.telegram-bridge/image-outbox.json"
copy_file "$FISH_HOME/.telegram-bridge/voice-prefs.json"
copy_file "$FISH_HOME/.telegram-bridge/voice-usage.json"

# 5. DSH 会话状态（只取她自己的 workspace）
copy_file "$DSH_HOME/storages/workspace.json"
copy_dir_files "$DSH_HOME/sessions/--var-lib-fish-.dsh-fish-home--" 'session.v4.jsonl.zstd' 4
copy_file "$DSH_HOME/cordis.patch.yml"
copy_file "$PROFILE_DIR/cordis.patch.yml"
copy_file "$PROFILE_DIR/cordis.yml"
copy_file "$PROFILE_DIR/package.json"
copy_file "$PROFILE_DIR/pnpm-lock.yaml"

# 6. 非敏感的 systemd 配置
copy_file /etc/systemd/system/dsh-web.service
copy_file /etc/systemd/system/dsh-telegram.service

# 明确排除（写进 manifest）
for p in \
  "$FISH_ROOT/owner.json" \
  "$FISH_ROOT/instance.json" \
  "$FISH_ROOT/logs" \
  "$FISH_ROOT/media/*.png" \
  "$DSH_HOME/.credentials.yaml" \
  "$DSH_HOME/plugins/subscriptions/auth.json" \
  "$DSH_HOME/plugins/subscriptions/images" \
  "$FISH_HOME/.telegram-bridge.env" \
  "$FISH_HOME/.breezeblue.env" \
  "$FISH_HOME/.elevenlabs.env" \
  "$FISH_HOME/.telegram-bridge/bridge.log" \
  "$FISH_HOME/.dsh-web" \
  /etc/mahiro-fish/dsh.env; do
  exclude "$p" "forbidden-or-derived"
done

# ---------------------------------------------------------------- 校验
log "校验快照"
validate_snapshot_tree "$SNAP"
assert_no_forbidden_names "$SNAP"

log "检查潜在凭据"
if ! scan_private_tree "$SNAP"; then
  die "快照里发现潜在凭据，已停止；没有提交或推送。"
fi
ok "未发现高信号凭据"

# ---------------------------------------------------------------- manifest
python3 - "$SNAP" "$TMP/manifest.json" "$STAMP" "$CREATED_AT" "$TOOL_VERSION" "$EXCLUDED" "$SANITIZED" <<'PY'
import hashlib, json, os, sys
snap, out, stamp, created, version, excluded, sanitized = sys.argv[1:8]
files = []
total = 0
for dirpath, _, names in os.walk(snap):
    for n in sorted(names):
        p = os.path.join(dirpath, n)
        rel = os.path.relpath(p, os.path.dirname(snap))
        data = open(p, 'rb').read()
        files.append({
            'path': rel.replace(os.sep, '/'),
            'sha256': hashlib.sha256(data).hexdigest(),
            'bytes': len(data),
            'mode': oct(os.stat(p).st_mode & 0o777),
        })
        total += len(data)

def lines(path):
    try:
        return [l.rstrip('\n') for l in open(path, encoding='utf-8') if l.strip()]
    except FileNotFoundError:
        return []

manifest = {
    'format': 1,
    'backup_id': stamp,
    'created_at': created,
    'tool_version': version,
    'source_layout': 'state/<absolute path without leading slash>',
    'summary': {'file_count': len(files), 'total_bytes': total},
    'files': sorted(files, key=lambda x: x['path']),
    'excluded': lines(excluded),
    'sanitized': lines(sanitized),
    'notes': [
        'events.jsonl 只包含完整 JSON 行；写入一半的尾行会被丢弃。',
        'Telegram state.json 的 DSH browser cookie 已移除。',
        'owner.json（B 站 Cookie）、订阅 auth.json、各类 .env 与 API Key 不在备份内。',
        '媒体图片本体不在备份内；media/index.json 保留索引，恢复后图片可能需要重新获取。',
    ],
}
with open(out, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(f"manifest: {len(files)} files, {total} bytes")
PY

# ---------------------------------------------------------------- 写入私有仓库
log "更新私有仓库工作区"
rm -rf "$PRIVATE_DIR/state"
cp -a "$SNAP" "$PRIVATE_DIR/state"
mkdir -p "$PRIVATE_DIR/manifests"
cp "$TMP/manifest.json" "$PRIVATE_DIR/manifests/${STAMP}.json"

if [ ! -f "$PRIVATE_DIR/README.md" ]; then
  cat >"$PRIVATE_DIR/README.md" <<'EOF'
# mahiro-fish private backup

这是真寻运行状态的**私有**备份，不是公开代码仓库。

- 公开代码：https://github.com/yaoyao368345/mahiro-fish
- 备份内容：事件流、长期记忆、日记/梦、DSH 会话、媒体索引、Telegram 去重状态、非敏感配置。
- 不包含：Bot Token、API Key、ChatGPT OAuth、B 站 Cookie、SSH 私钥、真实 .env、图片/音频/视频。
- `manifests/` 每个文件列出路径、SHA256 与大小。
- `state/` 保留原始绝对路径（去掉开头的 `/`）。

恢复请使用公开仓库里的 `scripts/restore-private.sh`。
EOF
fi
printf '%s\n' "This repository is managed by mahiro-fish private backup tooling." >"$PRIVATE_DIR/$PRIVATE_MARKER"
cat >"$PRIVATE_DIR/.gitignore" <<'EOF'
*.tmp
*.partial
.DS_Store
EOF

cd "$PRIVATE_DIR"
git config user.name "${GIT_AUTHOR_NAME:-yaoyao368345}"
git config user.email "${GIT_AUTHOR_EMAIL:-184503511+yaoyao368345@users.noreply.github.com}"
git add -- state manifests README.md .gitignore "$PRIVATE_MARKER"

if git diff --cached --quiet; then
  die "没有可提交的变化（这不应发生，因为每次都有新 manifest）"
fi

# 提交前再确认 remote 与私有属性
assert_private_remote "$PRIVATE_DIR"
assert_private_repo

git commit -q -m "backup: ${STAMP}" || die "git commit 失败"
LOCAL_SHA="$(git rev-parse HEAD)"
log "推送到 ${PRIVATE_SLUG}"
git push -q origin "$PRIVATE_BRANCH" || die "git push 失败"
REMOTE_SHA="$(git ls-remote origin "refs/heads/${PRIVATE_BRANCH}" | awk '{print $1}')"
[ "$REMOTE_SHA" = "$LOCAL_SHA" ] || die "远端 SHA 与本地不一致：local=${LOCAL_SHA} remote=${REMOTE_SHA}"

# 推送后再确认私有属性
assert_private_repo

FILES="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["summary"]["file_count"])' "$TMP/manifest.json")"
BYTES="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["summary"]["total_bytes"])' "$TMP/manifest.json")"
ok "私有备份完成"
printf '  备份 ID   %s\n  提交 SHA  %s\n  文件数    %s\n  总大小    %s 字节\n  仓库      https://github.com/%s\n' \
  "$STAMP" "$LOCAL_SHA" "$FILES" "$BYTES" "$PRIVATE_SLUG"
