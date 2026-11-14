# mahiro-fish

A reproducible, open-source deployment of the **Mahiro Oyama AI companion**:
DSH + dsh-fish + DeepSeek for daily conversation, a Telegram private-chat
bridge, autonomous check-ins, Bilibili browsing/frame capture/subtitles,
long-term media memory, ChatGPT image generation, and voice in/out.

> **Unofficial fan project.** The character is from *Onimai: I'm Now Your
> Sister!* (お兄ちゃんはおしまい！). This project is not affiliated with or
> endorsed by the original rights holders. It ships no anime screenshots,
> voice clips, character art, or long excerpts from the source material.

## What is inside

- `persona/mahiro-handover.md` — the exact initial Mahiro persona used at
  first import (the `seed` event), published as a template.
- `telegram-bridge/` — Telegram long-polling bridge, proactive-letter outbox,
  image outbox, and autonomous-voice policy.
- `dsh-fish/patches/` — a SHA256-verified patch for dsh-fish **0.9.9**,
  adding Bilibili vision/subtitles, media indexing, `her_draw`, and `her_voice`.
- `scripts/` — idempotent install / patch / verify / update / restore scripts.
- `config/` — sanitized config templates and systemd units.

Pinned versions: Node.js 24.22.3, DSH 0.2.1-rc.3, dsh-fish 0.9.9,
dsh-plugin-subscriptions 0.9.13, pnpm 11.28.5.

## Quick start

```bash
sudo git clone <repo-url> /opt/mahiro-fish
cd /opt/mahiro-fish
sudo bash scripts/install.sh
sudo nano /etc/mahiro-fish/dsh.env                  # DeepSeek API key
sudo -u fish nano /home/fish/.telegram-bridge.env    # Telegram bot token + owner ID
sudo bash scripts/verify.sh
sudo systemctl restart dsh-web dsh-telegram
```

Optional features are opt-in: Bilibili login, ChatGPT Plus image generation,
local ASR, and TTS. The core text companion and Telegram chat work without
any of them.

The web UI binds to `127.0.0.1:3080`; use an SSH tunnel:
`ssh -L 3080:127.0.0.1:3080 user@server`.

## Persona and privacy

The initial persona is intentionally public. Runtime data is not:

- no `events.jsonl`, diaries, dreams, private chats, or owner identity
- no Telegram/DeepSeek/OpenRouter/Breeze keys, cookies, or OAuth tokens
- no images, audio, video, or media index from a live instance

A public repo restores code, the initial persona, and the configuration shape.
It cannot restore an old instance's memories. Use a separate encrypted private
backup for real data.

## Documentation

Chinese documentation lives in [`docs/`](docs/) and the main
[`README.md`](README.md). Start with `docs/deployment.md`.

## License

MIT for this project's code. Third-party components keep their own licenses;
see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
