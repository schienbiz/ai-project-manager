#!/bin/bash
# ngrok-start.sh — Start all ngrok tunnels (HTTP proxy + SSH TCP) and notify Telegram

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

echo "[ngrok] $(date): starting all tunnels (ngrok start --all)"
/usr/local/bin/ngrok start --all &
NGROK_PID=$!

# Wait up to 20s for ngrok local API to be ready
TCP_URL=""
for i in $(seq 1 40); do
  sleep 0.5
  TCP_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); ts=[t for t in d.get('tunnels',[]) if t.get('proto')=='tcp']; print(ts[0]['public_url'] if ts else '')" 2>/dev/null)
  [ -n "$TCP_URL" ] && break
done

if [ -n "$TCP_URL" ]; then
  # e.g. tcp://0.tcp.ngrok.io:12345
  HOST=$(echo "$TCP_URL" | sed 's|tcp://||' | cut -d: -f1)
  PORT=$(echo "$TCP_URL" | grep -oE '[0-9]+$')
  echo "[ngrok] $(date): SSH TCP tunnel active at $HOST:$PORT"
  tg "🔑 *chusMBp SSH Fallback (ngrok)*
Port changes on restart — current:
\`ssh -p $PORT chuchuchien0430@$HOST\`
_(Use when Tailscale is down)_"
else
  echo "[ngrok] $(date): WARNING — could not detect TCP tunnel URL from local API"
fi

wait $NGROK_PID
