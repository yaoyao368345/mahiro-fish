#!/usr/bin/env bash
# 恢复工具。
#
#   sudo bash scripts/restore.sh --list
#       列出本机备份。
#   sudo bash scripts/restore.sh --from 20261114-160000
#       恢复那个时间点的所有已备份文件（状态库、配置、代码）。
#   sudo bash scripts/restore.sh --code
#       只把 dsh-fish 的 lib/ 恢复成未打补丁的 0.9.9。
#
# 恢复前会停止 dsh-web / dsh-telegram；结束后按原状态重新启动。
set -euo pipefail
source "$(dirname "$0")/lib.sh"

need_root
MODE=""
FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list) MODE=list ;;
    --from) MODE=from; FROM="${2:-}"; shift ;;
    --code) MODE=code ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
  shift
done

stop_services() {
  command -v systemctl >/dev/null 2>&1 || return 0
  systemctl stop dsh-telegram.service dsh-web.service 2>/dev/null || true
}
start_services() {
  command -v systemctl >/dev/null 2>&1 || return 0
  systemctl start dsh-web.service 2>/dev/null || true
  if ! grep -qE '^TELEGRAM_BOT_TOKEN=.+REPLACE_ME' "$BRIDGE_ENV_FILE" 2>/dev/null; then
    systemctl start dsh-telegram.service 2>/dev/null || true
  fi
}

case "$MODE" in
  list)
    echo "备份根目录：${BACKUP_ROOT}"
    find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -r || true
    ;;
  from)
    [ -n "$FROM" ] || die "用法：--from <时间戳>"
    SRC="${BACKUP_ROOT}/${FROM}"
    [ -d "$SRC" ] || die "找不到备份：$SRC"
    log "恢复备份 ${FROM}"
    stop_services
    # 备份目录保留绝对路径结构，例如 <stamp>/home/fish/.dsh-fish。
    (cd "$SRC" && find . \( -type f -o -type l \)) | while IFS= read -r rel; do
      rel="${rel#./}"
      dst="/${rel}"
      case "$dst" in
        "${FISH_HOME}"/*|/etc/mahiro-fish/*|/etc/systemd/system/dsh-*.service) ;;
        *) warn "跳过备份范围外的路径：$dst"; continue ;;
      esac
      mkdir -p "$(dirname "$dst")"
      cp -a "${SRC}/${rel}" "$dst"
      echo "  恢复 $dst"
    done
    chown -R "$FISH_USER:$FISH_USER" "${FISH_HOME}/.dsh-fish" "${FISH_HOME}/telegram-bridge" "${FISH_HOME}/.telegram-bridge" 2>/dev/null || true
    chmod 600 "$BRIDGE_ENV_FILE" 2>/dev/null || true
    systemctl daemon-reload 2>/dev/null || true
    start_services
    ok "恢复完成"
    ;;
  code)
    log "恢复 dsh-fish 0.9.9 原始 lib/"
    stop_services
    bash "${REPO_DIR}/dsh-fish/patches/restore.sh" "$FISH_PKG"
    systemctl daemon-reload 2>/dev/null || true
    start_services
    ok "已撤销补丁；新增模块已移除"
    ;;
  *)
    sed -n '2,14p' "$0"
    exit 1
    ;;
esac
