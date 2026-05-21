#!/bin/bash
# chusMBp service watchdog — runs every 5 min via LaunchAgent
# Checks all 5 services, restarts dead ones, sends Telegram alert on action taken.

BOT_TOKEN="$(cat ~/Library/LaunchAgents/com.ai-project-manager.dev.plist | grep -A1 'BOT_TOKEN' | tail -1 | sed 's/.*<string>//;s/<\/string>.*//')"
CHAT_ID="$(cat ~/Library/LaunchAgents/com.ai-project-manager.dev.plist | grep -A1 'OWNER_TELEGRAM_ID' | tail -1 | sed 's/.*<string>//;s/<\/string>.*//')"

send_telegram() {
  [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ] && return
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\":\"${CHAT_ID}\",\"text\":\"$1\",\"parse_mode\":\"Markdown\"}" > /dev/null
}

RESTARTED=()

check_service() {
  local LABEL="$1"
  local URL="$2"
  local HTTP
  HTTP=$(curl -s --max-time 5 "$URL" -o /dev/null -w '%{http_code}')
  if [ "$HTTP" = "000" ] || [ -z "$HTTP" ]; then
    echo "[watchdog] $(date): $LABEL unreachable (HTTP $HTTP) — restarting"
    # kickstart works if plist is loaded; if not (e.g. accidental unload), load it first
    if ! launchctl kickstart -k "gui/501/$LABEL" 2>/dev/null; then
      echo "[watchdog] $(date): $LABEL — kickstart failed, loading plist first"
      launchctl load ~/Library/LaunchAgents/$LABEL.plist 2>/dev/null || true
      sleep 2
      launchctl kickstart -k "gui/501/$LABEL" 2>/dev/null || true
    fi
    RESTARTED+=("$LABEL")
  else
    echo "[watchdog] $(date): $LABEL OK ($HTTP)"
  fi
}

check_service "com.ai-project-manager.dev"   "http://localhost:3004/pm/api/status"
check_service "com.ai-learning-tool.dev"      "http://localhost:3003/health"
check_service "com.marketing-assistant.dev"   "http://localhost:3001/"
check_service "com.relationship-os.dev"       "http://localhost:3000/health"
check_service "com.proxy.marketing"           "http://localhost:3002/"

if [ ${#RESTARTED[@]} -gt 0 ]; then
  send_telegram "⚙️ *Watchdog auto-restarted*\n\n$(printf '• %s\n' "${RESTARTED[@]}")\n\n_chusMBp auto-healing triggered_"
  echo "[watchdog] alert sent: ${RESTARTED[*]}"
else
  echo "[watchdog] $(date): all services healthy"
fi
