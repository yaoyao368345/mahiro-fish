#!/usr/bin/env bash
# 把 M2.4 + M2.6 + M2.7 的 dsh-fish 0.9.9 改动应用到当前 profile。
# 只适用于 dsh-fish 0.9.9；不升级 DSH/插件。
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="${1:-/var/lib/fish/.dsh/profiles/web/node_modules/@ssamurias/dsh-fish}"
PATCH="$DIR/dsh-fish-0.9.9-m2.4-m2.12.patch"

cd "$PKG"
echo "== dry-run =="
patch -p1 --dry-run < "$PATCH"
echo "== apply =="
patch -p1 < "$PATCH"
echo "== checksums =="
sha256sum -c "$DIR/CHECKSUMS.sha256"
echo "OK. 重启 dsh-web 后 her_media / 主动材料 / 媒体维护才生效。"
