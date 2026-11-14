#!/usr/bin/env bash
# 安装后自检。可重复执行；不会修改线上数据。
set -uo pipefail
source "$(dirname "$0")/lib.sh"
export PATH="${NODE_BIN}:$PATH"

FAIL=0
pass() { ok "$*"; }
fail() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; FAIL=$((FAIL+1)); }
check() { if eval "$1" >/dev/null 2>&1; then pass "$2"; else fail "$2"; fi; }

echo "== 路径 =="
print_paths
echo

echo "== 版本 =="
check "[ \"\$(${NODE_BIN}/node -v 2>/dev/null)\" = \"v${NODE_VERSION}\" ]" "Node v${NODE_VERSION}"
check "[ -x ${NODE_BIN}/dsh ]" "DSH CLI 存在"
check "[ \"\$(${NODE_BIN}/dsh --version 2>/dev/null)\" = \"${DSH_VERSION}\" ]" "DSH ${DSH_VERSION}"
check "[ -f ${FISH_PKG}/package.json ]" "dsh-fish 已安装"
if [ -f "${FISH_PKG}/package.json" ]; then
  v="$(node -e "console.log(require('${FISH_PKG}/package.json').version)" 2>/dev/null || echo '')"
  [ "$v" = "$DSH_FISH_VERSION" ] && pass "dsh-fish ${DSH_FISH_VERSION}" || fail "dsh-fish 版本是 ${v:-未知}，期望 ${DSH_FISH_VERSION}"
fi
check "[ -d ${PROFILE_DIR}/node_modules/dsh-plugin-subscriptions ]" "subscriptions 插件已安装"

echo
echo "== 补丁 =="
if (cd "$FISH_PKG" 2>/dev/null && sha256sum -c "${REPO_DIR}/dsh-fish/patches/CHECKSUMS.sha256" >/dev/null 2>&1); then
  pass "dsh-fish 补丁校验和全部匹配"
else
  fail "dsh-fish 补丁未应用或文件被改动"
fi
for f in draw.js selfavatar.js life.js mediaindex.js mediarecall.js sub.js voice.js; do
  check "[ -f ${FISH_PKG}/lib/${f} ]" "新增模块 lib/${f}"
done

echo
echo "== 服务 =="
if [ "${MAHIRO_SKIP_SERVICE_CHECK:-0}" = 1 ]; then
  warn "跳过服务检查（MAHIRO_SKIP_SERVICE_CHECK=1）"
elif command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  check "systemctl is-active --quiet dsh-web" "dsh-web 正在运行"
  check "systemctl is-active --quiet dsh-telegram" "dsh-telegram 正在运行"
  check "curl -sS --max-time 5 http://127.0.0.1:3080/ >/dev/null" "DSH Web 127.0.0.1:3080 可访问"
else
  warn "没有 systemd，跳过服务检查"
fi

echo
echo "== 人格 =="
if [ -s "${FISH_ROOT}/events.jsonl" ] && head -c 200000 "${FISH_ROOT}/events.jsonl" | grep -q '"type":"seed"'; then
  pass "事件流里有 seed"
  if head -c 200000 "${FISH_ROOT}/events.jsonl" | grep -q '绪山真寻'; then
    pass "seed 是绪山真寻"
  else
    fail "seed 里没有找到绪山真寻"
  fi
else
  fail "没有找到人格 seed（可能还没导入）"
fi

echo
echo "== 权限 =="
for f in "$DSH_ENV_FILE" "$BRIDGE_ENV_FILE" "${FISH_ROOT}/owner.json"; do
  if [ -e "$f" ]; then
    m="$(file_mode "$f")"
    [ "$m" = "600" ] && pass "$(basename "$f") 权限 600" || fail "$(basename "$f") 权限是 $m，期望 600"
  fi
done
# events.jsonl 由插件创建（常见 644），但父目录必须是 700，别人进不来。
hm="$(file_mode "$FISH_HOME")"
[ "$hm" = "700" ] && pass "HOME 目录权限 700" || fail "HOME 目录权限是 $hm，期望 700"

echo
echo "== 语法与测试 =="
for f in "$REPO_DIR"/telegram-bridge/*.mjs "$REPO_DIR"/scripts/*.mjs; do
  if "${NODE_BIN}/node" --check "$f" >/dev/null 2>&1; then pass "语法 $(basename "$f")"; else fail "语法 $(basename "$f")"; fi
done
if (cd "$REPO_DIR" && "${NODE_BIN}/node" --test tests/*.test.mjs >/dev/null 2>&1); then
  pass "基础测试通过"
else
  fail "基础测试未通过（运行 node --test tests/ 查看）"
fi

echo
echo "== 凭据扫描 =="
if bash "${REPO_DIR}/scripts/scan-secrets.sh"; then pass "凭据扫描通过"; else fail "凭据扫描未通过"; fi

echo
if [ "$FAIL" -gt 0 ]; then
  echo "自检完成：${FAIL} 项失败。" >&2
  exit 1
fi
echo "自检完成：全部通过。"
