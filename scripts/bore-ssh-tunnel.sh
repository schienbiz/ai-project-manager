#!/bin/bash
# bore-ssh-tunnel.sh — SSH fallback tunnel via bore.pub (runs when Tailscale is down)

BORE=~/bin/bore
BORE_LOG=/tmp/bore-ssh-output.log

# Credentials moved out of the plist into .env when the service was migrated, but
# this script kept grepping the plist for them — so BOT_TOKEN came back empty and
# tg() returned early on every call. The one job this script has when Tailscale is
# down is telling you which port bore assigned, and it had been silently skipping
# it. Read them from the same .env the server uses.
ENV_FILE=~/CloudSync/ai-project-manager/.env
BOT_TOKEN="$(grep -E '^BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'"' )"
CHAT_ID="$(grep -E '^OWNER_TELEGRAM_ID=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'"' )"

# Fail loudly rather than degrade into a silent no-op: a notifier that cannot
# notify is worse than one that is absent, because it looks installed.
if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
  echo "[bore-ssh] FATAL: BOT_TOKEN/OWNER_TELEGRAM_ID not found in $ENV_FILE — the tunnel port could not be reported" >&2
  exit 78   # EX_CONFIG
fi

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
  # Publish to the Syncthing-synced data dir so ATung's watchdog can read this port
  # transport-independently: bore is the OUT-OF-BAND liveness signal now that the ngrok
  # HTTP tunnel is retired (2026-07-11). During a Tailscale outage ATung still has the
  # last-synced port on local disk and probes bore.pub:$PORT directly (public internet).
  SYNCED_DIR="$HOME/CloudSync/ai-project-manager/data"
  [ -d "$SYNCED_DIR" ] && echo "$PORT" > "$SYNCED_DIR/bore-ssh-current.txt"
  if should_notify; then
    date +%s > "$COOLDOWN_FILE"
    tg "🔑 *chusMBp SSH Fallback (bore)*
Port changes on restart — current port:
\`ssh -p $PORT $(whoami)@bore.pub\`
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
