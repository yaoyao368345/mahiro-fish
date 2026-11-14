#!/usr/bin/env bash
# mahiro-fish 一键安装（Debian 12/13，可重复执行）。
#
# 用法：
#   sudo bash scripts/install.sh                 # 核心功能 + 自动导入初始人格
#   sudo bash scripts/install.sh --with-asr      # 额外安装本地语音识别
#   sudo bash scripts/install.sh --no-persona    # 只装环境，不导入人格
#   sudo bash scripts/install.sh --no-start      # 装完不启动 systemd
#
# 所有会覆盖的文件都会先备份到 $FISH_HOME/.mahiro-fish-backups/<时间>/。
set -euo pipefail
source "$(dirname "$0")/lib.sh"

WITH_ASR=0
WITH_PERSONA=1
DO_START=1
FORCE_CONFIG=0
WITH_SYSTEMD=1
SKIP_APT=0
for a in "$@"; do
  case "$a" in
    --with-asr) WITH_ASR=1 ;;
    --no-persona) WITH_PERSONA=0 ;;
    --no-start) DO_START=0 ;;
    --no-systemd) WITH_SYSTEMD=0; DO_START=0 ;;
    --skip-apt) SKIP_APT=1 ;;
    --force-config) FORCE_CONFIG=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) die "未知参数：$a" ;;
  esac
done

need_root
[ -r /etc/os-release ] || die "无法识别系统"
. /etc/os-release
case "${ID:-}" in
  debian|ubuntu) ;;
  *) die "本项目只在 Debian/Ubuntu 上测试过，当前是 ${ID:-unknown}。" ;;
esac
[ "$(uname -m)" = "x86_64" ] || die "当前只提供 linux-x64 的固定依赖。"

log "mahiro-fish 安装开始"
print_paths

# ---------------------------------------------------------------- 1. 系统依赖
if [ "$SKIP_APT" = 1 ]; then
  warn "跳过 apt 安装（--skip-apt）"
else
  log "安装系统依赖（git / curl / ffmpeg / patch / tar / xz）"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git ffmpeg patch tar xz-utils bzip2 procps >/dev/null
  ok "系统依赖就绪"
fi

# ---------------------------------------------------------------- 2. 用户
if ! id "$FISH_USER" >/dev/null 2>&1; then
  log "创建用户 ${FISH_USER}"
  useradd --create-home --home-dir "$FISH_HOME" --shell /bin/bash "$FISH_USER"
  ok "用户 ${FISH_USER} 已创建"
else
  ok "用户 ${FISH_USER} 已存在"
fi
install -d -m 700 -o "$FISH_USER" -g "$FISH_USER" "$FISH_HOME"
install -d -m 700 -o "$FISH_USER" -g "$FISH_USER" "$BACKUP_ROOT"

# ---------------------------------------------------------------- 3. Node
if [ -x "${NODE_BIN}/node" ] && [ "$("${NODE_BIN}/node" -v 2>/dev/null)" = "v${NODE_VERSION}" ]; then
  ok "Node.js v${NODE_VERSION} 已存在"
else
  log "安装 Node.js v${NODE_VERSION} 到 ${NODE_PREFIX}"
  tmp="$(mktemp -d)"
  base="https://nodejs.org/dist/v${NODE_VERSION}"
  asset="node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl -fL --retry 3 --connect-timeout 15 -o "${tmp}/SHASUMS256.txt" "${base}/SHASUMS256.txt"
  curl -fL --retry 3 --connect-timeout 15 -o "${tmp}/${asset}" "${base}/${asset}"
  (cd "$tmp" && grep " ${asset}\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || die "Node.js 校验失败"
  tar -xJf "${tmp}/${asset}" -C "$tmp"
  mkdir -p "$(dirname "$NODE_PREFIX")"
  rm -rf "$NODE_PREFIX"
  mv "${tmp}/node-v${NODE_VERSION}-linux-x64" "$NODE_PREFIX"
  rm -rf "$tmp"
  ok "Node.js 已安装"
fi
export PATH="${NODE_BIN}:$PATH"

# ---------------------------------------------------------------- 4. DSH / pnpm
if ! "${NODE_BIN}/dsh" --version >/dev/null 2>&1; then
  log "安装 @deepseek-ai/dsh@${DSH_VERSION}"
  npm install -g --no-fund --no-audit "@deepseek-ai/dsh@${DSH_VERSION}" >/dev/null
else
  ok "DSH 已存在：$("${NODE_BIN}/dsh" --version 2>/dev/null || true)"
fi
if ! "${NODE_BIN}/pnpm" --version >/dev/null 2>&1; then
  log "安装 pnpm@${PNPM_VERSION}"
  npm install -g --no-fund --no-audit "pnpm@${PNPM_VERSION}" >/dev/null
else
  ok "pnpm 已存在：$("${NODE_BIN}/pnpm" --version)"
fi
chmod -R a+rX /opt/nodejs

# ---------------------------------------------------------------- 5. DSH profile
log "准备 DSH web profile"
install -d -m 700 -o "$FISH_USER" -g "$FISH_USER" "$DSH_HOME"
run_as_fish "${NODE_BIN}/dsh" --profile web --help >/dev/null 2>&1 || die "无法创建 web profile"
run_as_fish "${NODE_BIN}/dsh" plugin --profile web add "@ssamurias/dsh-fish@${DSH_FISH_VERSION}"
run_as_fish "${NODE_BIN}/dsh" plugin --profile web add "dsh-plugin-subscriptions@${SUBS_VERSION}"
ok "profile 依赖已固定：dsh-fish ${DSH_FISH_VERSION} / subscriptions ${SUBS_VERSION}"

# ---------------------------------------------------------------- 6. profile 配置
PATCH_DST="${PROFILE_DIR}/cordis.patch.yml"
trivial=1
if [ -f "$PATCH_DST" ]; then
  if grep -qvE '^[[:space:]]*(#|$|\[\])' "$PATCH_DST"; then trivial=0; fi
fi
if [ ! -f "$PATCH_DST" ] || [ "$trivial" = 1 ] || [ "$FORCE_CONFIG" = 1 ]; then
  backup_path "$PATCH_DST" >/dev/null
  install -m 600 -o "$FISH_USER" -g "$FISH_USER" "${REPO_DIR}/config/cordis.patch.yml" "$PATCH_DST"
  ok "已写入 profile 的 DeepSeek 配置"
else
  warn "profile 已有自定义 cordis.patch.yml，未覆盖（要覆盖请加 --force-config）"
fi

# ---------------------------------------------------------------- 7. 补丁
log "应用 dsh-fish 补丁"
bash "${REPO_DIR}/scripts/apply-patches.sh"
chown -R "$FISH_USER:$FISH_USER" "$FISH_PKG"

# ---------------------------------------------------------------- 8. Telegram 桥
log "安装 Telegram 桥"
install -d -m 700 -o "$FISH_USER" -g "$FISH_USER" "${FISH_HOME}/telegram-bridge"
for f in bridge.mjs outbox.mjs imageoutbox.mjs voicepolicy.mjs; do
  backup_path "${FISH_HOME}/telegram-bridge/${f}" >/dev/null
  install -m 644 -o "$FISH_USER" -g "$FISH_USER" "${REPO_DIR}/telegram-bridge/${f}" "${FISH_HOME}/telegram-bridge/${f}"
done
install -d -m 700 -o "$FISH_USER" -g "$FISH_USER" "${FISH_HOME}/.telegram-bridge"
install -d -m 700 -o "$FISH_USER" -g "$FISH_USER" "${FISH_HOME}/.dsh-web"
: >"${FISH_HOME}/.dsh-web/web.log"
chown "$FISH_USER:$FISH_USER" "${FISH_HOME}/.dsh-web/web.log"
chmod 600 "${FISH_HOME}/.dsh-web/web.log"
ok "桥模块已安装"

# ---------------------------------------------------------------- 9. 配置模板
install -d -m 750 -o root -g root "$(dirname "$DSH_ENV_FILE")"
if [ ! -f "$DSH_ENV_FILE" ]; then
  install -m 600 -o root -g root "${REPO_DIR}/config/dsh.env.example" "$DSH_ENV_FILE"
  warn "已创建 ${DSH_ENV_FILE}，请填入 DEEPSEEK_API_KEY"
else
  ok "保留已有 ${DSH_ENV_FILE}"
fi
if [ ! -f "$BRIDGE_ENV_FILE" ]; then
  install -m 600 -o "$FISH_USER" -g "$FISH_USER" "${REPO_DIR}/config/telegram-bridge.env.example" "$BRIDGE_ENV_FILE"
  warn "已创建 ${BRIDGE_ENV_FILE}，请填入 Bot Token 与 OWNER_TELEGRAM_ID"
else
  ensure_secure_file "$BRIDGE_ENV_FILE"
  ok "保留已有 ${BRIDGE_ENV_FILE}"
fi

# ---------------------------------------------------------------- 10. 初始配置
install -d -m 700 -o "$FISH_USER" -g "$FISH_USER" "$FISH_ROOT"
if [ ! -f "${FISH_ROOT}/config.json" ]; then
  install -m 600 -o "$FISH_USER" -g "$FISH_USER" "${REPO_DIR}/config/fish.example.json" "${FISH_ROOT}/config.json"
  ok "已写入默认 config.json"
fi

# ---------------------------------------------------------------- 11. 人格
if [ "$WITH_PERSONA" = 1 ]; then
  if [ -s "${FISH_ROOT}/events.jsonl" ]; then
    warn "状态库已有事件流，跳过人格导入（不会覆盖正在成长的她）"
  else
    log "导入初始绪山真寻人格"
    "${NODE_BIN}/node" "${REPO_DIR}/scripts/import-persona.mjs" \
      --pkg "$FISH_PKG" --root "$FISH_ROOT" \
      --persona "${REPO_DIR}/persona/mahiro-handover.md" --yes
    chown -R "$FISH_USER:$FISH_USER" "$FISH_ROOT"
    ok "初始人格已导入"
  fi
fi

# ---------------------------------------------------------------- 12. systemd
if [ "$WITH_SYSTEMD" = 1 ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  log "安装 systemd 服务"
  for unit in dsh-web dsh-telegram; do
    dst="/etc/systemd/system/${unit}.service"
    backup_path "$dst" >/dev/null
    render_template "${REPO_DIR}/config/systemd/${unit}.service.template" "$dst"
    chmod 644 "$dst"
  done
  systemctl daemon-reload
  systemctl enable dsh-web.service dsh-telegram.service >/dev/null

  if [ "$DO_START" = 1 ]; then
    systemctl restart dsh-web.service
    ok "dsh-web 已启动"
    if grep -qE '^TELEGRAM_BOT_TOKEN=.+REPLACE_ME' "$BRIDGE_ENV_FILE"; then
      warn "Telegram Token 还是占位符，暂不启动 dsh-telegram"
    else
      systemctl restart dsh-telegram.service
      ok "dsh-telegram 已启动"
    fi
  fi
else
  warn "没有检测到 systemd，跳过服务安装"
fi

# ---------------------------------------------------------------- 13. 可选依赖
if [ "$WITH_ASR" = 1 ]; then
  bash "${REPO_DIR}/scripts/install-extras.sh" --with-asr
  warn "记得在 ${BRIDGE_ENV_FILE} 里取消 ASR_* 注释"
fi

log "安装完成"
cat <<EOF

下一步：
  1. 编辑 ${DSH_ENV_FILE}，填入 DEEPSEEK_API_KEY。
  2. 编辑 ${BRIDGE_ENV_FILE}，填入 TELEGRAM_BOT_TOKEN 与 OWNER_TELEGRAM_ID。
  3. sudo bash ${REPO_DIR}/scripts/verify.sh
  4. systemctl restart dsh-web dsh-telegram

DSH Web 只监听 127.0.0.1:3080。用 SSH 隧道访问：
  ssh -L 3080:127.0.0.1:3080 <user>@<server>
然后打开 http://127.0.0.1:3080/ （首次启动会打印带 token 的登录链接）。

注意：本仓库备份的是代码与初始人格，不包含旧实例的聊天和成长数据。
真实数据的灾难恢复请使用独立的私有备份。
EOF
