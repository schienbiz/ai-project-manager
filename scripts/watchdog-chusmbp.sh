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

STRUCTURAL=()  # services that won't recover without manual fix

check_service() {
  local LABEL="$1"
  local URL="$2"
  local LOG="$3"
  local HTTP
  HTTP=$(curl -s --max-time 5 "$URL" -o /dev/null -w '%{http_code}')
  if [ "$HTTP" = "000" ] || [ -z "$HTTP" ]; then
    # Detect structural failures (SyntaxError, missing module) vs transient crashes
    local FAILURE_TYPE="transient"
    local ERR_SNIPPET=""
    if [ -n "$LOG" ] && [ -f "$LOG" ]; then
      if tail -20 "$LOG" | grep -qE "SyntaxError|MODULE_NOT_FOUND|Cannot find (module|package)"; then
        FAILURE_TYPE="structural"
        ERR_SNIPPET=$(tail -20 "$LOG" | grep -E "SyntaxError|MODULE_NOT_FOUND|Cannot find" | head -1)
      fi
    fi
    echo "[watchdog] $(date): $LABEL unreachable (HTTP $HTTP) — $FAILURE_TYPE — restarting"
    if ! launchctl kickstart -k "gui/501/$LABEL" 2>/dev/null; then
      echo "[watchdog] $(date): $LABEL — kickstart failed, loading plist first"
      launchctl load ~/Library/LaunchAgents/$LABEL.plist 2>/dev/null || true
      sleep 2
      launchctl kickstart -k "gui/501/$LABEL" 2>/dev/null || true
    fi
    RESTARTED+=("$LABEL")
    if [ "$FAILURE_TYPE" = "structural" ]; then
      STRUCTURAL+=("$LABEL|$ERR_SNIPPET")
    fi
  else
    echo "[watchdog] $(date): $LABEL OK ($HTTP)"
  fi
}

check_service "com.ai-project-manager.dev"   "http://localhost:3004/pm/api/status" "/tmp/ai-project-manager.err"
check_service "com.ai-learning-tool.dev"      "http://localhost:3003/health"        "/tmp/ai-learning-tool.err"
check_service "com.marketing-assistant.dev"   "http://localhost:3001/"               "/tmp/marketing-assistant.err"
check_service "com.relationship-os.dev"       "http://localhost:3000/health"         "/tmp/relationship-os.err"
check_service "com.proxy.marketing"           "http://localhost:3002/"               "/tmp/proxy.marketing.err"
check_service "com.voice-trainer"             "http://localhost:3005/health"         "/tmp/voice-trainer.err"

if [ ${#RESTARTED[@]} -gt 0 ]; then
  MSG="⚙️ *Watchdog restarted*\n\n$(printf '• %s\n' "${RESTARTED[@]}")"
  if [ ${#STRUCTURAL[@]} -gt 0 ]; then
    MSG="$MSG\n\n🔴 *Manual fix needed* (structural failure):"
    for ENTRY in "${STRUCTURAL[@]}"; do
      SVC="${ENTRY%%|*}"
      ERR="${ENTRY##*|}"
      MSG="$MSG\n• \`$SVC\`${ERR:+: $ERR}"
    done
    MSG="$MSG\n\n_Kickstart will not fix this — check stderr log_"
  else
    MSG="$MSG\n\n_Auto-healing triggered — transient crash_"
  fi
  send_telegram "$MSG"
  echo "[watchdog] alert sent: ${RESTARTED[*]}"
else
  echo "[watchdog] $(date): all services healthy"
fi
