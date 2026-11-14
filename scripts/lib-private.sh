#!/usr/bin/env bash
# 私有备份脚本的共享函数。被 backup/restore/verify source，不单独执行。
set -euo pipefail

PRIVATE_SLUG="${PRIVATE_SLUG:-yaoyao368345/mahiro-fish-private-backup}"
PRIVATE_BRANCH="${PRIVATE_BRANCH:-main}"
PRIVATE_MARKER=".mahiro-fish-private-backup"
PUBLIC_SLUG="${PUBLIC_SLUG:-yaoyao368345/mahiro-fish}"

private_repo_json() {
  gh api "repos/${PRIVATE_SLUG}" 2>/dev/null
}

assert_private_repo() {
  local json private visibility
  json="$(private_repo_json)" || die "无法读取私有仓库 ${PRIVATE_SLUG}（检查 gh auth）"
  private="$(printf '%s' "$json" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("private")).lower())')"
  visibility="$(printf '%s' "$json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("visibility",""))')"
  [ "$private" = "true" ] || die "目标仓库不是私有：${PRIVATE_SLUG}（private=${private}）"
  [ "$visibility" = "private" ] || die "目标仓库 visibility 不是 private：${visibility}"
  ok "仓库私有属性已验证：private=true, visibility=private"
}

assert_private_remote() {
  local dir="$1" url
  url="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  case "$url" in
    "https://github.com/${PRIVATE_SLUG}.git"|"https://github.com/${PRIVATE_SLUG}"|"git@github.com:${PRIVATE_SLUG}.git")
      ;;
    *) die "Git remote 不是私有备份仓库：${url:-<空>}。拒绝操作。" ;;
  esac
}

ensure_private_repo_dir() {
  local dir="$1"
  if [ ! -d "$dir/.git" ]; then
    log "克隆私有备份仓库到 ${dir}"
    gh repo clone "$PRIVATE_SLUG" "$dir" >/dev/null 2>&1 || die "克隆私有仓库失败"
  fi
  assert_private_remote "$dir"
  git -C "$dir" fetch origin "$PRIVATE_BRANCH" >/dev/null 2>&1 || true
  if git -C "$dir" rev-parse --verify "origin/${PRIVATE_BRANCH}" >/dev/null 2>&1; then
    git -C "$dir" checkout -q -B "$PRIVATE_BRANCH" "origin/${PRIVATE_BRANCH}"
  elif git -C "$dir" rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C "$dir" checkout -q -B "$PRIVATE_BRANCH"
  else
    git -C "$dir" symbolic-ref HEAD "refs/heads/${PRIVATE_BRANCH}"
  fi
}

# 第一次使用时，空仓库或本工具创建的仓库才允许写入，避免推错已有项目。
assert_repo_is_ours_or_empty() {
  local dir="$1"
  if [ -f "$dir/$PRIVATE_MARKER" ]; then return 0; fi
  if ! git -C "$dir" rev-parse --verify HEAD >/dev/null 2>&1; then return 0; fi
  if [ -z "$(git -C "$dir" ls-tree --name-only HEAD 2>/dev/null)" ]; then return 0; fi
  die "私有仓库已有内容且没有 ${PRIVATE_MARKER} 标记。为避免覆盖其他项目，已停止。"
}

# 校验 manifest 里的每个文件：路径、SHA256、大小。
verify_manifest() {
  local repo_dir="$1" manifest="$2"
  python3 - "$repo_dir" "$manifest" <<'PY'
import hashlib, json, os, sys
repo, mf = sys.argv[1], sys.argv[2]
m = json.load(open(mf))
files = m.get('files')
if not isinstance(files, list) or not files:
    raise SystemExit('manifest 没有文件列表')
total = 0
for f in files:
    p = str(f.get('path', ''))
    if not p.startswith('state/') or '..' in p.split('/'):
        raise SystemExit(f'非法路径：{p}')
    abs = os.path.join(repo, p)
    if not os.path.isfile(abs):
        raise SystemExit(f'缺少文件：{p}')
    h = hashlib.sha256(open(abs, 'rb').read()).hexdigest()
    if h != f.get('sha256'):
        raise SystemExit(f'SHA256 不匹配：{p}')
    if os.path.getsize(abs) != int(f.get('bytes', -1)):
        raise SystemExit(f'大小不匹配：{p}')
    total += os.path.getsize(abs)
print(f"manifest 校验通过：{len(files)} 个文件，{total} 字节")
PY
}

# 校验快照内容：JSON 可解析、JSONL 每行可解析、zstd 完整。
validate_snapshot_tree() {
  local root="$1"
  python3 - "$root" <<'PY'
import json, os, sys
root = sys.argv[1]
for dirpath, _, names in os.walk(root):
    for n in names:
        p = os.path.join(dirpath, n)
        if n.endswith('.json'):
            try: json.load(open(p))
            except Exception as e: raise SystemExit(f'JSON 损坏：{p}: {e}')
        elif n.endswith('.jsonl'):
            for i, line in enumerate(open(p, 'rb'), 1):
                if not line.strip(): continue
                try: json.loads(line)
                except Exception as e: raise SystemExit(f'JSONL 损坏：{p}:{i}: {e}')
PY
  while IFS= read -r -d '' f; do
    zstd -t "$f" >/dev/null 2>&1 || die "zstd 文件损坏：$f"
  done < <(find "$root" -type f -name '*.zstd' -print0)
}

# 扫描快照里的高信号凭据。命中时只报告文件名/模式，不打印密钥本身。
scan_private_tree() {
  local root="$1"
  local patterns=(
    'sk-[A-Za-z0-9]{24,}'
    'sk-or-v1-[A-Za-z0-9]{20,}'
    '[0-9]{8,10}:[A-Za-z0-9_-]{35}'
    'gh[pousr]_[A-Za-z0-9]{30,}'
    'AKIA[0-9A-Z]{16}'
    '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
    'SESSDATA=|bili_jct=|DedeUserID='
    'voc_[a-z0-9]{12,}'
  )
  local hits=0 f p
  while IFS= read -r -d '' f; do
    case "$f" in
      *.png|*.jpg|*.jpeg|*.webp|*.gif) continue ;;
    esac
    if [[ "$f" == *.zstd ]]; then
      for p in "${patterns[@]}"; do
        if zstd -dc "$f" 2>/dev/null | grep -aqE -- "$p"; then
          echo "  可疑内容：${f#${root}/}（模式 ${p}）"
          hits=$((hits+1))
        fi
      done
    else
      for p in "${patterns[@]}"; do
        if grep -aqE -- "$p" "$f" 2>/dev/null; then
          echo "  可疑内容：${f#${root}/}（模式 ${p}）"
          hits=$((hits+1))
        fi
      done
    fi
  done < <(find "$root" -type f -print0)
  [ "$hits" -eq 0 ] || return 1
}

assert_no_forbidden_names() {
  local root="$1"
  local bad
  bad="$(find "$root" -type f \( \
    -name 'owner.json' -o -name 'auth.json' -o -name 'credentials.yaml' \
    -o -name '.credentials.yaml' -o -name '.env' -o -name '.telegram-bridge.env' \
    -o -name '.breezeblue.env' -o -name '*.pem' -o -name 'id_rsa' \) -print)"
  [ -z "$bad" ] || die "快照里出现禁止文件：${bad}"
}

assert_public_repo_clean() {
  local paths
  paths="$(gh api "repos/${PUBLIC_SLUG}/git/trees/main?recursive=1" --jq '.tree[].path' 2>/dev/null)" || die "无法读取公开仓库文件树"
  if printf '%s\n' "$paths" | grep -qE '^(state|manifests|snapshot)/|(^|/)(events\.jsonl|owner\.json|auth\.json|credentials\.yaml|\.telegram-bridge\.env|bridge\.log)$'; then
    die "公开仓库里发现疑似私人备份内容"
  fi
  ok "公开仓库没有私人备份内容"
}
