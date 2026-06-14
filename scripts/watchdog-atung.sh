#!/bin/bash
# ATung watchdog — checks Syncthing + chusMBp reachability every 5 min
# LaunchAgent: com.atung.watchdog
# When chusMBp services are down: auto-SSH and restart all services.
# Uses Syncthing heartbeat file to distinguish machine-offline vs service-crash.

BOT_TOKEN="8696185476:AAHGPjhDQMkLIbP6XN4jgJiEqpa3Ce1UE2Y"
CHAT_ID="5108352229"
SYNCTHING_KEY="JHPURzgxjGsAmbv5mgRACvL2WYxFHPRW"
CHUSMBP="100.115.104.42"
CHUS_USER="chuchuchien0430"
HB_FILE="/Users/atungc/CloudSync/ai-project-manager/data/heartbeat.json"

CHUS_COOLDOWN_FILE="/tmp/watchdog-chus-cooldown"
CHUS_RESTART_COOLDOWN_FILE="/tmp/watchdog-chus-restart-cooldown"
SYNCTHING_COOLDOWN_FILE="/tmp/watchdog-syncthing-cooldown"
COOLDOWN_SECS=1800

RESTART_CMD="for label in com.ai-project-manager.dev com.ai-learning-tool.dev com.marketing-assistant.dev com.relationship-os.dev com.proxy.marketing com.voice-trainer com.chusmbp.watchdog; do launchctl kickstart -k gui/501/\$label 2>/dev/null; done"

is_in_cooldown() {
  local file="$1"
  if [ -f "$file" ]; then
    local last=$(cat "$file" 2>/dev/null || echo 0)
    local age=$(( $(date +%s) - last ))
    [ "$age" -lt "$COOLDOWN_SECS" ] && return 0
  fi
  return 1
}

set_cooldown() { date +%s > "$1"; }

send_telegram() {
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\":\"${CHAT_ID}\",\"text\":\"$1\",\"parse_mode\":\"Markdown\"}" > /dev/null
}

ssh_restart() {
  ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no \
    "${CHUS_USER}@${CHUSMBP}" "$RESTART_CMD" 2>&1
}

ALERTS=()

# --- 1. Syncthing ---
ST=$(curl -s --max-time 5 http://localhost:8384/rest/system/ping \
  -H "X-API-Key: $SYNCTHING_KEY" 2>/dev/null | grep -c 'pong')
if [ "$ST" -lt 1 ]; then
  echo "[watchdog] $(date): Syncthing down — restarting"
  brew services restart syncthing 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/homebrew.mxcl.syncthing" 2>/dev/null
  if ! is_in_cooldown "$SYNCTHING_COOLDOWN_FILE"; then
    ALERTS+=("⚠️ *Syncthing* restarted on ATung")
    set_cooldown "$SYNCTHING_COOLDOWN_FILE"
  fi
else
  echo "[watchdog] $(date): Syncthing OK"
  rm -f "$SYNCTHING_COOLDOWN_FILE"
fi

# --- 2. chusMBp: read heartbeat (written by chusMBp watchdog, synced via Syncthing) ---
NOW=$(date +%s)
HB_TS=0
HB_AGE=99999
CHUS_STATUS="unknown"

if [ -f "$HB_FILE" ] && [ "$ST" -ge 1 ]; then
  HB_TS=$(python3 -c "import json; d=json.load(open('$HB_FILE')); print(d.get('ts',0))" 2>/dev/null || echo 0)
  HB_AGE=$(( NOW - HB_TS ))
  if [ "$HB_AGE" -lt 720 ]; then
    CHUS_STATUS="alive"
  else
    CHUS_STATUS="down"
  fi
fi

# Network checks
NGROK_HTTP=$(curl -s --max-time 8 "https://cancel-aneurism-uneven.ngrok-free.dev/health" -o /dev/null -w '%{http_code}')
TAILSCALE_HTTP=$(curl -s --max-time 8 "http://${CHUSMBP}:3004/pm/api/status" -o /dev/null -w '%{http_code}')

echo "[watchdog] $(date): heartbeat=${HB_AGE}s status=${CHUS_STATUS} ngrok=${NGROK_HTTP} tailscale=${TAILSCALE_HTTP}"

if [ "$NGROK_HTTP" = "200" ] || [ "$TAILSCALE_HTTP" = "200" ]; then
  echo "[watchdog] $(date): chusMBp reachable — OK"
  rm -f "$CHUS_COOLDOWN_FILE"
  rm -f "$CHUS_RESTART_COOLDOWN_FILE"
else
  # Services unreachable. Try SSH — port 3004 returning 000 could mean AI-PM crashed,
  # not necessarily that the machine is offline.
  echo "[watchdog] $(date): chusMBp unreachable — attempting SSH restart"
  SSH_OUT=$(ssh_restart 2>&1)
  SSH_EXIT=$?

  if [ "$SSH_EXIT" -eq 0 ]; then
    # SSH worked → machine alive, services were down
    echo "[watchdog] $(date): SSH restart succeeded"
    rm -f "$CHUS_COOLDOWN_FILE"
    if ! is_in_cooldown "$CHUS_RESTART_COOLDOWN_FILE"; then
      ALERTS+=("🔄 *chusMBp* services restarted via SSH from ATung\nngrok: ${NGROK_HTTP} | Tailscale port 3004: ${TAILSCALE_HTTP}\n_Auto-recovered_")
      set_cooldown "$CHUS_RESTART_COOLDOWN_FILE"
    else
      echo "[watchdog] $(date): SSH restart alert suppressed (cooldown)"
    fi
  else
    # SSH failed → machine is offline
    echo "[watchdog] $(date): SSH failed (exit $SSH_EXIT) — machine likely offline"
    if ! is_in_cooldown "$CHUS_COOLDOWN_FILE"; then
      if [ "$CHUS_STATUS" = "down" ]; then
        AGE_MIN=$(( HB_AGE / 60 ))
        MSG="🔴 *chusMBp OFFLINE* — SSH unreachable\nHeartbeat stale: ${AGE_MIN} min ago\nngrok: ${NGROK_HTTP} | Tailscale: ${TAILSCALE_HTTP}\n\n_Machine may be asleep or powered off_\n_Bore SSH port in previous notification_"
      else
        MSG="🔴 *chusMBp* unreachable — SSH failed\nngrok: ${NGROK_HTTP} | Tailscale: ${TAILSCALE_HTTP}\n\nSSH when Tailscale reconnects:\n\`ssh ${CHUS_USER}@${CHUSMBP}\`"
      fi
      ALERTS+=("$MSG")
      set_cooldown "$CHUS_COOLDOWN_FILE"
    else
      echo "[watchdog] $(date): chusMBp offline alert suppressed (cooldown)"
    fi
  fi
fi

if [ ${#ALERTS[@]} -gt 0 ]; then
  MSG="⚙️ *ATung Watchdog*\n\n$(printf '%s\n' "${ALERTS[@]}")"
  send_telegram "$MSG"
  echo "[watchdog] alert sent: ${ALERTS[*]}"
fi
