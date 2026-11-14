#!/usr/bin/env bash
# 更新代码并重新应用固定版本补丁。不会动运行数据与密钥。
#
#   sudo bash scripts/update.sh              # git pull --ff-only + 重装
#   sudo bash scripts/update.sh --no-pull    # 只用当前 checkout 重装
set -euo pipefail
source "$(dirname "$0")/lib.sh"

need_root
PULL=1
INSTALL_ARGS=()
for a in "$@"; do
  case "$a" in
    --no-pull) PULL=0 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) INSTALL_ARGS+=("$a") ;;
  esac
done

if [ "$PULL" = 1 ]; then
  if git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log "拉取最新代码（--ff-only，不会覆盖本地改动）"
    git -C "$REPO_DIR" pull --ff-only
  else
    warn "不是 Git 仓库，跳过拉取"
  fi
fi

log "备份当前补丁后的 lib/ 与桥"
backup_path "${FISH_PKG}/lib" >/dev/null || true
backup_path "${FISH_HOME}/telegram-bridge" >/dev/null || true

log "重新运行安装（幂等）"
bash "${REPO_DIR}/scripts/install.sh" "${INSTALL_ARGS[@]}"

log "更新完成"
