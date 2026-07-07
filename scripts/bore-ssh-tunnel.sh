#!/bin/bash
# bore-ssh-tunnel.sh — SSH fallback tunnel via bore.pub (runs when Tailscale is down)

BORE=~/bin/bore
BORE_LOG=/tmp/bore-ssh-output.log
PLIST=~/Library/LaunchAgents/com.ai-project-manager.dev.plist
BOT_TOKEN="$(grep -A1 'BOT_TOKEN' "$PLIST" | tail -1 | sed 's/.*<string>//;s/<\/string>.*//')"
CHAT_ID="$(grep -A1 'OWNER_TELEGRAM_ID' "$PLIST" | tail -1 | sed 's/.*<string>//;s/<\/string>.*//')"

tg() {
  [ -z "$BOT_TOKEN" ] && return
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT_ID}" \
    --data-urlencode "text=$1" \
    -d "parse_mode=Markdown" >/dev/null 2>&1
}

COOLDOWN_FILE=/tmp/bore-ssh-last-notify
COOLDOWN_SECS=1800  # 30 minutes between Telegram notifications

echo "[bore-ssh] $(date): starting bore local 22 --to bore.pub"
> "$BORE_LOG"

# Start bore; redirect its output to log for port parsing
"$BORE" local 22 --to bore.pub >"$BORE_LOG" 2>&1 &
BORE_PID=$!

# Wait up to 15s for port assignment
PORT=""
for i in $(seq 1 30); do
  sleep 0.5
  PORT=$(grep -oE 'bore\.pub:[0-9]+' "$BORE_LOG" 2>/dev/null | head -1 | grep -oE '[0-9]+$')
  [ -n "$PORT" ] && break
done

# Check cooldown before sending Telegram
should_notify() {
  [ ! -f "$COOLDOWN_FILE" ] && return 0
  LAST=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  [ $(( $(date +%s) - LAST )) -gt $COOLDOWN_SECS ] && return 0
  return 1
}

if [ -n "$PORT" ]; then
  echo "[bore-ssh] $(date): tunnel active at bore.pub:$PORT"
  echo "$PORT" > /tmp/bore-ssh-current.txt
  if should_notify; then
    date +%s > "$COOLDOWN_FILE"
    tg "🔑 *chusMBp SSH Fallback (bore)*
Port changes on restart — current port:
\`ssh -p $PORT chuchuchien0430@bore.pub\`
_(Use when Tailscale is down)_"
  else
    echo "[bore-ssh] $(date): skipping Telegram (cooldown active)"
  fi
else
  echo "[bore-ssh] $(date): ERROR — failed to obtain port from bore.pub"
  if should_notify; then
    date +%s > "$COOLDOWN_FILE"
    tg "⚠️ chusMBp bore SSH tunnel failed to start. Check /tmp/bore-ssh.log"
  fi
fi

wait $BORE_PID
