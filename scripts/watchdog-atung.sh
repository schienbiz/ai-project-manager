#!/bin/bash
# ATung watchdog — checks Syncthing + chusMBp reachability every 5 min
# LaunchAgent: com.atung.watchdog

BOT_TOKEN="8696185476:AAHGPjhDQMkLIbP6XN4jgJiEqpa3Ce1UE2Y"
CHAT_ID="5108352229"
SYNCTHING_KEY="JHPURzgxjGsAmbv5mgRACvL2WYxFHPRW"
CHUSMBP="100.85.224.76"

send_telegram() {
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\":\"${CHAT_ID}\",\"text\":\"$1\",\"parse_mode\":\"Markdown\"}" > /dev/null
}

ALERTS=()

# 1. Syncthing
ST=$(curl -s --max-time 5 http://localhost:8384/rest/system/ping \
  -H "X-API-Key: $SYNCTHING_KEY" 2>/dev/null | grep -c 'pong')
if [ "$ST" -lt 1 ]; then
  echo "[watchdog] $(date): Syncthing down — restarting"
  brew services restart syncthing 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/homebrew.mxcl.syncthing" 2>/dev/null
  ALERTS+=("⚠️ *Syncthing* restarted on ATung")
else
  echo "[watchdog] $(date): Syncthing OK"
fi

# 2. chusMBp reachability (AI PM as probe)
CHUS=$(curl -s --max-time 6 "http://${CHUSMBP}:3004/pm/api/status" -o /dev/null -w '%{http_code}')
if [ "$CHUS" != "200" ]; then
  echo "[watchdog] $(date): chusMBp AI PM unreachable (HTTP $CHUS)"
  ALERTS+=("🔴 *chusMBp AI PM* unreachable (HTTP ${CHUS}) — check Tailscale or restart services")
else
  echo "[watchdog] $(date): chusMBp AI PM OK"
fi

# 3. Tailscale connectivity (quick check)
TS=$(curl -s --max-time 3 "http://${CHUSMBP}:3000/health" -o /dev/null -w '%{http_code}')
if [ "$TS" != "200" ] && [ "$CHUS" = "200" ]; then
  # AI PM works but ROS doesn't — ROS issue not Tailscale
  echo "[watchdog] $(date): ROS unresponsive (HTTP $TS) — chusMBp itself is reachable"
  ALERTS+=("⚠️ *Relationship OS* (port 3000) unresponsive — AI PM is up, ROS may need restart")
fi

if [ ${#ALERTS[@]} -gt 0 ]; then
  MSG="⚙️ *ATung Watchdog Alert*\n\n$(printf '%s\n' "${ALERTS[@]}")"
  send_telegram "$MSG"
  echo "[watchdog] alert sent: ${ALERTS[*]}"
fi
