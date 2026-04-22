#!/usr/bin/env bash
# install-ollama-bridge.sh — one-shot installer for the self-hosted Ollama AI fallback.
# Sets up Ollama locally and exposes it via Cloudflare tunnel so Plynth's
# Supabase edge functions can reach it as the second link in AI_PROVIDER_CHAIN.
#
# Usage:
#   bash scripts/install-ollama-bridge.sh
#
# After it prints the public URL, run:
#   supabase secrets set OLLAMA_BASE_URL=<printed-url> OLLAMA_SHARED_SECRET=<your-secret>

set -euo pipefail

MODEL="${OLLAMA_MODEL:-llama3.1:8b}"

echo "==> Installing Ollama (if needed)"
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

echo "==> Pulling model: $MODEL"
ollama pull "$MODEL"

echo "==> Enabling Ollama systemd service (binds 127.0.0.1:11434)"
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl enable --now ollama || true
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "!! cloudflared not installed. Install it from https://github.com/cloudflare/cloudflared"
  exit 1
fi

echo "==> Starting Cloudflare tunnel (background)"
LOG=/tmp/plynth-ollama-tunnel.log
nohup cloudflared tunnel --url http://127.0.0.1:11434 >"$LOG" 2>&1 &
PID=$!
echo "tunnel pid: $PID  (log: $LOG)"

# Wait for the URL to appear.
for _ in $(seq 1 20); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [[ -n "${URL:-}" ]] && break
  sleep 1
done

if [[ -z "${URL:-}" ]]; then
  echo "!! Failed to detect tunnel URL; check $LOG"
  exit 1
fi

echo
echo "============================================================"
echo "Ollama bridge ready: $URL"
echo
echo "Run on your dev machine:"
echo "  supabase secrets set OLLAMA_BASE_URL='$URL'"
echo "  supabase secrets set OLLAMA_MODEL='$MODEL'"
echo "  supabase secrets set OLLAMA_SHARED_SECRET='<choose-a-strong-token>'"
echo "============================================================"
