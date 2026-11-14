#!/usr/bin/env bash
# 公共 shell 工具。被其他脚本 source，不单独执行。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FISH_USER="${FISH_USER:-fish}"
FISH_HOME="${FISH_HOME:-/home/${FISH_USER}}"
DSH_HOME="${DSH_HOME:-${FISH_HOME}/.dsh}"
FISH_ROOT="${FISH_ROOT:-${FISH_HOME}/.dsh-fish}"
NODE_VERSION="${NODE_VERSION:-24.22.3}"
NODE_PREFIX="${NODE_PREFIX:-/opt/nodejs/v${NODE_VERSION}}"
NODE_BIN="${NODE_BIN:-${NODE_PREFIX}/bin}"
DSH_VERSION="${DSH_VERSION:-0.2.1-rc.3}"
DSH_FISH_VERSION="${DSH_FISH_VERSION:-0.9.9}"
SUBS_VERSION="${SUBS_VERSION:-0.9.13}"
PNPM_VERSION="${PNPM_VERSION:-11.28.5}"
PROFILE_DIR="${PROFILE_DIR:-${DSH_HOME}/profiles/web}"
FISH_PKG="${FISH_PKG:-${PROFILE_DIR}/node_modules/@ssamurias/dsh-fish}"
DSH_ENV_FILE="${DSH_ENV_FILE:-/etc/mahiro-fish/dsh.env}"
BRIDGE_ENV_FILE="${BRIDGE_ENV_FILE:-${FISH_HOME}/.telegram-bridge.env}"
BACKUP_ROOT="${BACKUP_ROOT:-${FISH_HOME}/.mahiro-fish-backups}"
: "${MAHIRO_BACKUP_STAMP:=$(date +%Y%m%d-%H%M%S)}"
export MAHIRO_BACKUP_STAMP

log()  { printf '\033[1;36m[mahiro-fish]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  !\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

need_root() { [ "$(id -u)" -eq 0 ] || die "请用 root 执行（sudo bash $0 ...）"; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"; }

run_as_fish() {
  local envs=("HOME=${FISH_HOME}" "PATH=${NODE_BIN}:${FISH_HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin")
  [ -n "${DSH_HOME:-}" ] && envs+=("DSH_HOME=${DSH_HOME}")
  runuser -u "$FISH_USER" -- env "${envs[@]}" "$@"
}

# 备份一个文件或目录；存在才备份。备份路径保留原绝对路径结构。
backup_path() {
  local src="$1" stamp dest
  [ -e "$src" ] || return 0
  stamp="${MAHIRO_BACKUP_STAMP:-$(date +%Y%m%d-%H%M%S)}"
  dest="${BACKUP_ROOT}/${stamp}${src}"
  mkdir -p "$(dirname "$dest")"
  cp -a "$src" "$dest"
  printf '%s\n' "$dest"
}

rotate_log() {
  local f="$1"
  [ -f "$f" ] || return 0
  [ "$(stat -c%s "$f")" -gt 5242880 ] || return 0
  mv -f "$f" "$f.1"
}

file_mode() { stat -c '%a' "$1" 2>/dev/null || echo '?'; }

ensure_secure_file() {
  local f="$1"
  [ -e "$f" ] || return 0
  chown "$FISH_USER:$FISH_USER" "$f"
  chmod 600 "$f"
}

render_template() {
  local src="$1" dst="$2"
  sed \
    -e "s|__FISH_USER__|${FISH_USER}|g" \
    -e "s|__FISH_HOME__|${FISH_HOME}|g" \
    -e "s|__NODE_BIN__|${NODE_BIN}|g" \
    -e "s|__DSH_BIN__|${NODE_BIN}/dsh|g" \
    -e "s|__DSH_ENV__|${DSH_ENV_FILE}|g" \
    "$src" >"$dst"
}

print_paths() {
  cat <<EOF
  FISH_USER      ${FISH_USER}
  FISH_HOME      ${FISH_HOME}
  DSH_HOME       ${DSH_HOME}
  FISH_ROOT      ${FISH_ROOT}
  PROFILE_DIR    ${PROFILE_DIR}
  FISH_PKG       ${FISH_PKG}
  DSH_ENV_FILE   ${DSH_ENV_FILE}
  BRIDGE_ENV     ${BRIDGE_ENV_FILE}
  BACKUP_ROOT    ${BACKUP_ROOT}
EOF
}
