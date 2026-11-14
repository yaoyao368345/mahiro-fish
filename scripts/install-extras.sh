#!/usr/bin/env bash
# 安装可选依赖。
#   --with-asr      安装 sherpa-onnx + SenseVoice（约 180MB）
#   --with-kokoro   安装本地 Kokoro TTS（约 290MB，2C4G 上较慢）
set -euo pipefail
source "$(dirname "$0")/lib.sh"

WITH_ASR=0
WITH_KOKORO=0
for a in "$@"; do
  case "$a" in
    --with-asr) WITH_ASR=1 ;;
    --with-kokoro) WITH_KOKORO=1 ;;
    *) die "未知参数：$a" ;;
  esac
done

need_root
need_cmd curl
need_cmd sha256sum
need_cmd tar

DEST="${FISH_HOME}/.local/sherpa-onnx"
mkdir -p "$DEST"
chown -R "$FISH_USER:$FISH_USER" "$FISH_HOME/.local"

source "${REPO_DIR}/config/asr-versions.env"

fetch_verified() {
  local url="$1" sha="$2" asset="$3" tmp
  tmp="$(mktemp -d)"
  log "下载 ${asset}"
  curl -fL --retry 3 --connect-timeout 15 -o "${tmp}/${asset}" "$url"
  echo "${sha}  ${tmp}/${asset}" | sha256sum -c - >/dev/null || die "校验失败：${asset}"
  tar -xjf "${tmp}/${asset}" -C "$DEST"
  rm -rf "$tmp"
  ok "${asset} 已解压到 ${DEST}"
}

if [ "$WITH_ASR" = 1 ]; then
  if [ -x "${DEST}/sherpa-onnx-v${SHERPA_VERSION}-linux-x64-shared-no-tts/bin/sherpa-onnx-offline" ] &&
     [ -f "${DEST}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx" ]; then
    ok "SenseVoice ASR 已存在，跳过。"
  else
    fetch_verified "$SHERPA_URL" "$SHERPA_SHA256" "$SHERPA_ASSET"
    fetch_verified "$SENSEVOICE_URL" "$SENSEVOICE_SHA256" "$SENSEVOICE_ASSET"
  fi
  chown -R "$FISH_USER:$FISH_USER" "$DEST"
fi

if [ "$WITH_KOKORO" = 1 ]; then
  KOKORO_DIR="${DEST}/kokoro-int8-multi-lang-v1_1"
  KOKORO_TOOL="${DEST}/sherpa-onnx-v1.13.8-linux-x64-shared"
  if [ -d "$KOKORO_DIR" ] && [ -x "${KOKORO_TOOL}/bin/sherpa-onnx-offline-tts" ]; then
    ok "Kokoro TTS 已存在，跳过。"
  else
    warn "Kokoro 资源较大，且 2C4G 上合成速度慢；本项目默认只推荐云端 TTS。"
    warn "如需安装，请按 docs/voice.md 的链接手动下载这两个固定版本："
    warn "  sherpa-onnx v1.13.8 linux-x64 shared"
    warn "  kokoro-int8-multi-lang-v1_1"
  fi
fi

ok "可选依赖处理完成。"
