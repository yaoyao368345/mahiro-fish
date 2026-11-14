# 语音：识别与合成

语音是可选功能。默认只回文字。没有麦克风、没有 TTS Key、没有 Plus 账号，
核心聊天仍然正常。

## 入站：语音识别（ASR）

### 固定依赖

| 组件 | 版本 | 许可证 |
| --- | --- | --- |
| sherpa-onnx | v1.13.8 linux-x64 shared-no-tts | Apache-2.0 |
| SenseVoice Small INT8 | zh-en-ja-ko-yue-int8-2024-07-17 | 见上游 |

安装：

```bash
sudo bash scripts/install-extras.sh --with-asr
```

脚本会：

1. 从固定 GitHub Release URL 下载两个压缩包；
2. 用 `config/asr-versions.env` 里的 SHA256 校验；
3. 解压到 `/home/fish/.local/sherpa-onnx/`；
4. 不改任何配置，需要你手动取消 `.telegram-bridge.env` 里的注释。

默认路径：

```text
/home/fish/.local/sherpa-onnx/
├── sherpa-onnx-v1.13.8-linux-x64-shared-no-tts/
│   ├── bin/sherpa-onnx-offline
│   └── lib/
└── sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/
    ├── model.int8.onnx
    └── tokens.txt
```

配置：

```dotenv
ASR_BIN=/home/fish/.local/sherpa-onnx/sherpa-onnx-v1.13.8-linux-x64-shared-no-tts/bin/sherpa-onnx-offline
ASR_LIB=/home/fish/.local/sherpa-onnx/sherpa-onnx-v1.13.8-linux-x64-shared-no-tts/lib
ASR_MODEL=/home/fish/.local/sherpa-onnx/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx
ASR_TOKENS=/home/fish/.local/sherpa-onnx/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/tokens.txt
FFMPEG_BIN=/usr/bin/ffmpeg
VOICE_MAX_SEC=60
VOICE_MAX_BYTES=5242880
```

### 处理流程

1. Telegram `voice` → `getFile` → 临时 OGG。
2. FFmpeg 转 16k mono WAV。
3. sherpa-onnx + SenseVoice（auto 语言，2 线程）。
4. 转写文本前加“（语音转写，可能有误）”。
5. 走 `/dsh-fish/say`，默认只回文字。
6. 临时文件在成功/失败后删除。

超过 60 秒或 5MB 的语音会被拒绝，并回一句提示。

### 手动测试

```bash
B=/home/fish/.local/sherpa-onnx/sherpa-onnx-v1.13.8-linux-x64-shared-no-tts
O=/home/fish/.local/sherpa-onnx/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17
LD_LIBRARY_PATH="$B/lib" "$B/bin/sherpa-onnx-offline" \
  --tokens="$O/tokens.txt" \
  --sense-voice-model="$O/model.int8.onnx" \
  --sense-voice-language=auto \
  --num-threads=2 \
  /path/to/16k-mono.wav
```

## 出站：语音合成（TTS）

### 默认：关闭

```dotenv
TTS_PROVIDER=off
```

只回文字。

### OpenRouter 免费 TTS（推荐给没有本地算力的人）

```dotenv
TTS_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-你的Key
OPENROUTER_TTS_MODEL=heygen/heygen-voice-1-turbo:free
OPENROUTER_TTS_VOICE=noelle
```

- 请求 `POST https://openrouter.ai/api/v1/audio/speech`。
- HeyGen 返回 PCM，桥用 FFmpeg 转 48kHz mono OGG/Opus 32kbps。
- 免费模型可能限流或下线；失败时回退文字，不会自动切到收费模型。

### 本地 Kokoro（可选，较慢）

需要额外下载：

- `sherpa-onnx v1.13.8 linux-x64 shared`
- `kokoro-int8-multi-lang-v1_1`（`sid=47` = `zf_xiaoxiao`）

2C4G 实测 RTF 约 1.77，14 秒音频要 25 秒，所以默认不用，也不作为云端失败
时的回退。

```dotenv
TTS_PROVIDER=local
TTS_BIN=/home/fish/.local/sherpa-onnx/sherpa-onnx-v1.13.8-linux-x64-shared/bin/sherpa-onnx-offline-tts
TTS_LIB=/home/fish/.local/sherpa-onnx/sherpa-onnx-v1.13.8-linux-x64-shared/lib
TTS_DIR=/home/fish/.local/sherpa-onnx/kokoro-int8-multi-lang-v1_1
TTS_SID=47
```

### Breeze Blue（自带音色）

Breeze 支持自定义/克隆音色。**克隆音色属于私人凭据，不要提交到 Git。**

Key 单独放在 `~/.breezeblue.env`（0600）：

```dotenv
BREEZE_API_KEY=...
```

`.telegram-bridge.env`：

```dotenv
TTS_PROVIDER=breeze
BREEZE_TTS_MODEL=breeze-tts-2
BREEZE_TTS_VOICE=voc_你的音色ID
BREEZE_TTS_SPEED=1.03
BREEZE_TTS_GUIDANCE=2.0
BREEZE_TTS_INSTRUCTIONS=用自然、清楚、稍微轻快的年轻女性语气说普通话，语气跟着当时的语境走。
```

仓库里的 `BREEZE_TTS_VOICE` 故意留空；不要把自己的音色 ID 写进公开文件。

## 自主语音策略

她可以在同一轮里自己决定用文字还是声音，不需要第二次 LLM 请求。

- 工具：`her_voice`。
- 只写内存请求，不进事件流、不改回复、不留“我要发语音”的文字。
- `/say` 返回 `voiceRequested: true`，桥用这一轮的真实回复合成。

策略（`voicepolicy.mjs`）：

| 限制 | 值 |
| --- | --- |
| 模式 | `auto` / `request_only` / `off` |
| 每日自主语音 | 3 条 |
| 两条间隔 | 至少 30 分钟 |
| 时段 | 09:00–23:00（Asia/Hong_Kong） |
| 单条长度 | 150 字 |

明确要求语音不计入这 3 条；`request_only` 只在她被明确要求时出声；
`off` 全部关闭。失败、额度满、夜间、太长都回退文字，不重复合成。

偏好保存在 `~/.telegram-bridge/voice-prefs.json`，计数在
`voice-usage.json`（均 0600）。

主人可以说：

- “以后可以多用语音” → `auto`
- “先不要主动发语音了” → `request_only`
- “关闭语音” → `off`
- “这条用文字回答” → 只影响这一轮

桥不提供模型改额度的入口。

## 失败行为

| 情况 | 行为 |
| --- | --- |
| ASR 未安装/路径错 | 回“这条语音没听清，能再说一遍吗？” |
| 语音太长/太大 | 回“语音文件太大了/太长了” |
| TTS 未配置 | 只回文字 |
| TTS 失败/限流 | 回退文字，最多重试 2 次 |
| 夜间/额度满/太长 | 回退文字 |
| 合成成功但发送失败 | 记录失败，不重复合成 |

## 隐私

- 语音临时文件在处理后删除。
- TTS 文本会发给所选云端服务；不想外发就用本地或关闭 TTS。
- 克隆音色的 ID、Key、试听音频都不进入仓库。
- 日志不打印 Key；只记录 provider、字符数、耗时、失败原因。
