#!/bin/bash
# ATung watchdog — checks Syncthing + chusMBp reachability every 5 min
# LaunchAgent: com.atung.watchdog

BOT_TOKEN="8696185476:AAHGPjhDQMkLIbP6XN4jgJiEqpa3Ce1UE2Y"
CHAT_ID="5108352229"
SYNCTHING_KEY="JHPURzgxjGsAmbv5mgRACvL2WYxFHPRW"
CHUSMBP="100.85.224.76"

# Alert cooldown files — suppress re-alert for 30 min after last alert
CHUS_COOLDOWN_FILE="/tmp/watchdog-chus-cooldown"
SYNCTHING_COOLDOWN_FILE="/tmp/watchdog-syncthing-cooldown"
COOLDOWN_SECS=1800

is_in_cooldown() {
  local file="$1"
  if [ -f "$file" ]; then
    local last=$(cat "$file" 2>/dev/null || echo 0)
    local now=$(date +%s)
    local age=$(( now - last ))
    [ "$age" -lt "$COOLDOWN_SECS" ] && return 0
  fi
  return 1
}

set_cooldown() {
  date +%s > "$1"
}

send_telegram() {
  local text="$1"
  local keyboard="$2"
  if [ -n "$keyboard" ]; then
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      -H 'Content-Type: application/json' \
      -d "{\"chat_id\":\"${CHAT_ID}\",\"text\":\"${text}\",\"parse_mode\":\"Markdown\",\"reply_markup\":${keyboard}}" > /dev/null
  else
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      -H 'Content-Type: application/json' \
      -d "{\"chat_id\":\"${CHAT_ID}\",\"text\":\"${text}\",\"parse_mode\":\"Markdown\"}" > /dev/null
  fi
}

ALERTS=()
CHUS_ALERT=0

# 1. Syncthing
ST=$(curl -s --max-time 5 http://localhost:8384/rest/system/ping \
  -H "X-API-Key: $SYNCTHING_KEY" 2>/dev/null | grep -c 'pong')
if [ "$ST" -lt 1 ]; then
  echo "[watchdog] $(date): Syncthing down — restarting"
  brew services restart syncthing 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/homebrew.mxcl.syncthing" 2>/dev/null
  if ! is_in_cooldown "$SYNCTHING_COOLDOWN_FILE"; then
    ALERTS+=("⚠️ *Syncthing* restarted on ATung")
    set_cooldown "$SYNCTHING_COOLDOWN_FILE"
  else
    echo "[watchdog] $(date): Syncthing alert suppressed (cooldown)"
  fi
else
  echo "[watchdog] $(date): Syncthing OK"
  rm -f "$SYNCTHING_COOLDOWN_FILE"
fi

# 2. chusMBp reachability — check via ngrok (bypasses firewall) first, Tailscale IP as fallback
# ngrok is outbound from chusMBp so works even when inbound firewall is on
ROS_NGROK=$(curl -s --max-time 6 "https://cancel-aneurism-uneven.ngrok-free.dev/health" -o /dev/null -w '%{http_code}')
CHUS=$(curl -s --max-time 6 "http://${CHUSMBP}:3004/pm/api/status" -o /dev/null -w '%{http_code}')

if [ "$ROS_NGROK" = "200" ]; then
  # ROS reachable via ngrok — chusMBp is alive, firewall may be blocking direct Tailscale access
  echo "[watchdog] $(date): chusMBp reachable via ngrok (ROS OK) — skipping Tailscale-only alerts"
  rm -f "$CHUS_COOLDOWN_FILE"
  if [ "$CHUS" != "200" ]; then
    echo "[watchdog] $(date): AI PM unreachable via Tailscale (HTTP $CHUS) but ngrok OK — likely firewall, not crash"
  fi
elif [ "$CHUS" != "200" ]; then
  echo "[watchdog] $(date): chusMBp unreachable via both ngrok AND Tailscale (HTTP $CHUS)"
  if ! is_in_cooldown "$CHUS_COOLDOWN_FILE"; then
    ALERTS+=("🔴 *chusMBp* unreachable (ngrok + Tailscale both down, HTTP $CHUS) — machine may be offline")
    CHUS_ALERT=1
    set_cooldown "$CHUS_COOLDOWN_FILE"
  else
    echo "[watchdog] $(date): chusMBp alert suppressed (cooldown active)"
  fi
else
  echo "[watchdog] $(date): chusMBp AI PM OK"
  rm -f "$CHUS_COOLDOWN_FILE"
fi

if [ ${#ALERTS[@]} -gt 0 ]; then
  MSG="⚙️ *ATung Watchdog Alert*\n\n$(printf '%s\n' "${ALERTS[@]}")"
  if [ "$CHUS_ALERT" = "1" ]; then
    KEYBOARD='{"inline_keyboard":[[{"text":"🔄 Restart All Services","callback_data":"watchdog:restart_all"},{"text":"📊 Admin Dashboard","url":"https://cancel-aneurism-uneven.ngrok-free.dev/pm/admin"}]]}'
    send_telegram "$MSG" "$KEYBOARD"
  else
    send_telegram "$MSG"
  fi
  echo "[watchdog] alert sent: ${ALERTS[*]}"
fi
