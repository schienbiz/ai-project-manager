#!/bin/bash
# ATung watchdog — checks Syncthing + chusMBp reachability every 5 min
# LaunchAgent: com.atung.watchdog
# When chusMBp services are down: auto-SSH and restart all services.
# Uses Syncthing heartbeat file to distinguish machine-offline vs service-crash.
# locale 護欄：launchd 繼承空 locale → 中文告警在 log 會 mojibake;固定 UTF-8(本檔無 set -u,故為顯示正確性非防崩)。
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# secrets: sourced from untracked ~/.watchdog-secrets (chmod 600, outside any Syncthing folder).
# rotate the token/key there, not here. exits loudly if missing so launchd surfaces it.
SECRETS_FILE="${WATCHDOG_SECRETS:-$HOME/.watchdog-secrets}"
if [ ! -f "$SECRETS_FILE" ]; then
  echo "watchdog: missing $SECRETS_FILE (BOT_TOKEN/CHAT_ID/SYNCTHING_KEY)" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$SECRETS_FILE"
: "${BOT_TOKEN:?watchdog: BOT_TOKEN unset in $SECRETS_FILE}"
: "${CHAT_ID:?watchdog: CHAT_ID unset in $SECRETS_FILE}"
: "${SYNCTHING_KEY:?watchdog: SYNCTHING_KEY unset in $SECRETS_FILE}"
# Machine identity comes from the same untracked secrets file as the token — this repo
# is public, and a Tailscale address plus a username is a fingerprint of a private
# network. Same `:?` treatment as the credentials: absent means exit loudly rather than
# run against an empty host.
: "${CHUSMBP:?watchdog: CHUSMBP unset in $SECRETS_FILE}"
: "${CHUS_USER:?watchdog: CHUS_USER unset in $SECRETS_FILE}"
HB_FILE="$HOME/CloudSync/ai-project-manager/data/heartbeat.json"

CHUS_COOLDOWN_FILE="/tmp/watchdog-chus-cooldown"
CHUS_RESTART_COOLDOWN_FILE="/tmp/watchdog-chus-restart-cooldown"
CHUS_TRANSPORT_COOLDOWN_FILE="/tmp/watchdog-chus-transport-cooldown"
SYNCTHING_COOLDOWN_FILE="/tmp/watchdog-syncthing-cooldown"
COOLDOWN_SECS=1800

RESTART_CMD="for label in com.ai-project-manager.dev com.ai-learning-tool.dev com.proxy.marketing com.voice-trainer com.chusmbp.watchdog; do launchctl kickstart -k gui/501/\$label 2>/dev/null; done"

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
# All three service probes go over Tailscale (${CHUSMBP} = Tailscale IP). The ngrok HTTP
# tunnel (retired 2026-07-11) used to be the ONLY transport-independent probe; its role is
# now filled by BORE_ALIVE — a direct TCP reach to chusMBp's bore.pub SSH tunnel, which
# egresses to the public internet and works even when Tailscale is down. That's what lets us
# distinguish "Tailscale transport down, machine alive" from "machine offline".
# Single-service failure (e.g. AI-PM DB crash) must not trigger a full restart, so any of the
# three Tailscale HTTP probes answering = services reachable.
TAILSCALE_HTTP=$(curl -s --max-time 8 "http://${CHUSMBP}:3004/pm/api/status" -o /dev/null -w '%{http_code}')
TAILSCALE_PROXY=$(curl -s --max-time 6 "http://${CHUSMBP}:3002/health" -o /dev/null -w '%{http_code}')
TAILSCALE_VOICE=$(curl -s --max-time 6 "http://${CHUSMBP}:3005/health" -o /dev/null -w '%{http_code}')

# Out-of-band liveness: probe chusMBp's bore.pub SSH tunnel port (published by
# bore-ssh-tunnel.sh into the Syncthing-synced data dir). Independent of Tailscale.
BORE_PORT=$(grep -oE '[0-9]+' "$HOME/CloudSync/ai-project-manager/data/bore-ssh-current.txt" 2>/dev/null | head -1)
BORE_ALIVE="no"
if [ -n "$BORE_PORT" ] && nc -z -w 5 bore.pub "$BORE_PORT" 2>/dev/null; then BORE_ALIVE="yes"; fi

echo "[watchdog] $(date): heartbeat=${HB_AGE}s status=${CHUS_STATUS} bore=${BORE_ALIVE}(${BORE_PORT:-?}) aipm=${TAILSCALE_HTTP} proxy=${TAILSCALE_PROXY} voice=${TAILSCALE_VOICE}"

if [ "$TAILSCALE_HTTP" = "200" ] || [ "$TAILSCALE_PROXY" = "200" ] || [ "$TAILSCALE_VOICE" = "200" ]; then
  # Services answer over Tailscale → machine up, transport healthy.
  echo "[watchdog] $(date): chusMBp reachable — OK"
  rm -f "$CHUS_COOLDOWN_FILE"
  rm -f "$CHUS_RESTART_COOLDOWN_FILE"
  rm -f "$CHUS_TRANSPORT_COOLDOWN_FILE"
elif [ "$BORE_ALIVE" = "yes" ]; then
  # No Tailscale HTTP, but the machine's bore tunnel is up = machine alive with internet.
  # Try a Tailscale SSH restart: if it works, services had merely crashed; if SSH also fails,
  # Tailscale itself is down while the machine lives = transport degraded (network change).
  echo "[watchdog] $(date): no Tailscale HTTP but bore alive — attempting SSH restart"
  SSH_OUT=$(ssh_restart 2>&1)
  SSH_EXIT=$?
  if [ "$SSH_EXIT" -eq 0 ]; then
    echo "[watchdog] $(date): SSH restart succeeded (services were down)"
    rm -f "$CHUS_COOLDOWN_FILE"
    rm -f "$CHUS_TRANSPORT_COOLDOWN_FILE"
    if ! is_in_cooldown "$CHUS_RESTART_COOLDOWN_FILE"; then
      ALERTS+=("🔄 *chusMBp* services restarted via SSH from ATung\nbore: up:${BORE_PORT} | Tailscale 3004: ${TAILSCALE_HTTP}\n_Auto-recovered_")
      set_cooldown "$CHUS_RESTART_COOLDOWN_FILE"
    fi
  else
    echo "[watchdog] $(date): Tailscale SSH failed but bore up — transport degraded"
    if ! is_in_cooldown "$CHUS_TRANSPORT_COOLDOWN_FILE"; then
      ALERTS+=("🟠 *chusMBp transport degraded* — machine alive (bore SSH up on port ${BORE_PORT}) but Tailscale down\nSSH in via fallback:\n\`ssh -p ${BORE_PORT} ${CHUS_USER}@bore.pub\`\n_Check chusMBp WiFi + Tailscale app (network change?)_")
      set_cooldown "$CHUS_TRANSPORT_COOLDOWN_FILE"
    fi
  fi
else
  # No Tailscale HTTP AND bore not reachable — machine likely offline. Last-ditch SSH restart.
  echo "[watchdog] $(date): chusMBp unreachable (bore down too) — attempting SSH restart"
  SSH_OUT=$(ssh_restart 2>&1)
  SSH_EXIT=$?

  if [ "$SSH_EXIT" -eq 0 ]; then
    # SSH worked → machine alive, services were down
    echo "[watchdog] $(date): SSH restart succeeded"
    rm -f "$CHUS_COOLDOWN_FILE"
    if ! is_in_cooldown "$CHUS_RESTART_COOLDOWN_FILE"; then
      ALERTS+=("🔄 *chusMBp* services restarted via SSH from ATung\nbore: down | Tailscale port 3004: ${TAILSCALE_HTTP}\n_Auto-recovered_")
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
        MSG="🔴 *chusMBp OFFLINE* — SSH + bore unreachable\nHeartbeat stale: ${AGE_MIN} min ago\nTailscale: ${TAILSCALE_HTTP} | bore: down\n\n_Machine may be asleep or powered off_"
      else
        MSG="🔴 *chusMBp* unreachable — SSH failed\nTailscale: ${TAILSCALE_HTTP} | bore: down\n\nSSH when Tailscale reconnects:\n\`ssh ${CHUS_USER}@${CHUSMBP}\`"
      fi
      ALERTS+=("$MSG")
      set_cooldown "$CHUS_COOLDOWN_FILE"
    else
      echo "[watchdog] $(date): chusMBp offline alert suppressed (cooldown)"
    fi
  fi
fi

# --- 3. ATung local agents (self-heal: re-bootstrap if booted out of domain) ---
# 破口(2026-07-09 定位)：此 watchdog 原本只顧 chusMBp；ATung 本機 agent 被 bootout
# 後無人 re-bootstrap → 靜默消失(warehouse 7/9 正是此態)。KeepAlive 只在「已載入」時
# 管 crash，不管「被移出 domain」。此段補上：未註冊→bootstrap；已註冊但 port 死→kickstart。
# 每筆 "label port"（port=0 表示無 HTTP 只驗註冊）。bash 3.2 相容(無 declare -A)。
UID_NUM=$(id -u)
LOCAL_AGENT_COOLDOWN_FILE="/tmp/watchdog-local-agent-cooldown"
LOCAL_RECOVERED=()
for entry in \
  "com.intelligence-journal.dev 3000" \
  "com.voice-trainer.dev 3005" \
  "com.warehouse-scanner.dev 3008"; do
  label="${entry%% *}"; port="${entry##* }"
  plist="$HOME/Library/LaunchAgents/${label}.plist"
  [ -f "$plist" ] || continue   # plist 不存在 = 刻意沒這個 agent，跳過
  if ! launchctl print "gui/${UID_NUM}/${label}" >/dev/null 2>&1; then
    echo "[watchdog] $(date): local agent $label NOT loaded — bootstrapping"
    if launchctl bootstrap "gui/${UID_NUM}" "$plist" 2>/dev/null; then
      LOCAL_RECOVERED+=("$label (re-bootstrap)")
    else
      LOCAL_RECOVERED+=("$label (bootstrap FAILED — 手動查)")
    fi
  elif [ "$port" != "0" ]; then
    # 已載入但 port 不通 → 給 KeepAlive 幾秒，仍不通才 kickstart
    if ! nc -z -w 3 localhost "$port" >/dev/null 2>&1; then
      sleep 5
      if ! nc -z -w 3 localhost "$port" >/dev/null 2>&1; then
        echo "[watchdog] $(date): local agent $label loaded but :$port dead — kickstart"
        launchctl kickstart -k "gui/${UID_NUM}/${label}" 2>/dev/null
        LOCAL_RECOVERED+=("$label (:$port dead → kickstart)")
      fi
    fi
  fi
done
if [ ${#LOCAL_RECOVERED[@]} -gt 0 ]; then
  echo "[watchdog] $(date): local agents recovered: ${LOCAL_RECOVERED[*]}"
  if ! is_in_cooldown "$LOCAL_AGENT_COOLDOWN_FILE"; then
    ALERTS+=("🩺 *ATung 本機 agent 自癒*\n$(printf '%s\n' "${LOCAL_RECOVERED[@]}")")
    set_cooldown "$LOCAL_AGENT_COOLDOWN_FILE"
  fi
else
  echo "[watchdog] $(date): local agents all loaded & healthy"
  rm -f "$LOCAL_AGENT_COOLDOWN_FILE"
fi

# --- audit dead-man's switch ---
# com.atung.audit runs audit-ground-truth.sh daily and pages on FAIL. But a scheduled
# check that stops running is silent in exactly the way the audit's own date gates were
# silent for months: §9 was written to catch an overdue claims ledger and never fired,
# because nothing ran the script that contained it. So something OUTSIDE that schedule
# has to notice, and this watchdog — every 5 minutes, already wired to Telegram — is the
# cheapest thing that already exists.
#
# 48h, not 24h: the audit is daily and this laptop sleeps. One missed day is ordinary;
# two means the schedule itself is broken. A threshold that cries on the ordinary is a
# threshold that gets muted.
AUDIT_HB="$HOME/.audit-last-run"
AUDIT_STALE_SECS=172800
AUDIT_COOLDOWN_FILE="/tmp/watchdog-audit-cooldown"
if [ -f "$AUDIT_HB" ]; then
  AUDIT_AGE=$(( $(date +%s) - $(cat "$AUDIT_HB" 2>/dev/null || echo 0) ))
else
  AUDIT_AGE=$AUDIT_STALE_SECS
fi
if [ "$AUDIT_AGE" -ge "$AUDIT_STALE_SECS" ]; then
  echo "[watchdog] $(date): audit heartbeat stale (${AUDIT_AGE}s)"
  if ! is_in_cooldown "$AUDIT_COOLDOWN_FILE"; then
    ALERTS+=("🕰️ *audit 排程沒在跑* — 心跳已 $(( AUDIT_AGE / 3600 ))h 未更新\ncom.atung.audit 應每日 09:30 執行\n\`launchctl print gui/501/com.atung.audit\`")
    set_cooldown "$AUDIT_COOLDOWN_FILE"
  fi
else
  rm -f "$AUDIT_COOLDOWN_FILE"
fi

if [ ${#ALERTS[@]} -gt 0 ]; then
  MSG="⚙️ *ATung Watchdog*\n\n$(printf '%s\n' "${ALERTS[@]}")"
  send_telegram "$MSG"
  echo "[watchdog] alert sent: ${ALERTS[*]}"
fi
