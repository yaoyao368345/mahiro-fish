#!/usr/bin/env bash
# 凭据扫描。只扫会被 Git 跟踪的文件（未初始化 Git 时扫白名单目录）。
# 发现真实密钥时退出码为 1；占位符与示例文本不算。
set -uo pipefail
cd "$(dirname "$0")/.."

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mapfile -d '' FILES < <(git ls-files -z)
else
  mapfile -d '' FILES < <(find . -type f \
    -not -path './.git/*' -not -path './node_modules/*' \
    -not -path './tests/tmp/*' -print0)
fi

[ "${#FILES[@]}" -gt 0 ] || { echo "没有可扫描的文件。"; exit 0; }

PATTERNS=(
  'sk-[A-Za-z0-9]{24,}'
  'sk-or-v1-[A-Za-z0-9]{20,}'
  '[0-9]{8,10}:[A-Za-z0-9_-]{35}'
  'gh[pousr]_[A-Za-z0-9]{30,}'
  'AKIA[0-9A-Z]{16}'
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'AIza[0-9A-Za-z_-]{35}'
)

hits=0
for pat in "${PATTERNS[@]}"; do
  while IFS= read -r line; do
    case "$line" in
      *REPLACE_ME*|*example*|*EXAMPLE*|*placeholder*|*你的*) continue ;;
    esac
    echo "潜在凭据：$line"
    hits=$((hits + 1))
  done < <(grep -nEI -- "$pat" "${FILES[@]}" 2>/dev/null || true)
done

# 真实配置值（不是占位符）出现在受版本控制的文件里也算问题。
while IFS= read -r line; do
  echo "真实配置值：$line"
  hits=$((hits + 1))
done < <(grep -nE '^(OWNER_TELEGRAM_ID|TELEGRAM_BOT_TOKEN|OPENROUTER_API_KEY|BREEZE_TTS_VOICE)=[^#[:space:]]+' "${FILES[@]}" 2>/dev/null \
  | grep -vE 'REPLACE_ME|100000000|123456789|voc_REPLACE|你的' || true)

# 可选的个人标识扫描：不要把真实称呼写进仓库。
# 在本地 shell 里临时设置，例如：
#   PERSONAL_PATTERNS='真实昵称|真实姓名' bash scripts/scan-secrets.sh
if [ -n "${PERSONAL_PATTERNS:-}" ]; then
  while IFS= read -r line; do
    echo "个人标识：$line"
    hits=$((hits + 1))
  done < <(grep -nIiE -- "$PERSONAL_PATTERNS" "${FILES[@]}" 2>/dev/null || true)
fi

if [ "$hits" -gt 0 ]; then
  echo
  echo "扫描发现 ${hits} 处可疑内容。不要提交，先脱敏。"
  exit 1
fi
echo "凭据扫描通过：未发现真实密钥或个人标识。"
