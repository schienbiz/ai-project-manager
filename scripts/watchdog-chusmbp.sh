#!/bin/bash
# chusMBp service watchdog — runs every 5 min via LaunchAgent
# Checks all 6 services, restarts dead ones, attempts auto-recovery from stderr,
# sends Telegram alert distinguishing structural vs transient failures.
# Also writes Syncthing-based heartbeat + checks ngrok/Tailscale tunnels.

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

BOT_TOKEN="$(cat ~/Library/LaunchAgents/com.ai-project-manager.dev.plist | grep -A1 'BOT_TOKEN' | tail -1 | sed 's/.*<string>//;s/<\/string>.*//')"
CHAT_ID="$(cat ~/Library/LaunchAgents/com.ai-project-manager.dev.plist | grep -A1 'OWNER_TELEGRAM_ID' | tail -1 | sed 's/.*<string>//;s/<\/string>.*//')"

HB_FILE="$HOME/CloudSync/ai-project-manager/data/heartbeat.json"

send_telegram() {
  [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ] && return
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\":\"${CHAT_ID}\",\"text\":\"$1\",\"parse_mode\":\"Markdown\"}" > /dev/null
}

RESTARTED=()
STRUCTURAL=()   # "label|error_snippet|recovery_result"
# SVC_HTTP tracks last known HTTP code per port (for heartbeat reuse)
SVC_HTTP_3000="000"; SVC_HTTP_3001="000"; SVC_HTTP_3003="000"; SVC_HTTP_3004="000"; SVC_HTTP_3005="000"

# try_kickstart <label>
try_kickstart() {
  local LABEL="$1"
  if ! launchctl kickstart -k "gui/501/$LABEL" 2>/dev/null; then
    launchctl load ~/Library/LaunchAgents/$LABEL.plist 2>/dev/null || true
    sleep 2
    launchctl kickstart -k "gui/501/$LABEL" 2>/dev/null || true
  fi
}

# check_service <label> <url> <stderr_log> <main_file> <service_dir>
check_service() {
  local LABEL="$1"
  local URL="$2"
  local LOG="$3"
  local MAIN_FILE="$4"
  local SVC_DIR="$5"
  local HTTP

  HTTP=$(curl -s --max-time 5 "$URL" -o /dev/null -w '%{http_code}')
  # Record status for heartbeat reuse
  case "$URL" in
    *:3000*) SVC_HTTP_3000="$HTTP" ;;
    *:3001*) SVC_HTTP_3001="$HTTP" ;;
    *:3003*) SVC_HTTP_3003="$HTTP" ;;
    *:3004*) SVC_HTTP_3004="$HTTP" ;;
    *:3005*) SVC_HTTP_3005="$HTTP" ;;
  esac
  if [ "$HTTP" != "000" ] && [ -n "$HTTP" ]; then
    echo "[watchdog] $(date): $LABEL OK ($HTTP)"
    return
  fi

  local ERR_TYPE="transient"
  local ERR_SNIPPET=""
  local RECOVERY="none"

  if [ -n "$LOG" ] && [ -f "$LOG" ]; then
    local TAIL
    TAIL=$(tail -30 "$LOG")

    if echo "$TAIL" | grep -q "SyntaxError"; then
      ERR_TYPE="syntax"
      ERR_SNIPPET=$(echo "$TAIL" | grep "SyntaxError" | head -1)
    elif echo "$TAIL" | grep -qE "MODULE_NOT_FOUND|Cannot find (module|package)"; then
      ERR_TYPE="missing_module"
      ERR_SNIPPET=$(echo "$TAIL" | grep -E "MODULE_NOT_FOUND|Cannot find" | head -1)
    elif echo "$TAIL" | grep -qE "^Error:|UnhandledPromiseRejection|ECONNREFUSED|EADDRINUSE"; then
      ERR_TYPE="runtime_error"
      ERR_SNIPPET=$(echo "$TAIL" | grep -E "^Error:|UnhandledPromiseRejection|ECONNREFUSED|EADDRINUSE" | head -1)
    fi
  fi

  echo "[watchdog] $(date): $LABEL unreachable (HTTP $HTTP) — $ERR_TYPE — attempting recovery"

  case "$ERR_TYPE" in
    syntax)
      local BAK="${MAIN_FILE}.bak"
      if [ -n "$MAIN_FILE" ] && [ -f "$BAK" ]; then
        cp "$BAK" "$MAIN_FILE"
        echo "[watchdog] $(date): $LABEL — restored from .bak"
        try_kickstart "$LABEL"
        sleep 4
        local CHECK
        CHECK=$(curl -s --max-time 5 "$URL" -o /dev/null -w '%{http_code}')
        if [ "$CHECK" != "000" ] && [ -n "$CHECK" ]; then
          RECOVERY="✅ .bak 還原成功（$CHECK）"
        else
          RECOVERY="⚠️ .bak 還原後仍無回應"
        fi
      else
        try_kickstart "$LABEL"
        RECOVERY="⚠️ 無 .bak，需手動修復"
      fi
      ;;
    missing_module)
      if [ -n "$SVC_DIR" ] && [ -d "$SVC_DIR" ]; then
        echo "[watchdog] $(date): $LABEL — running npm install"
        (cd "$SVC_DIR" && npm install --silent 2>/dev/null) && \
          try_kickstart "$LABEL" && sleep 4
        local CHECK
        CHECK=$(curl -s --max-time 5 "$URL" -o /dev/null -w '%{http_code}')
        if [ "$CHECK" != "000" ] && [ -n "$CHECK" ]; then
          RECOVERY="✅ npm install 後恢復（$CHECK）"
        else
          RECOVERY="⚠️ npm install 後仍無回應"
        fi
      else
        try_kickstart "$LABEL"
        RECOVERY="⚠️ 無法定位目錄，需手動修復"
      fi
      ;;
    *)
      try_kickstart "$LABEL"
      RECOVERY="kickstart 已執行（transient）"
      ;;
  esac

  RESTARTED+=("$LABEL")
  if [ "$ERR_TYPE" != "transient" ] && [ "$ERR_TYPE" != "runtime_error" ]; then
    STRUCTURAL+=("$LABEL|$ERR_SNIPPET|$RECOVERY")
  fi
}

check_service "com.ai-project-manager.dev"  "http://localhost:3004/pm/api/status" \
  "/tmp/ai-project-manager.err" \
  "$HOME/CloudSync/ai-project-manager/server/index.js" \
  "$HOME/CloudSync/ai-project-manager"

check_service "com.ai-learning-tool.dev"    "http://localhost:3003/health" \
  "/tmp/ai-learning-tool.err" \
  "$HOME/CloudSync/ai-learning-tool/server.js" \
  "$HOME/CloudSync/ai-learning-tool"

check_service "com.marketing-assistant.dev" "http://localhost:3001/" \
  "/tmp/marketing-assistant.err" \
  "$HOME/CloudSync/marketing-assistant/server.js" \
  "$HOME/CloudSync/marketing-assistant"

check_service "com.relationship-os.dev"     "http://localhost:3000/health" \
  "/tmp/relationship-os.err" \
  "$HOME/relationship-os/src/index.ts" \
  "$HOME/relationship-os"

check_service "com.proxy.marketing"         "http://localhost:3002/" \
  "/tmp/proxy.marketing.err" "" ""

check_service "com.voice-trainer"           "http://localhost:3005/health" \
  "/tmp/voice-trainer.err" \
  "$HOME/CloudSync/voice-trainer/server/index.js" \
  "$HOME/CloudSync/voice-trainer"

# --- Tunnel health checks ---

# ngrok: check local API; restart LaunchAgent if process is gone
if ! pgrep -x ngrok > /dev/null 2>&1; then
  echo "[watchdog] $(date): ngrok not running — restarting"
  launchctl kickstart -k "gui/501/com.relationship-os.ngrok" 2>/dev/null || \
  launchctl kickstart -k "gui/501/com.ngrok" 2>/dev/null || true
fi

# Tailscale: reconnect if offline
TS_BIN="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
if [ -x "$TS_BIN" ]; then
  TS_SELF=$("$TS_BIN" status 2>/dev/null | head -3 | grep -c 'active\|idle')
  if [ "$TS_SELF" -lt 1 ]; then
    echo "[watchdog] $(date): Tailscale offline — reconnecting"
    "$TS_BIN" up 2>/dev/null || true
  fi
fi

# --- Heartbeat to Syncthing-shared file (reuses statuses from check_service above) ---
HB_TS=$(date +%s)
printf '{"ts":%s,"host":"chusMBp","services":{"3000":"%s","3001":"%s","3003":"%s","3004":"%s","3005":"%s"}}\n' \
  "$HB_TS" "$SVC_HTTP_3000" "$SVC_HTTP_3001" "$SVC_HTTP_3003" "$SVC_HTTP_3004" "$SVC_HTTP_3005" > "$HB_FILE"
echo "[watchdog] $(date): heartbeat written (ts=$HB_TS)"

# --- Build Telegram alert ---

if [ ${#RESTARTED[@]} -eq 0 ]; then
  echo "[watchdog] $(date): all services healthy"
  exit 0
fi

MSG="⚙️ *Watchdog triggered*\n\n$(printf '• %s\n' "${RESTARTED[@]}")"

if [ ${#STRUCTURAL[@]} -gt 0 ]; then
  MSG="$MSG\n\n🔴 *Structural failures (auto-recovery attempted):*"
  for ENTRY in "${STRUCTURAL[@]}"; do
    local_label="${ENTRY%%|*}"
    rest="${ENTRY#*|}"
    local_err="${rest%%|*}"
    local_rec="${rest##*|}"
    MSG="$MSG\n• \`$local_label\`"
    [ -n "$local_err" ] && MSG="$MSG\n  ↳ ${local_err:0:80}"
    MSG="$MSG\n  ↳ $local_rec"
  done
else
  MSG="$MSG\n\n_Transient crash — auto-healing triggered_"
fi

send_telegram "$MSG"
echo "[watchdog] alert sent: ${RESTARTED[*]}"
