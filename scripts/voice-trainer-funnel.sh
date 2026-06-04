#!/bin/bash
# voice-trainer-funnel.sh
# Starts cloudflared quick tunnel for voice-trainer :3005 and sends the URL
# to Telegram when it's assigned. Reads BOT_TOKEN from ai-pm plist so no
# extra config is needed.

CLOUDFLARED="/Users/chuchuchien0430/cloudflared"
CF_LOG="/tmp/cloudflared.log"
URL_FILE="/tmp/voice-trainer-funnel-url.txt"
log() { echo "[funnel] $(date): $*"; }

# Start cloudflared, capturing its output to its own log
"$CLOUDFLARED" tunnel --url http://localhost:3005 > "$CF_LOG" 2>&1 &
CF_PID=$!
log "started cloudflared (PID=$CF_PID)"

# Wait up to 40s for the trycloudflare URL to appear
URL=""
for i in $(seq 1 40); do
    sleep 1
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | head -1)
    [ -n "$URL" ] && break
done

# Get Telegram creds from ai-pm plist
PLIST="$HOME/Library/LaunchAgents/com.ai-project-manager.dev.plist"
BOT_TOKEN="$(grep -A1 'BOT_TOKEN' "$PLIST" | tail -1 | sed 's/.*<string>//;s/<\/string>.*//')"
CHAT_ID="$(grep -A1 'OWNER_TELEGRAM_ID' "$PLIST" | tail -1 | sed 's/.*<string>//;s/<\/string>.*//')"

if [ -n "$URL" ]; then
    log "tunnel active at $URL"
    echo "$URL" > "$URL_FILE"
    if [ -n "$BOT_TOKEN" ] && [ -n "$CHAT_ID" ]; then
        curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
            --data-urlencode "chat_id=${CHAT_ID}" \
            --data-urlencode "text=🌐 voice-trainer tunnel active
${URL}" > /dev/null
        log "Telegram sent"
    fi
else
    log "ERROR: no URL detected after 40s"
fi

# Block until cloudflared exits (keeps KeepAlive from spinning too fast)
wait "$CF_PID"
