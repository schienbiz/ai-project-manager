#!/bin/bash
# voice-trainer-funnel.sh — Cloudflare Quick Tunnel for Voice Trainer (:3005)
# Reads credentials from AI-PM .env, sends URL via Telegram (30-min cooldown),
# waits on cloudflared so KeepAlive only restarts after a real exit.

CLOUDFLARED="$HOME/cloudflared"
ENV_FILE="$HOME/CloudSync/ai-project-manager/.env"
TUNNEL_LOG="/tmp/cloudflared.log"
COOLDOWN_FILE="/tmp/vt-funnel-last-notify"
COOLDOWN_SECS=1800

log() { echo "[funnel] $(date): $*"; }

# Parse KEY=value or KEY="value" from .env
read_env() {
  grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^[^=]*=//;s/^"//;s/"$//'
}

BOT_TOKEN=$(read_env BOT_TOKEN)
CHAT_ID=$(read_env OWNER_TELEGRAM_ID)

tg() {
  [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ] && return
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT_ID}" \
    --data-urlencode "text=$1" \
    -d "parse_mode=Markdown" >/dev/null 2>&1 || true
}

should_notify() {
  [ ! -f "$COOLDOWN_FILE" ] && return 0
  local last; last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  [ $(( $(date +%s) - last )) -gt $COOLDOWN_SECS ]
}

# Kill cloudflared child if script exits unexpectedly (SIGTERM from KeepAlive, etc.)
CFPID=""
cleanup() { [ -n "$CFPID" ] && kill "$CFPID" 2>/dev/null || true; }
trap cleanup EXIT

log "starting cloudflared → :3005"
> "$TUNNEL_LOG"

"$CLOUDFLARED" tunnel --url http://localhost:3005 >"$TUNNEL_LOG" 2>&1 &
CFPID=$!
log "cloudflared started (PID=$CFPID)"

# Wait up to 20s for Cloudflare to assign a URL (0.5s polling = faster than 1s)
URL=""
for i in $(seq 1 40); do
  sleep 0.5
  URL=$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
  [ -n "$URL" ] && break
done

if [ -z "$URL" ]; then
  log "ERROR: tunnel URL not found after 20s"
  tg "⚠️ Voice Trainer 隧道無法建立，請檢查 cloudflared log"
  exit 1
fi

log "tunnel active at $URL"

if should_notify; then
  tg "🔗 *Voice Trainer 隧道已建立*
URL: \`$URL\`
chusMBp :3005 → 外網可存取"
  date +%s > "$COOLDOWN_FILE"
  log "Telegram sent"
else
  log "Telegram skipped (cooldown active)"
fi

# Block until cloudflared exits; LaunchAgent KeepAlive will restart us after
wait $CFPID
EXIT_CODE=$?
log "cloudflared exited (code=$EXIT_CODE) — will restart via KeepAlive"
exit 0
