#!/usr/bin/env bash
# 给 dsh-fish 0.9.9 应用本项目补丁。可重复执行。
set -euo pipefail
source "$(dirname "$0")/lib.sh"

PATCH_DIR="${REPO_DIR}/dsh-fish/patches"
PATCH_FILE="${PATCH_DIR}/dsh-fish-0.9.9-m2.4-m2.12.patch"
SUMS="${PATCH_DIR}/CHECKSUMS.sha256"
TARGET="${1:-${FISH_PKG}}"

[ -d "$TARGET" ] || die "找不到 dsh-fish 安装目录：$TARGET"
[ -f "$PATCH_FILE" ] || die "找不到补丁：$PATCH_FILE"
need_cmd patch
need_cmd sha256sum

ver="$(node -e "console.log(require('${TARGET}/package.json').version)" 2>/dev/null || true)"
[ "$ver" = "$DSH_FISH_VERSION" ] || die "dsh-fish 版本是 ${ver:-未知}，本补丁只适用于 ${DSH_FISH_VERSION}。请先安装固定版本，或升级补丁。"

log "检查补丁状态：$TARGET"
if (cd "$TARGET" && sha256sum -c "$SUMS" >/dev/null 2>&1); then
  ok "补丁已经完整应用（校验和全部匹配），跳过。"
  exit 0
fi

# 已经打了一半的补丁不能硬来；先恢复再重打。
if ! (cd "$TARGET" && patch -p1 --dry-run <"$PATCH_FILE" >/dev/null 2>&1); then
  die "补丁无法干净应用（可能已部分应用或被改过）。先执行 dsh-fish/patches/restore.sh，再重试。"
fi

log "备份现有 lib/ 到 ${BACKUP_ROOT}"
backup_path "${TARGET}/lib" >/dev/null

log "应用补丁（dry-run → apply）"
(cd "$TARGET" && patch -p1 --dry-run <"$PATCH_FILE" >/dev/null)
(cd "$TARGET" && patch -p1 <"$PATCH_FILE" >/dev/null)

log "校验补丁结果"
(cd "$TARGET" && sha256sum -c "$SUMS")
ok "dsh-fish 补丁应用完成。重启 dsh-web 后生效。"
