#!/usr/bin/env bash
# 回滚到 0.9.9 原始 lib（仅用于撤销本补丁；不要在升级后的版本上运行）。
#
# 优先使用同目录的 orig/package/lib（本地开发时）；
# 否则从 npm 下载固定的 0.9.9 tarball，校验 SHA256 后解出 lib。
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="${1:-/var/lib/fish/.dsh/profiles/web/node_modules/@ssamurias/dsh-fish}"
TARBALL_SHA256="71835c673557d14e992577d1c4f255816b4cc0bce74fe874f47c17b11c0e487d"

[ -d "$PKG/lib" ] || { echo "找不到 $PKG/lib；无法回滚。" >&2; exit 1; }

SRC="$DIR/orig/package/lib"
TMP=""
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; }
trap cleanup EXIT

if [ ! -d "$SRC" ]; then
  command -v npm >/dev/null 2>&1 || { echo "缺少 npm，无法下载 0.9.9；请手动恢复。" >&2; exit 1; }
  TMP="$(mktemp -d)"
  echo "下载 @ssamurias/dsh-fish@0.9.9 原始包…"
  (cd "$TMP" && npm pack --silent @ssamurias/dsh-fish@0.9.9 >/dev/null)
  tgz="$(find "$TMP" -maxdepth 1 -name '*.tgz' | head -1)"
  [ -n "$tgz" ] || { echo "下载失败。" >&2; exit 1; }
  echo "${TARBALL_SHA256}  ${tgz}" | sha256sum -c - >/dev/null || {
    echo "tarball 校验失败，拒绝回滚。" >&2; exit 1;
  }
  tar -xzf "$tgz" -C "$TMP"
  SRC="$TMP/package/lib"
fi

cp -a "$PKG/lib" "$PKG/lib.before-restore.$(date +%Y%m%d-%H%M%S)"
rm -rf "$PKG/lib"
cp -a "$SRC" "$PKG/lib"
echo "已恢复 0.9.9 原始 lib；原 lib 备份在 $PKG/lib.before-restore.*"
