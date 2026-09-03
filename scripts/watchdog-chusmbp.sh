#!/bin/bash
# ⚠️ 版控鏡像（MIRROR ONLY — NOT EXECUTED）：實際在跑的是 chusMBp 的 ~/watchdog.sh
# （com.chusmbp.watchdog LaunchAgent ProgramArguments 指向 $HOME/watchdog.sh，
# 非本 repo 檔）。改行為必須 SSH 直改 ~/watchdog.sh，完成後再把變更同步回此鏡像。
# 直接改此檔不會影響任何執行中的服務。
#
# 鏡像同步歷史：
#   2026-06-20：ROS HTTP-kill 檢查停用 + 自監控心跳 /tmp/watchdog-hb
#   2026-06-25：com.marketing-assistant.dev 從 NODE_CA_PLISTS + check_service 移除（Marketing 已併入 AI-PM）
#   2026-09-03：整檔自 live 重建。鏡像少了三塊真正在跑的東西 —— ROS bot-token
#               存活守門、BOT_TOKEN 跨 ROS/AI-PM 的 sha 比對、以及寫
#               data/heartbeat.json（ATung 的 watchdog 靠它判斷 chusMBp 死活）。
#               heartbeat 那行曾經在版控裡，被某次 sed 誤刪（見 8efe23b 的訊息）；
#               drift 守門則從未進過版控。從 live 逐位元組重建，只改一處：拿掉
#               註解裡的 Telegram bot 數字 id，這是公開 repo。
# chusMBp service watchdog — runs every 5 min via LaunchAgent
# Checks all 6 services, restarts dead ones, sends Telegram alert on action taken.

# secrets: sourced from untracked ~/.watchdog-secrets (chmod 600, not synced, not in gdrive backup set).
# rotate the token there, not here. exits loudly if missing so launchd surfaces it.
SECRETS_FILE="${WATCHDOG_SECRETS:-$HOME/.watchdog-secrets}"
if [ ! -f "$SECRETS_FILE" ]; then
  echo "watchdog: missing $SECRETS_FILE (BOT_TOKEN/CHAT_ID)" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$SECRETS_FILE"
: "${BOT_TOKEN:?watchdog: BOT_TOKEN unset in $SECRETS_FILE}"
: "${CHAT_ID:?watchdog: CHAT_ID unset in $SECRETS_FILE}"

send_telegram() {
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\":\"${CHAT_ID}\",\"text\":\"$1\",\"parse_mode\":\"Markdown\"}" > /dev/null
}

RESTARTED=()

# ── TLS cert guard ─────────────────────────────────────────────────────────────
# Node.js 20 on macOS Monterey doesn't trust GoDaddy G2 (used by api.telegram.org)
# unless NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem is set. This env var must exist in
# each service plist's EnvironmentVariables. Check and auto-fix if missing.
NODE_CA_PLISTS=(com.relationship-os.dev com.ai-learning-tool.dev com.ai-project-manager.dev com.proxy.marketing)
CA_FIXED=0
for svc in "${NODE_CA_PLISTS[@]}"; do
  plist_file="$HOME/Library/LaunchAgents/${svc}.plist"
  current=$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:NODE_EXTRA_CA_CERTS" "$plist_file" 2>/dev/null)
  if [ "$current" != "/etc/ssl/cert.pem" ]; then
    echo "[watchdog] $(date): $svc missing NODE_EXTRA_CA_CERTS — applying fix"
    /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables dict" "$plist_file" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Delete :EnvironmentVariables:NODE_EXTRA_CA_CERTS" "$plist_file" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:NODE_EXTRA_CA_CERTS string /etc/ssl/cert.pem" "$plist_file"
    launchctl unload "$plist_file" 2>/dev/null || true
    launchctl load "$plist_file"
    CA_FIXED=1
    echo "[watchdog] $(date): reloaded $svc with NODE_EXTRA_CA_CERTS"
  fi
done
if [ "$CA_FIXED" = "1" ]; then
  launchctl setenv NODE_EXTRA_CA_CERTS /etc/ssl/cert.pem
  send_telegram "🔧 *chusMBp Auto-fixed: Node.js TLS cert*\n\nNODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem re-applied to all service plists. Services reloaded."
  sleep 10  # give services time to restart before health checks
else
  echo "[watchdog] $(date): NODE_EXTRA_CA_CERTS OK in all plists"
fi

check_service() {
  local LABEL="$1"
  local URL="$2"
  local HTTP
  HTTP=$(curl -s --max-time 5 "$URL" -o /dev/null -w '%{http_code}')
  if [ "$HTTP" = "000" ] || [ -z "$HTTP" ]; then
    echo "[watchdog] $(date): $LABEL unreachable (HTTP $HTTP) — restarting"
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
# 2026-06-20 停用: ROS Neon compute 配額耗盡→3000永不bind→此HTTP檢查每5分鐘殺活進程(339次)+洗版,且修不了外部Neon根因。plist KeepAlive管真crash,ROS會在Neon重置後自動serve。
# check_service "com.relationship-os.dev"       "http://localhost:3000/health"
check_service "com.proxy.marketing"           "http://localhost:3002/health"
check_service "com.voice-trainer"             "http://localhost:3005/health"

if [ ${#RESTARTED[@]} -gt 0 ]; then
  send_telegram "⚙️ *Watchdog auto-restarted*\n\n$(printf '• %s\n' "${RESTARTED[@]}")\n\n_chusMBp auto-healing triggered_"
  echo "[watchdog] alert sent: ${RESTARTED[*]}"
else
  echo "[watchdog] $(date): all services healthy"
fi

# ── ROS bot-token liveness guard ────────────────────────────────────────────────
# ROS shares one Telegram bot with AI-PM (and this watchdog). A token
# rotation that updates only one holder silently 401-kills the others — 2026-07-22:
# relationship-os/.env was left stale, ROS dead ~2 days with no alert. ROS can't
# self-alert with a dead token, so we check it here and alert via the watchdog's
# own token. Alert-only: never restart ROS on this signal (an HTTP kill loop is
# exactly what caused the 2026-06-20 incident above). getMe has no side effects and
# does not wake Neon, so it is safe to run every 5 min. Throttled to 1 alert/hour.
ROS_ENV="$HOME/relationship-os/.env"
if [ -f "$ROS_ENV" ]; then
  ROS_TOKEN=$(grep -m1 -E '^BOT_TOKEN=' "$ROS_ENV" | cut -d= -f2-)
  if [ -n "$ROS_TOKEN" ]; then
    GM=$(curl -s --max-time 8 "https://api.telegram.org/bot${ROS_TOKEN}/getMe")
    STAMP=/tmp/watchdog-ros-token-alert
    if printf '%s' "$GM" | grep -q '"ok":true'; then
      echo "[watchdog] $(date): ROS token OK"
      rm -f "$STAMP" 2>/dev/null
    else
      CODE=$(printf '%s' "$GM" | grep -oE '"error_code":[0-9]+' | grep -oE '[0-9]+')
      NOW=$(date +%s)
      LAST=$(cat "$STAMP" 2>/dev/null || echo 0)
      if [ $((NOW - LAST)) -gt 3600 ]; then
        send_telegram "🔴 *ROS bot token DEAD* (getMe ${CODE:-fail})\n\nRelationship OS cannot authenticate its bot — likely a token rotation that updated AI-PM/watchdog but not relationship-os/.env. ROS is effectively down.\n\n*Fix:* copy the live BOT_TOKEN from CloudSync/ai-project-manager/.env into relationship-os/.env, then: launchctl kickstart -k gui/501/com.relationship-os.dev"
        echo "$NOW" > "$STAMP"
        echo "[watchdog] $(date): ROS token DEAD (${CODE:-?}) — alerted"
      else
        echo "[watchdog] $(date): ROS token DEAD (${CODE:-?}) — alert throttled"
      fi
    fi
  fi
fi

# ── Shared-secret drift guard (BOT_TOKEN across ROS + AI-PM) ─────────────────────
# ROS and AI-PM share one bot token across two SEPARATE .env files that are never
# cross-populated. 2026-07-22: a rotation updated only ai-pm/.env, ros/.env went
# stale -> ROS dead ~2 days. The getMe guard above watches only ROS's token and is
# BLIND to the mirror case (rotation updates ros, AI-PM's send-only token dies
# silently -> digests vanish, no 401 visible anywhere). This sha-compare catches
# drift in BOTH directions the instant it lands, before Telegram even 401s. Pure
# hashes, no secret printed, no network. Only BOT_TOKEN is a shared invariant now:
# ROS got its own Groq+Cerebras keys 2026-07-22 (intentionally separate), so those
# keys are NOT checked here — divergence is the desired state, not drift.
AIPM_ENV="$HOME/CloudSync/ai-project-manager/.env"
_secval() { grep -m1 -E "^(export )?$2=" "$1" 2>/dev/null | cut -d= -f2- | tr -d '\042\047\015'; }
_sha10()  { printf '%s' "$1" | shasum | cut -c1-10; }
if [ -f "$ROS_ENV" ] && [ -f "$AIPM_ENV" ]; then
  ROS_BT=$(_secval "$ROS_ENV" BOT_TOKEN)
  AIPM_BT=$(_secval "$AIPM_ENV" BOT_TOKEN)
  RS=$(_sha10 "$ROS_BT")
  AS=$(_sha10 "$AIPM_BT")
  DSTAMP=/tmp/watchdog-token-drift-alert
  if [ -n "$ROS_BT" ] && [ "$RS" = "$AS" ]; then
    echo "[watchdog] $(date): BOT_TOKEN in sync across ROS + AI-PM (${RS})"
    rm -f "$DSTAMP" 2>/dev/null
  else
    NOW=$(date +%s)
    LAST=$(cat "$DSTAMP" 2>/dev/null || echo 0)
    if [ $((NOW - LAST)) -gt 3600 ]; then
      send_telegram "🔴 *Shared BOT_TOKEN drift* — ROS vs AI-PM differ\n\nrelationship-os/.env and ai-project-manager/.env hold DIFFERENT bot tokens. A rotation updated one side only. Whichever holds the stale token is 401-dead: ROS = polling stops (bot down); AI-PM = digests and alerts silently vanish.\n\n*Fix:* pick the live token (getMe ok) and write it into BOTH .env, then kickstart the stale service. ROS sha=${RS} AIPM sha=${AS}"
      echo "$NOW" > "$DSTAMP"
      echo "[watchdog] $(date): BOT_TOKEN DRIFT — alerted (ros=${RS} aipm=${AS})"
    else
      echo "[watchdog] $(date): BOT_TOKEN DRIFT — alert throttled (ros=${RS} aipm=${AS})"
    fi
  fi
fi

# Rotate ROS logs if > 5MB
for logfile in ~/relationship-os/logs/stdout.log ~/relationship-os/logs/stderr.log; do
  if [ -f "$logfile" ]; then
    size=$(stat -f%z "$logfile" 2>/dev/null || echo 0)
    if [ "$size" -gt 5242880 ]; then
      mv "$logfile" "${logfile}.bak"
      touch "$logfile"
      echo "[watchdog] rotated $logfile (${size} bytes)"
    fi
  fi
done


date +%s > /tmp/watchdog-hb 2>/dev/null   # 2026-06-20 自監控心跳：AI-PM 讀此檔新鮮度判 watchdog 是否還活著
printf '{"ts":%s}' "$(date +%s)" > ~/CloudSync/ai-project-manager/data/heartbeat.json 2>/dev/null  # 2026-06-28 ATung watchdog 讀此檔判 chusMBp 是否 alive（Syncthing 同步）
exit 0
